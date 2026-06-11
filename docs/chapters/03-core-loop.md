# 03. Think → Act → Observe Loop

> **In this chapter: You'll build the core loop that powers every agent — Think, Act, Observe. Your agent will handle multi-step tasks and decide when it's done.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand the **Think → Act → Observe** loop that drives all agents
- Build a `while` loop that keeps running until the agent decides to stop
- Define tools with **ToolDef + build_tool** and dispatch via **ToolRegistry**
- Use a **StreamingToolExecutor** with concurrent-safe partitioning
- Handle **multi-step tasks** like "search, calculate, and summarize"
- Track **token budgets** and trigger compaction when nearing limits

---

## 📖 Explain Like I'm 10

### The Three-Step Dance

Imagine you're baking a cake. You don't just do it in one step. You:

1. **Think**: "I need to check if I have flour."
2. **Act**: You look in the cupboard.
3. **Observe**: "I see flour. Now I need eggs."
4. **Think**: "I have flour. Next step is to get eggs."
5. **Act**: You check the fridge.
6. **Observe**: "I have eggs. Now I need to preheat the oven."
7. **Think**: "Ready to start baking."
8. **Act**: You start mixing ingredients.
9. **Observe**: "The batter looks good."
10. ... and so on, until the cake is done.

This is exactly how an AI agent works!

```
Think    → "What should I do next?"
Act      → Call a tool or respond
Observe  → "What did the tool tell me?"
Repeat until the task is complete.
```

### The Loop, Simplified

```python
while task_is_not_done:
    think()      # LLM decides what to do
    act()        # We run a tool or get the final answer
    observe()    # We process what happened
```

In Chapter 02, our agent only did **one** cycle. The LLM either called a tool or answered. But what if the task needs **multiple steps**?

```
User: "What's 15% of 200, and then add 10% of that result?"

Step 1: LLM calculates 15% of 200 → 30
Step 2: LLM calculates 10% of 30 → 3
Step 3: LLM adds 30 + 3 → 33
Step 4: LLM says "The answer is 33"
```

Each step is one iteration of the loop. The agent keeps going until it decides it's done.

---

## 🔧 Hands-On: Build the Core Loop

### Step 0: The Tool System Module

First, let's create the tool system module that we'll use in every chapter. This uses the same patterns as claude-code — Schema for validation, ToolDef + build_tool for tool creation, and ToolRegistry with alias lookup.

Create `tool_system.py`:

