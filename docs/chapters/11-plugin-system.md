# 11. Plugin System

> **In this chapter: Your agent is powerful, but you can't predict every tool someone might need. You'll build a plugin system using the Model Context Protocol (MCP) pattern — the same approach claude-code uses to integrate external tools dynamically.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand why dynamic tool discovery beats hard-coding
- Build an **MCPServer** — a remote tool provider that advertises its capabilities
- Build an **MCPToolRegistry** that merges built-in and external tools
- Create example MCP servers: weather, translator, and a simple API
- See how tools are discovered at runtime without code changes

---

## 📖 Explain Like I'm 10

### The Problem: You Can't Predict Everything

You've built a great agent. It can search the web, do math, and read files. But what if someone wants it to:

- Check the weather?
- Translate text to Spanish?
- Generate an image?
- Control their smart home lights?

You could add each feature directly to the agent's code. But that means:

```
Week 1: User wants weather  →  Add weather function
Week 2: User wants translate →  Add translate function
Week 3: User wants images   →  Add image generation
Week 4: User wants...       →  ...you get the idea
```

Every change means modifying the agent's core code. After a while, the agent becomes a tangled mess of features.

### The Plugin Solution

A **plugin system** lets you add features **without touching the core code**:

```
┌────────────────────────────────────────┐
│         Agent Core                     │
│  • Think → Act → Observe loop         │
│  • Tool dispatch                       │
│  • Context management                  │
└──────────────────┬─────────────────────┘
                   │ "I need a tool"
                   ▼
┌────────────────────────────────────────┐
│         MCPToolRegistry                │
│  Merges tools from all sources         │
└──┬──────┬──────┬──────┬────────────────┘
   │      │      │      │
   ▼      ▼      ▼      ▼
 Built  MCP    MCP    MCP
-in     Srv A  Srv B  Srv C
Tools  (weth) (trans)(image)
```

Each MCP server is **independent**. It advertises its own tools. The agent discovers them at runtime. No core code changes needed.

### MCP: A Protocol, Not a Framework

The Model Context Protocol (MCP) is an open standard for how agents discover and call external tools. Instead of writing a Python plugin class, your tools run on an MCP server. The server tells the agent:

- "Here are my tools"
- "Here's what each tool does"
- "Here's what parameters each tool needs"

The agent connects to the server, gets the tool list, and adds them to its available tools. The agent doesn't need to know if the tool is local, remote, or running in a different language.

---

## 🔧 Hands-On: Build an MCP Plugin System

### Step 1: The MCPServer — A Tool Advertiser

An MCP server is something that hosts tools and advertises them. Let's build our version:

```python
# mcp_plugin_system.py

from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry
from typing import Dict, List, Optional, Callable


class MCPServer:
    """
    An MCP server that hosts and advertises tools.
    
    In the real claude-code, MCP servers are processes that
    communicate over stdio or HTTP. Here we simulate the
    same pattern — each server holds tools and advertises
    them via get_tool_schemas().
    
    Like claude-code's MCP integration
    (source: restored-src/src/services/tools/toolOrchestration.ts).
    """
    def __init__(self, name: str, description: str = ""):
        self.name = name
        self.description = description
        self._tools: Dict[str, dict] = {}  # name → schema

    def add_tool(self, name: str, description: str,
                 input_schema: Schema, call_fn: Callable) -> None:
        """Register a tool on this MCP server."""
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
        Advertise all tools on this server.
        
        The agent calls this at connection time to learn
        what tools are available. This is the MCP equivalent
        of the "initialize" handshake.
        """
        print(f"  🔍 Discovering tools from MCP server '{self.name}'...")
        return [info["schema"] for info in self._tools.values()]

    def execute(self, tool_name: str, args: dict) -> str:
        """Execute a tool on this server."""
        if tool_name not in self._tools:
            return f"Error: MCP server '{self.name}' has no tool '{tool_name}'"

        try:
            return self._tools[tool_name]["call"](**args)
        except Exception as e:
            return f"Error from MCP server '{self.name}': {type(e).__name__}: {e}"

    def has_tool(self, name: str) -> bool:
        return name in self._tools
```

### Step 2: The MCPToolRegistry — Merging All Tools

Now we need a registry that merges built-in tools with tools from MCP servers. This is how claude-code's `toolOrchestration.ts` works — every tool is just a tool, regardless of where it comes from:

