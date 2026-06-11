# 08. Error Handling & Resilience

> **In this chapter: What happens when things go wrong? APIs fail, tools break, the LLM gives a bad response. You'll build an agent that handles errors gracefully — using claude-code's validation-before-execution pattern.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand common failure modes for AI agents
- Use **Schema validation** to catch bad inputs before tool execution
- Implement **canUseTool** permission gating (like claude-code's permission system)
- Build retry logic with exponential backoff
- Create **ValidationResult** — structured error messages the LLM can understand
- Build a resilient agent that handles errors gracefully

---

## 📖 Explain Like I'm 10

### Things Will Break

Your agent will break. A lot. Here's what can go wrong:

```
❌ LLM API is down      → "Service unavailable"
❌ Tool throws error    → "Division by zero"
❌ Network timeout      → "Connection timed out"
❌ Bad input            → LLM passes a number instead of a string
❌ Rate limit exceeded  → "Too many requests"
```

A **resilient agent** doesn't just crash. It:

1. **Catches bad inputs before execution** — validation is the first line of defense
2. **Tries again** with backoff for transient failures
3. **Falls back** to a simpler approach
4. **Reports structured errors** the LLM can understand and retry from

---

## 🔧 Hands-On: Building a Resilient Agent

### Step 1: ValidationResult — Catch Errors Before Execution

The most important lesson from claude-code: **validate before you execute**. Don't let the tool function see bad inputs.

In claude-code, every tool's `canUseTool` and input schema are checked before `run()` is ever called. Let's build this pattern:

```python
# error_handling.py

from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry
from typing import Tuple, Optional, Dict, Any

# ─── ValidationResult: typed validation outcome ──────

class ValidationResult:
    """
    The result of validating tool inputs before execution.
    
    Like claude-code's ValidationResult<Input> type
    (source: restored-src/src/Tool.ts).
    
    Two states:
    - success: inputs are valid → tool should execute
    - failure: inputs are invalid → return error to LLM
    """
    def __init__(self, is_valid: bool, error_message: Optional[str] = None):
        self.is_valid = is_valid
        self.error_message = error_message

    @classmethod
    def success(cls):
        return cls(is_valid=True)

    @classmethod
    def failure(cls, message: str):
        return cls(is_valid=False, error_message=message)

    def __bool__(self):
        return self.is_valid

    def __str__(self):
        if self.is_valid:
            return "ValidationResult(success)"
        return f"ValidationResult(failure: {self.error_message})"
```

### Step 2: Permission Gating with canUseTool

In claude-code, each tool can declare `canUseTool` — a function that checks runtime permissions before execution. This is separate from input validation: permissions check the **context** (not the inputs), like "is this tool allowed in dry-run mode?"

```python
class PermissionCheck:
    """
    The result of a permission check before tool execution.
    
    Like claude-code's canUseTool pattern
    (source: restored-src/src/Tool.ts).
    """
    def __init__(self, allowed: bool, reason: str = ""):
        self.allowed = allowed
        self.reason = reason

    @classmethod
    def grant(cls):
        return cls(allowed=True)

    @classmethod
    def deny(cls, reason: str):
        return cls(allowed=False, reason=reason)

    def __bool__(self):
        return self.allowed


class PermissionedTool:
    """
    A tool wrapper with permission checking.
    
    Like claude-code's canUseTool system — checks are done
    before the tool runs, not inside it.
    """
    def __init__(self, tool: Tool, context: Dict[str, Any] = None):
        self.tool = tool
        self.context = context or {}

    def check_permissions(self, **kwargs) -> PermissionCheck:
        """
        Check if this tool can be used in the current context.
        Override in subclasses for custom permission logic.
        """
        # Default: always allowed
        return PermissionCheck.grant()

    def safe_execute(self, **kwargs) -> str:
        """
        Execute the tool with full permission and validation checks.
        This is the pattern claude-code uses before every tool call.
        """
        # Layer 1: Permission check (canUseTool)
        perm = self.check_permissions(**kwargs)
        if not perm.allowed:
            return self._format_permission_error(perm)

        # Layer 2: Schema validation (ValidationResult)
        is_valid, error = self.tool.input_schema.validate(kwargs)
        if not is_valid:
            return self._format_validation_error(error)

        # Layer 3: Execution with error boundary
        try:
            return self.tool.call(**kwargs)
        except Exception as e:
            return self._format_execution_error(e)

    def _format_permission_error(self, perm: PermissionCheck) -> str:
        """Format a permission error for the LLM to understand."""
        return (
            f"<tool_use_error>\n"
            f"  Tool: {self.tool.name}\n"
            f"  Error: PermissionDenied\n"
            f"  Reason: {perm.reason}\n"
            f"  Action: Try a different tool or approach.\n"
            f"</tool_use_error>"
        )

    def _format_validation_error(self, error_message: str) -> str:
        """Format a validation error the LLM can fix."""
        return (
            f"<tool_use_error>\n"
            f"  Tool: {self.tool.name}\n"
            f"  Error: ValidationError\n"
            f"  Message: {error_message}\n"
            f"  Action: Check the input parameters and retry.\n"
            f"</tool_use_error>"
        )

    def _format_execution_error(self, error: Exception) -> str:
        """Format a runtime error with a suggested fix."""
        return (
            f"<tool_use_error>\n"
            f"  Tool: {self.tool.name}\n"
            f"  Error: RuntimeError ({type(error).__name__})\n"
            f"  Message: {error}\n"
            f"  Action: Check the input parameters and retry.\n"
            f"</tool_use_error>"
        )
```

### Step 3: Structured Error Messages (FallbackToolUseErrorMessage)

In claude-code, when a tool fails, the error is displayed with a structured format that the LLM can understand and retry from — the `FallbackToolUseErrorMessage` component.

The `<tool_use_error>` XML tags are important: they tell the LLM exactly what happened and what to do next. The tags are easy to parse (by both the LLM and our code).

### Step 4: Build Permissioned Tools

Now let's create some tools with our permission system:

```python
# ─── Example: Calculator with input validation ───────

import math

calc_schema = Schema(
    properties={
        "expression": {
            "type": "string",
            "description": "Math expression, e.g. '2 + 2'",
        },
    },
    required=["expression"],
)

def calc_impl(expression: str) -> str:
    allowed = {"sqrt": math.sqrt, "pi": math.pi, "abs": abs, "pow": pow}
    return str(eval(expression, {"__builtins__": {}}, allowed))

calculator = build_tool(ToolDef(
    name="calculate",
    description="Evaluate a mathematical expression",
    input_schema=calc_schema,
    call=calc_impl,
    is_concurrency_safe=True,
    aliases=["calc"],
))


# ─── Example: FileWriteTool with permission checking ──

file_write_schema = Schema(
    properties={
        "path": {"type": "string", "description": "File path to write to"},
        "content": {"type": "string", "description": "Content to write"},
    },
    required=["path", "content"],
)

def write_file_impl(path: str, content: str) -> str:
    with open(path, 'w') as f:
        f.write(content)
    return f"Written {len(content)} chars to {path}"

file_writer = build_tool(ToolDef(
    name="write_file",
    description="Write content to a file",
    input_schema=file_write_schema,
    call=write_file_impl,
    is_concurrency_safe=False,  # Has side effects
    aliases=["save"],
))


# ─── Permissioned wrapper for the writer ─────────────

class PermissionedFileWriter(PermissionedTool):
    """
    File writer with permission checks.
    Blocks writes to system directories.
    """
    SAFE_DIRS = ["/tmp", os.getcwd()]  # Only these directories are writable

    def check_permissions(self, **kwargs) -> PermissionCheck:
        path = kwargs.get("path", "")
        abs_path = os.path.abspath(os.path.expanduser(path))

        # Check if the path is in a safe directory
        for safe_dir in self.SAFE_DIRS:
            if abs_path.startswith(os.path.abspath(safe_dir)):
                return PermissionCheck.grant()

        return PermissionCheck.deny(
            f"Cannot write to '{path}'. Allowed directories: "
            f"{', '.join(self.SAFE_DIRS)}"
        )


# ─── Registry ────────────────────────────────────────

registry = ToolRegistry()
registry.register_many([calculator, file_writer])
```

### Step 5: The Safe Executor

Now let's build an executor that uses permission checking:

```python
# ─── SafeExecutor: runs tools with permission + validation ──

class SafeExecutor:
    """
    Executes tools with layered error handling.
    
    Each tool call goes through:
    1. Permission check (canUseTool)
    2. Schema validation (ValidationResult)
    3. Execution with error boundary
    """
    def __init__(self, registry: ToolRegistry, context: dict = None):
        self.registry = registry
        self.context = context or {}
        self._permissioned_tools = {}

    def _get_permissioned(self, tool: Tool) -> PermissionedTool:
        """Get or create a PermissionedTool wrapper."""
        if tool.name not in self._permissioned_tools:
            self._permissioned_tools[tool.name] = PermissionedTool(tool, self.context)
        return self._permissioned_tools[tool.name]

    def execute(self, name: str, args: dict) -> str:
        """Execute a tool with full error handling layers."""
        tool = self.registry.find_tool(name)
        if not tool:
            # Unknown tool — tell the LLM what's available
            available = list(self.registry._tools.keys())
            return (
                f"<tool_use_error>\n"
                f"  Error: UnknownTool\n"
                f"  Message: No tool named '{name}'\n"
                f"  Available tools: {', '.join(available)}\n"
                f"</tool_use_error>"
            )

        # Use the permissioned wrapper
        perm_tool = self._get_permissioned(tool)
        return perm_tool.safe_execute(**args)


# ─── Retry with Exponential Backoff ──────────────────

import time
import openai

def call_llm_with_retry(messages: list, tools: list,
                         model: str = "gpt-4o-mini",
                         max_retries: int = 3) -> str:
    """
    Call the LLM with retry and exponential backoff.
    Only retries transient errors (timeout, rate limit, connection).
    """
    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            response = openai.chat.completions.create(
                model=model,
                messages=messages,
                tools=tools,
                timeout=30,
            )
            return response

        except (openai.APITimeoutError, openai.RateLimitError,
                openai.APIConnectionError) as e:
            last_error = e
            if attempt < max_retries:
                wait_time = 2 ** (attempt - 1)  # 1s, 2s, 4s
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

### Step 6: Complete Resilient Agent

```python
# ─── Resilient Agent ─────────────────────────────────

import json
import os

class ResilientAgent:
    """
    Agent that never crashes — it catches, reports, and retries.
    
    Three error layers:
    1. API call retries (transient failures)
    2. Permission + validation checks (bad inputs)
    3. Tool execution errors (runtime failures)
    """
    def __init__(self, executor: SafeExecutor, tools_schema: list):
        self.executor = executor
        self.tools_schema = tools_schema

    def run(self, user_input: str, max_steps: int = 10) -> str:
        messages = [
            {"role": "system", "content": (
                "You are a helpful agent with access to tools.\n\n"
                "When a tool returns an error wrapped in <tool_use_error> tags, "
                "read the error carefully and either fix your input "
                "or try a different approach.\n\n"
                "Tool errors are:\n"
                "- PermissionDenied: You're not allowed to do this\n"
                "- ValidationError: Your input has the wrong format\n"
                "- RuntimeError: Something went wrong during execution\n"
                "- UnknownTool: You used a tool name that doesn't exist"
            )},
            {"role": "user", "content": user_input},
        ]

        step = 0
        while step < max_steps:
            step += 1
            print(f"\n🔄 Step {step}")

            # THINK (with retry)
            response = call_llm_with_retry(messages, self.tools_schema)
            if isinstance(response, str) and response.startswith("⚠️"):
                return response  # All retries exhausted

            msg = response.choices[0].message

            # DONE?
            if not msg.tool_calls:
                return msg.content

            # ACT + OBSERVE (with permission + validation checks)
            messages.append(msg)
            for tc in msg.tool_calls:
                tool_name = tc.function.name
                args = json.loads(tc.function.arguments)

                print(f"  🔧 {tool_name}({args})")

                # Execute through SafeExecutor (with 3 error layers)
                result = self.executor.execute(tool_name, args)

                # Check if result is an error
                if "<tool_use_error>" in result:
                    print(f"  ⚠️ Error: {result.split(chr(10))[3].strip()}")
                else:
                    print(f"  ✅ Result: {result[:60]}...")

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })

        return "⚠️ Max steps reached."