```python
# tool_system.py — Reusable tool system (like claude-code's Tool.ts)
# Source pattern: restored-src/src/Tool.ts

from typing import Any, Dict, List, Optional, Tuple, Callable


class Schema:
    """Validates tool inputs. Like claude-code's Zod schemas."""
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
    """A tool object built from a ToolDef. Like claude-code's Tool type."""
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
    """Definition used to build a Tool. Like claude-code's ToolDef."""
    def __init__(self, name, description, input_schema, call,
                 is_concurrency_safe=True, aliases=None):
        self.name = name
        self.description = description
        self.input_schema = input_schema
        self.call = call
        self.is_concurrency_safe = is_concurrency_safe
        self.aliases = aliases or []


def build_tool(tool_def: ToolDef) -> Tool:
    """Build a Tool from a ToolDef. Like claude-code's buildTool()."""
    return Tool(tool_def.name, tool_def.description, tool_def.input_schema,
                tool_def.call, tool_def.is_concurrency_safe, tool_def.aliases)


class ToolRegistry:
    """Registry with alias lookup. Like claude-code's findToolByName()."""
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

### Step 1: Define Tools with Schema + build_tool

Now let's use the tool system to define our agent's tools. Each tool has a Schema, an implementation function, and gets built via `build_tool(ToolDef)`. This mirrors how claude-code defines tools in `Tool.ts`.

Create `core_loop.py`:

```python
import math
import json
import os
from openai import OpenAI
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ─── DEFINE TOOLS (like claude-code's buildTool(ToolDef)) ────

calc_schema = Schema(
    properties={
        "expression": {
            "type": "string",
            "description": "The math expression to evaluate, e.g. '2 + 2'",
        },
    },
    required=["expression"],
)

def calculate_impl(expression: str) -> str:
    """Evaluate a mathematical expression."""
    allowed = {
        "abs": abs, "round": round, "sqrt": math.sqrt,
        "sin": math.sin, "cos": math.cos, "pi": math.pi, "e": math.e,
    }
    return str(eval(expression, {"__builtins__": {}}, allowed))

search_schema = Schema(
    properties={
        "query": {"type": "string", "description": "The search query"},
    },
    required=["query"],
)

def search_impl(query: str) -> str:
    """Simulated web search."""
    fake_db = {
        "capital of france": "Paris is the capital of France.",
        "population of japan": "Japan's population is approximately 125 million (2024 estimate).",
        "weather tokyo": "Tokyo weather: 22°C, sunny.",
        "python language": "Python is a high-level, interpreted programming language created by Guido van Rossum in 1991.",
        "ai agent": "An AI agent is a system that uses an LLM to reason and call tools to accomplish tasks.",
    }
    for key, value in fake_db.items():
        if key in query.lower():
            return value
    return f"Search results for '{query}': No specific data found."

time_schema = Schema(properties={})

def time_impl() -> str:
    from datetime import datetime
    return f"Current time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

# ─── BUILD TOOLS (like claude-code's buildTool) ─────────────

calculator = build_tool(ToolDef(
    name="calculate",
    description="Evaluate a mathematical expression. Use +, -, *, /, sqrt(), pow(), sin(), cos(), pi, e, etc.",
    input_schema=calc_schema,
    call=calculate_impl,
    is_concurrency_safe=True,
    aliases=["calc", "math"],
))

searcher = build_tool(ToolDef(
    name="search_web",
    description="Search the web for information. Use for facts, definitions, and knowledge questions.",
    input_schema=search_schema,
    call=search_impl,
    is_concurrency_safe=True,
    aliases=["search", "web"],
))

clock = build_tool(ToolDef(
    name="get_time",
    description="Get the current date and time.",
    input_schema=time_schema,
    call=time_impl,
    is_concurrency_safe=True,
))

# ─── REGISTRY ───────────────────────────────────────────────

registry = ToolRegistry()
registry.register_many([calculator, searcher, clock])

# OpenAI-compatible schemas for the LLM
tools_schema = registry.get_openai_schemas()
```

### Step 2: The StreamingToolExecutor

In claude-code, the `StreamingToolExecutor` partitions tools by concurrency safety and streams results back. Let's build our version:

```python
# ─── STREAMING TOOL EXECUTOR (like claude-code's StreamingToolExecutor.ts) ──

class ToolResult:
    """A single tool execution result, ready to be streamed back."""
    def __init__(self, tool_name: str, output: str, success: bool = True):
        self.tool_name = tool_name
        self.output = output
        self.success = success

class StreamingToolExecutor:
    """
    Executes tools with concurrency support.
    
    Like claude-code's StreamingToolExecutor (source:
    restored-src/src/services/tools/StreamingToolExecutor.ts).
    Partitions tools into concurrent-safe and sequential batches.
    """
    def __init__(self, registry: ToolRegistry):
        self.registry = registry

    def partition_tools(self, tool_calls: list) -> tuple:
        """
        Partition tool calls into concurrent-safe and sequential groups.
        Safe tools can run in parallel; unsafe tools run one at a time.
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
        Execute all tool calls with partitioning.
        Safe batch runs in parallel (simulated here); unsafe runs sequentially.
        """
        safe_calls, unsafe_calls = self.partition_tools(tool_calls)

        # Run concurrent-safe tools in parallel (simulated)
        safe_results = [self._run_one(c) for c in safe_calls]

        # Run unsafe tools one at a time
        unsafe_results = [self._run_one(c) for c in unsafe_calls]

        return safe_results + unsafe_results

    def _run_one(self, tc: dict) -> ToolResult:
        """Execute a single tool call."""
        output = self.registry.run_tool(tc["name"], tc.get("args", {}))
        return ToolResult(tc["name"], output)

executor = StreamingToolExecutor(registry)
```

### Step 3: Context Manager with Token Budget

Claude-code tracks context window usage and triggers **auto-compaction** when nearing the limit. Let's add a simple version:

```python
# ─── CONTEXT MANAGER (like claude-code's auto-compaction) ────

class ContextManager:
    """
    Tracks token usage and triggers compaction when needed.
    
    Like claude-code's compact service (source:
    restored-src/src/services/compact/compact.ts).
    """
    def __init__(self, max_tokens: int = 128000):
        self.max_tokens = max_tokens
        self.compaction_threshold = int(max_tokens * 0.75)

    def check_budget(self, current_tokens: int) -> dict:
        """
        Check token budget and return status.
        
        Returns:
            {"ok": True} — still within budget
            {"ok": False, "action": "compact"} — nearing limit, should compact
        """
        remaining = self.max_tokens - current_tokens
        if current_tokens > self.compaction_threshold:
            return {"ok": False, "action": "compact",
                    "message": f"Context at {current_tokens}/{self.max_tokens} tokens. Compacting..."}
        return {"ok": True, "remaining": remaining}

    def compact(self, messages: list) -> list:
        """
        Compact messages by summarizing older turns.
        Keeps system prompt + most recent exchanges verbatim.
        """
        system_msgs = [m for m in messages if m["role"] == "system"]
        # Keep last 2 exchanges (4 messages) verbatim
        recent = messages[-4:] if len(messages) > 4 else messages
        old = messages[len(system_msgs):-4] if len(messages) > 4 else []

        if not old:
            return messages

        summary = f"[Context compacted: {len(old)} older messages summarized]"
        return system_msgs + [
            {"role": "system", "content": summary}
        ] + recent

ctx = ContextManager(max_tokens=128000)
```

### Step 4: The Core Loop

Now let's build the **Think → Act → Observe** loop using our tool system. This mirrors how claude-code's `query.ts` orchestrates the agent:

```python
# ─── THE CORE LOOP ────────────────────────────────────

def run_agent(user_input: str, max_steps: int = 10) -> str:
    """
    Run the agent with Think → Act → Observe loop.
    Uses ToolRegistry, StreamingToolExecutor, and ContextManager.
    """
    messages = [
        {
            "role": "system",
            "content": (
                "You are a helpful agent that solves tasks step by step.\n"
                "You have access to tools. Follow this process:\n"
                "1. Think about what you need to do\n"
                "2. Use a tool if needed\n"
                "3. Observe the result\n"
                "4. Continue until the task is complete\n"
                "When you have all the information needed, respond directly.\n"
                "IMPORTANT: Always check tool results before deciding you're done."
            ),
        },
        {"role": "user", "content": user_input},
    ]

    step = 0
    total_tokens = 0

    while step < max_steps:
        step += 1
        print(f"\n{'='*50}")
        print(f"🔄 Step {step}: Thinking...")

        # ─── THINK ────────────────────────────────────
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=tools_schema,
        )

        # Track token usage
        if hasattr(response, 'usage') and response.usage:
            total_tokens += response.usage.total_tokens
            print(f"📊 Total tokens used so far: {total_tokens}")

        message = response.choices[0].message

        # ─── CHECK BUDGET ─────────────────────────────
        budget = ctx.check_budget(total_tokens)
        if not budget["ok"]:
            print(f"⚠️ {budget['message']}")
            messages = ctx.compact(messages)

        # ─── CHECK IF DONE ────────────────────────────
        if not message.tool_calls:
            print(f"✅ Agent decided it's done.")
            print(f"💬 Final response: {message.content}")
            return message.content

        # ─── ACT ──────────────────────────────────────
        messages.append(message)

        # Convert OpenAI tool calls to our format
        tool_calls = []
        for tc in message.tool_calls:
            tool_calls.append({
                "name": tc.function.name,
                "args": json.loads(tc.function.arguments),
            })
            print(f"🔧 Act: Calling {tc.function.name}({tc.function.arguments})")

        # Execute via StreamingToolExecutor (with partitioning)
        results = executor.execute(tool_calls)

        # ─── OBSERVE ──────────────────────────────────
        for i, (tc, result) in enumerate(zip(message.tool_calls, results)):
            print(f"👀 Observe: {result.output[:80]}...")
            messages.append({
                "role": "tool",
                "tool_call_id": tc.id,
                "content": result.output,
            })

    # If we hit max_steps, force a final answer
    print(f"⚠️ Hit max steps ({max_steps}). Forcing final answer.")
    messages.append({
        "role": "system",
        "content": "You have reached the maximum number of steps. "
                   "Please provide your best answer now based on what you've done so far."
    })

    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
    )
    return response.choices[0].message.content


