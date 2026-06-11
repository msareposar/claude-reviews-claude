# 04. Tool System: Hands & Feet

> **In this chapter: You'll design a proper tool system inspired by real claude-code patterns — schema validation, functional tool definitions, alias-based lookup, and concurrency control. Your agent's "hands and feet" will be clean, extensible, and production-ready.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Build a **Schema** class for input validation (like claude-code's Zod)
- Define tools using **ToolDef + build_tool()** (like claude-code's `buildTool(ToolDef)`)
- Build production-ready tools: Calculator, FileRead, WebSearch
- Register and dispatch tools with **alias lookup** (like claude-code's `findToolByName()`)
- Control **concurrency** with `is_concurrency_safe`
- Understand the **tool lifecycle**: define → build → register → dispatch → validate → execute

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
| Camera app | Calculator tool |
| Maps app | Search tool |
| App Store | Tool registry |
| Standard app interface | `Tool` + `Schema` |
| App permissions | `is_concurrency_safe`, aliases |

### Why Not Keep Using Functions?

In Chapters 02 and 03, we wrote tools as plain functions:

```python
def calculate(expression: str) -> str:
    return str(eval(...))
```

This works, but it has problems as your agent grows:

| Problem | With Functions | With Tool System |
|---|---|---|
| Adding a new tool | Write a function + write a schema separately | Define schema once, `build_tool()` handles the rest |
| Error handling | Inconsistent (each function does it differently) | Standardized: validate before execute |
| Listing all tools | Manual list | Tools auto-register with schemas |
| Tool metadata | Scattered | All in one place: name, aliases, schema, concurrency |
| Testing | Manual | Consistent interface via `tool.call()` |

A **tool system** solves these problems by standardizing how tools are built, described, and called.

---

## 🔧 Hands-On: Build the Tool System

### Step 1: The Schema — Input Validation Foundation

Claude-code uses [Zod](https://zod.dev/) schemas to validate every tool input **before** execution. Let's build a simplified version:

```python
# schema.py

from typing import Any, Dict, List, Optional, Tuple


class Schema:
    """
    Validates tool inputs before execution.
    Like claude-code's Zod schemas (source: restored-src/src/Tool.ts).
    """
    def __init__(self, properties: Dict[str, dict], required: Optional[List[str]] = None):
        self.schema = {
            "type": "object",
            "properties": properties,
            "required": required or [],
        }

    def validate(self, data: dict) -> Tuple[bool, Optional[str]]:
        """
        Validate input data against the schema.
        Returns (is_valid, error_message).
        This mirrors how claude-code validates inputs in ValidationResult.
        """
        # Check required fields
        for key in self.schema["required"]:
            if key not in data:
                return False, f"Missing required field: '{key}'"

        # Check types
        for key, value in data.items():
            prop = self.schema["properties"].get(key)
            if prop:
                expected_type = prop.get("type")
                if expected_type == "string" and not isinstance(value, str):
                    return False, f"'{key}' must be a string, got {type(value).__name__}"
                if expected_type == "integer" and not isinstance(value, int):
                    return False, f"'{key}' must be an integer, got {type(value).__name__}"
                if expected_type == "number" and not isinstance(value, (int, float)):
                    return False, f"'{key}' must be a number, got {type(value).__name__}"
                # Check allowed values
                allowed = prop.get("enum")
                if allowed and value not in allowed:
                    return False, f"'{key}' must be one of {allowed}, got '{value}'"

        return True, None

    def to_json_schema(self) -> Dict[str, Any]:
        """Export to OpenAI-compatible JSON Schema format."""
        return self.schema
```

The `Schema` does two things:
1. **Validates** inputs before the tool runs — catch errors early
2. **Describes** the inputs to the LLM via `to_json_schema()`

### Step 2: The Tool Object — build_tool(ToolDef)

In claude-code, tools are **plain objects** built from a definition, not class instances. The pattern is:

```python
# Tool — the object the agent uses
# Like claude-code's Tool<Input, Output, P> type

import math
from typing import Callable, Optional


class Tool:
    """
    A tool object, built from a ToolDef.
    Like claude-code's Tool type (source: restored-src/src/Tool.ts).
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
        Execute the tool with validation.
        Claude-code always validates inputs via ValidationResult before calling.
        """
        # 1. Validate inputs (like claude-code's ValidationResult)
        is_valid, error = self.input_schema.validate(kwargs)
        if not is_valid:
            return f"ValidationError: {error}"

        # 2. Execute with error boundary
        try:
            return self._call(**kwargs)
        except Exception as e:
            return f"Error({type(e).__name__}): {e}"

    def to_openai_schema(self) -> Dict[str, Any]:
        """Convert to OpenAI function-calling format."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.input_schema.to_json_schema(),
            },
        }
```

Notice what the `Tool` class does NOT do:
- It does **not** require subclassing — you just pass a function
- It does **not** have abstract methods — tools are objects, not classes
- It handles **validation and errors** generically, so each tool function stays clean

The `ToolDef` + `build_tool()` pattern makes tool creation explicit:

```python
class ToolDef:
    """
    Definition used to build a Tool.
    Like claude-code's ToolDef in restored-src/src/Tool.ts.
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
    Build a Tool from a ToolDef.
    Like claude-code's function buildTool(ToolDef) in Tool.ts.
    This fills in defaults and wraps the call function with validation.
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

### Step 3: Implement Calculator

Now let's build our first tool using this pattern. The implementation function is separate from the tool definition:

```python
# 1. Define the schema
calc_schema = Schema(
    properties={
        "expression": {
            "type": "string",
            "description": "The math expression to evaluate, e.g. '2 + 2' or 'sqrt(144)'",
        },
    },
    required=["expression"],
)

# 2. Write the implementation function (clean, no boilerplate)
def calculate_impl(expression: str) -> str:
    """Evaluate a mathematical expression."""
    allowed = {
        "abs": abs, "round": round, "max": max, "min": min,
        "sum": sum, "pow": pow, "sqrt": math.sqrt,
        "sin": math.sin, "cos": math.cos, "tan": math.tan,
        "pi": math.pi, "e": math.e,
    }
    result = eval(expression, {"__builtins__": {}}, allowed)
    return str(result)

# 3. Build the tool from a ToolDef
calculator = build_tool(ToolDef(
    name="calculate",
    description=(
        "Evaluate a mathematical expression. "
        "Supports: +, -, *, /, sqrt(), pow(), sin(), cos(), tan(), "
        "pi, e, abs(), round(), min(), max()"
    ),
    input_schema=calc_schema,
    call=calculate_impl,
    is_concurrency_safe=True,  # ✅ Safe to run in parallel
))
```

The implementation function is **pure** — it takes inputs, returns a string, and doesn't worry about validation or error handling. The `Tool.call()` wrapper handles both.

### Step 4: Implement FileRead

```python
import os

file_read_schema = Schema(
    properties={
        "path": {
            "type": "string",
            "description": "The path to the file to read (absolute or relative)",
        },
        "encoding": {
            "type": "string",
            "description": "File encoding (default: utf-8)",
        },
    },
    required=["path"],
)

def read_file_impl(path: str, encoding: str = "utf-8") -> str:
    """Read a file and return its contents."""
    if not os.path.exists(path):
        raise FileNotFoundError(f"File not found: {path}")
    if not os.path.isfile(path):
        raise IsADirectoryError(f"Not a file: {path}")

    with open(path, 'r', encoding=encoding) as f:
        content = f.read()

    if len(content) == 0:
        return "File is empty."
    return f"File content ({len(content)} chars):\n{content}"

file_reader = build_tool(ToolDef(
    name="read_file",
    description="Read the contents of a file. Returns the file content or an error message.",
    input_schema=file_read_schema,
    call=read_file_impl,
    is_concurrency_safe=True,
    aliases=["read", "cat", "view"],  # LLMs may try different names
))
```

Notice the **aliases**. If the LLM calls `"read"` instead of `"read_file"`, we still find it. This is how claude-code's `findToolByName()` works — it checks the canonical name first, then aliases.

### Step 5: Implement WebSearch (Simulated)

```python
web_search_schema = Schema(
    properties={
        "query": {
            "type": "string",
            "description": "The search query",
        },
    },
    required=["query"],
)

def web_search_impl(query: str) -> str:
    """Simulated web search."""
    database = {
        "capital of france": "Paris is the capital of France.",
        "capital of japan": "Tokyo is the capital of Japan.",
        "population of japan": "Japan's population is approximately 125 million as of 2024.",
        "population of the world": "The world population is approximately 8 billion as of 2024.",
        "python programming": "Python is a high-level programming language created by Guido van Rossum in 1991.",
        "what is an ai agent": "An AI agent is a system that uses LLMs to reason, plan, and use tools.",
        "weather in tokyo": "Tokyo weather: 22°C, partly cloudy.",
        "weather in london": "London weather: 15°C, overcast.",
    }
    query_lower = query.lower().strip()
    
    for key, answer in database.items():
        if query_lower == key or query_lower in key:
            return answer
    
    # Fuzzy match
    matches = [v for k, v in database.items() 
               if any(word in k for word in query_lower.split())]
    if matches:
        return "\n".join(matches[:3])
    return f"No results found for '{query}'. Try a different search."

searcher = build_tool(ToolDef(
    name="search_web",
    description="Search the web for information. Use for facts, current events, and general knowledge.",
    input_schema=web_search_schema,
    call=web_search_impl,
    is_concurrency_safe=True,
    aliases=["search", "web", "google"],
))
```

### Step 6: The ToolRegistry — findToolByName

Now we need a place to keep all our tools. In claude-code, tools are collected in a list and found via `findToolByName()`. Let's build that:

```python
class ToolRegistry:
    """
    Registry that holds all tools and provides lookup by name or alias.
    Like claude-code's findToolByName() pattern (source: restored-src/src/Tool.ts).
    """
    def __init__(self):
        self._tools: Dict[str, Tool] = {}

    def register(self, tool: Tool) -> None:
        """Register a single tool by its canonical name."""
        self._tools[tool.name] = tool

    def register_many(self, tools: List[Tool]) -> None:
        """Register multiple tools at once."""
        for t in tools:
            self.register(t)

    def find_tool(self, name: str) -> Optional[Tool]:
        """
        Find a tool by canonical name or alias.
        Like claude-code's findToolByName() in Tool.ts.
        """
        # Try canonical name first
        tool = self._tools.get(name)
        if tool:
            return tool
        # Try aliases
        for t in self._tools.values():
            if name in t.aliases:
                return t
        return None

    def run_tool(self, name: str, args: Dict[str, Any]) -> str:
        """Find a tool by name/alias and execute it with given arguments."""
        tool = self.find_tool(name)
        if not tool:
            return f"Error: Unknown tool '{name}'"
        return tool.call(**args)

    def get_openai_schemas(self) -> List[Dict[str, Any]]:
        """Get all tool schemas in OpenAI function-calling format."""
        return [t.to_openai_schema() for t in self._tools.values()]

    def concurrency_safe_tools(self) -> List[Tool]:
        """
        Get tools that can run in parallel.
        Like claude-code's StreamingToolExecutor partitioning.
        """
        return [t for t in self._tools.values() if t.is_concurrency_safe]

    @property
    def count(self) -> int:
        return len(self._tools)
```

### Step 7: Putting It All Together

```python
# agent.py — Complete tool system

# Create the registry
registry = ToolRegistry()

# Register all tools
registry.register_many([
    calculator,
    file_reader,
    searcher,
])

# Verify
print(f"📦 Registered {registry.count} tools:")
for t in registry._tools.values():
    safe = "⚡" if t.is_concurrency_safe else "🔒"
    aliases = f" (aliases: {', '.join(t.aliases)})" if t.aliases else ""
    print(f"  {safe} {t.name}: {t.description}{aliases}")

# === Agent loop integration ===

def run_tool(name: str, args: dict) -> str:
    """Dispatch a tool call (like claude-code's runTools())."""
    result = registry.run_tool(name, args)
    return result

# Test calls
print("\n🧪 Testing tools:")
print(run_tool("calculate", {"expression": "2 + 2"}))           # "4"
print(run_tool("read", {"path": "tool_system.py"}))              # alias works!
print(run_tool("search", {"query": "capital of france"}))        # alias works!
print(run_tool("search_web", {"query": "unknown topic"}))        # fallback
```

---

### Summary: The Tool Lifecycle

```
   Define           Build           Register         Dispatch         Validate         Execute
  ┌────────┐    ┌──────────┐    ┌────────────┐    ┌───────────┐    ┌─────────┐    ┌──────────┐
  │ Schema │───→│ ToolDef  │───→│ ToolRegistry│←──│ agent loop│───→│ Schema  │───→│ call_fn  │
  │  impl  │    │build_tool│    │ find_tool  │    │ run_tool  │    │validate │    │ execute  │
  └────────┘    └──────────┘    └────────────┘    └───────────┘    └─────────┘    └──────────┘
```

1. **Define** — Write the Schema and implementation function
2. **Build** — Create a `ToolDef` and call `build_tool(ToolDef)`
3. **Register** — Add the tool to the `ToolRegistry`
4. **Dispatch** — The agent loop calls `registry.run_tool(name, args)`
5. **Validate** — `Tool.call()` validates inputs before execution
6. **Execute** — The implementation function runs with valid inputs

---

## 🔍 How It Works

### Schema Validation Catches Errors Early

In claude-code, validation happens **before** the tool runs — not inside it. This means:

- The tool function never sees bad inputs
- The LLM gets a clear "ValidationError" message telling it exactly what's wrong
- Each type of error (missing field, wrong type, invalid value) has a distinct message

```python
# What happens when validation fails:
result = calculator.call(expression=42)  # Not a string!
# → "ValidationError: 'expression' must be a string, got int"
```

### Why build_tool + ToolDef Instead of Subclassing?

Claude-code uses functional composition over class inheritance for tools because:

| Approach | Details |
|---|---|
| **Subclassing** (our old way) | Each tool = one class. Adding a tool means writing a new file. Schema is scattered across `@property` methods. |
| **Functional** (claude-code way) | Each tool = one function + one `ToolDef`. The `Tool` object is created once and reused. Schema lives in one place. |

The functional approach is:
- **Lighter** — no class hierarchy, no `super().__init__()` chains
- **Composable** — you can build tools from any function, including lambdas
- **Testable** — the implementation function is a plain function you can test directly

### Aliases: Why They Matter

Different LLMs (or the same LLM at different times) may try different names for the same tool. If the LLM says `"read"` but the tool is named `"read_file"`, without aliases the call fails. With aliases, `find_tool()` checks both.

This is exactly how claude-code's `findToolByName()` works — it's a simple but critical piece of reliability engineering.

### is_concurrency_safe: Parallel Execution

Claude-code's `StreamingToolExecutor` (source: `restored-src/src/services/tools/StreamingToolExecutor.ts`) partitions tools into two groups:

- **Concurrent-safe** (`is_concurrency_safe=True`): Can run in parallel (calculations, reads)
- **Not safe** (`is_concurrency_safe=False`): Must run one at a time (file writes, state changes)

Safe tools get batched together with `Promise.all()` for performance. This is why we keep the flag on each tool.

---

## 🧪 Exercises

### Exercise 1: Add Aliases

Add an alias to the calculator tool and verify it works:

```python
# Modify the calculator build to include aliases
calculator = build_tool(ToolDef(
    name="calculate",
    description="Evaluate a mathematical expression",
    input_schema=calc_schema,
    call=calculate_impl,
    is_concurrency_safe=True,
    aliases=["calc", "math", "eval"],
))

# Test alias lookup
print(registry.find_tool("calc"))       # Should find calculator
print(registry.find_tool("calculate"))  # Same tool
```

### Exercise 2: Register All Tools

Create a complete tool system with at least 3 tools and display their schemas:

```python
def list_tools(registry: ToolRegistry):
    """Print all registered tools in OpenAI format."""
    schemas = registry.get_openai_schemas()
    for s in schemas:
        name = s["function"]["name"]
        params = s["function"]["parameters"]["properties"]
        print(f"\n📌 {name}")
        for p_name, p_info in params.items():
            print(f"   - {p_name}: {p_info['description']}")

list_tools(registry)
```

### Exercise 3: Weather Tool (Real API)

Build a weather tool that uses the real `wttr.in` API:

```python
import urllib.request

weather_schema = Schema(
    properties={
        "city": {
            "type": "string",
            "description": "City name, e.g. 'Tokyo', 'London', 'New York'",
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
    description="Get the current weather for a city. Uses real weather data.",
    input_schema=weather_schema,
    call=get_weather_impl,
    is_concurrency_safe=True,
    aliases=["weather", "forecast"],
))

registry.register(weather_tool)

# Test: "What's the weather in Paris?" and "How's the weather in Tokyo and Seoul?"
```

### Exercise 4: Tool with Validation

Build a password checker that uses Schema validation:

```python
# The Schema validates the types; the implementation checks the rules
password_schema = Schema(
    properties={
        "password": {
            "type": "string",
            "description": "The password to check",
        },
    },
    required=["password"],
)

def check_password_impl(password: str) -> str:
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

password_checker = build_tool(ToolDef(
    name="check_password",
    description="Check if a password meets security requirements",
    input_schema=password_schema,
    call=check_password_impl,
    is_concurrency_safe=True,
))
```

### Challenge: Build a Composed Tool

Build a tool that calls other tools internally:

```python
# A "super calculator" that breaks complex problems into steps

def multi_step_calc_impl(expression: str) -> str:
    """Parse and evaluate multi-step math expressions."""
    # Simple step-by-step: split on operators and calculate each part
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
                return f"Error: Can't parse '{part}'"
    
    # Use the calculator tool internally for the actual calculation
    return f"Steps: {' '.join(steps)}\nResult: {calculator.call(expression=expression)}"

super_calc = build_tool(ToolDef(
    name="super_calculate",
    description="Evaluate complex multi-step math problems. Breaks them down step by step.",
    input_schema=calc_schema,  # Reuse the same schema
    call=multi_step_calc_impl,
    is_concurrency_safe=True,
))
```

---

## 📝 Summary

### Key Concepts

| Concept | What It Means | In claude-code |
|---|---|---|
| **Schema** | Validates inputs before execution | `Zod` schemas in `Tool.ts` |
| **build_tool(ToolDef)** | Builds a Tool from a definition | `buildTool(ToolDef)` in `Tool.ts` |
| **Tool** | A reusable function with metadata | `Tool<Input, Output, P>` type |
| **findToolByName** | Lookup by name or alias | `findToolByName()` in `Tool.ts` |
| **is_concurrency_safe** | Can this tool run in parallel? | `StreamingToolExecutor` partitioning |
| **ValidationResult** | Input validation before call | `ValidationResult<Input>` type |

### The Code You Own

```python
from typing import Any, Dict, List, Optional, Tuple, Callable

# ─── Schema (like claude-code's Zod) ───

class Schema:
    def __init__(self, properties: dict, required: list = None):
        self.schema = {"type": "object", "properties": properties, "required": required or []}
    def validate(self, data: dict) -> Tuple[bool, Optional[str]]:
        for key in self.schema["required"]:
            if key not in data:
                return False, f"Missing required field: '{key}'"
        for key, value in data.items():
            prop = self.schema["properties"].get(key)
            if prop:
                t = prop.get("type")
                if t == "string" and not isinstance(value, str):
                    return False, f"'{key}' must be a string"
                if t == "integer" and not isinstance(value, int):
                    return False, f"'{key}' must be an integer"
        return True, None
    def to_json_schema(self):
        return self.schema

# ─── Tool + build_tool (like claude-code's buildTool) ───

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

# ─── ToolRegistry + find_tool (like claude-code's findToolByName) ───

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
        if not tool: return f"Error: Unknown tool '{name}'"
        return tool.call(**args)
    def get_openai_schemas(self):
        return [t.to_openai_schema() for t in self._tools.values()]
    def concurrency_safe_tools(self):
        return [t for t in self._tools.values() if t.is_concurrency_safe]
```

### The Key Insight

> **A good tool system is invisible. The LLM doesn't know or care how tools are implemented. It just sees clean names, clear descriptions, and gets reliable results. Your job is to make the tools reliable, well-described, and error-resistant.**

### What's Next?

In **[Chapter 05: Prompt Engineering for Agents](./05-prompt-engineering.md)**, you'll learn how to craft system prompts that make your agent smarter. You'll see how the same tools can behave completely differently with different prompts, and how to dynamically inject context like time, user info, and available tools into your prompts.

---

*"A tool without a good description is like a button without a label. The LLM won't know when to press it."*
