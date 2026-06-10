# 04. 工具系统：手脚并用的智能体

> **本章内容：如何设计一个可扩展的工具系统，让你的智能体拥有各种能力。**

---

## 🎯 目标

学完本章，你将能够：
- 用抽象基类设计工具系统
- 实现工具的注册、发现和调度
- 构建多种工具（计算、文件、搜索）
- 处理工具的错误

---

## 📖 给 10 岁孩子解释

工具就是智能体的"手脚"。你没有手，就只能说话；有了手，你就能做事。

好的工具系统像一个工具箱：
- 每个工具有名字和说明书
- 你可以随时添加新工具
- 智能体自己决定用什么工具

---

## 🔧 动手实践

### Step 1：工具基类

```python
from abc import ABC, abstractmethod

class Tool(ABC):
    """所有工具的基类。"""

    @property
    @abstractmethod
    def name(self) -> str:
        """工具名称。"""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """工具描述（给 LLM 看）。"""
        pass

    @abstractmethod
    def run(self, **kwargs) -> str:
        """执行工具。"""
        pass

    def to_openai_tool(self) -> dict:
        """转成 OpenAI 工具格式。"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.get_parameters(),
            },
        }

    @abstractmethod
    def get_parameters(self) -> dict:
        """返回 JSON Schema 参数定义。"""
        pass
```

### Step 2：具体工具

```python
class CalculatorTool(Tool):
    @property
    def name(self): return "calculator"

    @property
    def description(self): return "计算数学表达式"

    def get_parameters(self):
        return {
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "数学表达式"}
            },
            "required": ["expression"],
        }

    def run(self, expression: str) -> str:
        allowed = set("0123456789+-*/.() ")
        if not all(c in allowed for c in expression):
            return "错误：非法字符"
        try:
            return str(eval(expression, {"__builtins__": {}}, {}))
        except Exception as e:
            return f"错误：{e}"


class FileReadTool(Tool):
    @property
    def name(self): return "file_reader"

    @property
    def description(self): return "读取文件内容"

    def get_parameters(self):
        return {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "文件路径"}
            },
            "required": ["path"],
        }

    def run(self, path: str) -> str:
        try:
            with open(path, "r") as f:
                return f.read()[:2000]  # 限制长度
        except Exception as e:
            return f"读取失败：{e}"
```

### Step 3：工具注册和管理

```python
class ToolRegistry:
    """管理所有可用工具。"""

    def __init__(self):
        self._tools = {}

    def register(self, tool: Tool):
        """注册一个工具。"""
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool:
        return self._tools.get(name)

    def get_all_tools(self) -> list:
        return list(self._tools.values())

    def get_openai_tools(self) -> list:
        return [t.to_openai_tool() for t in self._tools.values()]

    def execute(self, name: str, **kwargs) -> str:
        tool = self.get(name)
        if not tool:
            return f"未找到工具：{name}"
        return tool.run(**kwargs)

# 使用
registry = ToolRegistry()
registry.register(CalculatorTool())
registry.register(FileReadTool())
```

### Step 4：工具调度

```python
class ToolAgent:
    """使用工具注册表的智能体。"""

    def __init__(self, registry: ToolRegistry):
        self.registry = registry

    def run(self, user_input: str) -> str:
        messages = [{"role": "user", "content": user_input}]
        tools_config = self.registry.get_openai_tools()

        for _ in range(10):
            response = openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                tools=tools_config if tools_config else None,
            )
            msg = response.choices[0].message
            if not msg.tool_calls:
                return msg.content

            messages.append(msg)
            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments)
                result = self.registry.execute(tc.function.name, **args)
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

        return "任务完成。"

# 使用
agent = ToolAgent(registry)
print(agent.run("帮我计算 345 * 678"))
```

---

## 🧪 练习

1. 添加一个 `CurrentTimeTool`，返回当前时间
2. 添加一个 `WebSearchTool`，使用模拟搜索
3. 让工具结果先经过 LLM 再返回用户（而不是直接输出）
4. 给工具添加"权限等级"（只读/读写）

---

## 📝 总结

- **Tool 基类**统一了工具接口
- **ToolRegistry** 管理所有工具的注册和发现
- 工具描述（JSON Schema）告诉 LLM 怎么用
- 用抽象基类设计，添加新工具不需要改核心代码

### 真实的 claude-code 是如何定义工具的？

