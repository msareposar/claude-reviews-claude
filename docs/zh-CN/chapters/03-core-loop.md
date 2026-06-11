# 03. 思考→行动→观察循环

> **本章内容：你将构建驱动每个智能体的核心循环——思考、行动、观察。你的智能体将处理多步任务，并自主判断何时完成。**

---

## 🎯 目标

学完本章，你将能够：

- 理解支撑所有智能体的 **思考→行动→观察** 循环
- 构建一个 `while` 循环，持续运行直到智能体决定停止
- 使用 **ToolDef + build_tool** 定义工具，并通过 **ToolRegistry** 进行调度
- 使用带有并发安全性分区的 **StreamingToolExecutor**
- 处理像"搜索、计算、总结"这样的 **多步任务**
- 跟踪 **Token 预算**并在接近限制时触发压缩

---

## 📖 给 10 岁孩子解释

### 三步舞曲

想象你在烤蛋糕。你不会一步到位，而是：

1. **思考**："我需要看看有没有面粉。"
2. **行动**：你查看橱柜。
3. **观察**："我看到面粉了。现在我需要鸡蛋。"
4. **思考**："我有面粉了。下一步是拿鸡蛋。"
5. **行动**：你检查冰箱。
6. **观察**："我有鸡蛋了。现在需要预热烤箱。"
7. **思考**："准备好开始烘焙了。"
8. **行动**：你开始搅拌原料。
9. **观察**："面糊看起来不错。"
10. ……依此类推，直到蛋糕做好。

这正是 AI 智能体的工作方式！

```
思考    → "我下一步该做什么？"
行动    → 调用工具或回复
观察    → "工具告诉了我什么？"
重复直到任务完成。
```

### 简化循环

```python
while 任务未完成:
    思考()      # LLM 决定做什么
    行动()      # 我们运行工具或给出最终答案
    观察()      # 我们处理发生的事情
```

在第 02 章中，我们的智能体只执行了 **一轮** 循环。LLM 要么调用工具，要么直接回答。但如果任务需要 **多个步骤** 呢？

```
用户："200 的 15% 是多少，然后在这个结果的 10% 上加 10%？"

第 1 步：LLM 计算 200 的 15% → 30
第 2 步：LLM 计算 30 的 10% → 3
第 3 步：LLM 计算 30 + 3 → 33
第 4 步：LLM 说"答案是 33"
```

每一步都是循环的一次迭代。智能体持续运行，直到它认为任务完成。

---

## 🔧 动手实践：构建核心循环

### Step 0：工具系统模块

首先，创建我们将在每一章中使用的工具系统模块。它使用与 claude-code 相同的模式——用于验证的 Schema、用于创建工具的 ToolDef + build_tool，以及带有别名查找功能的 ToolRegistry。

创建 `tool_system.py`：

