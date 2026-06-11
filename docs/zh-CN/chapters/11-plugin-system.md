# 11. 插件系统

> **本章内容：你的智能体很强大，但你无法预测每个人可能需要的每一个工具。你将使用 Model Context Protocol (MCP) 模式构建一个插件系统——这也是 claude-code 用于动态集成外部工具的同一方法。**

---

## 🎯 目标

通过本章的学习，你将能够：

- 理解为什么动态工具发现优于硬编码
- 构建 **MCPServer**——一个能宣告自身能力的远程工具提供者
- 构建 **MCPToolRegistry**——合并内置工具和外部工具的注册器
- 创建示例 MCP 服务器：天气、翻译和数学扩展
- 看到工具如何在运行时被发现，无需修改代码

---

## 📖 用大白话解释

### 问题：你无法预测一切

你已经构建了一个很棒的智能体。它可以搜索网络、做数学运算和读取文件。但如果有人希望它：

- 查天气？
- 翻译文本？
- 生成图片？
- 控制家里的智能灯？

你可以将每个功能直接添加到智能体的代码中。但这意味着：

```
第1周：用户想要天气  →  添加天气函数
第2周：用户想要翻译  →  添加翻译函数
第3周：用户想要图片  →  添加图片生成
第4周：用户想要...   →  ...你懂的
```

每次更改都意味着修改智能体的核心代码。过不了多久，智能体就会变成一团糟的功能堆砌。

### 插件解决方案

**插件系统**让你无需触碰核心代码即可添加功能：

```
┌────────────────────────────────────────┐
│          智能体核心                     │
│  • 思考 → 行动 → 观察循环              │
│  • 工具调度                            │
│  • 上下文管理                          │
└──────────────────┬─────────────────────┘
                   │ "我需要一个工具"
                   ▼
┌────────────────────────────────────────┐
│          MCPToolRegistry               │
│  合并来自所有来源的工具                 │
└──┬──────┬──────┬──────┬────────────────┘
   │      │      │      │
   ▼      ▼      ▼      ▼
 内置    MCP    MCP    MCP
 工具    服务A  服务B  服务C
        (天气) (翻译) (数学)
```

每个 MCP 服务器都是**独立的**。它宣告自己的工具。智能体在运行时发现它们。不需要修改核心代码。

### MCP：一种协议，而非框架

Model Context Protocol (MCP) 是一个开放标准，定义了智能体如何发现和调用外部工具。你的工具运行在 MCP 服务器上，而不是写成 Python 插件类。服务器告诉智能体：

- "这是我的工具列表"
- "每个工具的功能是什么"
- "每个工具需要什么参数"

智能体连接到服务器，获取工具列表，然后将它们加入自己的可用工具集。智能体不需要知道这个工具是本地的、远程的，还是用不同语言编写的。

---

## 🔧 动手实践：构建 MCP 插件系统

### 第1步：MCPServer——工具宣告者

MCP 服务器是托管工具并宣告它们的服务。让我们构建自己的版本：

```python
# mcp_plugin_system.py

from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry
from typing import Dict, List, Optional, Callable


class MCPServer:
    """
    一个 MCP 服务器，用于托管和宣告工具。
    
    在真实的 claude-code 中，MCP 服务器是通过 stdio 或 HTTP
    通信的独立进程。这里我们模拟相同的模式——每个服务器
    持有工具并通过 get_tool_schemas() 宣告它们。
    
    类似于 claude-code 的 MCP 集成
    (来源: restored-src/src/services/tools/toolOrchestration.ts).
    """
    def __init__(self, name: str, description: str = ""):
        self.name = name
        self.description = description
        self._tools: Dict[str, dict] = {}  # name → schema

    def add_tool(self, name: str, description: str,
                 input_schema: Schema, call_fn: Callable) -> None:
        """在此 MCP 服务器上注册一个工具。"""
        schema = {
            "type": "function",
            "function": {
                "name": name,
                "description": description,
                "parameters": input_schema.to_json_schema(),
            },
        }
        self._tools[name] = {
            "schema": schema,
            "call": call_fn,
        }

    def discover(self) -> List[dict]:
        """
        宣告此服务器上的所有工具。
        
        智能体在连接时调用此方法以了解可用工具。
        这相当于 MCP 的 "initialize" 握手。
        """
        print(f"  🔍 正在从 MCP 服务器 '{self.name}' 发现工具...")
        return [info["schema"] for info in self._tools.values()]

    def execute(self, tool_name: str, args: dict) -> str:
        """在此服务器上执行一个工具。"""
        if tool_name not in self._tools:
            return f"错误: MCP 服务器 '{self.name}' 没有工具 '{tool_name}'"

        try:
            return self._tools[tool_name]["call"](**args)
        except Exception as e:
            return f"来自 MCP 服务器 '{self.name}' 的错误: {type(e).__name__}: {e}"

    def has_tool(self, name: str) -> bool:
        return name in self._tools
```

