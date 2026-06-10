# 08. Error Handling & Resilience

> **In this chapter: What happens when things go wrong? APIs fail, tools break, the LLM gives a bad response. You'll build an agent that handles errors gracefully and keeps working.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand common failure modes for AI agents
- Implement try/except around tool calls
- Build retry logic with exponential backoff
- Create fallback strategies when things fail
- Build a resilient agent that handles errors gracefully

---

## 📖 Explain Like I'm 10

### Things Will Break

Your agent will break. A lot. Here's what can go wrong:

```python
❌ LLM API is down      → "Service unavailable"
❌ Tool throws error    → "Division by zero"
❌ Network timeout      → "Connection timed out"
❌ Bad LLM response     → Returns "I don't know" instead of JSON
❌ Rate limit exceeded  → "Too many requests"
```

A **resilient agent** doesn't just crash. It:

1. **Detects** the error
2. **Tries again** (maybe differently)
3. **Falls back** to a simpler approach
4. **Tells the user** what happened

---

## 🔧 Hands-On: Building a Resilient Agent

### Step 1: Basic Try/Except

```python
import openai
import time
from datetime import datetime

def call_llm_with_error_handling(messages: list, model: str = "gpt-4o-mini") -> str:
    """Call LLM with basic error handling."""
    try:
        response = openai.chat.completions.create(
            model=model,
            messages=messages,
            timeout=30,  # Don't wait forever
        )
        return response.choices[0].message.content

    except openai.APITimeoutError:
        return "⚠️ Error: The request timed out. Please try again."

    except openai.RateLimitError:
        return "⚠️ Error: Too many requests. Please wait a moment."

    except openai.APIConnectionError:
        return "⚠️ Error: Could not connect to the API. Check your internet."

    except openai.AuthenticationError:
        return "⚠️ Error: API key is invalid. Check your configuration."

    except Exception as e:
        return f"⚠️ Error: Something went wrong: {str(e)}"
```

### Step 2: Retry With Exponential Backoff

When an error happens, don't retry immediately. Wait a bit, then wait longer, then give up:

```python
def call_llm_with_retry(messages: list, model: str = "gpt-4o-mini",
                        max_retries: int = 3) -> str:
    """Call LLM with retry and exponential backoff."""
    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            response = openai.chat.completions.create(
                model=model,
                messages=messages,
                timeout=30,
            )
            return response.choices[0].message.content

        except (openai.APITimeoutError, openai.RateLimitError,
                openai.APIConnectionError) as e:
            last_error = e

            if attempt < max_retries:
                # Wait: 1s, 2s, 4s (exponential backoff)
                wait_time = 2 ** (attempt - 1)
                print(f"  [Retry {attempt}/{max_retries}] Waiting {wait_time}s...")
                time.sleep(wait_time)

        except openai.AuthenticationError as e:
            # No point retrying auth errors
            return f"⚠️ Authentication failed: {e}"

        except Exception as e:
            last_error = e
            if attempt < max_retries:
                print(f"  [Retry {attempt}/{max_retries}] Unknown error, retrying...")
                time.sleep(1)

    return f"⚠️ Failed after {max_retries} retries. Last error: {last_error}"
```

### Step 3: Fallback Strategies

Sometimes the LLM returns something you can't parse. Have a backup plan:

```python
import json

def parse_llm_json(response_text: str) -> dict:
    """Try to parse JSON from LLM response with multiple strategies."""
    # Strategy 1: Direct parse
    try:
        return json.loads(response_text)
    except json.JSONDecodeError:
        pass

    # Strategy 2: Find JSON in markdown code block
    import re
    json_match = re.search(r'```(?:json)?\s*\n(.*?)\n```', response_text, re.DOTALL)
    if json_match:
        try:
            return json.loads(json_match.group(1))
        except json.JSONDecodeError:
            pass

    # Strategy 3: Find anything that looks like { ... }
    brace_match = re.search(r'\{.*\}', response_text, re.DOTALL)
    if brace_match:
        try:
            return json.loads(brace_match.group(0))
        except json.JSONDecodeError:
            pass

    # All strategies failed
    raise ValueError(f"Could not parse JSON from: {response_text[:200]}")
```