```python
# tool_system.py — 可复用的工具系统（类似 claude-code 的 Tool.ts）
# 源码模式：restored-src/src/Tool.ts

from typing import Any, Dict, List, Optional, Tuple, Callable


class Schema:
    """验证工具输入。类似 claude-code 的 Zod schemas。"""
    def __init__(self, properties: dict, required: list = None):
        self.schema = {
            "type": "object",
            "properties": properties,
            "required": required or [],
        }
    def validate(self, data: dict) -> Tuple[bool, Optional[str]]:
        for key in self.schema["required"]:
            if key not in data:
                return False, f"缺少必填字段：'{key}'"
        for key, value in data.items():
            prop = self.schema["properties"].get(key)
            if prop:
                t = prop.get("type")
                if t == "string" and not isinstance(value, str):
                    return False, f"'{key}' 必须是字符串类型"
        return True, None
    def to_json_schema(self):
        return self.schema


class Tool:
    """从 ToolDef 构建的工具对象。类似 claude-code 的 Tool 类型。"""
    def __init__(self, name, description, input_schema, call_fn,
                 is_concurrency_safe=True, aliases=None):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self._call = call_fn
        self.is_concurrency_safe = is_concurrency_safe
        self.aliases = aliases or []
    def call(self, **kwargs) -> str:
        is_valid, error = self.input_schema.validate(kwargs)
        if not is_valid:
            return f"ValidationError: {error}"
        try:
            return self._call(**kwargs)
        except Exception as e:
            return f"Error({type(e).__name__}): {e}"
    def to_openai_schema(self):
        return {"type": "function", "function": {
            "name": self.name, "description": self.description,
            "parameters": self.input_schema.to_json_schema(),
        }}


class ToolDef:
    """用于构建 Tool 的定义。类似 claude-code 的 ToolDef。"""
    def __init__(self, name, description, input_schema, call,
                 is_concurrency_safe=True, aliases=None):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.call = call
        self.is_concurrency_safe = is_concurrency_safe
        self.aliases = aliases or []


def build_tool(tool_def: ToolDef) -> Tool:
    """从 ToolDef 构建 Tool。类似 claude-code 的 buildTool()。"""
    return Tool(tool_def.name, tool_def.description, tool_def.input_schema,
                tool_def.call, tool_def.is_concurrency_safe, tool_def.aliases)


class ToolRegistry:
    """带有别名查找功能的注册表。类似 claude-code 的 findToolByName()。"""
    def __init__(self):
        self._tools = {}
    def register(self, tool: Tool):
        self._tools[tool.name] = tool
    def register_many(self, tools: list):
        for t in tools:
            self.register(t)
    def find_tool(self, name: str) -> Optional[Tool]:
        tool = self._tools.get(name)
        if tool:
            return tool
        for t in self._tools.values():
            if name in t.aliases:
                return t
        return None
    def run_tool(self, name: str, args: dict) -> str:
        tool = self.find_tool(name)
        if not tool:
            return f"错误：未知工具 '{name}'"
        return tool.call(**args)
    def get_openai_schemas(self):
        return [t.to_openai_schema() for t in self._tools.values()]
    def concurrency_safe_tools(self):
        return [t for t in self._tools.values() if t.is_concurrency_safe]
```

### Step 1：用 Schema + build_tool 定义工具

现在让我们使用工具系统来定义智能体的工具。每个工具都有一个 Schema、一个实现函数，并通过 `build_tool(ToolDef)` 构建。这反映了 claude-code 在 `Tool.ts` 中定义工具的方式。

创建 `core_loop.py`：

```python
import math
import json
import os
from openai import OpenAI
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ─── 定义工具（类似 claude-code 的 buildTool(ToolDef)）────

calc_schema = Schema(
    properties={
        "expression": {
            "type": "string",
            "description": "要计算的数学表达式，例如 '2 + 2'",
        },
    },
    required=["expression"],
)

def calculate_impl(expression: str) -> str:
    """计算数学表达式。"""
    allowed = {
        "abs": abs, "round": round, "sqrt": math.sqrt,
        "sin": math.sin, "cos": math.cos, "pi": math.pi, "e": math.e,
    }
    return str(eval(expression, {"__builtins__": {}}, allowed))

search_schema = Schema(
    properties={
        "query": {"type": "string", "description": "搜索查询词"},
    },
    required=["query"],
)

def search_impl(query: str) -> str:
    """模拟网络搜索。"""
    fake_db = {
        "france capital": "法国的首都是巴黎。",
        "japan population": "日本人口约为 1.25 亿（2024 年估计）。",
        "tokyo weather": "东京天气：22°C，晴。",
        "python language": "Python 是一种高级解释型编程语言，由 Guido van Rossum 于 1991 年创建。",
        "ai agent": "AI 智能体是一种使用 LLM 进行推理并调用工具来完成任务的系统。",
    }
    for key, value in fake_db.items():
        if key in query.lower():
            return value
    return f"搜索 '{query}' 的结果：未找到具体数据。"

time_schema = Schema(properties={})

def time_impl() -> str:
    from datetime import datetime
    return f"当前时间：{datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

# ─── 构建工具（类似 claude-code 的 buildTool）─────────────

calculator = build_tool(ToolDef(
    name="calculate",
    description="计算数学表达式。支持 +、-、*、/、sqrt()、pow()、sin()、cos()、pi、e 等。",
    input_schema=calc_schema,
    call=calculate_impl,
    is_concurrency_safe=True,
    aliases=["calc", "math"],
))

searcher = build_tool(ToolDef(
    name="search_web",
    description="搜索网络获取信息。用于查找事实、定义和知识性问题。",
    input_schema=search_schema,
    call=search_impl,
    is_concurrency_safe=True,
    aliases=["search", "web"],
))

clock = build_tool(ToolDef(
    name="get_time",
    description="获取当前日期和时间。",
    input_schema=time_schema,
    call=time_impl,
    is_concurrency_safe=True,
))

# ─── 注册表 ───────────────────────────────────────────────

registry = ToolRegistry()
registry.register_many([calculator, searcher, clock])

# 为 LLM 提供 OpenAI 兼容的 schema
tools_schema = registry.get_openai_schemas()
```