### 第2步：MCPToolRegistry——合并所有工具

现在我们需要一个注册器，将内置工具与来自 MCP 服务器的工具合并。这就是 claude-code 的 `toolOrchestration.ts` 的工作方式——每个工具都只是一个工具，无论它来自哪里：

```python
class MCPToolRegistry:
    """
    聚合来自内置定义和 MCP 服务器的工具。
    
    智能体看到的是一个统一的工具列表。它不知道（也不关心）
    每个工具由哪个服务器提供。当工具被调用时，注册器会
    路由到正确的提供者。
    
    类似于 claude-code 的编排层
    (来源: restored-src/src/services/tools/toolOrchestration.ts).
    """
    def __init__(self, built_in_registry: ToolRegistry):
        self.built_in = built_in_registry
        self.mcp_servers: Dict[str, MCPServer] = {}

    def attach_server(self, server: MCPServer) -> None:
        """
        连接一个 MCP 服务器并发现其工具。
        
        这会在启动时为每个已配置的服务器调用。
        之后，该服务器的工具与内置工具一起可用。
        """
        print(f"📡 正在附加 MCP 服务器: {server.name}")
        schemas = server.discover()
        print(f"   发现 {len(schemas)} 个工具")
        self.mcp_servers[server.name] = server

    def get_all_tool_schemas(self) -> List[dict]:
        """
        获取所有工具的 schema：内置 + MCP。
        这就是发送给 LLM 的内容。
        """
        schemas = self.built_in.get_openai_schemas()
        for server in self.mcp_servers.values():
            schemas.extend(server.discover())
        return schemas

    def execute(self, tool_name: str, args: dict) -> str:
        """
        执行工具，路由到正确的提供者。
        
        1. 首先检查内置工具
        2. 然后检查每个 MCP 服务器
        3. 未知工具 → 错误
        """
        # 尝试内置工具
        tool = self.built_in.find_tool(tool_name)
        if tool:
            return tool.call(**args)

        # 尝试 MCP 服务器
        for server in self.mcp_servers.values():
            if server.has_tool(tool_name):
                return server.execute(tool_name, args)

        return f"错误: 未知工具 '{tool_name}'."
```

### 第3步：构建 MCP 服务器（插件）

现在让我们创建一些 MCP 服务器。每个服务器都是独立的，并宣告自己的工具：