### Step 4: Tool Error Wrapper

Wrap all tool calls with error handling:

```python
class ToolError(Exception):
    """Custom exception for tool failures."""
    def __init__(self, tool_name: str, message: str):
        self.tool_name = tool_name
        super().__init__(f"[{tool_name}] {message}")

class Tool:
    """Base tool class with error handling."""

    def run(self, **kwargs) -> str:
        """Run the tool with error handling."""
        try:
            return self._execute(**kwargs)
        except ToolError:
            raise
        except Exception as e:
            raise ToolError(self.name, str(e))

    def _execute(self, **kwargs) -> str:
        """Override in subclasses."""
        raise NotImplementedError

class CalculatorTool(Tool):
    def __init__(self):
        self.name = "calculator"

    def _execute(self, expression: str) -> str:
        """Evaluate a mathematical expression safely."""
        # Only allow safe operations
        allowed = set("0123456789+-*/.() ")

        if not all(c in allowed for c in expression):
            raise ToolError(self.name, "Expression contains invalid characters")

        try:
            result = eval(expression, {"__builtins__": {}}, {})
            return f"Result: {result}"
        except ZeroDivisionError:
            raise ToolError(self.name, "Cannot divide by zero")
        except Exception as e:
            raise ToolError(self.name, f"Invalid expression: {e}")

class WebSearchTool(Tool):
    def __init__(self):
        self.name = "web_search"

    def _execute(self, query: str, max_results: int = 3) -> str:
        """Simulated web search."""
        if not query.strip():
            raise ToolError(self.name, "Query cannot be empty")

        # Simulate potential errors
        import random
        if random.random() < 0.1:  # 10% chance of failure
            raise ToolError(self.name, "Search service temporarily unavailable")

        return f"Search results for '{query}': (simulated results)"
```

### Step 5: Complete Resilient Agent

```python
class ResilientAgent:
    """Agent that handles errors gracefully."""

    def __init__(self, tools: list = None):
        self.tools = {t.name: t for t in (tools or [])}
        self.max_tool_retries = 2

    def run(self, user_input: str) -> str:
        system_prompt = f"""You are a helpful agent with these tools:
{', '.join(self.tools.keys()) if self.tools else 'No tools available.'}
When you need to use a tool, respond with JSON:
{{"tool": "tool_name", "args": {{"arg": "value"}}}}
If you can answer directly, just reply normally."""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_input},
        ]

        # Main loop with error handling
        max_attempts = 5
        for attempt in range(max_attempts):
            try:
                response_text = call_llm_with_retry(messages)
            except Exception as e:
                return f"🤖 I'm having trouble right now: {e}"

            # Try to parse as tool call
            try:
                parsed = json.loads(response_text)
                tool_name = parsed.get("tool")
                tool_args = parsed.get("args", {})

                if tool_name in self.tools:
                    tool = self.tools[tool_name]
                    # Retry tool with backoff
                    for tool_attempt in range(self.max_tool_retries):
                        try:
                            result = tool.run(**tool_args)
                            messages.append({"role": "assistant", "content": response_text})
                            messages.append({"role": "user",
                                "content": f"Tool result: {result}"})
                            break
                        except ToolError as e:
                            if tool_attempt < self.max_tool_retries - 1:
                                time.sleep(1)
                                messages.append({"role": "user",
                                    "content": f"Tool failed: {e}. Try again."})
                            else:
                                messages.append({"role": "user",
                                    "content": f"Tool failed after retries: {e}. Try a different approach or answer directly."})
                else:
                    messages.append({"role": "user",
                        "content": f"Unknown tool '{tool_name}'. Available: {', '.join(self.tools.keys())}."})

            except json.JSONDecodeError:
                # Not a tool call — just return the response
                return response_text

        return "🤖 I couldn't complete this task. Try rephrasing your request."


# Demo
agent = ResilientAgent(tools=[CalculatorTool(), WebSearchTool()])

print("=== Testing Resilient Agent ===")
print(agent.run("Hello! How are you?"))
print()
print(agent.run("Calculate 42 * 15"))
print()
print(agent.run("What's 1/0?"))
print()
print(agent.run("By the way, what's your name?"))
```

