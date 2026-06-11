# 02. 动手搭建第一个智能体

> **本章内容：你将把 LLM 和一个工具结合起来，打造你的第一个真正意义上的 AI 智能体。它会做数学题——而且知道什么时候该用计算器。**

---

## 🎯 目标

学完本章，你将能够：

- 理解智能体和聊天机器人有什么不同
- 用 **Schema + build_tool** 定义工具（就像 claude-code 的 `buildTool(ToolDef)`）
- 实现 LLM 的**函数调用（Function Calling / Tool Use）**
- 使用**别名解析**，让 LLM 可以用不同的名字调用工具
- 拥有一个既能回答问题、又能做数学运算的工作智能体

---

## 📖 给 10 岁孩子解释

### 什么是智能体？

**聊天机器人**只管说话。**智能体**会采取行动。

> **智能体 = LLM（大脑）+ 工具（双手）**

这样来理解：

- **你**就是一个智能体。你有大脑（用来思考）和双手（用来做事）。
- **计算器**只是一个工具，它不会思考。
- **单独的 LLM** 就像只有大脑没有手——能说不能做。
- **智能体**就是大脑和双手连在一起。

```
聊天机器人：用户提问 → LLM 回答
智能体：    用户提问 → LLM 思考 → LLM 决定：
                                 ├─ "我能回答" → 直接回复
                                 └─ "我需要工具" → 调用工具 → 拿到结果 → 回复
```

### 为什么这很难？

LLM 很擅长**生成文字**，但它们做不到：

- 做精确的数学计算（试试问："1234 × 5678 等于多少？"）
- 访问互联网
- 读取文件
- 控制现实世界中的任何东西

但 LLM 很擅长**决定该做什么**。所以思路是：

1. 给 LLM 一些**工具**（它可以调用的函数）
2. 让 LLM **决定**是否需要使用工具
3. LLM 告诉我们**该调用哪个工具**、传入**什么参数**
4. 我们执行工具，把结果送回给 LLM
5. LLM 组织最终的答案

这就是**函数调用（Function Calling）**，也叫**工具调用（Tool Use）**。

### 计算器示例

```
用户："200 的 15% 是多少？"

LLM 思考："我需要计算 200 的 15%。
           我有一个 'calculate' 工具。让我调用它。"

LLM 输出：{"tool": "calculate", "args": {"expression": "0.15 * 200"}}

我们执行：calculate("0.15 * 200") → 30.0

我们送回："结果是 30.0"

LLM 回复："200 的 15% 是 30。"
```

LLM 从不自己做数学运算，它只是编排工具的使用。

---

## 🔧 动手实践：构建一个计算器智能体

### Step 1：工具系统模块

首先，我们构建一个可复用的工具系统，后续每一章都会用到它。它模仿了 claude-code 定义工具的方式——用 Schema 做验证，用 `build_tool(ToolDef)` 创建工具，用 `ToolRegistry` 做别名查找。

创建一个名为 `tool_system.py` 的文件：

```python
# tool_system.py — 可复用的工具系统（类似 claude-code 的 Tool.ts）
# 源码参考：restored-src/src/Tool.ts

from typing import Any, Dict, List, Optional, Tuple, Callable


class Schema:
    """
    在工具执行前验证输入。
    类似 claude-code 的 Zod schemas（来源：restored-src/src/Tool.ts）。
    """
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
    """
    根据 ToolDef 构建的工具对象。
    类似 claude-code 的 Tool<Input, Output, P> 类型。
    """
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
            return f"ValidationError：{error}"
        try:
            return self._call(**kwargs)
        except Exception as e:
            return f"Error({type(e).__name__})：{e}"
    def to_openai_schema(self):
        return {"type": "function", "function": {
            "name": self.name, "description": self.description,
            "parameters": self.input_schema.to_json_schema(),
        }}


class ToolDef:
    """
    用来构建工具的定义。
    类似 claude-code 的 ToolDef（restored-src/src/Tool.ts）。
    """
    def __init__(self, name, description, input_schema, call,
                 is_concurrency_safe=True, aliases=None):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.call = call
        self.is_concurrency_safe = is_concurrency_safe
        self.aliases = aliases or []


def build_tool(tool_def: ToolDef) -> Tool:
    """
    从 ToolDef 构建一个工具。
    类似 claude-code 的 buildTool(ToolDef)（Tool.ts）。
    """
    return Tool(tool_def.name, tool_def.description, tool_def.input_schema,
                tool_def.call, tool_def.is_concurrency_safe, tool_def.aliases)


class ToolRegistry:
    """
    带别名查找的工具注册表。
    类似 claude-code 的 findToolByName() 模式。
    """
    def __init__(self):
        self._tools = {}
    def register(self, tool: Tool):
        self._tools[tool.name] = tool
    def register_many(self, tools: list):
        for t in tools:
            self.register(t)
    def find_tool(self, name: str) -> Optional[Tool]:
        """通过规范名或别名查找工具。"""
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
```