上面的基于类的模式很适合学习。但在真实的 **claude-code**（[源码](https://github.com/ChinaSiro/claude-code-sourcemap)）中，工具使用函数式组合模式定义：

**源码： [`restored-src/src/Tool.ts`](https://github.com/ChinaSiro/claude-code-sourcemap/blob/main/restored-src/src/Tool.ts)**

在 claude-code 中，工具通过 `buildTool(ToolDef)` 创建为普通对象：

```python
# claude-code 工具模式的 Python 翻译
# 原文：restored-src/src/Tool.ts

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Protocol

# ─── Schema 验证（类似真实代码中的 Zod） ───

class Schema:
    """简化版 schema 验证器，受 claude-code 中 Zod schema 的启发。"""
    def __init__(self, schema_dict: dict):
        self.schema = schema_dict

    def validate(self, data: dict) -> tuple[bool, Optional[str]]:
        """验证输入数据是否符合 schema。返回 (is_valid, error_message)。"""
        for key, props in self.schema.get("properties", {}).items():
            if key in props.get("required", []) and key not in data:
                return False, f"缺少必填字段: {key}"
            if key in data and props.get("type") == "string" \
               and not isinstance(data[key], str):
                return False, f"{key} 必须是字符串"
        return True, None

    def to_json_schema(self) -> Dict[str, Any]:
        return self.schema


# ─── 工具定义（buildTool 模式） ───

class Tool:
    """由 ToolDef 构建的工具对象。对应 claude-code 的 Tool<Input, Output, P> 类型。"""
    def __init__(
        self,
        name: str,
        description: str,
        input_schema: Schema,
        call_fn: Callable[..., str],
        is_concurrency_safe: bool = True,
        aliases: Optional[List[str]] = None,
        search_hint: str = "",
    ):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self._call = call_fn
        self.is_concurrency_safe = is_concurrency_safe
        self.aliases = aliases or []
        self.search_hint = search_hint

    def call(self, **kwargs) -> str:
        """执行工具。claude-code 调用 runTools() 来触发它。"""
        is_valid, error = self.input_schema.validate(kwargs)
        if not is_valid:
            return f"ValidationError: {error}"
        return self._call(**kwargs)

    def to_openai_schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema.to_json_schema(),
            },
        }


# ─── buildTool：从定义创建工具 ───

class ToolDef:
    """用于构建工具的配置定义（类似 claude-code Tool.ts 中的 ToolDef）。"""
    def __init__(
        self,
        name: str,
        description: str,
        input_schema: Schema,
        call: Callable[..., str],
        is_concurrency_safe: bool = True,
    ):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.call = call
        self.is_concurrency_safe = is_concurrency_safe


def build_tool(tool_def: ToolDef) -> Tool:
    """
    从 ToolDef 构建 Tool。
    在 claude-code 中，这会填充默认值并用错误处理包装 call()。
    源码：restored-src/src/Tool.ts — 函数 buildTool(ToolDef)
    """
    return Tool(
        name=tool_def.name,
        description=tool_def.description,
        input_schema=tool_def.input_schema,
        call_fn=tool_def.call,
        is_concurrency_safe=tool_def.is_concurrency_safe,
    )


# ─── 工具注册表（findToolByName 模式） ───

class ToolRegistry:
    """持有所有工具的注册表。对应 claude-code 用列表收集工具并使用 findToolByName() 的方式。"""
    def __init__(self):
        self._tools: Dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def register_many(self, tools: List[Tool]) -> None:
        for t in tools:
            self.register(t)

    def find_tool(self, name: str) -> Optional[Tool]:
        """按名称或别名查找工具。
        对应 claude-code Tool.ts 中的 findToolByName()。"""
        tool = self._tools.get(name)
        if tool:
            return tool
        # 检查别名
        for t in self._tools.values():
            if name in t.aliases:
                return t
        return None

    def run_tool(self, name: str, args: Dict[str, Any]) -> str:
        tool = self.find_tool(name)
        if not tool:
            return f"错误: 未知工具 '{name}'"
        return tool.call(**args)

    def get_openai_schemas(self) -> List[Dict[str, Any]]:
        return [t.to_openai_schema() for t in self._tools.values()]

    def concurrency_safe_tools(self) -> List[Tool]:
        """获取可以并行运行的工具。
        claude-code 将工具分区为可并发和不可并发批次。
        见：restored-src/src/services/tools/StreamingToolExecutor.ts"""
        return [t for t in self._tools.values() if t.is_concurrency_safe]


# ─── 示例：构建计算器工具 ───

calc_schema = Schema({
    "type": "object",
    "properties": {
        "expression": {
            "type": "string",
            "description": "数学表达式，例如 '2 + 2'",
        },
    },
    "required": ["expression"],
})

def calc_impl(expression: str) -> str:
    import math
    allowed = {"abs": abs, "sqrt": math.sqrt, "pi": math.pi, "e": math.e}
    try:
        return str(eval(expression, {"__builtins__": {}}, allowed))
    except Exception as e:
        return f"错误: {e}"

calculator = build_tool(ToolDef(
    name="calculate",
    description="计算数学表达式",
    input_schema=calc_schema,
    call=calc_impl,
    is_concurrency_safe=True,
))

registry = ToolRegistry()
registry.register(calculator)
```

**与本教学示例的关键区别：**

| 本教学示例（基于类） | claude-code 风格（函数式） |
|---|---|
| 每个工具是一个类实例 | 每个工具通过 `buildTool(ToolDef)` 从 `ToolDef` 创建 |
| 通过 `@property` 定义 Schema | 通过 `Schema` 对象定义（TypeScript 中是 Zod） |
| 错误处理在函数体内 | `input_schema.validate()` 在执行前完成验证 |
| 手动分发 | `findToolByName()` 支持别名查找 |
| 没有并发模型 | `isConcurrencySafe()` 控制并行执行 |

在 claude-code 中，工具还声明了 `isReadOnly`、`isDestructive`、`interruptBehavior` 和 `canUseTool` 以实现细粒度的权限控制。`StreamingToolExecutor`（[源码](https://github.com/ChinaSiro/claude-code-sourcemap/blob/main/restored-src/src/services/tools/StreamingToolExecutor.ts)）将工具分区为可并发和不可并发的批次，可并发的并行执行，不可并发的串行执行。

下一章：提示词工程——如何跟智能体好好说话。
