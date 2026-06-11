# 04. 工具系统：智能体的手脚

> **本章内容：你将设计一套真正可用的工具系统，参考真实 claude-code 的模式——schema 验证、函数式工具定义、基于别名的查找和并发控制。让你的智能体拥有干净、可扩展、生产就绪的"手脚"。**

---

## 🎯 目标

学完本章，你将能够：

- 构建一个 **Schema** 类用于输入验证（类似 claude-code 的 Zod）
- 使用 **ToolDef + build_tool()** 定义工具（类似 claude-code 的 `buildTool(ToolDef)`）
- 构建生产就绪的工具：计算器、文件读取、网络搜索
- 注册和调度工具，支持**别名查找**（类似 claude-code 的 `findToolByName()`）
- 通过 `is_concurrency_safe` 控制**并发**
- 理解**工具生命周期**：定义 → 构建 → 注册 → 调度 → 验证 → 执行

---

## 📖 给 10 岁孩子解释

### 工具就像手机 App

想象你的手机：

- 你不会每次拍照都重写相机 App
- 相机 App 有一个**标准接口**：按按钮 → 得到照片
- 新 App 可以随时安装，不需要改动手机本身

工具也应该这样工作。

| 手机 | 智能体 |
|---|---|
| 相机 App | 计算器工具 |
| 地图 App | 搜索工具 |
| 应用商店 | 工具注册表 |
| 标准 App 接口 | `Tool` + `Schema` |
| App 权限 | `is_concurrency_safe`、别名 |

### 为什么不用函数？

在第 02 和 03 章，我们把工具写成普通函数：

```python
def calculate(expression: str) -> str:
    return str(eval(...))
```

这能工作，但随着智能体增长会出现问题：

| 问题 | 用函数 | 用工具系统 |
|---|---|---|
| 添加新工具 | 写一个函数 + 单独写 schema | 定义一次 schema，`build_tool()` 处理其余部分 |
| 错误处理 | 不一致（每个函数各自处理） | 标准化：先验证后执行 |
| 列出所有工具 | 手动维护列表 | 工具自动注册，自带 schema |
| 工具元数据 | 散落各处 | 集中管理：名称、别名、schema、并发设置 |
| 测试 | 各自为政 | 统一接口 `tool.call()` |

**工具系统**通过标准化工具的构建、描述和调用方式解决了这些问题。

---

## 🔧 动手实践

### Step 1：Schema —— 输入验证基础