把这个文件保存好，你构建的每一个智能体都可以导入它。后续章节我们会不断给它增加功能。

### Step 2：定义计算器工具

现在用我们的工具系统来定义一个计算器。我们创建 **Schema** 描述输入，编写**实现函数**，然后调用 **build_tool(ToolDef)**——和 claude-code 一模一样的模式。

创建 `first_agent.py`：

```python
import math
import json
import os
from openai import OpenAI
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ─── 1. 定义输入 Schema ──────────────────────────────

calc_schema = Schema(
    properties={
        "expression": {
            "type": "string",
            "description": "要计算的数学表达式，例如 '2 + 2' 或 '15 * 3.5'",
        },
    },
    required=["expression"],
)

# ─── 2. 编写实现函数 ──────────────────────────────────

def calculate_impl(expression: str) -> str:
    """
    安全地计算数学表达式。
    只允许数学运算——不能访问文件，不能调用系统命令。
    """
    allowed_names = {
        "abs": abs, "round": round, "max": max, "min": min,
        "sum": sum, "pow": pow, "sqrt": math.sqrt,
        "sin": math.sin, "cos": math.cos, "tan": math.tan,
        "pi": math.pi, "e": math.e,
    }
    result = eval(expression, {"__builtins__": {}}, allowed_names)
    return str(result)

# ─── 3. 构建工具（类似 claude-code 的 buildTool）───────

calculator = build_tool(ToolDef(
    name="calculate",
    description=(
        "计算数学表达式的值。"
        "支持：+、-、*、/、sqrt()、pow()、sin()、cos()、tan()、"
        "pi、e、abs()、round()、min()、max()"
    ),
    input_schema=calc_schema,
    call=calculate_impl,
    is_concurrency_safe=True,
    aliases=["calc", "math"],  # LLM 也可以用这些名字来调用
))

# ─── 4. 注册到注册表 ──────────────────────────────────

registry = ToolRegistry()
registry.register(calculator)

# 获取 OpenAI API 兼容的 schema
tools_schema = registry.get_openai_schemas()
```

### Step 3：智能体循环

接下来，编写智能体的主循环。这个智能体：

1. 接收用户的问题
2. 把问题和工具定义一起发给 LLM
3. 如果 LLM 调用了工具 → 通过 `registry.run_tool()` 执行，把结果送回
4. 如果 LLM 直接回复 → 显示答案

```python
def run_agent(user_input: str) -> str:
    """
    根据用户输入运行智能体。
    使用 ToolRegistry 按名称分发工具调用。
    """
    messages = [
        {
            "role": "system",
            "content": (
                "你是一个有帮助的助手，可以使用计算器工具。"
                "当你需要计算时，请使用 calculate 工具。"
                "其他情况直接回答。"
            ),
        },
        {"role": "user", "content": user_input},
    ]

    # 第一次调用 LLM
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        tools=tools_schema,
        tool_choice="auto",
    )

    message = response.choices[0].message

    # 检查 LLM 是否想调用工具
    if message.tool_calls:
        tool_call = message.tool_calls[0]
        tool_name = tool_call.function.name
        tool_args = json.loads(tool_call.function.arguments)

        print(f"🔧 LLM 调用了工具：{tool_name}({tool_args})")

        # 通过注册表运行工具（带别名查找！）
        result = registry.run_tool(tool_name, tool_args)

        # 把结果告诉 LLM
        messages.append(message)
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": result,
        })

        # 从 LLM 获取最终回答
        final_response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=tools_schema,
        )

        return final_response.choices[0].message.content

    else:
        # LLM 直接回答了
        return message.content


# ─── 试试看 ───────────────────────────────────────────

if __name__ == "__main__":
    questions = [
        "2 + 2 等于多少？",
        "我有 15 个苹果，送出去 7 个，还剩几个？",
        "144 的平方根是多少？",
        "法国的首都是什么？",
        "帮我算 200 的 15%，然后加上 10。",
    ]

    for q in questions:
        print(f"\n❓ 你：{q}")
        answer = run_agent(q)
        print(f"🤖 智能体：{answer}")
```