# ─── Run it ──────────────────────────────────────────

if __name__ == "__main__":
    executor = SafeExecutor(registry)
    agent = ResilientAgent(executor, registry.get_openai_schemas())

    print("=== Testing Resilient Agent ===\n")

    # Test 1: Normal calculation
    print("📌 Test 1: Normal calculation")
    print(agent.run("Calculate 42 * 15"))
    print()

    # Test 2: Bad input (string where number expected triggers validation)
    print("📌 Test 2: Permission denied (write to protected path)")
    print(agent.run("Write 'hello' to /etc/passwd"))
    print()

    # Test 3: Unknown tool
    print("📌 Test 3: Unknown tool name")
    print(agent.run("Use the 'delete_all_files' tool to clean up"))
    print()

    # Test 4: Recovery from tool error
    print("📌 Test 4: Error recovery")
    print(agent.run("Calculate 1/0, then calculate 2+2"))
```

---

## 🔍 How It Works

### The Three Error Layers

```
                    LLM wants to call a tool
                              │
                              ▼
               ┌──────────────────────────┐
     Layer 1   │   canUseTool             │
     (context) │   "Is this allowed?"     │
               │   PermissionDenied → ret │
               └──────────┬───────────────┘
                          ▼
               ┌──────────────────────────┐
     Layer 2   │   Schema Validation      │
     (inputs)  │   "Are the inputs valid?" │
               │   ValidationError → ret  │
               └──────────┬───────────────┘
                          ▼
               ┌──────────────────────────┐
     Layer 3   │   Execution              │
     (runtime) │   "Does it work?"        │
               │   RuntimeError → ret     │
               └──────────┬───────────────┘
                          ▼
                    Result or Error