# ─── TRY IT ───────────────────────────────────────────

if __name__ == "__main__":
    test_tasks = [
        "What's 25 * 4?",
        "What is the capital of France and what is 15% of 200?",
        "Search the web for the population of Japan, then calculate what 10% of that is.",
        "What's the weather in Tokyo? Also, what time is it?",
    ]

    for task in test_tasks:
        print(f"\n\n{'#'*60}")
        print(f"❓ USER: {task}")
        print(f"{'#'*60}")
        result = run_agent(task)
        print(f"\n📨 FINAL: {result}")
```

### Step 5: Run It

```bash
python core_loop.py
```

Watch the output carefully. You'll see the agent:

1. **Think** about the task
2. **Act** by calling a tool via the `StreamingToolExecutor`
3. **Observe** the result
4. **Repeat** if more work is needed

Example output for "Search the web for the population of Japan, then calculate what 10% of that is."

```
############################################################
❓ USER: Search the web for the population of Japan, then calculate what 10% of that is.
############################################################

==================================================
🔄 Step 1: Thinking...
📊 Total tokens used so far: 412
🔧 Act: Calling search_web({"query":"population of Japan"})
👀 Observe: Japan's population is approximately 125 million (2024 estimate)....

==================================================
🔄 Step 2: Thinking...
📊 Total tokens used so far: 678
🔧 Act: Calling calculate({"expression":"125000000 * 0.1"})
👀 Observe: 12500000.0....