### Step 4：运行它

```bash
python first_agent.py
```

预期输出：

```
❓ 你：2 + 2 等于多少？
🔧 LLM 调用了工具：calculate({'expression': '2 + 2'})
🤖 智能体：2 + 2 等于 4。

❓ 你：我有 15 个苹果，送出去 7 个，还剩几个？
🔧 LLM 调用了工具：calculate({'expression': '15 - 7'})
🤖 智能体：你还剩 8 个苹果。

❓ 你：144 的平方根是多少？
🔧 LLM 调用了工具：calculate({'expression': 'sqrt(144)'})
🤖 智能体：144 的平方根是 12。

❓ 你：法国的首都是什么？
🤖 智能体：法国的首都是巴黎。

❓ 你：帮我算 200 的 15%，然后加上 10。
🔧 LLM 调用了工具：calculate({'expression': '15 / 100 * 200 + 10'})
🤖 智能体：200 的 15% 是 30，再加上 10 就是 40。
```

**观察发生的事情：**

- 对于"法国的首都"→ LLM **直接回答**（没有调用工具）
- 对于数学问题 → LLM **调用了计算器工具**
- LLM 自己决定什么时候用工具！

---

## 🔍 工作原理

### 函数调用机制

当你把 tools 参数发给 OpenAI API 时，内部发生的事情是这样的：

```
你的请求：
  messages: [...]
  tools: [{name: "calculate", parameters: {...}}]

OpenAI 处理过程：
  "嗯，用户问了一个数学问题。
   我看到有一个 'calculate' 工具可用。
   我应该调用它，传入 expression='15 * 3.5'。"

OpenAI 响应：
  {
    content: null,  ← 没有文字回复！
    tool_calls: [{   ← 取而代之的是工具调用请求
      id: "call_abc123",
      function: {
        name: "calculate",
        arguments: '{"expression": "15 * 3.5"}'
      }
    }]
  }
```

当 LLM 决定使用工具时：
- `content` 是**空的**（null）
- `tool_calls` 包含要调用哪个工具以及传入什么参数

当 LLM 决定直接回答时：
- `content` 包含文字回复
- `tool_calls` 是**空的**

### 智能体的决策流程

```
                    用户："15 * 3.5 等于多少？"
                               │
                               ▼
                     ┌─────────────────────┐
                     │   LLM（带着工具）    │
                     │                     │
                     │  "我应该用           │
                     │   calculate 工具。"  │
                     └─────────┬───────────┘
                               │
                     ┌─────────▼───────────┐
                     │ tool_calls 存在吗？  │
                     └─────────┬───────────┘
                     是         │         否
                  ┌────────────┴──────────────┐
                  ▼                           ▼
          ┌─────────────────┐       ┌──────────────────┐
          │ 执行工具        │       │ 直接回复文字     │
          │ 获取结果        │       │                  │
          └────────┬────────┘       └──────────────────┘
                   │
          ┌────────▼────────┐
          │ 把结果送回 LLM  │
          │ 让它组织最终回答 │
          └────────┬────────┘
                   │
          ┌────────▼────────┐
          │ LLM 给出        │
          │ 最终答案        │
          └─────────────────┘
```

### build_tool + ToolDef 的工作原理

不同于把工具 schema 写成原始字典，claude-code 使用**定义→构建**的模式：

1. **ToolDef**：一个简单的工具元数据包（名称、描述、schema、实现函数、标志位）
2. **build_tool(ToolDef)**：创建一个 Tool 对象，内置验证和错误处理
3. **ToolRegistry**：持有所有工具，通过 `find_tool()` 解析名称

这种分离意味着：
- 实现函数是纯粹、可独立测试的函数
- schema 与工具定义在一起
- 错误处理和验证是自动的
- 名称解析支持别名

