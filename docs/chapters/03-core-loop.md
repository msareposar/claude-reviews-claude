# 03. Think → Act → Observe Loop

> **In this chapter: You'll build the core loop that powers every agent — Think, Act, Observe. Your agent will handle multi-step tasks and decide when it's done.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand the **Think → Act → Observe** loop that drives all agents
- Build a `while` loop that keeps running until the agent decides to stop
- Handle **multi-step tasks** like "search, calculate, and summarize"
- See how the agent plans its next step after each observation
- Have a complete, runnable multi-step agent

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

### Step 1: Multiple Tools

First, let's give our agent a few tools so it can handle different tasks.

Create `core_loop.py`:

```python
import math
import json
import os
from openai import OpenAI

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ─── TOOLS ────────────────────────────────────────────

def calculate(expression: str) -> str:
    """Evaluate a math expression."""
    allowed = {
        "abs": abs, "round": round, "sqrt": math.sqrt,
        "sin": math.sin, "cos": math.cos, "pi": math.pi, "e": math.e,
    }
    try:
        return str(eval(expression, {"__builtins__": {}}, allowed))
    except Exception as e:
        return f"Error: {e}"

def search_web(query: str) -> str:
    """Simulated web search."""
    fake_db = {
        "capital of france": "Paris is the capital of France.",
        "population of japan": "Japan's population is approximately 125 million (2024 estimate).",
        "weather tokyo": "Tokyo weather: 22°C, sunny.",
        "python language": "Python is a high-level, interpreted programming language created by Guido van Rossum in 1991.",
        "ai agent": "An AI agent is a system that uses an LLM to reason and call tools to accomplish tasks.",
    }
    # Check for keyword matches
    for key, value in fake_db.items():
        if key in query.lower():
            return value
    return f"Search results for '{query}': No specific data found."

def get_time() -> str:
    """Get the current time (simulated)."""
    from datetime import datetime
    return f"Current time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}"

# ─── TOOL SCHEMAS ─────────────────────────────────────

tools = [
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "Evaluate a mathematical expression. Use +, -, *, /, sqrt(), pow(), sin(), cos(), pi, e, etc.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "The math expression to evaluate",
                    }
                },
                "required": ["expression"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_web",
            "description": "Search the web for information. Use for facts, definitions, and knowledge questions.",
            "parameters": {
                "type": "object",
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "The search query",
                    }
                },
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_time",
            "description": "Get the current date and time.",
            "parameters": {
                "type": "object",
                "properties": {},
            },
        },
    },
]

# ─── TOOL DISPATCHER ──────────────────────────────────

def run_tool(tool_name: str, args: dict) -> str:
    """Run a tool by name with the given arguments."""
    if tool_name == "calculate":
        return calculate(args["expression"])
    elif tool_name == "search_web":
        return search_web(args["query"])
    elif tool_name == "get_time":
        return get_time()
    else:
        return f"Unknown tool: {tool_name}"
```

### Step 2: The Core Loop

Now let's build the **Think → Act → Observe** loop:

```python
# ─── THE CORE LOOP ────────────────────────────────────

def run_agent(user_input: str, max_steps: int = 10) -> str:
    """
    Run the agent with the Think → Act → Observe loop.
    
    Args:
        user_input: The user's request
        max_steps: Maximum iterations to prevent infinite loops
    
    Returns:
        The agent's final response
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
    
    while step < max_steps:
        step += 1
        print(f"\n{'='*50}")
        print(f"🔄 Step {step}: Thinking...")
        
        # ─── THINK ────────────────────────────────────
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=tools,
        )
        
        message = response.choices[0].message
        
        # ─── CHECK IF DONE ────────────────────────────
        if not message.tool_calls:
            # No tool calls = the agent is done
            print(f"✅ Agent decided it's done.")
            print(f"💬 Final response: {message.content}")
            return message.content
        
        # ─── ACT ──────────────────────────────────────
        # Process each tool call
        messages.append(message)
        
        for tool_call in message.tool_calls:
            tool_name = tool_call.function.name
            args = json.loads(tool_call.function.arguments)
            
            print(f"🔧 Act: Calling {tool_name}({args})")
            
            # Run the tool
            result = run_tool(tool_name, args)
            print(f"👀 Observe: Got result: {result[:80]}...")
            
            # ─── OBSERVE ──────────────────────────────
            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result,
            })
    
    # If we hit max_steps, force a final answer
    print(f"⚠️ Hit max steps ({max_steps}). Forcing final answer.")
    messages.append({
        "role": "system",
        "content": "You have reached the maximum number of steps. Please provide your best answer now based on what you've done so far."
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

### Step 3: Run It

```bash
python core_loop.py
```

Watch the output carefully. You'll see the agent:

1. **Think** about the task
2. **Act** by calling a tool
3. **Observe** the result
4. **Repeat** if more work is needed

Example output for "Search the web for the population of Japan, then calculate what 10% of that is."

```
############################################################
❓ USER: Search the web for the population of Japan, then calculate what 10% of that is.
############################################################