```python
class MCPToolRegistry:
    """
    Aggregates tools from built-in definitions and MCP servers.
    
    The agent sees one unified list of tools. It doesn't know
    (or care) which server provides each tool. When a tool
    is called, the registry routes to the right provider.
    
    Like claude-code's orchestration layer
    (source: restored-src/src/services/tools/toolOrchestration.ts).
    """
    def __init__(self, built_in_registry: ToolRegistry):
        self.built_in = built_in_registry
        self.mcp_servers: Dict[str, MCPServer] = {}

    def attach_server(self, server: MCPServer) -> None:
        """
        Connect an MCP server and discover its tools.
        
        This is called at startup for each configured server.
        After this, the server's tools are available alongside
        built-in tools.
        """
        print(f"📡 Attaching MCP server: {server.name}")
        schemas = server.discover()
        print(f"   Found {len(schemas)} tool(s)")
        self.mcp_servers[server.name] = server

    def get_all_tool_schemas(self) -> List[dict]:
        """
        Get schemas for ALL tools: built-in + MCP.
        This is what gets sent to the LLM.
        """
        schemas = self.built_in.get_openai_schemas()
        for server in self.mcp_servers.values():
            schemas.extend(server.discover())
        return schemas

    def execute(self, tool_name: str, args: dict) -> str:
        """
        Execute a tool, routing to the right provider.
        
        1. Check built-in tools first
        2. Check each MCP server
        3. Unknown tool → error
        """
        # Try built-in
        tool = self.built_in.find_tool(tool_name)
        if tool:
            return tool.call(**args)

        # Try MCP servers
        for server in self.mcp_servers.values():
            if server.has_tool(tool_name):
                return server.execute(tool_name, args)

        return f"Error: Unknown tool '{tool_name}'."
```

### Step 3: Build MCP Servers (Plugins)

Now let's create some MCP servers. Each one is independent and advertises its own tools:

```python
# ─── Weather MCP Server ─────────────────────────────

import math
import json
import os

weather_server = MCPServer(
    name="weather",
    description="Weather data provider",
)

weather_schema = Schema(
    properties={
        "city": {"type": "string", "description": "City name, e.g. 'Tokyo'"},
    },
    required=["city"],
)

def weather_impl(city: str) -> str:
    """Get weather for a city using wttr.in."""
    import urllib.request
    url = f"https://wttr.in/{city}?format=3"
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            return response.read().decode("utf-8").strip()
    except Exception as e:
        # Fallback to simulated data
        fake_data = {
            "tokyo": "22°C, sunny",
            "london": "15°C, cloudy",
            "new york": "18°C, light rain",
            "paris": "20°C, partly cloudy",
        }
        return fake_data.get(city.lower(), f"20°C, clear (simulated for {city})")

weather_server.add_tool(
    name="get_weather",
    description="Get the current weather for a city. Uses real data from wttr.in.",
    input_schema=weather_schema,
    call_fn=weather_impl,
)


# ─── Translator MCP Server ──────────────────────────

translator_server = MCPServer(
    name="translator",
    description="Simple text translation",
)

translate_schema = Schema(
    properties={
        "text": {"type": "string", "description": "Text to translate"},
        "target_language": {
            "type": "string",
            "description": "Target language, e.g. 'spanish', 'french', 'japanese'",
        },
    },
    required=["text", "target_language"],
)

def translate_impl(text: str, target_language: str) -> str:
    """Simulated translation."""
    fake_translations = {
        "hello": {
            "spanish": "hola",
            "french": "bonjour",
            "japanese": "こんにちは",
            "german": "hallo",
        },
        "goodbye": {
            "spanish": "adiós",
            "french": "au revoir",
            "japanese": "さようなら",
        },
    }
    text_lower = text.lower().strip()
    if text_lower in fake_translations:
        translation = fake_translations[text_lower].get(target_language.lower())
        if translation:
            return translation
    return f"[{target_language}] {text} (translated)"

translator_server.add_tool(
    name="translate",
    description="Translate text to another language.",
    input_schema=translate_schema,
    call_fn=translate_impl,
)


# ─── Math Extension MCP Server ──────────────────────

math_ext_server = MCPServer(
    name="math_extensions",
    description="Advanced math operations",
)

fib_schema = Schema(
    properties={
        "n": {"type": "integer", "description": "Position in Fibonacci sequence (1-based)"},
    },
    required=["n"],
)

def fibonacci_impl(n: int) -> str:
    """Calculate the nth Fibonacci number."""
    if n < 1:
        return "Error: n must be >= 1"
    if n > 100:
        return "Error: n must be <= 100"

    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return str(a)

math_ext_server.add_tool(
    name="fibonacci",
    description="Calculate the nth Fibonacci number.",
    input_schema=fib_schema,
    call_fn=fibonacci_impl,
)
```

