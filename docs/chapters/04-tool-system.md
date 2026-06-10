# 04. Tool System: Hands & Feet

> **In this chapter: You'll design a proper tool system with an abstract base class, automatic schema generation, error handling, and easy registration. Your agent's "hands and feet" will be clean, extensible, and production-ready.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Design a **Tool base class** that all tools inherit from
- Generate **JSON schemas automatically** from tool definitions
- Build production-ready tools: CalculatorTool, FileReadTool, WebSearchTool
- Handle **errors gracefully** inside tools
- Register and dispatch tools dynamically
- Understand the **tool lifecycle**: define → register → call → handle errors

---

## 📖 Explain Like I'm 10

### Tools Are Like Phone Apps

Imagine your phone:

- You don't re-write the camera app every time you take a photo
- The camera app has a **standard interface**: press button → get photo
- New apps can be installed without changing the phone itself

Tools should work the same way.

| Phone | Agent |
|---|---|
| Camera app | CalculatorTool |
| Maps app | SearchTool |
| App Store | Tool registration |
| Standard app interface | Base class (`Tool`) |
| App permissions | Tool schema |

### Why Not Keep Using Functions?

In Chapters 02 and 03, we wrote tools as plain functions:

```python
def calculate(expression: str) -> str:
    return str(eval(...))
```

This works, but it has problems as your agent grows:

| Problem | With Functions | With Tool Class |
|---|---|---|
| Adding a new tool | Write a function + write a schema separately | Write a class; schema is auto-generated |
| Error handling | Inconsistent (each function does it differently) | Standardized in the base class |
| Listing all tools | Manual list | Tools auto-register |
| Tool metadata | Scattered | All in one place |
| Testing | Manual | Consistent interface |

A **tool system** solves these problems by standardizing how tools are built, described, and called.

---

## 🔧 Hands-On: Build the Tool System

### Step 1: The Abstract Base Class

Create a file called `tool_system.py`:

```python
import json
from abc import ABC, abstractmethod
from typing import Any, Dict, List, Optional


class Tool(ABC):
    """
    Abstract base class for all tools.
    
    Every tool must define:
    - name: The tool's name (used by the LLM)
    - description: What the tool does
    - parameters: The input parameters
    - run(): The actual implementation
    """
    
    @property
    @abstractmethod
    def name(self) -> str:
        """The tool name (used by the LLM to call it)."""
        pass
    
    @property
    @abstractmethod
    def description(self) -> str:
        """Describe what this tool does."""
        pass
    
    @property
    @abstractmethod
    def parameters(self) -> Dict[str, Any]:
        """
        The parameter schema in JSON Schema format.
        
        Example:
        {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "The math expression"
                }
            },
            "required": ["expression"]
        }
        """
        pass
    
    @abstractmethod
    def run(self, **kwargs) -> str:
        """Execute the tool with the given arguments."""
        pass
    
    def to_openai_schema(self) -> Dict[str, Any]:
        """Convert this tool to OpenAI's function calling format."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }
```

### Step 2: Implement CalculatorTool

```python
import math

class CalculatorTool(Tool):
    """A tool that evaluates mathematical expressions."""
    
    @property
    def name(self) -> str:
        return "calculate"
    
    @property
    def description(self) -> str:
        return (
            "Evaluate a mathematical expression. "
            "Supports: +, -, *, /, sqrt(), pow(), sin(), cos(), tan(), "
            "pi, e, abs(), round(), min(), max()"
        )
    
    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "The math expression to evaluate, e.g. '2 + 2' or 'sqrt(144)'",
                }
            },
            "required": ["expression"],
        }
    
    def run(self, expression: str) -> str:
        """Evaluate a mathematical expression."""
        allowed = {
            "abs": abs, "round": round, "max": max, "min": min,
            "sum": sum, "pow": pow, "sqrt": math.sqrt,
            "sin": math.sin, "cos": math.cos, "tan": math.tan,
            "pi": math.pi, "e": math.e,
        }
        
        try:
            result = eval(expression, {"__builtins__": {}}, allowed)
            return str(result)
        except ZeroDivisionError:
            return "Error: Cannot divide by zero."
        except SyntaxError:
            return "Error: Invalid expression syntax. Check your operators and parentheses."
        except NameError as e:
            return f"Error: Unknown function or variable used. {e}"
        except Exception as e:
            return f"Error: {type(e).__name__}: {e}"
```