```python
# ─── 天气 MCP 服务器 ─────────────────────────────

import math
import json
import os

weather_server = MCPServer(
    name="weather",
    description="天气数据提供者",
)

weather_schema = Schema(
    properties={
        "city": {"type": "string", "description": "城市名称，例如 'Beijing'"},
    },
    required=["city"],
)

def weather_impl(city: str) -> str:
    """使用 wttr.in 获取某个城市的天气。"""
    import urllib.request
    url = f"https://wttr.in/{city}?format=3"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.read().decode("utf-8").strip()
    except Exception as e:
        # 回退到模拟数据
        fake_data = {
            "beijing": "25°C, 晴",
            "shanghai": "28°C, 多云",
            "london": "15°C, 阴天",
            "tokyo": "22°C, 晴",
        }
        return fake_data.get(city.lower(), f"20°C, 晴 (模拟数据 for {city})")

weather_server.add_tool(
    name="get_weather",
    description="获取某个城市的当前天气。使用 wttr.in 的真实数据。",
    input_schema=weather_schema,
    call_fn=weather_impl,
)


# ─── 翻译 MCP 服务器 ──────────────────────────

translator_server = MCPServer(
    name="translator",
    description="简单的文本翻译",
)

translate_schema = Schema(
    properties={
        "text": {"type": "string", "description": "要翻译的文本"},
        "target_language": {
            "type": "string",
            "description": "目标语言，例如 'chinese', 'french', 'japanese'",
        },
    },
    required=["text", "target_language"],
)

def translate_impl(text: str, target_language: str) -> str:
    """模拟翻译。"""
    fake_translations = {
        "hello": {
            "chinese": "你好",
            "french": "bonjour",
            "japanese": "こんにちは",
            "spanish": "hola",
        },
        "goodbye": {
            "chinese": "再见",
            "french": "au revoir",
            "japanese": "さようなら",
        },
    }
    text_lower = text.lower().strip()
    if text_lower in fake_translations:
        translation = fake_translations[text_lower].get(target_language.lower())
        if translation:
            return translation
    return f"[{target_language}] {text} (已翻译)"

translator_server.add_tool(
    name="translate",
    description="将文本翻译成另一种语言。",
    input_schema=translate_schema,
    call_fn=translate_impl,
)


# ─── 数学扩展 MCP 服务器 ──────────────────────

math_ext_server = MCPServer(
    name="math_extensions",
    description="高级数学运算",
)

fib_schema = Schema(
    properties={
        "n": {"type": "integer", "description": "斐波那契数列中的位置（从1开始）"},
    },
    required=["n"],
)

def fibonacci_impl(n: int) -> str:
    """计算第 n 个斐波那契数。"""
    if n < 1:
        return "错误: n 必须 >= 1"
    if n > 100:
        return "错误: n 必须 <= 100"

    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return str(a)

math_ext_server.add_tool(
    name="fibonacci",
    description="计算第 n 个斐波那契数。",
    input_schema=fib_schema,
    call_fn=fibonacci_impl,
)
```

### 第4步：连接所有组件

现在让我们把所有部分组合在一起——内置工具加上 MCP 服务器：

```python
# ─── 内置工具（与前面章节相同）───────────────

calc_schema = Schema(
    properties={
        "expression": {"type": "string", "description": "数学表达式"},
    },
    required=["expression"],
)

def calc_impl(expression: str) -> str:
    allowed = {"sqrt": math.sqrt, "pi": math.pi, "abs": abs}
    return str(eval(expression, {"__builtins__": {}}, allowed))

calculator = build_tool(ToolDef(
    name="calculate",
    description="计算一个数学表达式",
    input_schema=calc_schema,
    call=calc_impl,
    is_concurrency_safe=True,
))

built_in_registry = ToolRegistry()
built_in_registry.register(calculator)

# ─── MCP 工具注册器 ──────────────────────────────

mcp_registry = MCPToolRegistry(built_in_registry)

# 附加 MCP 服务器（插件）
mcp_registry.attach_server(weather_server)
mcp_registry.attach_server(translator_server)
mcp_registry.attach_server(math_ext_server)

# 获取 LLM 使用的完整工具列表
all_tool_schemas = mcp_registry.get_all_tool_schemas()

print(f"\n📦 共有 {len(all_tool_schemas)} 个可用工具:")
for s in all_tool_schemas:
    print(f"  • {s['function']['name']}: {s['function']['description'][:60]}")
```

### 第5步：支持插件的智能体循环