### Step 4: Connect Everything

Now let's put it all together — built-in tools plus MCP servers:

```python
# ─── Built-in tools (same as previous chapters) ──────

calc_schema = Schema(
    properties={
        "expression": {"type": "string", "description": "Math expression"},
    },
    required=["expression"],
)

def calc_impl(expression: str) -> str:
    allowed = {"sqrt": math.sqrt, "pi": math.pi, "abs": abs}
    return str(eval(expression, {"__builtins__": {}}, allowed))

calculator = build_tool(ToolDef(
    name="calculate",
    description="Evaluate a mathematical expression",
    input_schema=calc_schema,
    call=calc_impl,
    is_concurrency_safe=True,
))

built_in_registry = ToolRegistry()
built_in_registry.register(calculator)

# ─── MCP Tool Registry ──────────────────────────────

mcp_registry = MCPToolRegistry(built_in_registry)

# Attach MCP servers (plugins)
mcp_registry.attach_server(weather_server)
mcp_registry.attach_server(translator_server)
mcp_registry.attach_server(math_ext_server)

# Get the full list of tools for the LLM
all_tool_schemas = mcp_registry.get_all_tool_schemas()

print(f"\n📦 {len(all_tool_schemas)} tools available:")
for s in all_tool_schemas:
    print(f"  • {s['function']['name']}: {s['function']['description'][:60]}")
```

### Step 5: The Plugin-Aware Agent Loop

```python
# ─── Agent with plugin support ──────────────────────

from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def run_agent(user_input: str, max_steps: int = 10) -> str:
    messages = [
        {"role": "system", "content": (
            "You are a helpful agent with access to tools from multiple sources. "
            "You have built-in tools (calculate) and tools from MCP servers "
            "(weather, translate, fibonacci). Use whichever tool is appropriate "
            "for the task."
        )},
        {"role": "user", "content": user_input},
    ]

    step = 0
    while step < max_steps:
        step += 1
        print(f"\n🔄 Step {step}")

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

            # Execute via MCP registry (routes to built-in or server)
            result = mcp_registry.execute(tool_name, args)
            print(f"  ✅ {result[:80]}")

            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })

    return "Max steps reached."


# ─── Try it ──────────────────────────────────────────

if __name__ == "__main__":
    print("\n=== Testing MCP Plugin System ===\n")

    tests = [
        "What's the weather in Tokyo?",           # From weather MCP server
        "Translate 'hello' to Spanish",           # From translator MCP server
        "Calculate the 10th Fibonacci number",    # From math_ext MCP server
        "What is 42 * 15?",                       # Built-in calculator
        "Weather in Paris and translate 'goodbye' to French",  # Mixed sources
    ]

    for test in tests:
        print(f"\n{'#'*60}")
        print(f"❓ {test}")
        print(f"{'#'*60}")
        result = run_agent(test)
        print(f"\n📨 {result}")
```

---

## 🔍 How It Works

### MCP: Dynamic Tool Discovery

The key difference between plugins and MCP:

| Approach | How Tools Are Known | When It Happens |
|---|---|---|
| **Hard-coded** | We import and register them | At code startup |
| **Plugin folder** | We scan a directory for .py files | At code startup |
| **MCP** (this chapter) | Each server advertises its tools | At connection time |

With MCP, the agent doesn't need to know what tools exist. It connects to a server and the server says "here's what I can do." This means:

- **Add a new tool**: Just start a new MCP server
- **Update a tool**: Restart the MCP server (agent picks up changes on reconnect)
- **Remove a tool**: Stop the MCP server
- **Language-agnostic**: The MCP server can be written in any language

### How Tool Resolution Works

When the agent calls `mcp_registry.execute("get_weather", {"city": "Tokyo"})`:

```
1. Check built-in registry → "get_weather" not found
2. Check "weather" MCP server → found! Execute there
3. Return result
```

When the agent calls `mcp_registry.execute("calculate", {"expression": "2 + 2"})`:

```
1. Check built-in registry → "calculate" found! Execute
2. Return result
```

The LLM never knows which server provided the tool. It just sees "there's a tool called get_weather" and uses it.

### Attaching vs. Importing

In a plugin system, you `import` the plugin. In MCP, you **attach** the server:

| Import | Attach |
|---|---|
| `from weather import get_weather` | `mcp_registry.attach_server(weather_server)` |
| Must happen at module level | Happens at runtime |
| Tool is always available | Tool is available once attached |
| Can't remove without restart | Can detach at any time |
| Python-only | Language-agnostic |

