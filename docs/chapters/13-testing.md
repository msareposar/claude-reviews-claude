# 13. Testing Your Agent

> **In this chapter: You wouldn't ship a website without testing it. The same goes for agents. You'll learn how to write unit tests for tools and memory, run integration tests that exercise the full agent loop, and mock the LLM to test without spending money.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand why testing is critical for AI agents (they're unpredictable!)
- Write **unit tests** for individual components (tools, parsers, memory)
- Write **integration tests** that run a full agent loop
- Test **edge cases**: empty input, malformed data, error recovery
- Use **fixtures and mocks** to test without calling real LLMs
- Have a complete pytest test suite you can reuse for any agent

---

## 📖 Explain Like I'm 10

### Why Test an Agent?

Imagine you build a robot chef. You teach it to chop vegetables, boil water, and fry eggs. But you don't test it before serving dinner.

What happens?

- You ask it to "make soup" and it puts the egg in *with the shell on*
- You ask for "boiled water" and it comes back with "I don't have a 'boil' tool"
- You ask it to "chop an onion" and it runs in an infinite loop, chopping forever

Agents are **unpredictable** because they use LLMs, and LLMs don't always do what you expect. Testing catches these surprises **before** your users find them.

### The Testing Pyramid for Agents

```
        /\          Manual / E2E tests
       /  \         (expensive, few)
      /    \
     /──────\       Integration tests
    /        \      (moderate, some)
   /──────────\
  /            \    Unit tests
 /              \   (cheap, many)
╱────────────────╲
```

**Unit tests** test small pieces in isolation: "Does the calculator tool return 4 for '2+2'?"

**Integration tests** test the full agent loop: "Does the agent use the calculator tool when asked a math question?"

**End-to-end tests** test real scenarios with real LLMs: "Does the agent answer a user's complex question correctly?"

In this chapter, we focus on **unit tests** and **integration tests** — the foundation of your testing strategy.

### What Could Go Wrong?

| Problem | Example | How Testing Catches It |
|---|---|---|
| **Tool returns wrong type** | Calculator returns "four" instead of 4 | Unit test checks return type |
| **Agent loops forever** | Keeps calling the same tool | Integration test with max_steps |
| **Memory overflow** | Agent's memory grows unbounded | Test memory size limits |
| **Wrong tool chosen** | Calls "delete" instead of "edit" | Integration test checks tool choice |
| **Crash on empty input** | User sends "" and agent crashes | Edge case test with empty input |
| **Hidden prompt injection** | User input changes behavior | Test with known injection patterns |

---

## 🔧 Hands-On: Build a Test Suite

### Step 1: Set Up Your Test Environment

First, install pytest and set up your project structure.

```python
# requirements-test.txt
pytest>=7.4.0
pytest-mock>=3.11.0
pytest-cov>=4.1.0
```

Project structure:

```
agent_project/
├── agent/
│   ├── __init__.py
│   ├── core.py         # Agent class
│   ├── tools.py        # Tool functions
│   ├── memory.py       # Memory system
│   └── parser.py       # Output parser
├── tests/
│   ├── __init__.py
│   ├── conftest.py     # Shared fixtures
│   ├── test_tools.py   # Unit tests for tools
│   ├── test_memory.py  # Unit tests for memory
│   ├── test_parser.py  # Unit tests for parser
│   ├── test_agent.py   # Integration tests
│   └── test_edge_cases.py
└── pyproject.toml
```

Create `pyproject.toml` for pytest configuration:

```toml
[tool.pytest.ini_options]
testpaths = ["tests"]
python_files = ["test_*.py"]
markers = [
    "slow: marks tests as slow (integration tests with real LLM calls)",
    "edge: marks edge case tests",
]
```

### Step 2: The Code We'll Test

First, let's create the agent components that we'll test.

```python
# ─── agent/tools.py ──────────────────────────────────

"""Tool functions for the agent."""

import math
import json
import re

def calculate(expression: str) -> str:
    """
    Safely evaluate a math expression.
    Returns the result as a string.
    """
    # Security: only allow safe math characters
    if not re.match(r'^[\d\s\+\-\*\/\(\)\.\,\%]+$', expression):
        return "Error: Invalid characters in expression"
    
    try:
        # Use a restricted eval with only math operations
        # In production, use a proper expression parser like `numexpr`
        result = eval(expression, {"__builtins__": {}}, {"math": math})
        return str(result)
    except ZeroDivisionError:
        return "Error: Division by zero"
    except Exception as e:
        return f"Error: {str(e)}"

def get_current_time() -> str:
    """Get the current date and time."""
    from datetime import datetime
    return datetime.now().strftime("%Y-%m-%d %H:%M:%S")

def search_web(query: str) -> str:
    """
    Simulate a web search.
    In production, call a real search API.
    """
    # Mock implementation for testing
    results = {
        "python": "Python is a programming language created by Guido van Rossum.",
        "weather": "The weather varies by location.",
        "capital of france": "The capital of France is Paris.",
    }
    
    query_lower = query.lower()
    for key, value in results.items():
        if key in query_lower:
            return value
    
    return f"No results found for '{query}'."


# ─── agent/memory.py ─────────────────────────────────

"""Simple memory system for the agent."""

class ConversationMemory:
    """Stores conversation history with size limits."""

    def __init__(self, max_messages: int = 10):
        self.messages = []
        self.max_messages = max_messages

    def add(self, role: str, content: str):
        """Add a message to memory."""
        self.messages.append({"role": role, "content": content})
        # Enforce size limit
        if len(self.messages) > self.max_messages:
            self.messages.pop(0)  # Remove oldest

    def get_recent(self, count: int = 5) -> list:
        """Get the N most recent messages."""
        return self.messages[-count:]

    def get_all(self) -> list:
        """Get all messages."""
        return self.messages

    def clear(self):
        """Reset memory."""
        self.messages = []

    def count_messages(self) -> int:
        return len(self.messages)

    def count_tokens(self, approx: bool = True) -> int:
        """Approximate token count (4 chars ≈ 1 token)."""
        total_chars = sum(len(m["content"]) for m in self.messages)
        return total_chars // 4


# ─── agent/parser.py ─────────────────────────────────

"""Parse LLM output into structured commands."""

import re

class OutputParser:
    """Parses LLM output to extract tool calls."""

    # Pattern for JSON tool calls in the text
    # e.g., {"tool": "calculate", "args": {"expression": "2+2"}}
    TOOL_CALL_PATTERN = re.compile(
        r'\{\s*"tool"\s*:\s*"([^"]+)"\s*,\s*"args"\s*:\s*(\{.*?\})\s*\}',
        re.DOTALL
    )

    def parse_tool_call(self, text: str) -> dict | None:
        """
        Extract a tool call from text.
        Returns {"name": "...", "args": {...}} or None.
        """
        match = self.TOOL_CALL_PATTERN.search(text)
        if not match:
            return None
        
        tool_name = match.group(1)
        args_str = match.group(2)
        
        try:
            import json
            args = json.loads(args_str)
        except json.JSONDecodeError:
            return None
        
        return {"name": tool_name, "args": args}

    def has_tool_call(self, text: str) -> bool:
        """Check if text contains a tool call."""
        return bool(self.TOOL_CALL_PATTERN.search(text))

    def extract_final_answer(self, text: str) -> str:
        """Extract the final answer from the agent's response."""
        # Remove any tool calls from the text
        cleaned = self.TOOL_CALL_PATTERN.sub("", text).strip()
        return cleaned


# ─── agent/core.py ───────────────────────────────────

"""Core agent class."""

class Agent:
    """A simple agent that can use tools."""

    def __init__(self, tools: dict = None, memory: ConversationMemory = None):
        self.tools = tools or {}
        self.memory = memory or ConversationMemory()
        self.steps_taken = 0

    def run(self, user_input: str, max_steps: int = 3) -> str:
        """
        Run the agent with user input.
        Simulates the core loop without calling a real LLM.
        """
        self.steps_taken = 0
        self.memory.add("user", user_input)
        
        context = self.memory.get_all()
        step = 0
        
        while step < max_steps:
            step += 1
            self.steps_taken = step
            
            # Simulate LLM deciding (this would be a real LLM call)
            decision = self._simulate_thinking(user_input, context)
            
            if decision["type"] == "answer":
                self.memory.add("assistant", decision["content"])
                return decision["content"]
            
            elif decision["type"] == "tool_call":
                tool_name = decision["tool"]
                tool_args = decision["args"]
                
                if tool_name not in self.tools:
                    error_msg = f"Error: Tool '{tool_name}' not found"
                    self.memory.add("tool", error_msg)
                    continue
                
                try:
                    result = self.tools[tool_name](**tool_args)
                    self.memory.add("tool", str(result))
                except Exception as e:
                    self.memory.add("tool", f"Error: {str(e)}")
        
        return "Agent reached maximum steps without completing."

    def _simulate_thinking(self, user_input: str, context: list) -> dict:
        """
        Simulate what the LLM would decide.
        In real usage, this would call the LLM API.
        For testing, we use a simple rule-based approach.
        """
        # Check if input is a math expression
        if any(op in user_input for op in ["+", "-", "*", "/", "calculate"]):
            # Extract the expression
            expr = user_input.replace("calculate", "").strip()
            return {
                "type": "tool_call",
                "tool": "calculate",
                "args": {"expression": expr},
            }
        
        # Check for time request
        if "time" in user_input.lower() or "date" in user_input.lower():
            return {
                "type": "tool_call",
                "tool": "get_time",
                "args": {},
            }
        
        # Check for search request
        if any(kw in user_input.lower() for kw in ["search", "find", "look up", "what is"]):
            return {
                "type": "tool_call",
                "tool": "search_web",
                "args": {"query": user_input},
            }
        
        # Default: answer directly
        return {
            "type": "answer",
            "content": f"I understand you asked: '{user_input}'. I don't have a specific tool for this, but I'll do my best.",
        }
```

### Step 3: Write Unit Tests

Now let's test each component individually.

```python
# ─── tests/conftest.py ──────────────────────────────

"""Shared fixtures for all tests."""

import pytest
import sys
import os

# Add agent code to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from agent.tools import calculate, get_current_time, search_web
from agent.memory import ConversationMemory
from agent.parser import OutputParser
from agent.core import Agent


@pytest.fixture
def memory():
    """Provide a fresh memory for each test."""
    return ConversationMemory()


@pytest.fixture
def parser():
    """Provide an output parser."""
    return OutputParser()


@pytest.fixture
def agent():
    """Provide a configured agent with mock tools."""
    tools = {
        "calculate": calculate,
        "get_time": get_current_time,
        "search_web": search_web,
    }
    return Agent(tools=tools)
```

```python
# ─── tests/test_tools.py ────────────────────────────

"""Unit tests for tool functions."""

import pytest
from agent.tools import calculate, get_current_time, search_web


class TestCalculate:
    """Tests for the calculator tool."""

    def test_simple_addition(self):
        """2 + 2 should equal 4."""
        result = calculate("2+2")
        assert result == "4"

    def test_multiplication(self):
        """5 * 3 should equal 15."""
        result = calculate("5*3")
        assert result == "15"

    def test_division(self):
        """10 / 2 should equal 5.0."""
        result = calculate("10/2")
        assert result == "5.0"

    def test_complex_expression(self):
        """Test order of operations."""
        result = calculate("2+3*4")
        assert result == "14"

    def test_division_by_zero(self):
        """Division by zero should return an error."""
        result = calculate("1/0")
        assert "Error" in result
        assert "zero" in result.lower()

    def test_invalid_input(self):
        """Invalid characters should be rejected."""
        result = calculate("import os")
        assert "Error" in result

    def test_float_result(self):
        """Test that floats work correctly."""
        result = calculate("10/3")
        assert "." in result

    def test_empty_input(self):
        """Empty input should not crash."""
        result = calculate("")
        # Should return an error or empty result
        assert isinstance(result, str)


class TestSearchWeb:
    """Tests for the search tool."""

    def test_known_query(self):
        """Known queries should return cached results."""
        result = search_web("What is Python?")
        assert "programming language" in result.lower()

    def test_unknown_query(self):
        """Unknown queries should return a 'no results' message."""
        result = search_web("xyznonexistent12345")
        assert "no results" in result.lower()

    def test_case_insensitive(self):
        """Search should be case-insensitive."""
        result_lower = search_web("capital of france")
        result_upper = search_web("CAPITAL OF FRANCE")
        assert result_lower == result_upper

    def test_empty_query(self):
        """Empty query should not crash."""
        result = search_web("")
        assert isinstance(result, str)


class TestGetCurrentTime:
    """Tests for the time tool."""

    def test_returns_string(self):
        """Time should be returned as a string."""
        result = get_current_time()
        assert isinstance(result, str)

    def test_has_date_format(self):
        """Result should look like a date/time."""
        result = get_current_time()
        assert ":" in result  # Should contain time
        assert "-" in result  # Should contain date

    def test_not_empty(self):
        """Result should not be empty."""
        result = get_current_time()
        assert len(result) > 0
```

```python
# ─── tests/test_memory.py ───────────────────────────

"""Unit tests for conversation memory."""

import pytest
from agent.memory import ConversationMemory


class TestConversationMemory:
    """Tests for the memory system."""

    def test_add_message(self, memory):
        """Adding a message should increase count."""
        memory.add("user", "Hello")
        assert memory.count_messages() == 1

    def test_add_multiple_messages(self, memory):
        """Adding multiple messages should increase count."""
        memory.add("user", "Hello")
        memory.add("assistant", "Hi there!")
        memory.add("user", "What's the weather?")
        assert memory.count_messages() == 3

    def test_max_messages_enforced(self, memory):
        """Memory should not exceed max_messages."""
        memory.max_messages = 3
        memory.add("user", "A")
        memory.add("assistant", "B")
        memory.add("user", "C")
        memory.add("assistant", "D")  # This should evict "A"
        assert memory.count_messages() == 3
        assert memory.messages[0]["content"] == "B"  # A was evicted

    def test_clear(self, memory):
        """Clearing memory should remove all messages."""
        memory.add("user", "Hello")
        memory.add("assistant", "Hi")
        memory.clear()
        assert memory.count_messages() == 0

    def test_get_recent(self, memory):
        """get_recent should return the last N messages."""
        for i in range(10):
            memory.add("user", f"Message {i}")
        recent = memory.get_recent(3)
        assert len(recent) == 3
        assert recent[-1]["content"] == "Message 9"

    def test_get_all(self, memory):
        """get_all should return all messages."""
        memory.add("user", "A")
        memory.add("assistant", "B")
        all_msgs = memory.get_all()
        assert len(all_msgs) == 2

    def test_count_tokens(self, memory):
        """Token count should be approximate."""
        memory.add("user", "Hello world, this is a test message!")
        count = memory.count_tokens()
        assert count > 0
        assert isinstance(count, int)

    def test_empty_memory(self, memory):
        """Empty memory should return 0 count."""
        assert memory.count_messages() == 0
        assert memory.get_all() == []
```

```python
# ─── tests/test_parser.py ───────────────────────────

"""Unit tests for the output parser."""

import pytest
from agent.parser import OutputParser


class TestOutputParser:
    """Tests for the output parser."""

    def test_parse_valid_tool_call(self, parser):
        """Valid JSON tool call should parse correctly."""
        text = 'I need to calculate. {"tool": "calculate", "args": {"expression": "2+2"}}'
        result = parser.parse_tool_call(text)
        assert result is not None
        assert result["name"] == "calculate"
        assert result["args"]["expression"] == "2+2"

    def test_parse_no_tool_call(self, parser):
        """Text with no tool call should return None."""
        text = "The capital of France is Paris."
        result = parser.parse_tool_call(text)
        assert result is None

    def test_has_tool_call_true(self, parser):
        """Should detect tool call presence."""
        text = 'Use tool: {"tool": "search", "args": {"query": "weather"}}'
        assert parser.has_tool_call(text) is True

    def test_has_tool_call_false(self, parser):
        """Should return False when no tool call."""
        text = "I'll answer directly."
        assert parser.has_tool_call(text) is False

    def test_extract_final_answer(self, parser):
        """Final answer should have tool calls removed."""
        text = '{"tool": "calculate", "args": {}} The answer is 42.'
        cleaned = parser.extract_final_answer(text)
        assert "The answer is 42" in cleaned
        assert "tool" not in cleaned

    def test_parse_malformed_json(self, parser):
        """Malformed JSON should return None gracefully."""
        text = '{"tool": "calculate", "args": {"broken": }'
        result = parser.parse_tool_call(text)
        assert result is None

    def test_multiple_tool_calls(self, parser):
        """Only the first tool call should be parsed."""
        text = 'First: {"tool": "a", "args": {}} Second: {"tool": "b", "args": {}}'
        result = parser.parse_tool_call(text)
        assert result["name"] == "a"
```

### Step 4: Write Integration Tests

Integration tests check that the full agent loop works correctly.

```python
# ─── tests/test_agent.py ────────────────────────────

"""Integration tests for the full agent."""

import pytest
from agent.core import Agent
from agent.tools import calculate, get_current_time, search_web


class TestAgentIntegration:
    """Tests that exercise the full agent loop."""

    def test_agent_answers_directly(self, agent):
        """Agent should answer when no tool is needed."""
        result = agent.run("Hello, how are you?")
        assert isinstance(result, str)
        assert len(result) > 0
        assert agent.steps_taken == 1

    def test_agent_uses_calculator(self, agent):
        """Agent should use calculator for math."""
        result = agent.run("What is 2+2?")
        assert isinstance(result, str)
        # The simulated agent returns the tool result directly
        assert "4" in result or agent.steps_taken >= 1

    def test_agent_uses_search(self, agent):
        """Agent should use search for lookup queries."""
        result = agent.run("What is Python?")
        assert isinstance(result, str)
        assert len(result) > 0

    def test_agent_handles_unknown_tool(self, agent):
        """Agent should handle requested tools that don't exist."""
        # Make a request that triggers a non-existent tool call
        result = agent.run("Do something with unknown_tool")
        assert isinstance(result, str)
        # Should not crash

    def test_agent_respects_max_steps(self, agent):
        """Agent should stop after max_steps."""
        # Set very low max steps
        result = agent.run("Search and calculate and do many things", max_steps=2)
        assert isinstance(result, str)
        assert agent.steps_taken <= 2

    def test_agent_maintains_memory(self, agent):
        """Agent should remember previous messages."""
        agent.run("Hello")
        agent.run("What did I just say?")
        assert agent.memory.count_messages() >= 2
        # Memory should contain the conversation
        all_msgs = agent.memory.get_all()
        roles = [m["role"] for m in all_msgs]
        assert "user" in roles
        assert "assistant" in roles
```

### Step 5: Edge Case Tests

The most important tests — what happens with weird inputs.

```python
# ─── tests/test_edge_cases.py ───────────────────────

"""Tests for edge cases and error handling."""

import pytest
from agent.core import Agent
from agent.tools import calculate
from agent.memory import ConversationMemory


class TestEdgeCases:
    """Edge cases that your agent must handle gracefully."""

    def test_empty_input(self):
        """Empty input should not crash the agent."""
        agent = Agent(tools={"calculate": calculate})
        result = agent.run("")
        assert isinstance(result, str)
        # Even empty input should produce some response

    def test_very_long_input(self):
        """Very long input should be handled."""
        agent = Agent()
        long_text = "hello " * 1000  # 5000 chars
        result = agent.run(long_text)
        assert isinstance(result, str)

    def test_special_characters(self):
        """Special characters should not break the agent."""
        agent = Agent()
        result = agent.run("!@#$%^&*()_+{}|:<>?~`")
        assert isinstance(result, str)

    def test_unicode_input(self):
        """Unicode and emoji should work."""
        agent = Agent()
        result = agent.run("Hello 世界! 🌍 How are you? 😊")
        assert isinstance(result, str)

    def test_sql_injection_attempt(self):
        """SQL-like injection should not crash the agent."""
        agent = Agent()
        result = agent.run("'; DROP TABLE users; --")
        assert isinstance(result, str)
        # Should not crash or execute the injection

    def test_very_short_input(self):
        """Single character input."""
        agent = Agent()
        result = agent.run("a")
        assert isinstance(result, str)

    def test_numeric_input(self):
        """Just a number."""
        agent = Agent()
        result = agent.run("42")
        assert isinstance(result, str)

    def test_repeated_same_input(self):
        """Sending the same input repeatedly should not cause issues."""
        agent = Agent()
        for _ in range(5):
            result = agent.run("What is the weather?")
            assert isinstance(result, str)

    def test_memory_overflow_prevention(self):
        """Memory should not grow unbounded with many requests."""
        memory = ConversationMemory(max_messages=5)
        agent = Agent(memory=memory)
        
        for i in range(20):
            agent.run(f"Message {i}")
        
        # Memory should be bounded
        assert memory.count_messages() <= 5
    
    def test_tool_returns_error(self):
        """Agent should handle tools that return errors."""
        # Create a tool that always fails
        def broken_tool(**kwargs):
            raise RuntimeError("Something went wrong!")
        
        agent = Agent(tools={"broken": broken_tool})
        
        # The agent might not call broken_tool since it's simulated,
        # but this tests that having an error-prone tool doesn't crash the agent
        result = agent.run("Hello")
        assert isinstance(result, str)
```

### Step 6: Mocking the LLM

When you want to test without making real (or simulated) LLM calls, you can mock the agent's thinking process.

```python
# ─── tests/test_with_mocks.py ───────────────────────

"""Tests using mocking to control agent behavior."""

import pytest
from unittest.mock import Mock, patch


# We'll test concepts here — in real usage, use pytest-mock

class TestMockedAgent:
    """Tests that mock the agent's decision making."""

    def test_mock_tool_call_decision(self):
        """Mock the LLM to always call a specific tool."""
        from agent.core import Agent
        
        # Create an agent
        agent = Agent(tools={"calculate": lambda expression: "42"})
        
        # Monkey-patch the thinking method
        original_think = agent._simulate_thinking
        
        def mock_think(user_input, context):
            return {
                "type": "tool_call",
                "tool": "calculate",
                "args": {"expression": "6*7"},
            }
        
        agent._simulate_thinking = mock_think
        
        # Now the agent will always use calculate
        result = agent.run("What is 6 times 7?")
        assert "42" in result

    def test_mock_answer_decision(self):
        """Mock the LLM to always answer directly."""
        from agent.core import Agent
        
        agent = Agent()
        
        def mock_think(user_input, context):
            return {
                "type": "answer",
                "content": "This is a mocked response.",
            }
        
        agent._simulate_thinking = mock_think
        
        result = agent.run("Anything")
        assert result == "This is a mocked response."

    def test_mock_empty_result(self):
        """Mock returning empty content."""
        from agent.core import Agent
        
        agent = Agent()
        
        def mock_think(user_input, context):
            return {"type": "answer", "content": ""}
        
        agent._simulate_thinking = mock_think
        
        result = agent.run("Test")
        assert result == ""  # Empty but not crashing

    def test_verify_tool_called_with_correct_args(self):
        """Verify the tool was called with expected arguments."""
        from agent.core import Agent
        
        mock_tool = Mock(return_value="success")
        agent = Agent(tools={"mock_tool": mock_tool})
        
        def mock_think(user_input, context):
            return {
                "type": "tool_call",
                "tool": "mock_tool",
                "args": {"key": "value"},
            }
        
        agent._simulate_thinking = mock_think
        agent.run("test")
        
        mock_tool.assert_called_once_with(key="value")
```

### Step 7: Running the Tests

```bash
# Install test dependencies
pip install pytest pytest-mock pytest-cov

# Run all tests
python -m pytest

# Run with verbose output
python -m pytest -v

# Run specific test file
python -m pytest tests/test_tools.py -v

# Run tests matching a pattern
python -m pytest -k "test_empty" -v

# Run with coverage report
python -m pytest --cov=agent --cov-report=term-missing

# Run slow tests (marked with @pytest.mark.slow)
python -m pytest -m slow

# Run everything except slow tests
python -m pytest -m "not slow"
```

---

## 🔍 How It Works

### Unit Tests vs Integration Tests

| Aspect | Unit Test | Integration Test |
|---|---|---|
| **What** | A single function or class | The full agent loop |
| **Speed** | Milliseconds | Milliseconds to seconds |
| **LLM needed?** | No | No (we simulate) |
| **What it catches** | Logic errors, wrong return types, edge cases | Wrong tool choices, loop issues, memory problems |
| **Example** | `calculate("2+2")` returns `"4"` | `agent.run("What is 2+2?")` returns a valid answer |

### Why Mocking Matters

When you test with real LLM calls:
- Each test costs money ($0.001–$0.01 per call)
- Tests are slow (1-5 seconds per call)
- Results are non-deterministic (the LLM might answer differently each time)
- You need internet access

When you mock the LLM:
- Tests are free
- Tests are fast (milliseconds)
- Results are predictable
- No internet needed

**Strategy**: Write most tests with mocked/simulated LLMs. Add a small number of integration tests with real LLMs for confidence.

### The Test Flow

```
test_tools.py          test_memory.py       test_agent.py
    │                       │                    │
    ▼                       ▼                    ▼
calculate("2+2") → "4"  memory.add("user",   agent.run("Hello")
                         "Hello")              │
calculate("1/0") →      memory.count → 1      └─ _simulate_thinking()
"Error: Division..."                            └─ returns answer
                         │
calculate("") →         memory.clear()        agent.run("2+2")
"Error:..."             memory.count → 0        │
                                                └─ _simulate_thinking()
                                                  └─ calls calculate()
                                                  └─ returns "4"
```

---

## 🧪 Exercises

### Exercise 1: Write Tests for a New Tool

Add a `reverse_text` tool that reverses a string. Then write tests for it:

```python
def reverse_text(text: str) -> str:
    return text[::-1]
```

Test cases:
- `reverse_text("hello")` → `"olleh"`
- `reverse_text("")` → `""`
- `reverse_text("a")` → `"a"`
- `reverse_text("12345")` → `"54321"`

### Exercise 2: Test Memory with Maximum Capacity

Write a test that:
1. Creates a memory with `max_messages=3`
2. Adds 10 messages
3. Asserts only the last 3 are retained
4. Asserts the first message is gone

### Exercise 3: Test the Agent with Concurrent Users

Create a test that simulates two users talking to the same agent simultaneously. Verify that their conversations don't get mixed up.

(Hint: Each user should have their own memory instance.)

### Exercise 4: Add a Test Coverage Target

Configure pytest-cov to require 80% coverage. Run the tests and see which lines are untested. Write tests to cover the missing lines.

```bash
python -m pytest --cov=agent --cov-fail-under=80
```

### Exercise 5: Property-Based Testing

Use the `hypothesis` library to test the calculator with random inputs:

```python
from hypothesis import given, strategies as st

@given(st.floats(allow_nan=False, allow_infinity=False))
def test_calculate_with_random_floats(x):
    result = calculate(f"{x}+{x}")
    assert float(result) == x * 2
```

### Challenge: Build a Test Harness for Real LLM Tests

Create a test harness that runs integration tests against a real LLM but with a budget cap. It should:

1. Set a maximum of 10 LLM calls per test session
2. Track total tokens used and stop if exceeding 100K tokens
3. Save all LLM responses for debugging
4. Report estimated cost per test

---

## 📝 Summary

### Key Concepts

| Concept | What It Means |
|---|---|
| **Unit Test** | Tests one small piece of code in isolation |
| **Integration Test** | Tests the full agent loop end to end |
| **Edge Case** | Unusual input that might break the agent |
| **Fixture** | A reusable test setup (fresh memory, configured agent) |
| **Mock** | Replacing a real component (LLM) with a controlled fake |
| **Coverage** | Percentage of code that is tested |
| **Deterministic Test** | A test that always gives the same result |
| **Non-deterministic** | Real LLM responses vary — hard to test precisely |

### Testing Strategy

```
Write component code
    │
    ▼
Write unit tests for each function
    │
    ▼
Write integration tests for the agent loop
    │
    ▼
Write edge case tests for weird inputs
    │
    ▼
Mock the LLM for reliable, fast tests
    │
    ▼
Run tests: pytest --cov --verbose
    │
    ▼
Fix issues → Repeat
```

### The Key Insight

> **LLMs are unpredictable. Your agent code should be predictable. Tests catch the unpredictability before it reaches your users. The more you test, the more confident you can be that your agent behaves correctly.**

### What's Next?

In **[Chapter 14: Configuration & Environment](./14-configuration.md)**, you'll learn how to manage settings across different environments — development, staging, and production. You'll build a configuration system using YAML files and environment variables.

---

*"If you don't test it, it doesn't work." — Anonymous developer*