```python
# ─── 支持插件的智能体 ──────────────────────

from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def run_agent(user_input: str, max_steps: int = 10) -> str:
    messages = [
        {"role": "system", "content": (
            "你是一个乐于助人的智能体，可以访问来自多个来源的工具。"
            "你有内置工具（calculate）和来自 MCP 服务器的工具"
            "（weather, translate, fibonacci）。根据任务使用合适的工具。"
        )},
        {"role": "user", "content": user_input},
    ]

    step = 0
    while step < max_steps:
        step += 1
        print(f"\n🔄 步骤 {step}")

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=all_tool_schemas,
        )

        msg = response.choices[0].message

        if not msg.tool_calls:
            return msg.content

        messages.append(msg)
        for tc in msg.tool_calls:
            tool_name = tc.function.name
            args = json.loads(tc.function.arguments)
            print(f"  🔧 {tool_name}({args})")

            # 通过 MCP 注册器执行（路由到内置或服务器）
            result = mcp_registry.execute(tool_name, args)
            print(f"  ✅ {result[:80]}")

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })

    return "已达到最大步骤数。"


# ─── 试试看 ──────────────────────────────────────────

if __name__ == "__main__":
    print("\n=== 测试 MCP 插件系统 ===\n")

    tests = [
        "东京的天气怎么样？",              # 来自天气 MCP 服务器
        "把 'hello' 翻译成中文",            # 来自翻译 MCP 服务器
        "计算第10个斐波那契数",             # 来自数学扩展 MCP 服务器
        "42 * 15 等于多少？",               # 内置计算器
        "巴黎的天气怎么样？然后把 'goodbye' 翻译成法语",  # 混合来源
    ]

    for test in tests:
        print(f"\n{'#'*60}")
        print(f"❓ {test}")
        print(f"{'#'*60}")
        result = run_agent(test)
        print(f"\n📨 {result}")
```

---

## 🔍 工作原理

### MCP：动态工具发现

插件与 MCP 的关键区别：

| 方式 | 工具如何被知晓 | 何时发生 |
|---|---|---|
| **硬编码** | 我们导入并注册它们 | 代码启动时 |
| **插件文件夹** | 我们扫描目录中的 .py 文件 | 代码启动时 |
| **MCP**（本章） | 每个服务器宣告自己的工具 | 连接时 |

使用 MCP，智能体不需要知道存在哪些工具。它连接到服务器，服务器说"这是我所能做的"。这意味着：

- **添加新工具**：只需启动一个新的 MCP 服务器
- **更新工具**：重启 MCP 服务器（重新连接时智能体获取更改）
- **移除工具**：停止 MCP 服务器
- **语言无关**：MCP 服务器可以用任何语言编写

### 工具解析的工作方式

当智能体调用 `mcp_registry.execute("get_weather", {"city": "Tokyo"})` 时：

```
1. 检查内置注册器 → 未找到 "get_weather"
2. 检查 "weather" MCP 服务器 → 找到了！在那里执行
3. 返回结果
```

当智能体调用 `mcp_registry.execute("calculate", {"expression": "2 + 2"})` 时：

```
1. 检查内置注册器 → 找到了 "calculate"！执行
2. 返回结果
```

LLM 永远不知道哪个服务器提供了这个工具。它只看到"有一个叫 get_weather 的工具"然后使用它。

### Attach vs. Import

在插件系统中，你 `import` 插件。在 MCP 中，你 **attach** 服务器：

| Import | Attach |
|---|---|
| `from weather import get_weather` | `mcp_registry.attach_server(weather_server)` |
| 必须在模块级别发生 | 在运行时发生 |
| 工具始终可用 | 工具在附加后才可用 |
| 不重启无法移除 | 随时可以分离 |
| 仅限 Python | 语言无关 |

### 真实 MCP 与我们的简化版本

在真实的 claude-code 中，MCP 服务器是独立的进程或 HTTP 端点：

```
我们的版本：
MCPServer(name="weather", ...)  →  同一个 Python 进程

真实的 MCP：
weather_server = Process("python weather_mcp.py")
# 或
weather_server = HTTPEndpoint("http://localhost:8080/mcp")
```

真实的 MCP 使用 stdin/stdout 或 HTTP 进行通信。我们的 `MCPServer` 类模拟了这一点——`execute()` 方法直接调用函数，而不是发出网络请求。但架构是相同的：在连接时发现工具，将调用路由到正确的服务器。

---

## 🧪 练习

### 练习 1：创建数据库查询 MCP 服务器

构建一个模拟数据库的 MCP 服务器：

```python
db_server = MCPServer(name="database", description="查询产品数据库")

query_schema = Schema(
    properties={
        "sql": {"type": "string", "description": "SQL 查询（模拟）"},
    },
    required=["sql"],
)

def query_db_impl(sql: str) -> str:
    """模拟数据库查询。"""
    fake_data = {
        "products": [
            {"id": 1, "name": "Laptop", "price": 999},
            {"id": 2, "name": "Mouse", "price": 25},
            {"id": 3, "name": "Keyboard", "price": 75},
        ]
    }
    if "product" in sql.lower():
        return json.dumps(fake_data["products"], indent=2)
    return f"查询已执行: {sql[:50]}... (模拟)"

db_server.add_tool(
    name="query_database",
    description="查询产品数据库。",
    input_schema=query_schema,
    call_fn=query_db_impl,
)
```

