# 02. Build Your First Agent

> **In this chapter: You'll combine an LLM with a tool to build your first real AI agent. The agent can do math — and it knows when to use its calculator.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand what makes an agent different from a chatbot
- Build a calculator tool your agent can use
- Implement **function calling** (tool use) with an LLM
- See how the LLM decides between answering directly or using a tool
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

### Step 1: The Calculator Tool

First, let's build a simple calculator that can evaluate math expressions safely.

Create a file called `first_agent.py`:

```python
import math
import json

# ─── THE TOOL ────────────────────────────────────────

def calculate(expression: str) -> str:
    """
    Evaluate a mathematical expression.
    
    Args:
        expression: A math expression like "2 + 2" or "15 * 3.5"
    
    Returns:
        The result as a string
    """
    # Create a safe evaluation environment
    allowed_names = {
        "abs": abs, "round": round, "max": max, "min": min,
        "sum": sum, "pow": pow, "sqrt": math.sqrt,
        "sin": math.sin, "cos": math.cos, "tan": math.tan,
        "pi": math.pi, "e": math.e,
    }
    
    try:
        # Using eval is risky - we restrict it to only math operations
        result = eval(expression, {"__builtins__": {}}, allowed_names)
        return str(result)
    except Exception as e:
        return f"Error: {e}"

# Test it
if __name__ == "__main__":
    print(calculate("2 + 2"))          # "4"
    print(calculate("15 * 3.5"))        # "52.5"
    print(calculate("sqrt(144)"))       # "12.0"
    print(calculate("sin(pi/2)"))       # "1.0"
```

> **Security note:** Using `eval()` is dangerous in production. We restrict it by removing dangerous built-ins. In later chapters, we'll build safer tools.

### Step 2: Define the Tool Schema

For the LLM to know about our tool, we need to describe it in a format the API understands. OpenAI uses a JSON schema:

```python
# ─── TOOL SCHEMA ──────────────────────────────────────

calculator_schema = {
    "type": "function",
    "function": {
        "name": "calculate",
        "description": "Evaluate a mathematical expression. Use +, -, *, /, sqrt(), pow(), sin(), cos(), pi, e, etc.",
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {
                    "type": "string",
                    "description": "The math expression to evaluate, e.g. '2 + 2' or '15 * 3.5'",
                }
            },
            "required": ["expression"],
        },
    },
}
```

This tells the LLM:
- There's a tool called **"calculate"**
- It takes **one parameter**: an expression string
- The parameter is **required**
- Here's what the tool does

### Step 3: The Agent Loop

Now, let's write the agent loop. The agent:

1. Takes a user's question
2. Sends it to the LLM with the tool definitions
3. If the LLM calls a tool → run the tool, send result back
4. If the LLM replies directly → show the answer

```python
from openai import OpenAI
import os

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

def run_agent(user_input):
    """
    Run the agent with a user input.
    Returns the final response.
    """
    messages = [
        {"role": "system", "content": "You are a helpful assistant with math skills. When you need to calculate something, use the calculate tool. Otherwise, answer directly."},
        {"role": "user", "content": user_input},
    ]
    
    # First call to the LLM
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        tools=[calculator_schema],  # Tell the LLM about our tool
        tool_choice="auto",         # Let the LLM decide when to use tools
    )
    
    message = response.choices[0].message
    
    # Check if the LLM wants to call a tool
    if message.tool_calls:
        # The LLM asked to use a tool!
        tool_call = message.tool_calls[0]
        tool_name = tool_call.function.name
        tool_args = json.loads(tool_call.function.arguments)
        
        print(f"🔧 LLM called tool: {tool_name}({tool_args})")
        
        # Run the tool
        if tool_name == "calculate":
            result = calculate(tool_args["expression"])
        
        # Tell the LLM the result
        messages.append(message)  # Add the assistant's tool call message
        messages.append({
            "role": "tool",
            "tool_call_id": tool_call.id,
            "content": result,
        })
        
        # Get the final answer from the LLM
        final_response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=[calculator_schema],
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

> "You are a helpful assistant with math skills. When you need to calculate something, use the calculate tool. Otherwise, answer directly."

This tells the LLM:
1. ✅ You have a tool for math
2. ✅ Use it when needed
3. ✅ It's okay to answer without tools too

Without this hint, the LLM might try to do math in its head (and get it wrong) or call the tool for everything (even non-math questions).

---

## 🧪 Exercises

### Exercise 1: Add a "Weather Tool"

Create a fake weather tool that returns hardcoded temperatures for different cities. The schema:

```python
weather_schema = {
    "type": "function",
    "function": {
        "name": "get_weather",
        "description": "Get the current weather for a city.",
        "parameters": {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "City name, e.g. 'Tokyo', 'London'",
                }
            },
            "required": ["city"],
        },
    },
}
```

The function:

```python
def get_weather(city: str) -> str:
    """Fake weather data."""
    weather_data = {
        "Tokyo": "22°C, sunny",
        "London": "15°C, cloudy",
        "New York": "18°C, light rain",
        "Sydney": "26°C, clear",
        "Mumbai": "32°C, humid",
    }
    return weather_data.get(city, f"20°C, unknown (no data for {city})")