```

Each layer catches a different kind of failure:

| Layer | What it checks | Error type |
|---|---|---|
| **canUseTool** | Is the operation allowed in this context? | `PermissionDenied` |
| **Schema validation** | Are the input types and values correct? | `ValidationError` |
| **Runtime execution** | Does the function run without exceptions? | `RuntimeError` |

### Why Three Layers Instead of One try/except?

Claude-code uses this layered approach because each layer has a **different recovery strategy**:

- **Permission errors**: The LLM should use a different tool entirely
- **Validation errors**: The LLM should fix its input and retry
- **Runtime errors**: The LLM should check the parameters and try again

If you wrap everything in one `try/except`, you lose this distinction. The LLM gets a generic "something went wrong" message and doesn't know how to respond.

### The <tool_use_error> Format

The structured XML-like format is designed for the LLM to parse:

- `<tool_use_error>` tags clearly delimit the error from normal output
- The `Error:` line tells the LLM the type
- The `Message:` line gives details
- The `Action:` line tells the LLM what to do next

This is exactly how claude-code's `FallbackToolUseErrorMessage` works — it produces a structured error that the model can understand and act on.

### Retry vs. Fail Fast

Not all errors should be retried:

| Error | Retry? | Why |
|---|---|---|
| `APITimeoutError` | ✅ Yes (exponential backoff) | Network issues are transient |
| `RateLimitError` | ✅ Yes (with waiting) | Will clear when limit resets |
| `APIConnectionError` | ✅ Yes (with backoff) | Service may recover |
| `AuthenticationError` | ❌ No | Wrong API key — retry won't fix |
| `ValidationError` | ❌ No (let LLM retry) | Bad input — tell the LLM to fix it |
| `PermissionDenied` | ❌ No (let LLM retry) | Not allowed — LLM should try differently |

The retry logic for API calls is separate from the retry logic for tool errors. API retries are automatic (the code waits and retries). Tool errors go back to the LLM, which decides whether to retry with different inputs.

---

## 🧪 Exercises

### Exercise 1: Add a Sandboxed File Tool

Create a permission checker that only allows writing to `/tmp/`:

```python
class SandboxedFileWriter(PermissionedTool):
    SAFE_PREFIX = "/tmp/"

    def check_permissions(self, **kwargs) -> PermissionCheck:
        path = kwargs.get("path", "")
        if not path.startswith(self.SAFE_PREFIX):
            return PermissionCheck.deny(
                f"Write denied: path must start with '{self.SAFE_PREFIX}'"
            )
        return PermissionCheck.grant()