### 练习 2：工具命名空间

如果两个 MCP 服务器有同名的工具会发生什么？修改注册器以处理冲突：

```python
def execute(self, tool_name, args):
    # 如果多个服务器有相同工具，使用最先附加的那个
    if tool_name in self._tool_to_server:
        server = self._tool_to_server[tool_name]
        return server.execute(tool_name, args)
    ...
```

### 练习 3：状态端点

为每个 MCP 服务器添加健康检查：

```python
class MCPHealthServer(MCPServer):
    def status(self) -> dict:
        return {
            "name": self.name,
            "tools": len(self._tools),
            "healthy": all(self._tools.keys()),
        }
```

### 练习 4：分离服务器

添加一个 `detach_server` 方法，在运行时移除服务器的工具：

```python
def detach_server(self, name: str) -> None:
    if name in self.mcp_servers:
        del self.mcp_servers[name]
        print(f"📡 已分离 MCP 服务器: {name}")
```

### 挑战：将 MCP 服务器作为外部进程运行

创建一个作为独立 Python 进程运行的 MCP 服务器，通过 JSON over stdin/stdout 通信：

```python
import sys
import json

# weather_mcp_server.py
def handle_request(request: dict) -> dict:
    tool = request.get("tool")
    args = request.get("args", {})

    if tool == "get_weather":
        city = args.get("city", "")
        return {"result": f"22°C, 晴, {city}"}
    return {"error": f"未知工具: {tool}"}

if __name__ == "__main__":
    for line in sys.stdin:
        request = json.loads(line)
        response = handle_request(request)
        print(json.dumps(response))
        sys.stdout.flush()
```

智能体通过向 stdin 写入 JSON 并从 stdout 读取来与此服务器通信——这正是真实 MCP 服务器的工作方式。

---

## 📝 总结

### 关键概念

| 概念 | 含义 | 在 claude-code 中 |
|---|---|---|
| **MCP 服务器** | 托管工具并宣告它们 | `toolOrchestration.ts` |
| **MCPToolRegistry** | 合并内置 + 服务器工具 | `ToolSearchTool` |
| **发现** | 服务器告诉智能体它有什么工具 | `initialize` 握手 |
| **路由** | 注册器为每个工具找到正确的服务器 | `execute` 分发 |
| **附加/分离** | 在运行时添加/移除服务器 | 动态 MCP 连接 |

### 你拥有的代码

```python
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

# ─── MCP 服务器（托管工具）───

class MCPServer:
    def __init__(self, name, description=""):
        self.name = name
        self._tools = {}

    def add_tool(self, name, description, input_schema, call_fn):
        self._tools[name] = {"call": call_fn}

    def discover(self):
        return [t["schema"] for t in self._tools.values()]

    def execute(self, tool_name, args):
        if tool_name in self._tools:
            return self._tools[tool_name]["call"](**args)
        return f"未知工具: {tool_name}"

# ─── MCP 注册器（合并所有工具）───

class MCPToolRegistry:
    def __init__(self, built_in_registry):
        self.built_in = built_in_registry
        self.servers = {}

    def attach_server(self, server):
        self.servers[server.name] = server

    def execute(self, tool_name, args):
        tool = self.built_in.find_tool(tool_name)
        if tool:
            return tool.call(**args)
        for server in self.servers.values():
            if server._tools.get(tool_name):
                return server.execute(tool_name, args)
        return f"未知工具: {tool_name}"

# ─── 使用方式 ───

weather_mcp = MCPServer("weather")
weather_mcp.add_tool("get_weather", "获取天气", schema, impl)

registry = MCPToolRegistry(built_in_registry)
registry.attach_server(weather_mcp)

# 智能体调用任何工具：内置或 MCP
result = registry.execute("get_weather", {"city": "Tokyo"})
```

> **下一章：第 12 章——评估与测试。如何判断你的智能体是否真的在正常工作？**