### Step 6: Graceful Degradation

If a tool fails, the agent should still work — just without that tool:

```python
class GracefulAgent(ResilientAgent):
    """Agent that continues working even when tools fail."""

    def run(self, user_input: str) -> str:
        system_prompt = """You are a helpful agent with tools.
If a tool is unavailable, answer to the best of your ability without it.
Always try to help even when limited."""

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_input},
        ]

        response_text = call_llm_with_retry(messages)

        try:
            parsed = json.loads(response_text)
            tool_name = parsed.get("tool")
            tool_args = parsed.get("args", {})

            if tool_name in self.tools:
                try:
                    result = self.tools[tool_name].run(**tool_args)
                    # Feed result back and continue
                    messages.append({"role": "assistant", "content": response_text})
                    messages.append({"role": "user",
                        "content": f"Tool result: {result}"})
                    return call_llm_with_retry(messages)
                except ToolError as e:
                    # Tool failed, ask LLM to continue without it
                    messages.append({"role": "assistant", "content": response_text})
                    messages.append({"role": "user",
                        "content": f"The {tool_name} tool failed: {e}. Continue without it."})
                    return call_llm_with_retry(messages)

        except json.JSONDecodeError:
            pass

        return response_text
```

---

## 🔍 How It Works

### Error Handling Pyramid

```
                  ┌──────────────────┐
                  │   Resilient Agent │
                  └────────┬─────────┘
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
      ┌────────────┐ ┌──────────┐ ┌──────────┐
      │ LLM Retry  │ │Tool Try/ │ │ Fallback │
      │ + Backoff  │ │  Except  │ │ Strategy │
      └────────────┘ └──────────┘ └──────────┘
              │            │            │
              ▼            ▼            ▼
      ┌─────────────────────────────────────┐
      │         Error Recovery              │
      │  Retry → Different approach → Tell  │
      │         user gracefully             │
      └─────────────────────────────────────┘
```

### Retry Strategies

| Strategy | How it works | Best for |
|---|---|---|
| **Immediate retry** | Try again right away | Network glitches |
| **Exponential backoff** | Wait 1s, 2s, 4s, 8s... | Rate limits, server overload |
| **Jitter** | Add randomness to wait time | Avoid thundering herd |
| **Different approach** | Try method B when A fails | Parsing failures |

### Graceful Degradation Priorities

1. All tools available → Full capability
2. Some tools failed → Work without them
3. LLM API rate limited → Wait and retry
4. Everything failing → Tell user clearly

---

## 🧪 Exercises

1. **Add timeout protection**: Wrap tool calls with a timeout so they can't run forever.

2. **Build a circuit breaker**: After 3 failures in a row, stop trying that tool for 30 seconds.

3. **Log all errors**: Build a logger that records every error with timestamp for debugging.

4. **User notification**: Instead of returning the raw error, make the agent apologize and suggest alternatives.

5. **Automatic fallback chain**: If calculator fails → try using Python's math module → try asking the LLM to calculate manually.

---

## 📝 Summary

- **Always assume failure** — plan for errors from the start
- **Retry with backoff** — don't hammer failing services
- **Graceful degradation** — work without broken tools
- **Clear user messages** — don't show raw errors to users
- **Circuit breakers** — stop trying when something is clearly broken

> **Next up: Chapter 09 — Planning & Reasoning. How does your agent think through complex tasks?**