### 为什么别名很重要

不同的 LLM（或同一 LLM 在不同时候）可能会为同一个概念上的工具尝试不同的名字。一个可能说 `"calc"`，另一个可能说 `"calculate"`。没有别名，调用就会失败。有了别名，`find_tool()` 会同时检查规范名和别名列表。

在 claude-code 中，Bash 工具有 `"shell"`、`"terminal"`、`"command"` 等别名——这样即使 LLM 没有猜对准确的名字，工具仍然能被找到。

### Schema：执行前的验证

`Schema` 类的作用不仅仅是向 LLM 描述输入。它还会在工具运行前**验证**输入。当你调用 `tool.call(expression=42)` 时，Schema 会检测到 `42` 不是字符串，并返回清晰的 `ValidationError`，而不是一个让人摸不着头脑的崩溃。

这和 claude-code 使用的模式一样：先验证，再执行。这意味着工具实现函数永远不会收到无效输入。

### 为什么函数调用改变了一切

在函数调用出现之前，如果你想让 LLM 做数学运算，你不得不：

1. 让 LLM 在文字里输出 `[CALC：15 * 3.5]`
2. 用正则表达式解析这段文字
3. 运行计算器
4. 把结果插回对话

这种方式**脆弱且容易出错**。LLM 每次的格式都可能不同。

有了**原生函数调用**，API 帮你处理好了结构化输出。LLM 输出的是**结构化的 JSON**，你可以放心使用。

### 多个工具调用怎么办？

LLM 可以在一次回复中调用**多个工具**。每个 `tool_calls[i]` 都是一个独立的请求。我们会在第三章中深入探讨。

### 系统提示词很重要

注意我们的系统提示词：

> "你是一个有帮助的助手，可以使用计算器工具。当你需要计算时，请使用 calculate 工具。其他情况直接回答。"

这告诉 LLM：
1. ✅ 你有一个做数学的工具
2. ✅ 需要的时候就用它
3. ✅ 不需要工具时直接回答也没问题

如果没有这个提示，LLM 可能会试图在脑子里做数学（然后算错），或者什么事都调用工具（甚至非数学问题也要用）。

---

## 🧪 练习

### 练习 1：添加一个"天气工具"

用同样的 `build_tool(ToolDef)` 模式创建一个天气工具：

```python
weather_schema = Schema(
    properties={
        "city": {
            "type": "string",
            "description": "城市名称，例如'北京'、'上海'",
        },
    },
    required=["city"],
)

def get_weather_impl(city: str) -> str:
    """模拟天气数据。"""
    weather_data = {
        "北京": "22°C，晴",
        "上海": "25°C，多云",
        "深圳": "28°C，阵雨",
        "东京": "18°C，阴",
        "纽约": "15°C，晴",
    }
    return weather_data.get(city, f"20°C，未知（没有 {city} 的天气数据）")

weather_tool = build_tool(ToolDef(
    name="get_weather",
    description="查询某个城市的当前天气。",
    input_schema=weather_schema,
    call=get_weather_impl,
    is_concurrency_safe=True,
    aliases=["weather", "forecast"],
))

registry.register(weather_tool)
```

**步骤：**
1. 把上面的代码加到 `first_agent.py`
2. 再次运行 `python first_agent.py`
3. 测试："东京天气怎么样？" 和 "5 + 3 等于多少？顺便看看伦敦的天气"

### 练习 2：添加一个"网页搜索"工具

用同样的模式添加一个搜索工具：

```python
search_schema = Schema(
    properties={
        "query": {"type": "string", "description": "搜索关键词"},
    },
    required=["query"],
)

def search_impl(query: str) -> str:
    fake_results = {
        "python 编程": "Python 是一种高级、解释型编程语言……",
        "AI 智能体": "AI 智能体是能够感知环境并采取行动的自主系统……",
        "日本首都": "东京是日本的首都。",
    }
    for key, value in fake_results.items():
        if key in query:
            return value
    return f"关于'{query}'的搜索结果：（模拟）未找到结果。"

searcher = build_tool(ToolDef(
    name="search_web",
    description="在网上搜索信息。",
    input_schema=search_schema,
    call=search_impl,
    is_concurrency_safe=True,
    aliases=["search", "web"],
))
```