### Step 2：StreamingToolExecutor

在 claude-code 中，`StreamingToolExecutor` 根据并发安全性对工具进行分区，并将结果流式返回。让我们构建我们的版本：

```python
# ─── 流式工具执行器（类似 claude-code 的 StreamingToolExecutor.ts）──

class ToolResult:
    """单个工具执行结果，可流式返回。"""
    def __init__(self, tool_name: str, output: str, success: bool = True):
        self.tool_name = tool_name
        self.output = output
        self.success = success

class StreamingToolExecutor:
    """
    支持并发执行工具的执行器。

    类似 claude-code 的 StreamingToolExecutor（源码：
    restored-src/src/services/tools/StreamingToolExecutor.ts）。
    将工具分区为可并发和不可并发的批次。
    """
    def __init__(self, registry: ToolRegistry):
        self.registry = registry

    def partition_tools(self, tool_calls: list) -> tuple:
        """
        将工具调用分区为可并发和不可并发的组。
        安全工具可并行运行；不安全工具依次运行。
        """
        safe = []
        unsafe = []
        for tc in tool_calls:
            tool = self.registry.find_tool(tc["name"])
            if tool and tool.is_concurrency_safe:
                safe.append(tc)
            else:
                unsafe.append(tc)
        return safe, unsafe

    def execute(self, tool_calls: list) -> List[ToolResult]:
        """
        用分区策略执行所有工具调用。
        安全批次并行运行（此处模拟）；不安全批次串行运行。
        """
        safe_calls, unsafe_calls = self.partition_tools(tool_calls)

        # 运行并发安全工具（模拟并行）
        safe_results = [self._run_one(c) for c in safe_calls]

        # 运行不安全工具（依次执行）
        unsafe_results = [self._run_one(c) for c in unsafe_calls]

        return safe_results + unsafe_results

    def _run_one(self, tc: dict) -> ToolResult:
        """执行单个工具调用。"""
        output = self.registry.run_tool(tc["name"], tc.get("args", {}))
        return ToolResult(tc["name"], output)

executor = StreamingToolExecutor(registry)
```

### Step 3：带 Token 预算的上下文管理器

Claude-code 会跟踪上下文窗口使用情况，并在接近限制时触发 **自动压缩**。让我们添加一个简化版本：