==================================================
🔄 Step 1: Thinking...
🔧 Act: Calling search_web({'query': 'population of Japan'})
👀 Observe: Got result: Japan's population is approximately 125 million (2024 estimate)....

==================================================
🔄 Step 2: Thinking...
🔧 Act: Calling calculate({'expression': '125000000 * 0.1'})
👀 Observe: Got result: 12500000.0....

==================================================
🔄 Step 3: Thinking...
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

### Why the Loop Matters

Without a loop, your agent can only do **one thing**. With a loop, it can:

| Before (single call) | After (loop) |
|---|---|
| Answer or call 1 tool | Call many tools in sequence |
| No chain of thought | Step-by-step reasoning |
| Can't recover from errors | Can retry or try alternatives |
| Fixed, one-shot | Dynamic, until done |

### Understand the Think Phase

During the **Think** phase, the LLM sees:

1. The system message (instructions)
2. All previous conversation (user, assistant, tool results)
3. The tool definitions

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

Our loop handles this by iterating over `message.tool_calls` and running each one.

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

### Exercise 1: Add a File Writing Tool

Add a tool that writes text to a file. The agent can then save results.

```python
def write_file(filename: str, content: str) -> str:
    """Write content to a file."""
    try:
        with open(filename, 'w') as f:
            f.write(content)
        return f"Successfully wrote {len(content)} characters to {filename}"
    except Exception as e:
        return f"Error writing file: {e}"
```

Add the schema:

```python
{
    "type": "function",
    "function": {
        "name": "write_file",
        "description": "Write text content to a file.",
        "parameters": {
            "type": "object",
            "properties": {
                "filename": {"type": "string", "description": "Name of the file"},
                "content": {"type": "string", "description": "Content to write"},
            },
            "required": ["filename", "content"],
        },
    },
}
```

**Test:** "Search for information about Python, then save a summary to python_info.txt"

### Exercise 2: Chain Three Tools

Create a task that requires **three** sequential tool calls:

- Search for a famous person's birth year
- Calculate how old they would be today
- Save the result to a file

Observe how the agent plans and executes all three steps.

### Exercise 3: Error Recovery

Make the `calculate` tool fail sometimes (simulate an error):

```python
def calculate(expression: str) -> str:
    if "error" in expression.lower():
        return "Error: Invalid expression. Please try again with proper syntax."
    # ... normal calculation
```

Ask the agent: "Calculate error_test" and see how the LLM handles the error. Does it try again with a different expression? Does it apologize and give up?

Modify your system prompt to encourage retrying on errors:

```
"When a tool returns an error, try to fix the issue and retry."
```

### Exercise 4: Limit the Steps to 2

Change `max_steps = 2` and ask a task that needs 3 steps. Watch what happens. The agent should be forced to give its best answer even if the task isn't complete.

### Exercise 5: Track the Token Usage

Add token tracking to see how much each step costs:

```python
response = client.chat.completions.create(...)
prompt_tokens = response.usage.prompt_tokens
completion_tokens = response.usage.completion_tokens
total_tokens = response.usage.total_tokens
print(f"📊 Tokens used: {total_tokens} (prompt: {prompt_tokens}, completion: {completion_tokens})")
```

Run a multi-step task and see how many tokens the whole conversation uses.

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

| Concept | What It Means |
|---|---|
| **Think** | The LLM looks at context and decides what to do |
| **Act** | Call a tool with specific arguments |
| **Observe** | Process the tool's result and add it to context |
| **Loop** | Repeat Think → Act → Observe until done |
| **Max steps** | Safety limit to prevent infinite loops |
| **Multi-step** | Breaking a complex task into sequential tool calls |

### The Core Loop Pattern

```python
messages = [
    {"role": "system", "content": system_prompt},
    {"role": "user", "content": user_input},
]

while step < max_steps:
    # THINK: Ask the LLM
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        tools=tools,
    )
    
    msg = response.choices[0].message
    
    # CHECK: Is the agent done?
    if not msg.tool_calls:
        return msg.content  # Done!
    
    # ACT: Run each tool
    messages.append(msg)
    for tc in msg.tool_calls:
        result = run_tool(tc.function.name, json.loads(tc.function.arguments))
        # OBSERVE: Add result to context
        messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})
    
    # LOOP: Go back to THINK
```

### The Key Insight

> **A single LLM call is not an agent. A loop that lets the LLM decide when to stop — that's an agent.**

The loop is the engine. It gives the LLM the ability to iterate, correct itself, and handle complex tasks that no single prompt could solve.

### What's Next?

In **[Chapter 04: Tool System: Hands & Feet](./04-tool-system.md)**, you'll stop writing tools as loose functions. You'll build a proper **tool system** — an abstract base class, schema generation, error handling, and registration. Your agent will be easier to extend with new capabilities.

---

*"Think. Act. Observe. Repeat. That's not just how agents work — it's how we work too."*