==================================================
🔄 Step 3: Thinking...
📊 Total tokens used so far: 823
✅ Agent decided it's done.
💬 Final response: Japan's population is approximately 125 million, and 10% of that is 12.5 million.
```

**Three steps to complete a two-part task.** The agent:
1. Searched for the population
2. Calculated 10%
3. Answered

---

## 🔍 How It Works

### The Agent State Machine

The core loop is a simple state machine:

```
                    ┌──────────────┐
                    │   START      │
                    │ (user input) │
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
             ┌──────│   THINK      │──────┐
             │      │ (LLM decides)│      │
             │      └──────────────┘      │
             │                            │
             ▼                            ▼
     ┌──────────────┐           ┌────────────────┐
     │   ACT        │           │   RESPOND      │
     │ (call tool)  │           │ (answer user)  │
     └──────┬───────┘           └───────┬────────┘
             │                          │
             ▼                          ▼
     ┌──────────────┐           ┌────────────────┐
     │   OBSERVE    │           │     DONE       │
     │ (get result) │           │  (exit loop)   │
     └──────┬───────┘           └────────────────┘
             │
             └──→ BACK TO THINK ──┘
```

### How the Pieces Connect

Our agent uses three claude-code-inspired layers:

| Layer | Our Code | In claude-code |
|---|---|---|
| **Tool Definition** | `Schema` + `build_tool(ToolDef)` | `restored-src/src/Tool.ts` |
| **Tool Registry** | `ToolRegistry.find_tool()` with alias lookup | `findToolByName()` |
| **Execution** | `StreamingToolExecutor` with concurrency partitioning | `StreamingToolExecutor.ts` |
| **Context** | `ContextManager` with token budget + compaction | `compact.ts` |

### Why Three Separate Layers?

Each layer handles one concern:
- **Tool System**: How tools are defined and validated
- **Executor**: How tools are run (parallel vs sequential)
- **Context Manager**: How the conversation stays within limits

This separation mirrors claude-code's architecture. It makes each part testable and replaceable.

### Partitioning: Safe vs Unsafe Tools

When the LLM calls multiple tools in one step, our `StreamingToolExecutor` checks `is_concurrency_safe` on each tool:

- **`is_concurrency_safe=True`**: No side effects, can run in parallel (calculations, searches, reads)
- **`is_concurrency_safe=False`**: Has side effects, must run sequentially (file writes, state changes)

Safe tools all run at once (simulated with a loop; in claude-code they use `Promise.all()`). Unsafe tools run one at a time to avoid race conditions.

### Token Budget Tracking

As the agent loops, the conversation grows. Every tool call and result adds tokens. Our `ContextManager` tracks usage and warns when approaching the limit. In claude-code, this triggers auto-compaction — older exchanges get summarized to free up space.

### Understand the Think Phase

During the **Think** phase, the LLM sees:

1. The system message (instructions)
2. All previous conversation (user, assistant, tool results)
3. The tool definitions (from `registry.get_openai_schemas()`)

It then decides:

```
Option A: "I have enough info. Let me respond."
          → content = "The answer is...", tool_calls = None