```

Test with: "Write 'test' to ~/test.txt" and "Write 'test' to /tmp/test.txt"

### Exercise 2: Simulate API Failures

Create a wrapper that randomly fails to test retry logic:

```python
import random

def flaky_tool(impl):
    """Wrap a tool implementation with random failures."""
    def wrapper(**kwargs):
        if random.random() < 0.3:  # 30% failure rate
            raise ConnectionError("Simulated network failure")
        return impl(**kwargs)
    return wrapper

# Usage
unreliable_calc = build_tool(ToolDef(
    name="calculate",
    description="Unreliable calculator",
    input_schema=calc_schema,
    call=flaky_tool(calc_impl),
))
```

### Exercise 3: Log All Errors

Add error logging to the SafeExecutor:

```python
class LoggingExecutor(SafeExecutor):
    def __init__(self, registry, log_file="errors.log", context=None):
        super().__init__(registry, context)
        self.log_file = log_file

    def execute(self, name, args):
        result = super().execute(name, args)
        if "<tool_use_error>" in result:
            with open(self.log_file, "a") as f:
                f.write(f"[{time.strftime('%H:%M:%S')}] {name}: {result}\n")
        return result
```

### Exercise 4: Graceful Degradation

If a critical tool fails, the agent should still work with remaining tools:

```python
# In the agent loop, when a tool returns PermissionDenied:
# The LLM reads the error and tries a different approach.
# This is handled naturally by including the error in the conversation.
```

Test: "Write 'backup' to /etc/critical_file" → LLM should realize it's blocked and try writing to /tmp instead.

### Challenge: Fallback Chain

Build a system where tools have fallbacks:

```python
class FallbackTool:
    """Try tool A, if it fails, try tool B."""
    def __init__(self, primary: str, fallback: str, registry: ToolRegistry):
        self.primary = primary
        self.fallback = fallback
        self.registry = registry

    def execute(self, args: dict) -> str:
        result = self.registry.run_tool(self.primary, args)
        if "<tool_use_error>" in result and self.fallback:
            print(f"  ⚠️ Primary '{self.primary}' failed, trying '{self.fallback}'")
            result = self.registry.run_tool(self.fallback, args)
        return result