### Real MCP vs. Our Simplified Version

In the real claude-code, MCP servers are separate processes or HTTP endpoints:

```
Our version:
MCPServer(name="weather", ...)  →  Same Python process

Real MCP:
weather_server = Process("python weather_mcp.py")
# or
weather_server = HTTPEndpoint("http://localhost:8080/mcp")
```

The real MCP uses stdin/stdout or HTTP for communication. Our `MCPServer` class simulates this — the `execute()` method calls the function directly instead of making a network request. But the architecture is the same: discover tools at connection, route calls to the right server.

---

## 🧪 Exercises

### Exercise 1: Create a Database Query MCP Server

Build an MCP server that simulates a database:

```python
db_server = MCPServer(name="database", description="Query a product database")

query_schema = Schema(
    properties={
        "sql": {"type": "string", "description": "SQL query (simulated)"},
    },
    required=["sql"],
)

def query_db_impl(sql: str) -> str:
    """Simulated database query."""
    fake_data = {
        "products": [
            {"id": 1, "name": "Laptop", "price": 999},
            {"id": 2, "name": "Mouse", "price": 25},
            {"id": 3, "name": "Keyboard", "price": 75},
        ]
    }
    if "product" in sql.lower():
        return json.dumps(fake_data["products"], indent=2)
    return f"Query executed: {sql[:50]}... (simulated)"

db_server.add_tool(
    name="query_database",
    description="Query the product database.",
    input_schema=query_schema,
    call_fn=query_db_impl,
)
```

### Exercise 2: Tool Namespacing

What happens if two MCP servers have a tool with the same name? Modify the registry to handle conflicts:

```python
def execute(self, tool_name, args):
    # If multiple servers have the same tool,
    # use the first one attached
    if tool_name in self._tool_to_server:
        server = self._tool_to_server[tool_name]
        return server.execute(tool_name, args)
    ...
```

### Exercise 3: Status Endpoint

Add a health check to each MCP server:

```python
class MCPHealthServer(MCPServer):
    def status(self) -> dict:
        return {
            "name": self.name,
            "tools": len(self._tools),
            "healthy": all(self._tools.keys()),
        }
```

### Exercise 4: Detach a Server

Add a `detach_server` method to remove a server's tools at runtime:

```python
def detach_server(self, name: str) -> None:
    if name in self.mcp_servers:
        del self.mcp_servers[name]
        print(f"📡 Detached MCP server: {name}")
```

### Challenge: MCP Server as an External Process

Create an MCP server that runs as a separate Python process and communicates via JSON over stdin/stdout:

```python
import sys
import json

# weather_mcp_server.py
def handle_request(request: dict) -> dict:
    tool = request.get("tool")
    args = request.get("args", {})

    if tool == "get_weather":
        city = args.get("city", "")
        return {"result": f"22°C, sunny in {city}"}
    return {"error": f"Unknown tool: {tool}"}

if __name__ == "__main__":
    for line in sys.stdin:
        request = json.loads(line)
        response = handle_request(request)
        print(json.dumps(response))
        sys.stdout.flush()
```

The agent communicates with this server by writing JSON to stdin and reading from stdout — exactly how real MCP servers work.

---

## 📝 Summary

### Key Concepts

| Concept | What It Means | In claude-code |
|---|---|---|
| **MCP Server** | Hosts tools and advertises them | `toolOrchestration.ts` |
| **MCPToolRegistry** | Merges built-in + server tools | `ToolSearchTool` |
| **Discovery** | Server tells agent what tools it has | `initialize` handshake |
| **Routing** | Registry finds the right server for each tool | `execute` dispatch |
| **Attach/Detach** | Add/remove servers at runtime | Dynamic MCP connection |

### The Code You Own

```python
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

# ─── MCP Server (hosts tools) ───

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
        return f"Unknown tool: {tool_name}"

# ─── MCP Registry (merges all tools) ───

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
        return f"Unknown tool: {tool_name}"

# ─── Usage ───

weather_mcp = MCPServer("weather")
weather_mcp.add_tool("get_weather", "Get weather", schema, impl)

registry = MCPToolRegistry(built_in_registry)
registry.attach_server(weather_mcp)

# Agent calls any tool: built-in or MCP
result = registry.execute("get_weather", {"city": "Tokyo"})
```

> **Next up: Chapter 12 — Evaluation & Testing. How do you know if your agent is actually working?**