Option B: "I need more info. Let me call a tool."
          → content = None, tool_calls = [{name: "calculate", args: {...}}]

Option C: "I need multiple things."
          → content = None, tool_calls = [{...}, {...}]  (multiple tools!)
```

### Multiple Tool Calls in One Step

The LLM can call **more than one tool** in a single response. For example, if you ask:

> "What's the weather in Tokyo and the capital of France?"

The LLM might reply with **two tool calls** at once:

```json
[
  {"name": "search_web", "arguments": {"query": "weather Tokyo"}},
  {"name": "search_web", "arguments": {"query": "capital of France"}}
]
```

Our `StreamingToolExecutor` handles this by partitioning and executing them efficiently.

### Handling Max Steps

What if the agent gets stuck in an infinite loop?

```
Agent: "I need to search." → searches
Agent: "Interesting. Let me search more." → searches again
Agent: "Let me verify by searching again." → searches forever...
```

That's why we have `max_steps`. It's a **safety limit**. If the agent exceeds it, we force a final answer.

In production, you'd also want:
- **Token limits**: Stop if the conversation gets too long
- **Time limits**: Stop if it's taking too long
- **Loop detection**: Detect if the same tool is called with the same args repeatedly

### The Observation Matters

When a tool returns a result, that result becomes part of the conversation. The LLM **reads** it and decides what to do next.

```
messages = [
    system: "You are a helpful agent...",
    user: "Search for Japan population and calculate 10%",
    assistant: (tool call: search_web),
    tool: "Japan's population is approximately 125 million...",
    # Now the LLM sees this result and knows the population
    assistant: (tool call: calculate, expression: 125000000 * 0.1),
    tool: "12500000.0",
    # Now the LLM has both pieces of info
    assistant: "The answer is 12.5 million.",
]
```

Each observation **changes the context** for the next Think phase.

---

## 🧪 Exercises

### Exercise 1: Add a File Writing Tool (with concurrency flag)

Add a tool that writes text to a file. Since writing is a side effect, it should **not** be concurrency-safe:

```python
write_schema = Schema(
    properties={
        "filename": {"type": "string", "description": "Name of the file"},
        "content": {"type": "string", "description": "Content to write"},
    },
    required=["filename", "content"],
)

def write_file_impl(filename: str, content: str) -> str:
    with open(filename, 'w') as f:
        f.write(content)
    return f"Successfully wrote {len(content)} characters to {filename}"

writer = build_tool(ToolDef(
    name="write_file",
    description="Write text content to a file.",
    input_schema=write_schema,
    call=write_file_impl,
    is_concurrency_safe=False,  # ⚠️ Side effects: must run sequentially
))