```python
# ─── 上下文管理器（类似 claude-code 的自动压缩）────

class ContextManager:
    """
    跟踪 Token 使用情况，并在需要时触发压缩。

    类似 claude-code 的 compact 服务（源码：
    restored-src/src/services/compact/compact.ts）。
    """
    def __init__(self, max_tokens: int = 128000):
        self.max_tokens = max_tokens
        self.compaction_threshold = int(max_tokens * 0.75)

    def check_budget(self, current_tokens: int) -> dict:
        """
        检查 Token 预算并返回状态。

        返回：
            {"ok": True} — 仍在预算内
            {"ok": False, "action": "compact"} — 接近限制，需要压缩
        """
        remaining = self.max_tokens - current_tokens
        if current_tokens > self.compaction_threshold:
            return {"ok": False, "action": "compact",
                    "message": f"上下文已使用 {current_tokens}/{self.max_tokens} tokens。正在压缩..."}
        return {"ok": True, "remaining": remaining}

    def compact(self, messages: list) -> list:
        """
        通过总结较早轮次来压缩消息。
        保留系统提示词 + 最近的原始对话。
        """
        system_msgs = [m for m in messages if m["role"] == "system"]
        # 保留最近 2 轮（4 条消息）的原文
        recent = messages[-4:] if len(messages) > 4 else messages
        old = messages[len(system_msgs):-4] if len(messages) > 4 else []

        if not old:
            return messages

        summary = f"[上下文已压缩：{len(old)} 条较早消息已总结]"
        return system_msgs + [
            {"role": "system", "content": summary}
        ] + recent

ctx = ContextManager(max_tokens=128000)
```

### Step 4：核心循环

现在让我们使用我们的工具系统构建 **思考→行动→观察** 循环。这反映了 claude-code 的 `query.ts` 如何编排智能体：

```python
# ─── 核心循环 ────────────────────────────────────

def run_agent(user_input: str, max_steps: int = 10) -> str:
    """
    以思考→行动→观察循环运行智能体。
    使用 ToolRegistry、StreamingToolExecutor 和 ContextManager。
    """
    messages = [
        {
            "role": "system",
            "content": (
                "你是一个乐于助人的智能体，逐步解决任务。\n"
                "你可以使用工具。请遵循以下流程：\n"
                "1. 思考你需要做什么\n"
                "2. 如果需要就使用工具\n"
                "3. 观察结果\n"
                "4. 继续直到任务完成\n"
                "当你拥有所有需要的信息时，直接回复。\n"
                "重要提示：在决定任务完成前，务必检查工具的结果。"
            ),
        },
        {"role": "user", "content": user_input},
    ]

    step = 0
    total_tokens = 0

    while step < max_steps:
        step += 1
        print(f"\n{'='*50}")
        print(f"🔄 第 {step} 步：思考中...")

        # ─── 思考 ────────────────────────────────────
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=tools_schema,
        )

        # 跟踪 Token 使用
        if hasattr(response, 'usage') and response.usage:
            total_tokens += response.usage.total_tokens
            print(f"📊 已用 Token 总数：{total_tokens}")

        message = response.choices[0].message

        # ─── 检查预算 ─────────────────────────────
        budget = ctx.check_budget(total_tokens)
        if not budget["ok"]:
            print(f"⚠️ {budget['message']}")
            messages = ctx.compact(messages)

        # ─── 检查是否完成 ────────────────────────────
        if not message.tool_calls:
            print(f"✅ 智能体决定任务完成。")
            print(f"💬 最终回复：{message.content}")
            return message.content

        # ─── 行动 ──────────────────────────────────────
        messages.append(message)

        # 将 OpenAI 工具调用转换为我们的格式
        tool_calls = []
        for tc in message.tool_calls:
            tool_calls.append({
                "name": tc.function.name,
                "args": json.loads(tc.function.arguments),
            })
            print(f"🔧 行动：调用 {tc.function.name}({tc.function.arguments})")

        # 通过 StreamingToolExecutor 执行（带分区）
        results = executor.execute(tool_calls)

        # ─── 观察 ──────────────────────────────────
        for i, (tc, result) in enumerate(zip(message.tool_calls, results)):
            print(f"👀 观察：{result.output[:80]}...")
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result.output,
            })

    # 如果达到最大步数，强制给出最终答案
    print(f"⚠️ 已达到最大步数（{max_steps}）。正在强制生成最终答案。")
    messages.append({
        "role": "system",
        "content": "你已经达到最大步数。请根据到目前为止完成的工作，给出最佳答案。"
    })

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
    )
    return response.choices[0].message.content


# ─── 试运行 ───────────────────────────────────────────

if __name__ == "__main__":
    test_tasks = [
        "25 * 4 等于多少？",
        "法国的首都是什么？200 的 15% 是多少？",
        "搜索日本的人口，然后计算它的 10% 是多少。",
        "东京的天气怎么样？另外，现在几点了？",
    ]

    for task in test_tasks:
        print(f"\n\n{'#'*60}")
        print(f"❓ 用户：{task}")
        print(f"{'#'*60}")
        result = run_agent(task)
        print(f"\n📨 最终结果：{result}")
```