```

**Steps:**
1. Add `weather_schema` to the `tools` list
2. Add the tool handling logic in the agent loop
3. Test with: "What's the weather in Tokyo?" and "What's 5 + 3 and weather in London?"

### Exercise 2: Add a "Web Search" Tool (Simulated)

Add another tool called `search_web` that returns simulated search results:

```python
def search_web(query: str) -> str:
    """Simulated web search."""
    fake_results = {
        "python programming": "Python is a high-level, interpreted programming language...",
        "AI agents": "AI agents are autonomous systems that perceive and act...",
        "capital of Japan": "Tokyo is the capital of Japan.",
    }
    # Return a fake result or a default
    for key, value in fake_results.items():
        if key in query.lower():
            return value
    return f"Search results for '{query}': (simulated) No results found, but here's a fun fact!"
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

Write the schemas, functions, and agent loop. Test with questions like:
- "What's the square root of 256?"
- "Define 'algorithm'"
- "Translate 'hello' to Spanish"
- "What's 25 * 4 and translate 'goodbye' to Spanish?"

---

## 📝 Summary

### Key Concepts

| Concept | What It Means |
|---|---|
| **Agent** | LLM + Tools (brain + hands) |
| **Function calling** | The LLM outputs a structured request to use a tool |
| **Tool schema** | A JSON description of a tool (name, params, description) |
| **tool_choice** | Controls whether the LLM must/may/never use tools |
| **Tool call** | The LLM's request to invoke a specific function |
| **Tool result** | The output of the function, sent back to the LLM |

### The Code You Own

```python
from openai import OpenAI
import json

client = OpenAI()

def calculate(expression):
    """A tool the agent can use."""
    allowed = {"sqrt": math.sqrt, "pi": math.pi}
    try:
        return str(eval(expression, {"__builtins__": {}}, allowed))
    except:
        return f"Error"

# Schema describing the tool
calculator_schema = {
    "type": "function",
    "function": {
        "name": "calculate",
        "description": "Do math",
        "parameters": {
            "type": "object",
            "properties": {
                "expression": {"type": "string"}
            },
            "required": ["expression"],
        },
    },
}

# Agent: LLM decides → we run tool → LLM answers
def run_agent(user_input):
    messages = [
        {"role": "system", "content": "Use tools when needed."},
        {"role": "user", "content": user_input},
    ]
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        tools=[calculator_schema],
    )
    
    msg = response.choices[0].message
    
    if msg.tool_calls:
        # Run the tool
        args = json.loads(msg.tool_calls[0].function.arguments)
        result = calculate(args["expression"])
        # Send result back to LLM
        messages.append(msg)
        messages.append({"role": "tool", "tool_call_id": msg.tool_calls[0].id, "content": result})
        final = client.chat.completions.create(model="gpt-4o-mini", messages=messages)
        return final.choices[0].message.content
    else:
        return msg.content
```

### The Key Insight

> **An LLM cannot do precise math, but it knows when math is needed. Your job is to give it the tools and trust it to decide when to use them.**

This pattern — LLM decides, we execute — is the foundation of every AI agent, from simple scripts to production systems used by millions.

### What's Next?

In **[Chapter 03: Think → Act → Observe Loop](./03-core-loop.md)**, you'll move beyond a single tool call. You'll build a loop that can handle **multiple steps** — think, act, observe, repeat — until a complex task is done.

---

*"An agent is not a mind-reader. It's a tool-user that thinks."*