Notice how error handling is **built into the tool**. Each type of error has a human-readable message.

### Step 3: Implement FileReadTool

```python
import os

class FileReadTool(Tool):
    """A tool that reads the contents of a file."""
    
    @property
    def name(self) -> str:
        return "read_file"
    
    @property
    def description(self) -> str:
        return "Read the contents of a file. Returns the file content or an error message."
    
    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "The path to the file to read (absolute or relative)",
                },
                "encoding": {
                    "type": "string",
                    "description": "File encoding (default: utf-8)",
                    "default": "utf-8",
                },
            },
            "required": ["path"],
        }
    
    def run(self, path: str, encoding: str = "utf-8") -> str:
        """Read a file and return its contents."""
        try:
            if not os.path.exists(path):
                return f"Error: File not found: {path}"
            if not os.path.isfile(path):
                return f"Error: Not a file: {path}"
            
            with open(path, 'r', encoding=encoding) as f:
                content = f.read()
            
            if len(content) == 0:
                return "File is empty."
            
            return f"File content ({len(content)} chars):\n{content}"
        
        except PermissionError:
            return f"Error: Permission denied reading: {path}"
        except UnicodeDecodeError:
            return f"Error: Cannot decode file with {encoding} encoding. Try a different encoding."
        except Exception as e:
            return f"Error reading file: {type(e).__name__}: {e}"
```

### Step 4: Implement WebSearchTool (Simulated)

```python
class WebSearchTool(Tool):
    """A simulated web search tool."""
    
    def __init__(self):
        # A mock database for our examples
        self._database = {
            "capital of france": "Paris is the capital of France, located in the Île-de-France region.",
            "capital of japan": "Tokyo is the capital of Japan, located on the island of Honshu.",
            "population of japan": "Japan's population is approximately 125 million as of 2024.",
            "population of the world": "The world population is approximately 8 billion as of 2024.",
            "python programming": "Python is a high-level, general-purpose programming language created by Guido van Rossum in 1991.",
            "what is an ai agent": "An AI agent is a software system that uses large language models to reason, plan, and use tools to accomplish tasks.",
            "weather in tokyo": "Tokyo weather: 22°C, partly cloudy, humidity 65%.",
            "weather in london": "London weather: 15°C, overcast, light rain expected.",
            "meaning of life": "The meaning of life is a philosophical question. Some say 42 (Douglas Adams).",
        }
    
    @property
    def name(self) -> str:
        return "search_web"
    
    @property
    def description(self) -> str:
        return "Search the web for information and facts. Use for knowledge questions, definitions, current information."
    
    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "The search query (be specific for best results)",
                }
            },
            "required": ["query"],
        }
    
    def run(self, query: str) -> str:
        """Search the database for matching information."""
        query_lower = query.lower()
        
        # Check for exact matches first
        if query_lower in self._database:
            return self._database[query_lower]
        
        # Check for keyword matches
        results = []
        for key, value in self._database.items():
            keywords = key.split()
            if any(kw in query_lower for kw in keywords):
                results.append(value)
        
        if results:
            return "\n".join(results)
        
        return f"No results found for '{query}'. Try different keywords."
```

### Step 5: The Tool Registry

Now let's build the **registry** that manages all tools:

```python
class ToolRegistry:
    """
    Manages registration and dispatch of tools.
    
    Tools can be registered and looked up by name.
    The registry can produce schemas for the LLM.
    """
    
    def __init__(self):
        self._tools: Dict[str, Tool] = {}
    
    def register(self, tool: Tool) -> None:
        """Register a tool."""
        if tool.name in self._tools:
            print(f"⚠ Warning: Overwriting existing tool '{tool.name}'")
        self._tools[tool.name] = tool
        print(f"✅ Registered tool: {tool.name}")
    
    def unregister(self, name: str) -> None:
        """Remove a tool from the registry."""
        if name in self._tools:
            del self._tools[name]
            print(f"🗑️ Unregistered tool: {name}")
    
    def get(self, name: str) -> Optional[Tool]:
        """Get a tool by name."""
        return self._tools.get(name)
    
    def get_all(self) -> List[Tool]:
        """Get all registered tools."""
        return list(self._tools.values())
    
    def get_openai_schemas(self) -> List[Dict[str, Any]]:
        """Get all tool schemas in OpenAI format."""
        return [tool.to_openai_schema() for tool in self._tools.values()]
    
    def run_tool(self, name: str, arguments: Dict[str, Any]) -> str:
        """
        Run a tool by name with the given arguments.
        Returns the result or an error message.
        """
        tool = self._tools.get(name)
        if not tool:
            return f"Error: Unknown tool '{name}'. Available tools: {', '.join(self._tools.keys())}"
        
        try:
            return tool.run(**arguments)
        except TypeError as e:
            return f"Error: Invalid arguments for {name}. {e}"
        except Exception as e:
            return f"Error: {name} failed with {type(e).__name__}: {e}"
    
    def list_tools(self) -> str:
        """Return a formatted list of available tools."""
        lines = ["Available tools:"]
        for tool in self._tools.values():
            params = tool.parameters
            param_names = list(params.get("properties", {}).keys())
            lines.append(f"  - {tool.name}({', '.join(param_names)}): {tool.description}")
        return "\n".join(lines)
```

### Step 6: The Agent with ToolRegistry

Now let's use the registry in our agent:

```python
from openai import OpenAI
import os
import json

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def run_agent_with_registry(user_input: str, registry: ToolRegistry, max_steps: int = 10) -> str:
    """Run the agent using the tool registry."""
    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful agent with access to tools.\n"
                "Available tools:\n" +
                registry.list_tools() +
                "\n\nSolve tasks step by step. Use tools when needed. "
                "When you're done, provide a clear answer."
            ),
        },
        {"role": "user", "content": user_input},
    ]
    
    for step in range(1, max_steps + 1):
        print(f"\n{'='*50}")
        print(f"🔄 Step {step}")
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=registry.get_openai_schemas(),
        )
        
        msg = response.choices[0].message
        
        if not msg.tool_calls:
            print(f"✅ Done. Answer: {msg.content[:80]}...")
            return msg.content
        
        messages.append(msg)
        
        for tc in msg.tool_calls:
            tool_name = tc.function.name
            args = json.loads(tc.function.arguments)
            print(f"🔧 Calling: {tool_name}({args})")
            
            result = registry.run_tool(tool_name, args)
            print(f"👀 Result: {result[:100]}...")
            
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result,
            })
    
    # Force final answer if max steps reached
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages + [{"role": "system", "content": "Provide your best final answer now."}],
    )
    return response.choices[0].message.content


# ─── DEMO ─────────────────────────────────────────────

if __name__ == "__main__":
    # Create the registry
    registry = ToolRegistry()
    
    # Register tools
    registry.register(CalculatorTool())
    registry.register(FileReadTool())
    registry.register(WebSearchTool())
    
    # Show registered tools
    print(registry.list_tools())
    
    # Test
    test_queries = [
        "What is 15% of 200?",
        "What is the capital of France and what's the weather in Tokyo?",
        "Calculate the square root of 144 plus 10.",
    ]
    
    for query in test_queries:
        print(f"\n\n{'#'*60}")
        print(f"❓ {query}")
        result = run_agent_with_registry(query, registry)
        print(f"\n📨 {result}")
```

---

## 🔍 How It Works

### Tool Lifecycle

```
1. DEFINE ──→ 2. REGISTER ──→ 3. DISPATCH ──→ 4. EXECUTE ──→ 5. HANDLE ERRORS
```

#### Phase 1: Define

Each tool is a **class** that inherits from `Tool`. The class defines:
- **name**: How the LLM refers to the tool
- **description**: What the tool does (this is critical for the LLM to choose correctly)
- **parameters**: The inputs, with types and descriptions
- **run()**: The actual logic

#### Phase 2: Register

Tools are registered with the `ToolRegistry`. The registry:
- Stores tools in a dictionary keyed by name
- Generates OpenAI-compatible schemas automatically
- Provides a list of all tools for the system prompt

```python
registry = ToolRegistry()
registry.register(CalculatorTool())
```

#### Phase 3: Dispatch

When the LLM calls a tool, the agent:
1. Looks up the tool by name in the registry
2. Passes the arguments as `**kwargs`
3. Returns the result (or error)