### Step 5：运行

```bash
python core_loop.py
```

仔细观察输出。你会看到智能体：

1. **思考** 任务
2. **行动**：通过 `StreamingToolExecutor` 调用工具
3. **观察** 结果
4. 如果需要更多工作则 **重复**

示例输出——"搜索日本的人口，然后计算它的 10% 是多少。"

```
############################################################
❓ 用户：搜索日本的人口，然后计算它的 10% 是多少。
############################################################

==================================================
🔄 第 1 步：思考中...
📊 已用 Token 总数：412
🔧 行动：调用 search_web({"query":"japan population"})
👀 观察：日本人口约为 1.25 亿（2024 年估计）。....

==================================================
🔄 第 2 步：思考中...
📊 已用 Token 总数：678
🔧 行动：调用 calculate({"expression":"125000000 * 0.1"})
👀 观察：12500000.0....

==================================================
🔄 第 3 步：思考中...
📊 已用 Token 总数：823
✅ 智能体决定任务完成。
💬 最终回复：日本人口约为 1.25 亿，其 10% 为 1250 万。
```

**三步完成一个两部分任务。** 智能体：
1. 搜索了人口
2. 计算了 10%
3. 做出回答

---

## 🔍 工作原理

### 智能体状态机

核心循环是一个简单的状态机：

```
                   ┌──────────────┐
                   │   开始       │
                   │ （用户输入） │
                   └──────┬───────┘
                          │
                          ▼
                   ┌──────────────┐
            ┌──────│   思考       │──────┐
            │      │ （LLM 决策） │      │
            │      └──────────────┘      │
            │                            │
            ▼                            ▼
    ┌──────────────┐           ┌────────────────┐
    │   行动       │           │   回复         │
    │ （调用工具） │           │ （回答用户）   │
    └──────┬───────┘           └───────┬────────┘
            │                          │
            ▼                          ▼
    ┌──────────────┐           ┌────────────────┐
    │   观察       │           │   完成         │
    │ （获取结果） │           │ （退出循环）   │
    └──────┬───────┘           └────────────────┘
            │
            └──→ 返回思考 ──┘
```

### 各部分如何连接

我们的智能体使用三个受 claude-code 启发的层：

| 层次 | 我们的代码 | 在 claude-code 中 |
|---|---|---|
| **工具定义** | `Schema` + `build_tool(ToolDef)` | `restored-src/src/Tool.ts` |
| **工具注册表** | `ToolRegistry.find_tool()` 带别名查找 | `findToolByName()` |
| **执行** | `StreamingToolExecutor` 带并发分区 | `StreamingToolExecutor.ts` |
| **上下文** | `ContextManager` 带 Token 预算 + 压缩 | `compact.ts` |

### 为什么分三个独立层次？

每个层次处理一个关注点：

- **工具系统**：工具如何定义和验证
- **执行器**：工具如何运行（并行 vs 串行）
- **上下文管理器**：对话如何保持在限制内

这种分离反映了 claude-code 的架构。它使每个部分都可测试、可替换。

### 分区：安全工具 vs 不安全工具

当 LLM 在一次回复中调用多个工具时，我们的 `StreamingToolExecutor` 会检查每个工具的 `is_concurrency_safe` 标志：

- **`is_concurrency_safe=True`**：无副作用，可并行运行（计算、搜索、读取操作）
- **`is_concurrency_safe=False`**：有副作用，必须串行执行（文件写入、状态变更）