确保智能体对知识类问题用 `search_web`，对数学问题用 `calculate`。

### 练习 3：调试 LLM 的决策过程

添加打印语句，看看 LLM 到底在想什么：

```python
print(f"🤔 LLM 回复：content={message.content!r}")
if message.tool_calls:
    for tc in message.tool_calls:
        print(f"🔧 工具调用：{tc.function.name}({tc.function.arguments})")
```

把 temperature 设为 0.0，运行同一个问题两次。LLM 每次都会做同样的决定吗？

### 练习 4：强制使用工具

把 `tool_choice` 从 `"auto"` 改为 `"required"`：

```python
response = client.chat.completions.create(
    ...
    tool_choice="required",  # LLM 必须使用工具
)
```

现在问："你今天怎么样？" LLM **被迫**调用一个它根本不需要的工具。会发生什么？

### 挑战：构建一个"学习助手"智能体

创建一个带**三个**工具的智能体：
1. `calculate` — 做数学运算
2. `define_word` — 返回模拟的字典释义
3. `translate` — 返回模拟的西班牙语翻译

每个工具都用 `build_tool(ToolDef)` 创建。用以下问题测试：
- "256 的平方根是多少？"
- "解释一下'算法'这个词"
- "把'你好'翻译成西班牙语"
- "25 * 4 等于多少？顺便把'再见'翻译成西班牙语"

---

## 📝 总结

### 核心概念

| 概念 | 含义 | 在 claude-code 中 |
|---|---|---|
| **Schema** | 验证和描述工具输入 | `Tool.ts` 中的 Zod schemas |
| **ToolDef + build_tool** | 从定义创建工具 | `Tool.ts` 中的 `buildTool(ToolDef)` |
| **ToolRegistry** | 持有工具，支持别名查找 | `Tool.ts` 中的 `findToolByName()` |
| **函数调用** | LLM 输出结构化请求来使用工具 | OpenAI/Anthropic API |
| **is_concurrency_safe** | 这个工具可以并行运行吗？ | `StreamingToolExecutor` |
| **别名** | 同一个工具的不同名字 | `Tool.ts` 中的 `aliases` 字段 |

### 你的代码

```python
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

# 1. 定义 Schema
calc_schema = Schema(
    properties={"expression": {"type": "string", "description": "..."}},
    required=["expression"],
)

# 2. 编写实现函数
def calc_impl(expression: str) -> str:
    return str(eval(expression, {"__builtins__": {}}, {"sqrt": sqrt}))

# 3. 构建工具（类似 claude-code 的 buildTool）
calculator = build_tool(ToolDef(
    name="calculate", description="做数学运算",
    input_schema=calc_schema, call=calc_impl,
    is_concurrency_safe=True, aliases=["calc"],
))

# 4. 注册
registry = ToolRegistry()
registry.register(calculator)

# 智能体：LLM 决定 → 我们分发 → LLM 回答
def run_agent(user_input):
    messages = [
        {"role": "system", "content": "需要时使用工具。"},
        {"role": "user", "content": user_input},
    ]
    response = client.chat.completions.create(
        model="gpt-4o-mini", messages=messages,
        tools=registry.get_openai_schemas(),
    )
    msg = response.choices[0].message
    if msg.tool_calls:
        args = json.loads(msg.tool_calls[0].function.arguments)
        result = registry.run_tool(msg.tool_calls[0].function.name, args)
        messages.append(msg)
        messages.append({"role": "tool", "tool_call_id": msg.tool_calls[0].id, "content": result})
        return client.chat.completions.create(
            model="gpt-4o-mini", messages=messages
        ).choices[0].message.content
    return msg.content
```

### 核心洞察

> **LLM 做不了精确的数学计算，但它知道什么时候需要数学。你的工作是给它工具，然后相信它来决定何时使用。**

这个模式——LLM 做决策，我们来执行——是所有 AI 智能体的基础，从简单的脚本到服务数百万用户的生产系统都是如此。

### 下一章是什么？

在**[第三章：思考→行动→观察循环](./03-core-loop.md)**中，你将超越单次工具调用，构建一个能处理**多步**任务的循环——思考、行动、观察、重复——直到完成一个复杂的任务。

---

*"智能体不是读心者。它是一个会思考的工具使用者。"*
