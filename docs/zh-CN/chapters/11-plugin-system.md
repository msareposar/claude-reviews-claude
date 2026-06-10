# 11. 插件系统

> **不用改核心代码就能无限扩展智能体的能力。**

---

## 🎯 目标
- 设计插件接口
- 实现插件注册和发现
- 构建热插拔的智能体

## 🔧 代码

```python
from abc import ABC, abstractmethod

class Plugin(ABC):
    @abstractmethod
    def execute(self, input_data: str) -> str: pass

class PluginManager:
    def __init__(self):
        self.plugins = {}

    def register(self, name: str, plugin: Plugin, description: str = ""):
        self.plugins[name] = {"instance": plugin, "description": description}

    def run(self, name: str, input_data: str) -> str:
        if name not in self.plugins:
            return f"找不到插件：{name}"
        return self.plugins[name]["instance"].execute(input_data)

    def list_plugins(self) -> str:
        return "\n".join(f"- {n}: {p['description']}" for n, p in self.plugins.items())

# 示例插件
class TranslatePlugin(Plugin):
    def execute(self, input_data: str) -> str:
        text, lang = input_data.split("|") if "|" in input_data else (input_data, "中文")
        r = openai.chat.completions.create(model="gpt-4o-mini",
            messages=[{"role": "user", "content": f"翻译成{lang}：{text}"}])
        return r.choices[0].message.content

pm = PluginManager()
pm.register("translate", TranslatePlugin(), "将文本翻译成指定语言")
```

## 🧪 练习
1. 实现天气查询插件
2. 实现文件保存插件
3. 让 LLM 能自动发现和调用插件

### 真实的 claude-code 如何集成外部工具（MCP）

真实的 **claude-code**（[源码](https://github.com/ChinaSiro/claude-code-sourcemap)）支持 **Model Context Protocol (MCP）**——一种用于动态添加外部工具的开放标准：

**源码：[`restored-src/src/services/tools/toolOrchestration.ts`](https://github.com/ChinaSiro/claude-code-sourcemap/blob/main/restored-src/src/services/tools/toolOrchestration.ts)**

claude-code 不是使用扫描文件夹的插件管理器，而是连接到**MCP 服务器**，这些服务器动态宣告自己的工具：

```python
# claude-code MCP 工具集成的概念模型
# 源码：restored-src/src/services/tools/toolOrchestration.ts

from typing import Dict, List, Optional

class MCPServer:
    """
    实现 Model Context Protocol 的远程工具服务器。
    
    MCP 服务器在运行时动态宣告它们的能力。
    智能体在连接时发现哪些工具可用。
    """
    def __init__(self, name: str, endpoint: str):
        self.name = name
        self.endpoint = endpoint
        self.tools: Dict[str, dict] = {}
    
    def connect(self) -> bool:
        """连接到 MCP 服务器并发现其工具。
        claude-code 在启动时为每个配置的服务器调用此方法。"""
        print(f"🔌 正在连接 MCP 服务器: {self.name} ({self.endpoint})")
        return True
    
    def get_tool_schemas(self) -> List[dict]:
        """获取此服务器宣告的所有工具 schema。
        这些将与内置工具合并，供 LLM 使用。"""
        return list(self.tools.values())


class MCPToolRegistry:
    """
    聚合多个 MCP 服务器的工具 + 内置工具。
    
    claude-code 将所有可用工具（内置 + MCP）合并为
    一个单一的列表，LLM 看到的是这个列表。LLM 不知道（也不关心）
    每个工具由哪个服务器提供。
    """
    def __init__(self):
        self.built_in_tools: Dict[str, callable] = {}
        self.mcp_servers: List[MCPServer] = []
    
    def add_mcp_server(self, server: MCPServer) -> None:
        """注册一个 MCP 服务器。其工具立即可用。"""
        self.mcp_servers.append(server)
    
    def get_all_tool_schemas(self) -> List[dict]:
        """合并内置工具 + 所有 MCP 服务器工具。"""
        schemas = []
        for name, fn in self.built_in_tools.items():
            schemas.append(self._tool_to_schema(name, fn))
        for server in self.mcp_servers:
            schemas.extend(server.get_tool_schemas())
        return schemas
    
    def execute(self, tool_name: str, args: dict) -> str:
        """执行工具，路由到正确的提供者。"""
        if tool_name in self.built_in_tools:
            return self.built_in_tools[tool_name](**args)
        for server in self.mcp_servers:
            if tool_name in server.tools:
                return self._call_mcp(server, tool_name, args)
        return f"错误: 未知工具 '{tool_name}'"
    
    @staticmethod
    def _tool_to_schema(name: str, fn: callable) -> dict:
        import inspect
        sig = inspect.signature(fn)
        props = {}
        for param_name, param in sig.parameters.items():
            props[param_name] = {"type": "string", "description": f"参数: {param_name}"}
        return {
            "type": "function",
            "function": {
                "name": name,
                "description": fn.__doc__ or "",
                "parameters": {"type": "object", "properties": props},
            },
        }
    
    def _call_mcp(self, server: MCPServer, tool: str, args: dict) -> str:
        """在 MCP 服务器上远程执行工具。"""
        print(f"📡 正在调用 MCP 工具 {server.name}/{tool}")
        return f"(来自 MCP 工具 '{tool}' 的模拟结果)"


# ─── 使用：通过 MCP 的插件 ───

registry = MCPToolRegistry()

def search_web(query: str) -> str:
    return f"搜索结果: {query}"
registry.built_in_tools["search_web"] = search_web

weather_mcp = MCPServer("weather", "http://localhost:8081/mcp")
weather_mcp.tools = {
    "get_weather": {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "获取某个城市的天气",
            "parameters": {
                "type": "object",
                "properties": {"city": {"type": "string"}},
            },
        },
    }
}
registry.add_mcp_server(weather_mcp)

# 现在智能体同时拥有内置 + MCP 工具
all_tools = registry.get_all_tool_schemas()
for t in all_tools:
    print(f"📦 可用工具: {t['function']['name']}")
```

与我们的插件系统的关键区别：MCP 工具是**远程且动态发现的**。智能体在运行时连接到服务器，获取工具列表，并可以立即使用它们，无需代码更改。这就是 claude-code 支持数据库连接器、API 集成和自定义工作流的方式——每个 MCP 服务器独立贡献自己的工具。

更多细节：claude-code 的 [tool orchestration 源码](https://github.com/ChinaSiro/claude-code-sourcemap/blob/main/restored-src/src/services/tools/toolOrchestration.ts) 和 `ToolSearchTool` 用于动态工具发现。

下一章：安全与权限。