```python
result = registry.run_tool("calculate", {"expression": "2 + 2"})
# result = "4"
```

#### Phase 4: Execute

The tool's `run()` method is called with validated arguments. Each tool is responsible for:
- Doing its job
- Returning a **string** result
- Handling its own errors

#### Phase 5: Handle Errors

Errors can happen at multiple levels:

| Level | What Goes Wrong | How It's Handled |
|---|---|---|
| **Dispatch** | Tool name not found | Registry returns error string |
| **Arguments** | Wrong type or missing params | Python `TypeError` caught by registry |
| **Execution** | File not found, division by zero | Tool's own try/except |
| **Runtime** | Unexpected crash | Registry's generic `Exception` catch |

The key principle: **tools always return strings, never crash the agent.**

### Why a Class-Based System?

| Feature | Plain Function | Tool Class |
|---|---|---|
| Schema | Must write manually | Auto-generated from `parameters` |
| Error handling | Inconsistent | Standardized |
| Registration | Manual list | One `register()` call |
| Documentation | Separate | Built into the class |
| Extensibility | Hard (copy-paste) | Easy (inherit and override) |
| Testing | Test each function | Test the base class interface |

### The LLM Sees Your Description

The `description` field is **extremely important**. The LLM uses it to decide which tool to call.

Bad description:
```python
description = "Calculate things."
```

Good description:
```python
description = "Evaluate a mathematical expression. Supports +, -, *, /, sqrt(), pow(), sin(), cos(), pi, e. Use for any math or arithmetic task."
```

A bad description leads to:
- The LLM calling the wrong tool
- The LLM not calling a tool when it should
- The LLM calling the tool with wrong arguments

A good description helps the LLM make the right decision.

### Parameters with Defaults

Our `FileReadTool` has an `encoding` parameter with a default:

```python
"encoding": {
    "type": "string",
    "description": "File encoding (default: utf-8)",
    "default": "utf-8",  # ← This tells the LLM it's optional
}
```

When a parameter has a `"default"`, the LLM knows it can skip it. Parameters without defaults (in `"required"` list) must be provided.

---

## 🧪 Exercises

### Exercise 1: Build a DateTool

Create a tool that returns the current date, time, or both.

```python
from datetime import datetime, timezone

class DateTool(Tool):
    @property
    def name(self) -> str:
        return "get_date_info"
    
    @property
    def description(self) -> str:
        return "Get the current date, time, or both. Ask for 'date', 'time', 'datetime', or 'timezone'."
    
    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "info_type": {
                    "type": "string",
                    "description": "What to get: 'date', 'time', 'datetime', 'timezone', or 'all'",
                    "enum": ["date", "time", "datetime", "timezone", "all"],
                }
            },
            "required": ["info_type"],
        }
    
    def run(self, info_type: str = "all") -> str:
        now = datetime.now()
        # ... implement the logic
```

**Complete the `run()` method** and register it. Test with: "What time is it?" and "What's today's date?"

### Exercise 2: Build a WeatherTool with a Real API