安全工具同时运行（用循环模拟；在 claude-code 中使用 `Promise.all()`）。不安全工具依次运行以避免竞态条件。

### Token 预算跟踪

随着智能体循环运行，对话不断增长。每次工具调用和结果都会增加 token。我们的 `ContextManager` 跟踪使用情况，并在接近限制时发出警告。在 claude-code 中，这触发自动压缩——较早的对话轮次被总结以释放空间。

### 理解思考阶段

在 **思考** 阶段，LLM 看到：

1. 系统消息（指令）
2. 之前的所有对话（用户、助手、工具结果）
3. 工具定义（来自 `registry.get_openai_schemas()`）

然后它决定：

```
选项 A："我有足够的信息了。让我回复。"
          → content = "答案是……", tool_calls = None

选项 B："我需要更多信息。让我调用工具。"
          → content = None, tool_calls = [{name: "calculate", args: {...}}]

选项 C："我需要多个信息。"
          → content = None, tool_calls = [{...}, {...}]  （多个工具！）
```

### 一次响应中调用多个工具

LLM 可以在一次回复中调用 **多个工具**。例如，如果你问：

> "东京的天气怎么样？法国的首都是什么？"

LLM 可能同时回复 **两个工具调用**：

```json
[
  {"name": "search_web", "arguments": {"query": "tokyo weather"}},
  {"name": "search_web", "arguments": {"query": "capital of france"}}
]
```

我们的 `StreamingToolExecutor` 通过分区和高效执行来处理这种情况。

### 处理最大步数

如果智能体陷入无限循环怎么办？

```
智能体："我需要搜索。" → 搜索
智能体："有趣。让我再搜索一下。" → 再次搜索
智能体："让我再确认一次。" → 永远搜索下去……
```

这就是我们设置 `max_steps` 的原因。它是一个 **安全限制**。如果智能体超过它，我们就强制生成最终答案。

在生产环境中，你还需要：

- **Token 限制**：对话太长时停止
- **时间限制**：耗时太久时停止
- **循环检测**：检测是否反复用相同参数调用相同工具

### 观察的重要性

当工具返回结果后，该结果成为对话的一部分。LLM **读取** 它并决定下一步做什么。

```
messages = [
    system: "你是一个乐于助人的智能体……",
    user: "搜索日本人口并计算 10%",
    assistant: （工具调用：search_web）,
    tool: "日本人口约为 1.25 亿……",
    # 现在 LLM 看到了这个结果，知道了人口数据
    assistant: （工具调用：calculate, expression: 125000000 * 0.1）,
    tool: "12500000.0",
    # 现在 LLM 有了两个信息
    assistant: "答案是 1250 万。",
]
```

每次观察都 **改变了思考阶段的上下文**。

---

## 🧪 练习

### 练习 1：添加文件写入工具（带并发标志）

添加一个将文本写入文件的工具。由于写入是副作用，它 **不** 应该是并发安全的：

```python
write_schema = Schema(
    properties={
        "filename": {"type": "string", "description": "文件名"},
        "content": {"type": "string", "description": "要写入的内容"},
    },
    required=["filename", "content"],
)

def write_file_impl(filename: str, content: str) -> str:
    with open(filename, 'w') as f:
        f.write(content)
    return f"成功将 {len(content)} 个字符写入 {filename}"

writer = build_tool(ToolDef(
    name="write_file",
    description="将文本内容写入文件。",
    input_schema=write_schema,
    call=write_file_impl,
    is_concurrency_safe=False,  # ⚠️ 有副作用：必须串行执行
))

registry.register(writer)
```

**测试：**"搜索关于 Python 的信息，然后将总结保存到 python_info.txt"

### 练习 2：串联三个工具

创建一个需要 **三步** 连续工具调用的任务：

- 搜索某位名人的出生年份
- 计算他们如果健在现在多大
- 将结果保存到文件

观察智能体如何规划和执行所有三个步骤。

### 练习 3：观察并发分区