registry.register(writer)
```

**Test:** "Search for information about Python, then save a summary to python_info.txt"

### Exercise 2: Chain Three Tools

Create a task that requires **three** sequential tool calls:

- Search for a famous person's birth year
- Calculate how old they would be today
- Save the result to a file

Observe how the agent plans and executes all three steps.

### Exercise 3: Watch the Concurrency Partitioning

Add debug output to see how the executor partitions tool calls:

```python
# Add inside execute():
print(f"  ⚡ Safe batch: {[c['name'] for c in safe_calls]}")
print(f"  🔒 Sequential: {[c['name'] for c in unsafe_calls]}")
```

Test with a task that triggers multiple concurrent calls.

### Exercise 4: Test Alias Resolution

Use an alias instead of the canonical tool name. The registry should still find it:

```python
# "search" is an alias for "search_web"
response = registry.run_tool("search", {"query": "capital of france"})
print(response)  # Should work!
```

### Exercise 5: Track Token Usage per Step

Modify the loop to track prompt vs completion tokens:

```python
usage = response.usage
print(f"📊 Prompt: {usage.prompt_tokens} | "
      f"Completion: {usage.completion_tokens} | "
      f"Total: {usage.total_tokens}")
```

Run a multi-step task and see how the token costs add up.

### Challenge: Build a "Research Assistant"

Create an agent with these tools:
1. `search_web` — for facts
2. `calculate` — for math
3. `write_file` — to save results
4. `get_time` — for timestamps

Ask it: "Research the population of the 3 largest cities in Japan. For each city, calculate approximately what percentage of Japan's total population they represent. Save the results to japan_cities_report.txt with a timestamp."

This requires:
- Multiple searches (one per city)
- Multiple calculations
- A file write at the end

Watch the agent plan and execute this complex task!

---

## 📝 Summary

### Key Concepts

| Concept | What It Means | In claude-code |
|---|---|---|
| **Think** | The LLM looks at context and decides what to do | `query.ts` |
| **Act** | Call a tool with specific arguments | `runTools()` |
| **Observe** | Process the tool's result and add it to context | message append |
| **Loop** | Repeat Think → Act → Observe until done | main agent loop |
| **StreamingToolExecutor** | Partitions tools by concurrency safety | `StreamingToolExecutor.ts` |
| **ContextManager** | Tracks token budget, triggers compaction | `compact.ts` |
| **Max steps** | Safety limit to prevent infinite loops | `maxIterations` |

### The Core Loop Pattern

```python
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

# 1. Define tools with Schema + build_tool(ToolDef)
calc = build_tool(ToolDef(name="calculate", ..., call=calculate_impl))
registry = ToolRegistry()
registry.register_many([calc, ...])

# 2. Create executor and context manager
executor = StreamingToolExecutor(registry)
ctx = ContextManager(max_tokens=128000)

# 3. The loop
messages = [{"role": "system", "content": prompt}, {"role": "user", "content": input}]

while step < max_steps:
    # THINK
    response = client.chat.completions.create(model="...", messages=messages, tools=tools)

    # CHECK BUDGET
    if not ctx.check_budget(total_tokens)["ok"]:
        messages = ctx.compact(messages)

    # CHECK DONE
    if not response.choices[0].message.tool_calls:
        return response.choices[0].message.content

    # ACT + OBSERVE (via StreamingToolExecutor)
    msg = response.choices[0].message
    messages.append(msg)
    results = executor.execute(tool_calls)
    for tc, result in zip(msg.tool_calls, results):
        messages.append({"role": "tool", "tool_call_id": tc.id, "content": result.output})
```

### The Key Insight

> **A single LLM call is not an agent. A loop that lets the LLM decide when to stop — that's an agent.**

The loop is the engine. It gives the LLM the ability to iterate, correct itself, and handle complex tasks that no single prompt could solve.

### What's Next?

In **[Chapter 04: Tool System: Hands & Feet](./04-tool-system.md)**, you'll dive deeper into the tool system we started here — Schema validation, alias-based dispatch, concurrency control, and a complete tool lifecycle. You'll build a full production-ready tool system.

---

*"Think. Act. Observe. Repeat. That's not just how agents work — it's how we work too."*