```

---

## 📝 Summary

### Key Concepts

| Concept | What It Means | In claude-code |
|---|---|---|
| **ValidationResult** | Typed validation outcome: success or failure with message | `ValidationResult<Input>` in `Tool.ts` |
| **canUseTool** | Permission check before execution | `canUseTool` in `Tool.ts` |
| **FallbackToolUseErrorMessage** | Structured error format for the LLM | `FallbackToolUseErrorMessage.tsx` |
| **Exponential backoff** | Wait 1s, 2s, 4s between retries | Standard retry pattern |
| **Three error layers** | Permission → Validation → Execution | Layered in `Tool.call()` |
| **<tool_use_error>** | XML-tagged error the LLM can parse | `FallbackToolUseErrorMessage.tsx` |

### The Code You Own

```python
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

class SafeExecutor:
    """Three-layer error handling for all tool calls."""
    def execute(self, name, args):
        tool = self.registry.find_tool(name)
        if not tool:
            return f"<tool_use_error>Unknown tool '{name}'</tool_use_error>"

        # Layer 1: Permission
        perm = self.check_permissions(tool, args)
        if not perm.allowed:
            return f"<tool_use_error>PermissionDenied: {perm.reason}</tool_use_error>"

        # Layer 2: Validation
        is_valid, error = tool.input_schema.validate(args)
        if not is_valid:
            return f"<tool_use_error>ValidationError: {error}</tool_use_error>"

        # Layer 3: Execution
        try:
            return tool.call(**args)
        except Exception as e:
            return f"<tool_use_error>RuntimeError: {e}</tool_use_error>"
```

> **Next up: Chapter 09 — Planning & Reasoning. How does your agent think through complex tasks?**