添加调试输出，观察执行器如何分区工具调用：

```python
# 在 execute() 内部添加：
print(f"  ⚡ 安全批次：{[c['name'] for c in safe_calls]}")
print(f"  🔒 串行执行：{[c['name'] for c in unsafe_calls]}")
```

用一个触发多个并发调用的任务来测试。

### 练习 4：测试别名解析

使用别名代替规范工具名称。注册表应该仍能正确匹配：

```python
# "search" 是 "search_web" 的别名
response = registry.run_tool("search", {"query": "capital of france"})
print(response)  # 应该能正常工作！
```

### 练习 5：跟踪每步的 Token 使用

修改循环以跟踪提示和补全的 token：

```python
usage = response.usage
print(f"📊 提示：{usage.prompt_tokens} | "
      f"补全：{usage.completion_tokens} | "
      f"总计：{usage.total_tokens}")
```

运行一个多步任务，观察 token 成本如何累积。

### 挑战：构建"研究助手"

创建一个拥有以下工具的智能体：
1. `search_web` —— 查找事实
2. `calculate` —— 数学计算
3. `write_file` —— 保存结果
4. `get_time` —— 获取时间戳

要求它："研究日本人口最多的 3 个城市。对每个城市，计算它们大约占日本总人口的百分比。将结果连同时间戳保存到 japan_cities_report.txt。"

这需要：
- 多次搜索（每个城市一次）
- 多次计算
- 最后写入文件

观察智能体如何规划并执行这个复杂任务！

---

## 📝 总结

### 核心概念

| 概念 | 含义 | 在 claude-code 中 |
|---|---|---|
| **思考** | LLM 查看上下文并决定做什么 | `query.ts` |
| **行动** | 用具体参数调用工具 | `runTools()` |
| **观察** | 处理工具结果并加入上下文 | 追加消息 |
| **循环** | 重复思考→行动→观察直到完成 | 主智能体循环 |
| **StreamingToolExecutor** | 根据并发安全性对工具分区 | `StreamingToolExecutor.ts` |
| **ContextManager** | 跟踪 Token 预算，触发压缩 | `compact.ts` |
| **最大步数** | 防止无限循环的安全限制 | `maxIterations` |

### 核心循环模式

```python
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

# 1. 用 Schema + build_tool(ToolDef) 定义工具
calc = build_tool(ToolDef(name="calculate", ..., call=calculate_impl))
registry = ToolRegistry()
registry.register_many([calc, ...])

# 2. 创建执行器和上下文管理器
executor = StreamingToolExecutor(registry)
ctx = ContextManager(max_tokens=128000)

# 3. 循环
messages = [{"role": "system", "content": prompt}, {"role": "user", "content": input}]

while step < max_steps:
    # 思考
    response = client.chat.completions.create(model="...", messages=messages, tools=tools)

    # 检查预算
    if not ctx.check_budget(total_tokens)["ok"]:
        messages = ctx.compact(messages)

    # 检查是否完成
    if not response.choices[0].message.tool_calls:
        return response.choices[0].message.content

    # 行动 + 观察（通过 StreamingToolExecutor）
    msg = response.choices[0].message
    messages.append(msg)
    results = executor.execute(tool_calls)
    for tc, result in zip(msg.tool_calls, results):
        messages.append({"role": "tool", "tool_call_id": tc.id, "content": result.output})
```

### 核心洞察

> **单次 LLM 调用不是智能体。让 LLM 自主决定何时停止的循环——那才是智能体。**

循环是引擎。它赋予 LLM 迭代、自我修正以及处理任何单一提示都无法解决的复杂任务的能力。

### 后续内容

在 **[第 04 章：工具系统：手与脚](./04-tool-system.md)** 中，你将深入探索我们从本章开始的工具系统——Schema 验证、基于别名的调度、并发控制以及完整的工具生命周期。你将构建一个完整的、可直接上线的工具系统。

---

*"思考。行动。观察。重复。这不只是智能体的工作方式——也是我们的工作方式。"*
