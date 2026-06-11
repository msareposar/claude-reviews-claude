# 02. Build Your First Agent

> **In this chapter: You'll combine an LLM with a tool to build your first real AI agent. The agent can do math — and it knows when to use its calculator.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand what makes an agent different from a chatbot
- Define a tool using **Schema + build_tool** (like claude-code's `buildTool(ToolDef)`)
- Implement **function calling** (tool use) with an LLM
- Use **alias resolution** so the LLM can call tools by different names
- Have a working agent that can answer questions AND do math

---

## 📖 Explain Like I'm 10

### What Makes an Agent?

A **chatbot** talks. An **agent** acts.

> **Agent = LLM (brain) + Tools (hands)**

Think of it this way:

- **You** are an agent. You have a brain (to think) and hands (to do things).
- A **calculator** is just a tool. It can't think.
- An **LLM** alone is just a brain with no hands. It can talk but not do.
- An **agent** is the brain + hands connected.

```
Chatbot: User asks → LLM replies
Agent:   User asks → LLM thinks → LLM decides: 
                                ├─ "I can answer this" → replies directly
                                └─ "I need a tool" → calls tool → gets result → replies
```

### Why Is This Hard?

LLMs are great at **generating text**, but they cannot:

- Do precise math (try asking one: "What's 1234 × 5678?")
- Access the internet
- Read files
- Control anything in the real world

But LLMs are great at **deciding what to do**. So the idea is:

1. Give the LLM some **tools** (functions it can call)
2. Let the LLM **decide** if it needs a tool
3. The LLM tells us **which tool** to call and with **what arguments**
4. We run the tool and give the result back to the LLM
5. The LLM formulates the final answer

This is called **function calling** or **tool use**.

### The Calculator Example

```
User: "What is 15% of 200?"

LLM thinks: "I need to calculate 15% of 200. 
             I have a 'calculate' tool. Let me call it."
             
LLM outputs: {"tool": "calculate", "args": {"expression": "0.15 * 200"}}

We run: calculate("0.15 * 200") → 30.0

We send back: "The result is 30.0"

LLM replies: "15% of 200 is 30."
```

The LLM never does the math itself. It just orchestrates the tool.

---

## 🔧 Hands-On: Build a Calculator Agent

### Step 1: The Tool System Module

First, let's build the reusable tool system that we'll use in every chapter. It mirrors how claude-code defines tools — Schema for validation, `build_tool(ToolDef)` for creation, and `ToolRegistry` with alias lookup.

Create a file called `tool_system.py`:

```python
# tool_system.py — Reusable tool system (like claude-code's Tool.ts)
# Source pattern: restored-src/src/Tool.ts

from typing import Any, Dict, List, Optional, Tuple, Callable


class Schema:
    """
    Validates tool inputs before execution.
    Like claude-code's Zod schemas (source: restored-src/src/Tool.ts).
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
                return False, f"Missing required field: '{key}'"
        for key, value in data.items():
            prop = self.schema["properties"].get(key)
            if prop:
                t = prop.get("type")
                if t == "string" and not isinstance(value, str):
                    return False, f"'{key}' must be a string"
        return True, None
    def to_json_schema(self):
        return self.schema


class Tool:
    """
    A tool object built from a ToolDef.
    Like claude-code's Tool<Input, Output, P> type.
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
    """
    Definition used to build a Tool.
    Like claude-code's ToolDef in restored-src/src/Tool.ts.
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
    Build a Tool from a ToolDef.
    Like claude-code's buildTool(ToolDef) in Tool.ts.
    """
    return Tool(tool_def.name, tool_def.description, tool_def.input_schema,
                tool_def.call, tool_def.is_concurrency_safe, tool_def.aliases)


class ToolRegistry:
    """
    Registry with alias lookup.
    Like claude-code's findToolByName() pattern.
    """
    def __init__(self):
        self._tools = {}
    def register(self, tool: Tool):
        self._tools[tool.name] = tool
    def register_many(self, tools: list):
        for t in tools: self.register(t)
    def find_tool(self, name: str) -> Optional[Tool]:
        """Find by canonical name or alias."""
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
```

You'll save this file and import it into every agent you build. We'll keep adding to it in later chapters.

### Step 2: Define the Calculator Tool

Now let's use our tool system to define a calculator. We create a **Schema** for the input, write an **implementation function**, and call **build_tool(ToolDef)** — the same pattern claude-code uses.

Create `first_agent.py`:

```python
import math
import json
import os
from openai import OpenAI
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ─── 1. Define the input schema ──────────────────────

calc_schema = Schema(
    properties={
        "expression": {
            "type": "string",
            "description": "The math expression to evaluate, e.g. '2 + 2' or '15 * 3.5'",
        },
    },
    required=["expression"],
)

# ─── 2. Write the implementation function ────────────

def calculate_impl(expression: str) -> str:
    """
    Evaluate a mathematical expression safely.
    Only allows math operations — no file access, no system calls.
    """
    allowed_names = {
        "abs": abs, "round": round, "max": max, "min": min,
        "sum": sum, "pow": pow, "sqrt": math.sqrt,
        "sin": math.sin, "cos": math.cos, "tan": math.tan,
        "pi": math.pi, "e": math.e,
    }
    result = eval(expression, {"__builtins__": {}}, allowed_names)
    return str(result)

# ─── 3. Build the tool (like claude-code's buildTool) ───

calculator = build_tool(ToolDef(
    name="calculate",
    description=(
        "Evaluate a mathematical expression. "
        "Supports: +, -, *, /, sqrt(), pow(), sin(), cos(), tan(), "
        "pi, e, abs(), round(), min(), max()"
    ),
    input_schema=calc_schema,
    call=calculate_impl,
    is_concurrency_safe=True,
    aliases=["calc", "math"],  # The LLM can also call it by these names
))

# ─── 4. Register with the registry ──────────────────

registry = ToolRegistry()
registry.register(calculator)

# Get the OpenAI-compatible schema for the API
tools_schema = registry.get_openai_schemas()
```

### Step 3: The Agent Loop

Now, let's write the agent loop. The agent:

1. Takes a user's question
2. Sends it to the LLM with the tool definitions
3. If the LLM calls a tool → run the tool via `registry.run_tool()`, send result back
4. If the LLM replies directly → show the answer

```python
def run_agent(user_input: str) -> str:
    """
    Run the agent with a user input.
    Uses ToolRegistry to dispatch tool calls by name.
    """
    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful assistant with access to a calculator tool. "
                "When you need to calculate something, use the calculate tool. "
                "Otherwise, answer directly."
            ),
        },
        {"role": "user", "content": user_input},
    ]

    # First call to the LLM
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        tools=tools_schema,
        tool_choice="auto",
    )

    message = response.choices[0].message

    # Check if the LLM wants to call a tool
    if message.tool_calls:
        tool_call = message.tool_calls[0]
        tool_name = tool_call.function.name
        tool_args = json.loads(tool_call.function.arguments)

        print(f"🔧 LLM called tool: {tool_name}({tool_args})")

        # Run the tool via registry (with alias lookup!)
        result = registry.run_tool(tool_name, tool_args)

        # Tell the LLM the result
        messages.append(message)
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": result,
        })

        # Get the final answer from the LLM
        final_response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=tools_schema,
        )

        return final_response.choices[0].message.content

    else:
        # The LLM answered directly
        return message.content


# ─── TRY IT ──────────────────────────────────────────

if __name__ == "__main__":
    questions = [
        "What's 2 + 2?",
        "If I have 15 apples and give away 7, how many do I have?",
        "What's the square root of 144?",
        "What's the capital of France?",
        "Calculate 15% of 200, then add 10.",
    ]

    for q in questions:
        print(f"\n❓ You: {q}")
        answer = run_agent(q)
        print(f"🤖 Agent: {answer}")
```

### Step 4: Run It

```bash
python first_agent.py
```

Expected output:

```
❓ You: What's 2 + 2?
🔧 LLM called tool: calculate({'expression': '2 + 2'})
🤖 Agent: 2 + 2 equals 4.

❓ You: If I have 15 apples and give away 7, how many do I have?
🔧 LLM called tool: calculate({'expression': '15 - 7'})
🤖 Agent: You would have 8 apples left.

❓ You: What's the square root of 144?
🔧 LLM called tool: calculate({'expression': 'sqrt(144)'})
🤖 Agent: The square root of 144 is 12.

❓ You: What's the capital of France?
🤖 Agent: The capital of France is Paris.

❓ You: Calculate 15% of 200, then add 10.
🔧 LLM called tool: calculate({'expression': '15 / 100 * 200 + 10'})
🤖 Agent: 15% of 200 is 30, plus 10 makes 40.
```

**Observe what happened:**

- For "capital of France" → the LLM answered **directly** (no tool call)
- For math questions → the LLM **called the calculator tool**
- The LLM decided by itself when to use the tool!

---

## 🔍 How It Works

### The Function Calling Mechanism

Here's what happens inside OpenAI's API when you send tools:

```
Your request:
  messages: [...]
  tools: [{name: "calculate", parameters: {...}}]

OpenAI processes:
  "Hmm, the user asked a math question.
   I see a 'calculate' tool available.
   I should call it with expression='15 * 3.5'."

OpenAI responds:
  {
    content: null,  ← No text reply!
    tool_calls: [{   ← Instead, a tool call request
      id: "call_abc123",
      function: {
        name: "calculate",
        arguments: '{"expression": "15 * 3.5"}'
      }
    }]
  }
```

When the LLM decides to use a tool:
- `content` is **empty** (null)
- `tool_calls` has the details of which tool to call and with what args

When the LLM decides to answer directly:
- `content` has the text reply
- `tool_calls` is **empty**

### The Agent Decision Flow

```
                    User: "What's 15 * 3.5?"
                              │
                              ▼
                    ┌─────────────────────┐
                    │   LLM with tools    │
                    │                     │
                    │  "I should use the  │
                    │   calculate tool."  │
                    └─────────┬───────────┘
                              │
                    ┌─────────▼───────────┐
                    │ tool_calls present? │
                    └─────────┬───────────┘
                    YES       │       NO
                 ┌────────────┴──────────────┐
                 ▼                           ▼
         ┌─────────────────┐       ┌──────────────────┐
         │ Run the tool    │       │ Reply directly   │
         │ get result      │       │ with text        │
         └────────┬────────┘       └──────────────────┘
                  │
         ┌────────▼────────┐
         │ Send result     │
         │ back to LLM     │
         │ for final reply │
         └────────┬────────┘
                  │
         ┌────────▼────────┐
         │ LLM crafts      │
         │ final answer    │
         └─────────────────┘
```

### How build_tool + ToolDef Works

Instead of writing tool schemas as raw dictionaries, claude-code uses a **definition → build** pattern:

1. **ToolDef**: A simple bundle of tool metadata (name, description, schema, implementation, flags)
2. **build_tool(ToolDef)**: Creates a Tool object with validation and error handling built in
3. **ToolRegistry**: Holds all tools and resolves names via `find_tool()`

This separation means:
- The implementation function is a plain, testable function
- The schema stays with the tool definition
- Error handling and validation are automatic
- Name resolution supports aliases

### Why Aliases Matter

Different LLMs (or the same LLM at different times) might try different names for the same conceptual tool. One might say `"calc"` while another says `"calculate"`. Without aliases, the call would fail. With aliases, `find_tool()` checks both the canonical name and the alias list.

In claude-code, the Bash tool has aliases like `"shell"`, `"terminal"`, `"command"` — so even if the LLM doesn't guess the exact name, the tool is still found.

### The Schema: Validation Before Execution

The `Schema` class does more than describe inputs to the LLM. It also **validates** inputs before the tool runs. When you call `tool.call(expression=42)`, the Schema catches that `42` is not a string and returns a clear `ValidationError` instead of a cryptic crash.

This is the same pattern claude-code uses: validate first, then execute. It means the tool implementation is always called with valid inputs.

### Why Function Calling Changes Everything

Before function calling, if you wanted an LLM to do math, you had to:

1. Ask the LLM to output `[CALC: 15 * 3.5]` in its text
2. Parse the text with a regex
3. Run the calculator
4. Inject the result back into the conversation

This was **fragile** and **error-prone**. The LLM might format it differently each time.

With **native function calling**, the API handles the structure for you. The LLM outputs **structured JSON** that you can trust.

### What About Multiple Tool Calls?

An LLM can call **multiple tools** in one response. Each `tool_calls[i]` is a separate request. We'll explore this in Chapter 03.

### The System Prompt Matters

Notice our system prompt:

> "You are a helpful assistant with access to a calculator tool. When you need to calculate something, use the calculate tool. Otherwise, answer directly."

This tells the LLM:
1. ✅ You have a tool for math
2. ✅ Use it when needed
3. ✅ It's okay to answer without tools too

Without this hint, the LLM might try to do math in its head (and get it wrong) or call the tool for everything (even non-math questions).

---

## 🧪 Exercises

### Exercise 1: Add a "Weather Tool"

Create a weather tool using the same `build_tool(ToolDef)` pattern:

```python
weather_schema = Schema(
    properties={
        "city": {
            "type": "string",
            "description": "City name, e.g. 'Tokyo', 'London'",
        },
    },
    required=["city"],
)

def get_weather_impl(city: str) -> str:
    """Fake weather data."""
    weather_data = {
        "Tokyo": "22°C, sunny",
        "London": "15°C, cloudy",
        "New York": "18°C, light rain",
        "Sydney": "26°C, clear",
    }
    return weather_data.get(city, f"20°C, unknown (no data for {city})")

weather_tool = build_tool(ToolDef(
    name="get_weather",
    description="Get the current weather for a city.",
    input_schema=weather_schema,
    call=get_weather_impl,
    is_concurrency_safe=True,
    aliases=["weather", "forecast"],
))

registry.register(weather_tool)
```

**Steps:**
1. Add the code above to `first_agent.py`
2. Run `python first_agent.py` again
3. Test with: "What's the weather in Tokyo?" and "What's 5 + 3 and weather in London?"

### Exercise 2: Add a "Web Search" Tool

Add a search tool using the same pattern:

```python
search_schema = Schema(
    properties={
        "query": {"type": "string", "description": "The search query"},
    },
    required=["query"],
)

def search_impl(query: str) -> str:
    fake_results = {
        "python programming": "Python is a high-level, interpreted programming language...",
        "AI agents": "AI agents are autonomous systems that perceive and act...",
        "capital of Japan": "Tokyo is the capital of Japan.",
    }
    for key, value in fake_results.items():
        if key in query.lower():
            return value
    return f"Search results for '{query}': (simulated) No results found."

searcher = build_tool(ToolDef(
    name="search_web",
    description="Search the web for information.",
    input_schema=search_schema,
    call=search_impl,
    is_concurrency_safe=True,
    aliases=["search", "web"],
))
```

Make sure the agent uses `search_web` for knowledge questions and `calculate` for math questions.

### Exercise 3: Debug the Decision

Add print statements to see exactly what the LLM is thinking:

```python
print(f"🤔 LLM response: content={message.content!r}")
if message.tool_calls:
    for tc in message.tool_calls:
        print(f"🔧 Tool call: {tc.function.name}({tc.function.arguments})")
```

Run the same question twice at temperature 0.0. Does the LLM always make the same decision?

### Exercise 4: Force Tool Use

Change `tool_choice` from `"auto"` to `"required"`:

```python
response = client.chat.completions.create(
    ...
    tool_choice="required",  # LLM MUST use a tool
)
```

Now ask: "How are you today?" The LLM is **forced** to call a tool even though it doesn't need one. What happens?

### Challenge: Build a "Study Buddy" Agent

Create an agent with **three** tools:
1. `calculate` — for math
2. `define_word` — returns a fake dictionary definition
3. `translate` — returns a fake translation to Spanish

Use `build_tool(ToolDef)` for each. Test with:
- "What's the square root of 256?"
- "Define 'algorithm'"
- "Translate 'hello' to Spanish"
- "What's 25 * 4 and translate 'goodbye' to Spanish?"

---

## 📝 Summary

### Key Concepts

| Concept | What It Means | In claude-code |
|---|---|---|
| **Schema** | Validates and describes tool inputs | `Zod` schemas in `Tool.ts` |
| **ToolDef + build_tool** | Creates a Tool from a definition | `buildTool(ToolDef)` in `Tool.ts` |
| **ToolRegistry** | Holds tools with alias lookup | `findToolByName()` in `Tool.ts` |
| **Function calling** | The LLM outputs a structured request to use a tool | OpenAI/Anthropic API |
| **Is_concurrency_safe** | Can this tool run in parallel? | `StreamingToolExecutor` |
| **Aliases** | Alternative names for the same tool | `aliases` field in `Tool.ts` |

### The Code You Own

```python
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

# 1. Define schema
calc_schema = Schema(
    properties={"expression": {"type": "string", "description": "..."}},
    required=["expression"],
)

# 2. Write implementation
def calc_impl(expression: str) -> str:
    return str(eval(expression, {"__builtins__": {}}, {"sqrt": sqrt}))

# 3. Build tool (like claude-code's buildTool)
calculator = build_tool(ToolDef(
    name="calculate", description="Do math",
    input_schema=calc_schema, call=calc_impl,
    is_concurrency_safe=True, aliases=["calc"],
))

# 4. Register
registry = ToolRegistry()
registry.register(calculator)

# Agent: LLM decides → we dispatch → LLM answers
def run_agent(user_input):
    messages = [
        {"role": "system", "content": "Use tools when needed."},
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

### The Key Insight

> **An LLM cannot do precise math, but it knows when math is needed. Your job is to give it the tools and trust it to decide when to use them.**

This pattern — LLM decides, we execute — is the foundation of every AI agent, from simple scripts to production systems used by millions.

### What's Next?

In **[Chapter 03: Think → Act → Observe Loop](./03-core-loop.md)**, you'll move beyond a single tool call. You'll build a loop that can handle **multiple steps** — think, act, observe, repeat — until a complex task is done.

---

*"An agent is not a mind-reader. It's a tool-user that thinks."*