Use the free [wttr.in](https://wttr.in) API to build a real weather tool.

```python
import urllib.request
import json

class WeatherTool(Tool):
    @property
    def name(self) -> str:
        return "get_weather"
    
    @property
    def description(self) -> str:
        return "Get the current weather for a city. Uses real weather data."
    
    @property
    def parameters(self) -> Dict[str, Any]:
        return {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "City name, e.g. 'Tokyo', 'London', 'New York'",
                }
            },
            "required": ["city"],
        }
    
    def run(self, city: str) -> str:
        try:
            url = f"https://wttr.in/{city}?format=3"
            with urllib.request.urlopen(url) as response:
                return response.read().decode("utf-8").strip()
        except Exception as e:
            return f"Error getting weather: {e}"
```

**Try:** "What's the weather in Paris?" and "How's the weather in Tokyo and Seoul?"

### Exercise 3: Schema Inspection

Write a function that prints the full OpenAI schema for all registered tools:

```python
def inspect_schemas(registry):
    schemas = registry.get_openai_schemas()
    print(json.dumps(schemas, indent=2))
```

Run it and see exactly what the LLM receives.

### Exercise 4: Tool with Validation

Create a tool that validates its inputs before running:

```python
class PasswordCheckerTool(Tool):
    """Check if a password meets security requirements."""
    
    def run(self, password: str) -> str:
        errors = []
        if len(password) < 8:
            errors.append("At least 8 characters")
        if not any(c.isupper() for c in password):
            errors.append("At least one uppercase letter")
        if not any(c.isdigit() for c in password):
            errors.append("At least one number")
        
        if errors:
            return f"Password is weak. Missing: {', '.join(errors)}"
        return "Password is strong!"
```

### Challenge: Build a "Super Tool" that Composes Other Tools

Build a `SuperCalculatorTool` that can:
- Parse complex multi-step math problems
- Break them into smaller calculations
- Use the `CalculatorTool` (or its logic) for each step
- Return the final result

For example: "Calculate (15 + 3) * 2 / 4" should work as a single call.

---

## 📝 Summary

### Key Concepts

| Concept | What It Means |
|---|---|
| **Tool Base Class** | An abstract class that defines the tool interface |
| **Schema** | A JSON description of the tool's parameters |
| **Registry** | A central place to register and look up tools |
| **Dispatch** | Running the right tool by name with given arguments |
| **Error Handling** | Tools never crash; they return error strings |
| **Auto-schema** | The `to_openai_schema()` method generates the API format |

### The Tool System Architecture

```
                    ┌──────────────────────┐
                    │     Agent Loop       │
                    │  (decides, iterates) │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │    ToolRegistry      │
                    │                      │
                    │  get_openai_schemas()│──→ To LLM
                    │  run_tool(name, args)│←── From LLM
                    └──────────┬───────────┘
                               │
             ┌─────────────────┼─────────────────┐
             ▼                 ▼                 ▼
     ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
     │CalculatorTool│   │ FileReadTool│   │WebSearchTool│
     └─────────────┘   └─────────────┘   └─────────────┘
```

### The Code You Own

```python
from abc import ABC, abstractmethod
from typing import Dict, Any, List, Optional

class Tool(ABC):
    @property
    @abstractmethod
    def name(self) -> str: ...
    
    @property
    @abstractmethod
    def description(self) -> str: ...
    
    @property
    @abstractmethod
    def parameters(self) -> Dict[str, Any]: ...
    
    @abstractmethod
    def run(self, **kwargs) -> str: ...
    
    def to_openai_schema(self) -> Dict[str, Any]:
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.parameters,
            },
        }

class ToolRegistry:
    def __init__(self):
        self._tools = {}
    
    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool
    
    def get_openai_schemas(self) -> List[Dict[str, Any]]:
        return [t.to_openai_schema() for t in self._tools.values()]
    
    def run_tool(self, name: str, args: Dict[str, Any]) -> str:
        tool = self._tools.get(name)
        if not tool:
            return f"Unknown tool: {name}"
        try:
            return tool.run(**args)
        except Exception as e:
            return f"Error: {e}"
```

### The Key Insight

> **A good tool system is invisible. The LLM doesn't know or care how tools are implemented. It just sees clean names, clear descriptions, and gets reliable results. Your job is to make the tools reliable, well-described, and error-resistant.**

### Behind the Code: How claude-code Defines Tools

The class-based pattern above is great for learning. But for reference, here's how the **real claude-code** ([sourcemap](https://github.com/ChinaSiro/claude-code-sourcemap)) defines its tools — it uses a functional composition pattern with type safety:

**Source: [`restored-src/src/Tool.ts`](https://github.com/ChinaSiro/claude-code-sourcemap/blob/main/restored-src/src/Tool.ts)**

In claude-code, a tool is a plain object created by `buildTool(ToolDef)`:

```python
# Python translation of claude-code's tool pattern
# Original: restored-src/src/Tool.ts

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional, Protocol

# ─── Schema Validation (like Zod in the real code) ───

class Schema:
    """Simplified schema validator, inspired by Zod schemas used in claude-code."""
    def __init__(self, schema_dict: dict):
        self.schema = schema_dict
        self._validators = []

    def validate(self, data: dict) -> tuple[bool, Optional[str]]:
        """Validate input data against the schema.
        Returns (is_valid, error_message)."""
        for key, props in self.schema.get("properties", {}).items():
            if key in props.get("required", []) and key not in data:
                return False, f"Missing required field: {key}"
            if key in data and props.get("type") == "string" \
               and not isinstance(data[key], str):
                return False, f"{key} must be a string"
        return True, None

    def to_json_schema(self) -> Dict[str, Any]:
        return self.schema


# ─── Tool Definition (buildTool pattern) ───

class Tool:
    """
    A tool object, built from a ToolDef.
    Mirrors claude-code's Tool<Input, Output, P> type.
    """
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
        """Execute the tool. Claude-code calls runTools() which invokes this."""
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


# ─── buildTool: creates a Tool from a definition ───

class ToolDef:
    """The definition used to build a tool (like ToolDef in claude-code's Tool.ts)."""
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
    Build a Tool from a ToolDef.
    In claude-code this fills in defaults and wraps call() with error handling.
    Source: restored-src/src/Tool.ts — function buildTool(ToolDef)
    """
    return Tool(
        name=tool_def.name,
        description=tool_def.description,
        input_schema=tool_def.input_schema,
        call_fn=tool_def.call,
        is_concurrency_safe=tool_def.is_concurrency_safe,
    )


# ─── Tool Registry (findToolByName pattern) ───

class ToolRegistry:
    """
    Registry that holds all tools.
    Mirrors how claude-code collects tools into a list and uses findToolByName().
    """
    def __init__(self):
        self._tools: Dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        self._tools[tool.name] = tool

    def register_many(self, tools: List[Tool]) -> None:
        for t in tools:
            self.register(t)

    def find_tool(self, name: str) -> Optional[Tool]:
        """
        Find a tool by name or alias.
        Mirrors findToolByName() in claude-code's Tool.ts.
        """
        tool = self._tools.get(name)
        if tool:
            return tool
        # Check aliases
        for t in self._tools.values():
            if name in t.aliases:
                return t
        return None

    def run_tool(self, name: str, args: Dict[str, Any]) -> str:
        tool = self.find_tool(name)
        if not tool:
            return f"Error: Unknown tool '{name}'"
        return tool.call(**args)

    def get_openai_schemas(self) -> List[Dict[str, Any]]:
        return [t.to_openai_schema() for t in self._tools.values()]

    def concurrency_safe_tools(self) -> List[Tool]:
        """
        Get tools that can run in parallel.
        Claude-code partitions tools into concurrent-safe and unsafe batches.
        See: restored-src/src/services/tools/StreamingToolExecutor.ts
        """
        return [t for t in self._tools.values() if t.is_concurrency_safe]


# ─── Example: Build a Calculator Tool ───

calc_schema = Schema({
    "type": "object",
    "properties": {
        "expression": {
            "type": "string",
            "description": "Math expression like '2 + 2'",
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
        return f"Error: {e}"

calculator = build_tool(ToolDef(
    name="calculate",
    description="Evaluate a mathematical expression",
    input_schema=calc_schema,
    call=calc_impl,
    is_concurrency_safe=True,
))

registry = ToolRegistry()
registry.register(calculator)
```

**Key differences from the class-based approach:**

| Class-based (this chapter) | Claude-code style (functional) |
|---|---|
| Each tool is a class instance | Each tool is built from a `ToolDef` via `buildTool()` |
| Schema defined via `@property` | Schema defined as a `Schema` object (Zod in TypeScript) |
| Error handling is inline | Validation happens before `call()` via `input_schema.validate()` |
| Manual dispatch | `findToolByName()` with alias support |
| No concurrency model | `isConcurrencySafe()` controls parallel execution |

In claude-code, tools also declare `isReadOnly`, `isDestructive`, `interruptBehavior`, and `canUseTool` for fine-grained permission control. The `StreamingToolExecutor` ([source](https://github.com/ChinaSiro/claude-code-sourcemap/blob/main/restored-src/src/services/tools/StreamingToolExecutor.ts)) partitions tools into concurrent-safe and unsafe batches, executing the safe ones in parallel and the unsafe ones sequentially.

### What's Next?

In **[Chapter 05: Prompt Engineering for Agents](./05-prompt-engineering.md)**, you'll learn how to craft system prompts that make your agent smarter. You'll see how the same tools can behave completely differently with different prompts, and how to dynamically inject context like time, user info, and available tools into your prompts.

---

*"A tool without a good description is like a button without a label. The LLM won't know when to press it."*