Claude-code 使用 [Zod](https://zod.dev/) schema 在每个工具**执行前**验证输入。我们来构建一个简化版本：

```python
# schema.py

from typing import Any, Dict, List, Optional, Tuple


class Schema:
    """
    在工具执行前验证输入。
    类似 claude-code 的 Zod schemas（源码：restored-src/src/Tool.ts）。
    """
    def __init__(self, properties: Dict[str, dict], required: Optional[List[str]] = None):
        self.schema = {
            "type": "object",
            "properties": properties,
            "required": required or [],
        }

    def validate(self, data: dict) -> Tuple[bool, Optional[str]]:
        """
        验证输入数据是否符合 schema。
        返回 (is_valid, error_message)。
        模仿 claude-code 中 ValidationResult 的验证方式。
        """
        # 检查必填字段
        for key in self.schema["required"]:
            if key not in data:
                return False, f"缺少必填字段: '{key}'"

        # 检查类型
        for key, value in data.items():
            prop = self.schema["properties"].get(key)
            if prop:
                expected_type = prop.get("type")
                if expected_type == "string" and not isinstance(value, str):
                    return False, f"'{key}' 必须是字符串，实际是 {type(value).__name__}"
                if expected_type == "integer" and not isinstance(value, int):
                    return False, f"'{key}' 必须是整数，实际是 {type(value).__name__}"
                if expected_type == "number" and not isinstance(value, (int, float)):
                    return False, f"'{key}' 必须是数字，实际是 {type(value).__name__}"
                # 检查允许值
                allowed = prop.get("enum")
                if allowed and value not in allowed:
                    return False, f"'{key}' 必须是 {allowed} 之一，实际是 '{value}'"

        return True, None

    def to_json_schema(self) -> Dict[str, Any]:
        """导出为 OpenAI 兼容的 JSON Schema 格式。"""
        return self.schema
```

`Schema` 做两件事：
1. **验证**输入——在工具运行前捕获错误
2. **描述**输入给 LLM——通过 `to_json_schema()`

### Step 2：Tool 对象 —— build_tool(ToolDef)

在 claude-code 中，工具是**普通对象**，从定义构建而来，而不是类实例。模式如下：

```python
# Tool —— 智能体使用的工具对象
# 类似 claude-code 的 Tool<Input, Output, P> 类型

import math
from typing import Any, Callable, Dict, List, Optional


class Tool:
    """
    由 ToolDef 构建的工具对象。
    类似 claude-code 的 Tool 类型（源码：restored-src/src/Tool.ts）。
    """
    def __init__(
        self,
        name: str,
        description: str,
        input_schema: Schema,
        call_fn: Callable[..., str],
        is_concurrency_safe: bool = True,
        aliases: Optional[List[str]] = None,
    ):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self._call = call_fn
        self.is_concurrency_safe = is_concurrency_safe
        self.aliases = aliases or []

    def call(self, **kwargs) -> str:
        """
        执行工具，带验证。
        claude-code 总是在调用前通过 ValidationResult 验证输入。
        """
        # 1. 验证输入（类似 claude-code 的 ValidationResult）
        is_valid, error = self.input_schema.validate(kwargs)
        if not is_valid:
            return f"ValidationError: {error}"

        # 2. 执行并捕获错误
        try:
            return self._call(**kwargs)
        except Exception as e:
            return f"Error({type(e).__name__}): {e}"

    def to_openai_schema(self) -> Dict[str, Any]:
        """转换为 OpenAI 函数调用格式。"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema.to_json_schema(),
            },
        }
```

注意 `Tool` 类**不**做的事情：
- **不**需要子类化——你只需要传入一个函数
- **没有**抽象方法——工具是对象，不是类
- **通用地**处理验证和错误，每个工具函数保持干净

`ToolDef` + `build_tool()` 模式让工具创建变得明确：

```python
class ToolDef:
    """
    用于构建工具的配置定义。
    类似 claude-code Tool.ts 中的 ToolDef。
    """
    def __init__(
        self,
        name: str,
        description: str,
        input_schema: Schema,
        call: Callable[..., str],
        is_concurrency_safe: bool = True,
        aliases: Optional[List[str]] = None,
    ):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.call = call
        self.is_concurrency_safe = is_concurrency_safe
        self.aliases = aliases or []


def build_tool(tool_def: ToolDef) -> Tool:
    """
    从 ToolDef 构建 Tool。
    类似 claude-code 的 buildTool(ToolDef) 函数（Tool.ts）。
    填充默认值并用验证包装调用函数。
    """
    return Tool(
        name=tool_def.name,
        description=tool_def.description,
        input_schema=tool_def.input_schema,
        call_fn=tool_def.call,
        is_concurrency_safe=tool_def.is_concurrency_safe,
        aliases=tool_def.aliases,
    )
```

### Step 3：实现计算器

现在用这个模式构建第一个工具。实现函数与工具定义分离：

```python
# 1. 定义 schema
calc_schema = Schema(
    properties={
        "expression": {
            "type": "string",
            "description": "要计算的数学表达式，例如 '2 + 2' 或 'sqrt(144)'",
        },
    },
    required=["expression"],
)

# 2. 编写实现函数（干净，没有样板代码）
def calculate_impl(expression: str) -> str:
    """计算数学表达式。"""
    allowed = {
        "abs": abs, "round": round, "max": max, "min": min,
        "sum": sum, "pow": pow, "sqrt": math.sqrt,
        "sin": math.sin, "cos": math.cos, "tan": math.tan,
        "pi": math.pi, "e": math.e,
    }
    result = eval(expression, {"__builtins__": {}}, allowed)
    return str(result)

# 3. 从 ToolDef 构建工具
calculator = build_tool(ToolDef(
    name="calculate",
    description=(
        "计算数学表达式。"
        "支持：+, -, *, /, sqrt(), pow(), sin(), cos(), tan(), "
        "pi, e, abs(), round(), min(), max()"
    ),
    input_schema=calc_schema,
    call=calculate_impl,
    is_concurrency_safe=True,  # ✅ 可以并行运行
))
```

实现函数是**纯函数**——接收输入，返回字符串，不关心验证或错误处理。`Tool.call()` 包装器来处理这些。

### Step 4：实现文件读取

```python
import os

file_read_schema = Schema(
    properties={
        "path": {
            "type": "string",
            "description": "要读取的文件路径（绝对或相对路径）",
        },
        "encoding": {
            "type": "string",
            "description": "文件编码（默认：utf-8）",
        },
    },
    required=["path"],
)

def read_file_impl(path: str, encoding: str = "utf-8") -> str:
    """读取文件并返回内容。"""
    if not os.path.exists(path):
        raise FileNotFoundError(f"文件不存在: {path}")
    if not os.path.isfile(path):
        raise IsADirectoryError(f"不是文件: {path}")

    with open(path, 'r', encoding=encoding) as f:
        content = f.read()

    if len(content) == 0:
        return "文件为空。"
    return f"文件内容（{len(content)} 字符）:\n{content}"

file_reader = build_tool(ToolDef(
    name="read_file",
    description="读取文件内容。返回文件内容或错误信息。",
    input_schema=file_read_schema,
    call=read_file_impl,
    is_concurrency_safe=True,
    aliases=["read", "cat", "view"],  # LLM 可能会尝试不同的名称
))
```

注意**别名**。如果 LLM 调用了 `"read"` 而不是 `"read_file"`，我们仍然能找到它。这就是 claude-code 的 `findToolByName()` 的工作方式——先检查规范名称，再检查别名。

### Step 5：实现网络搜索（模拟）

```python
web_search_schema = Schema(
    properties={
        "query": {
            "type": "string",
            "description": "搜索查询",
        },
    },
    required=["query"],
)

def web_search_impl(query: str) -> str:
    """模拟网络搜索。"""
    database = {
        "capital of france": "巴黎是法国的首都。",
        "capital of japan": "东京是日本的首都。",
        "population of japan": "截至 2024 年，日本人口约 1.25 亿。",
        "population of the world": "截至 2024 年，世界人口约 80 亿。",
        "python programming": "Python 是 Guido van Rossum 于 1991 年创建的高级编程语言。",
        "what is an ai agent": "AI 智能体是一种使用 LLM 进行推理、规划和工具使用的系统。",
        "weather in tokyo": "东京天气：22°C，局部多云。",
        "weather in london": "伦敦天气：15°C，阴天。",
    }
    query_lower = query.lower().strip()

    for key, answer in database.items():
        if query_lower == key or query_lower in key:
            return answer

    # 模糊匹配
    matches = [v for k, v in database.items()
               if any(word in k for word in query_lower.split())]
    if matches:
        return "\n".join(matches[:3])
    return f"未找到 '{query}' 的结果。请尝试其他搜索。"

searcher = build_tool(ToolDef(
    name="search_web",
    description="搜索网络信息。用于获取事实、时事和一般知识。",
    input_schema=web_search_schema,
    call=web_search_impl,
    is_concurrency_safe=True,
    aliases=["search", "web", "google"],
))
```

### Step 6：ToolRegistry —— findToolByName

现在需要一个地方来存放所有工具。在 claude-code 中，工具收集在一个列表中，通过 `findToolByName()` 查找。我们来构建它：

```python
class ToolRegistry:
    """
    持有所有工具并提供按名称或别名查找的功能。
    类似 claude-code 的 findToolByName() 模式（源码：restored-src/src/Tool.ts）。
    """
    def __init__(self):
        self._tools: Dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        """按规范名称注册单个工具。"""
        self._tools[tool.name] = tool

    def register_many(self, tools: List[Tool]) -> None:
        """一次注册多个工具。"""
        for t in tools:
            self.register(t)

    def find_tool(self, name: str) -> Optional[Tool]:
        """
        按规范名称或别名查找工具。
        类似 claude-code Tool.ts 中的 findToolByName()。
        """
        # 先尝试规范名称
        tool = self._tools.get(name)
        if tool:
            return tool
        # 再尝试别名
        for t in self._tools.values():
            if name in t.aliases:
                return t
        return None

    def run_tool(self, name: str, args: Dict[str, Any]) -> str:
        """按名称/别名查找工具并用给定参数执行。"""
        tool = self.find_tool(name)
        if not tool:
            return f"错误: 未知工具 '{name}'"
        return tool.call(**args)

    def get_openai_schemas(self) -> List[Dict[str, Any]]:
        """获取所有工具的 OpenAI 函数调用格式 schema。"""
        return [t.to_openai_schema() for t in self._tools.values()]

    def concurrency_safe_tools(self) -> List[Tool]:
        """
        获取可以并行运行的工具。
        类似 claude-code 的 StreamingToolExecutor 分区。
        """
        return [t for t in self._tools.values() if t.is_concurrency_safe]

    @property
    def count(self) -> int:
        return len(self._tools)
```

### Step 7：整合起来

```python
# agent.py —— 完整的工具系统

# 创建注册表
registry = ToolRegistry()

# 注册所有工具
registry.register_many([
    calculator,
    file_reader,
    searcher,
])

# 验证
print(f"📦 已注册 {registry.count} 个工具:")
for t in registry._tools.values():
    safe = "⚡" if t.is_concurrency_safe else "🔒"
    aliases = f"（别名: {', '.join(t.aliases)}）" if t.aliases else ""
    print(f"  {safe} {t.name}: {t.description}{aliases}")

# === 智能体循环集成 ===

def run_tool(name: str, args: dict) -> str:
    """调度工具调用（类似 claude-code 的 runTools()）。"""
    result = registry.run_tool(name, args)
    return result

# 测试调用
print("\n🧪 测试工具:")
print(run_tool("calculate", {"expression": "2 + 2"}))           # "4"
print(run_tool("read", {"path": "tool_system.py"}))              # 别名生效！
print(run_tool("search", {"query": "capital of france"}))        # 别名生效！
print(run_tool("search_web", {"query": "unknown topic"}))        # 回退
```

---

### 总结：工具生命周期

```
   定义            构建            注册            调度            验证            执行
  ┌────────┐    ┌──────────┐    ┌────────────┐    ┌───────────┐    ┌─────────┐    ┌──────────┐
  │ Schema │───→│ ToolDef  │───→│ ToolRegistry│←──│ agent loop│───→│ Schema  │───→│ call_fn  │
  │  实现   │    │build_tool│    │ find_tool  │    │ run_tool  │    │ validate│    │ 执行     │
  └────────┘    └──────────┘    └────────────┘    └───────────┘    └─────────┘    └──────────┘
```

1. **定义** —— 编写 Schema 和实现函数
2. **构建** —— 创建 `ToolDef` 并调用 `build_tool(ToolDef)`
3. **注册** —— 将工具添加到 `ToolRegistry`
4. **调度** —— 智能体循环调用 `registry.run_tool(name, args)`
5. **验证** —— `Tool.call()` 在执行前验证输入
6. **执行** —— 实现函数用有效输入运行

---

## 🔍 工作原理

### Schema 验证提前捕获错误

在 claude-code 中，验证发生在工具**运行之前**，而不是工具内部。这意味着：

- 工具函数永远不会收到错误输入
- LLM 得到清晰的 "ValidationError" 消息，准确告知问题所在
- 每种错误类型（缺少字段、类型错误、无效值）都有不同的消息

```python
# 验证失败时发生的情况：
result = calculator.call(expression=42)  # 不是字符串！
# → "ValidationError: 'expression' 必须是字符串，实际是 int"
```

### 为什么用 build_tool + ToolDef 而不是子类化？

Claude-code 在工具上使用函数式组合而不是类继承，原因是：

| 方式 | 说明 |
|---|---|
| **子类化**（旧方式） | 每个工具 = 一个类。添加工具意味着写新文件。Schema 分散在 `@property` 方法中。 |
| **函数式**（claude-code 方式） | 每个工具 = 一个函数 + 一个 `ToolDef`。`Tool` 对象创建一次后复用。Schema 集中在一处。 |

函数式方法的优势：
- **更轻量** —— 没有类层次结构，没有 `super().__init__()` 链
- **可组合** —— 可以从任何函数构建工具，包括 lambda
- **可测试** —— 实现函数是普通函数，可以直接测试

### 别名的重要性

不同的 LLM（或同一 LLM 在不同时间）可能对同一工具尝试不同的名称。如果 LLM 说 `"read"` 但工具名为 `"read_file"`，没有别名就会失败。有了别名，`find_tool()` 会检查两者。

这正是 claude-code 的 `findToolByName()` 的工作方式——这是一个简单但关键的可靠性工程组件。

### is_concurrency_safe：并行执行

Claude-code 的 `StreamingToolExecutor`（源码：`restored-src/src/services/tools/StreamingToolExecutor.ts`）将工具分为两组：

- **并发安全**（`is_concurrency_safe=True`）：可以并行运行（计算、读取）
- **不安全**（`is_concurrency_safe=False`）：必须串行执行（文件写入、状态变更）

安全工具通过 `Promise.all()` 批量处理以提高性能。这就是为什么我们在每个工具上保留这个标志。

---

## 🧪 练习

### 练习 1：添加别名

给计算器工具添加别名并验证：

```python
# 修改计算器构建，包含别名
calculator = build_tool(ToolDef(
    name="calculate",
    description="计算数学表达式",
    input_schema=calc_schema,
    call=calculate_impl,
    is_concurrency_safe=True,
    aliases=["calc", "math", "eval"],
))

# 测试别名查找
print(registry.find_tool("calc"))       # 应找到 calculator
print(registry.find_tool("calculate"))  # 同一个工具
```

### 练习 2：注册所有工具

创建一个至少包含 3 个工具的完整工具系统，并显示它们的 schema：

```python
def list_tools(registry: ToolRegistry):
    """打印所有注册工具的 OpenAI 格式。"""
    schemas = registry.get_openai_schemas()
    for s in schemas:
        name = s["function"]["name"]
        params = s["function"]["parameters"]["properties"]
        print(f"\n📌 {name}")
        for p_name, p_info in params.items():
            print(f"   - {p_name}: {p_info['description']}")

list_tools(registry)
```

### 练习 3：天气工具（真实 API）

构建一个使用真实 `wttr.in` API 的天气工具：

```python
import urllib.request

weather_schema = Schema(
    properties={
        "city": {
            "type": "string",
            "description": "城市名称，例如 'Tokyo'、'London'、'New York'",
        },
    },
    required=["city"],
)

def get_weather_impl(city: str) -> str:
    url = f"https://wttr.in/{city}?format=3"
    with urllib.request.urlopen(url) as response:
        return response.read().decode("utf-8").strip()

weather_tool = build_tool(ToolDef(
    name="get_weather",
    description="获取某个城市的当前天气。使用真实天气数据。",
    input_schema=weather_schema,
    call=get_weather_impl,
    is_concurrency_safe=True,
    aliases=["weather", "forecast"],
))

registry.register(weather_tool)

# 测试："巴黎天气怎么样？" 以及 "东京和首尔的天气如何？"
```

### 练习 4：带验证的工具

构建一个使用 Schema 验证的密码检查器：

```python
# Schema 验证类型；实现函数检查规则
password_schema = Schema(
    properties={
        "password": {
            "type": "string",
            "description": "要检查的密码",
        },
    },
    required=["password"],
)

def check_password_impl(password: str) -> str:
    errors = []
    if len(password) < 8:
        errors.append("至少 8 个字符")
    if not any(c.isupper() for c in password):
        errors.append("至少一个大写字母")
    if not any(c.isdigit() for c in password):
        errors.append("至少一个数字")

    if errors:
        return f"密码强度弱。缺少: {', '.join(errors)}"
    return "密码强度强！"

password_checker = build_tool(ToolDef(
    name="check_password",
    description="检查密码是否符合安全要求",
    input_schema=password_schema,
    call=check_password_impl,
    is_concurrency_safe=True,
))
```

### 挑战：构建组合工具

构建一个内部调用其他工具的工具：

```python
# 一个将复杂问题分解为步骤的"超级计算器"

def multi_step_calc_impl(expression: str) -> str:
    """解析和计算多步数学表达式。"""
    import re
    parts = re.split(r'(\+|\-|\*)', expression.replace(' ', ''))

    result = 0
    current_op = '+'
    steps = []

    for part in parts:
        if part in '+-*':
            current_op = part
        else:
            try:
                val = eval(part, {"__builtins__": {}},
                          {"abs": abs, "sqrt": math.sqrt, "pi": math.pi, "e": math.e})
                steps.append(f"{current_op} {part} = {val}")
            except:
                return f"错误: 无法解析 '{part}'"

    # 内部使用计算器工具进行实际计算
    return f"步骤: {' '.join(steps)}\n结果: {calculator.call(expression=expression)}"

super_calc = build_tool(ToolDef(
    name="super_calculate",
    description="计算复杂的多步数学问题。逐步分解。",
    input_schema=calc_schema,  # 复用同一个 schema
    call=multi_step_calc_impl,
    is_concurrency_safe=True,
))
```

---

## 📝 总结

### 核心概念

| 概念 | 含义 | 在 claude-code 中 |
|---|---|---|
| **Schema** | 在执行前验证输入 | `Tool.ts` 中的 Zod schemas |
| **build_tool(ToolDef)** | 从定义构建 Tool | `Tool.ts` 中的 `buildTool(ToolDef)` |
| **Tool** | 带元数据的可复用函数 | `Tool<Input, Output, P>` 类型 |
| **findToolByName** | 按名称或别名查找 | `Tool.ts` 中的 `findToolByName()` |
| **is_concurrency_safe** | 此工具可以并行运行吗？ | `StreamingToolExecutor` 分区 |
| **ValidationResult** | 调用前的输入验证 | `ValidationResult<Input>` 类型 |

### 你拥有的代码

```python
from typing import Any, Dict, List, Optional, Tuple, Callable

# ─── Schema（类似 claude-code 的 Zod） ───

class Schema:
    def __init__(self, properties: dict, required: list = None):
        self.schema = {"type": "object", "properties": properties, "required": required or []}
    def validate(self, data: dict) -> Tuple[bool, Optional[str]]:
        for key in self.schema["required"]:
            if key not in data:
                return False, f"缺少必填字段: '{key}'"
        for key, value in data.items():
            prop = self.schema["properties"].get(key)
            if prop:
                t = prop.get("type")
                if t == "string" and not isinstance(value, str):
                    return False, f"'{key}' 必须是字符串"
                if t == "integer" and not isinstance(value, int):
                    return False, f"'{key}' 必须是整数"
        return True, None
    def to_json_schema(self):
        return self.schema

# ─── Tool + build_tool（类似 claude-code 的 buildTool） ───

class Tool:
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
    def __init__(self, name, description, input_schema, call,
                 is_concurrency_safe=True, aliases=None):
        self.name = name; self.description = description
        self.input_schema = input_schema; self.call = call
        self.is_concurrency_safe = is_concurrency_safe; self.aliases = aliases or []

def build_tool(tool_def: ToolDef) -> Tool:
    return Tool(tool_def.name, tool_def.description, tool_def.input_schema,
                tool_def.call, tool_def.is_concurrency_safe, tool_def.aliases)

# ─── ToolRegistry + find_tool（类似 claude-code 的 findToolByName） ───

class ToolRegistry:
    def __init__(self):
        self._tools = {}
    def register(self, tool: Tool):
        self._tools[tool.name] = tool
    def register_many(self, tools: list):
        for t in tools: self.register(t)
    def find_tool(self, name: str) -> Optional[Tool]:
        tool = self._tools.get(name)
        if tool: return tool
        for t in self._tools.values():
            if name in t.aliases: return t
        return None
    def run_tool(self, name: str, args: dict) -> str:
        tool = self.find_tool(name)
        if not tool: return f"错误: 未知工具 '{name}'"
        return tool.call(**args)
    def get_openai_schemas(self):
        return [t.to_openai_schema() for t in self._tools.values()]
    def concurrency_safe_tools(self):
        return [t for t in self._tools.values() if t.is_concurrency_safe]
```

### 核心洞察

> **一个好的工具系统是隐形的。LLM 不关心工具如何实现，它只看到清晰的名称、明确的描述，并得到可靠的结果。你的工作是让工具可靠、描述清晰、对错误有弹性。**

### 下一章

在**[第 05 章：智能体提示词工程](./05-prompt-engineering.md)**中，你将学习如何编写系统提示词，让你的智能体更聪明。你会看到同样的工具在不同提示词下表现完全不同，以及如何将时间、用户信息和可用工具等上下文动态注入提示词中。

---

*"没有好描述的工具就像一个没有标签的按钮。LLM 不知道什么时候该按它。"*
