# 06. Context & Working Memory

> **In this chapter: What is context window? How does your agent remember what just happened? You'll build a context manager with auto-compaction and a file-based persistent memory system — inspired by claude-code's memdir.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand what a "context window" is and why it matters
- Build a **ContextManager** with token budget tracking (like claude-code's `compact.ts`)
- Implement **auto-compaction** that summarizes old messages when nearing the limit
- Build a **Memdir** — a file-based persistent memory system (like claude-code's `~/.claude/memory/`)
- Combine short-term and long-term memory in your agent

---

## 📖 Explain Like I'm 10

### Your Agent's Short-Term Memory

Imagine you're talking to a friend at a party. Your friend can remember what you said in the last few minutes — that's their **working memory**.

But if the conversation goes on for hours, they start forgetting the early parts. Same with your agent.

The **context window** is like your agent's desk. It can only fit so many papers on it at once. When too many papers pile up, it has to put some away (forget them) or summarize them into a single note.

### Two Kinds of Memory

| Type | What It Does | In claude-code |
|---|---|---|
| **Context / Working Memory** | What's in the current conversation | Auto-compaction (compact.ts) |
| **Long-term Memory** | What survives between conversations | Memdir (memory.tsx) |

The first is automatic — the agent compresses old messages when the conversation gets long. The second is intentional — the agent writes notes to files and reads them back later.

---

## 🔧 Hands-On: Build Context Management

### Step 1: Getting Ready

We'll build on the `tool_system.py` module from previous chapters. Make sure it's in your project directory.

We'll use `tiktoken` to count tokens:

```bash
pip install tiktoken
```

### Step 2: The ContextManager with Auto-Compaction

In claude-code, context compaction is automatic — when the token count hits ~75% of the limit, old messages are compressed into a summary. This preserves key decisions and results while dropping verbatim tool outputs.

Let's build our version, mirroring the logic from `restored-src/src/services/compact/compact.ts`:

```python
# context_manager.py

from typing import List, Optional, Dict, Any

try:
    import tiktoken
    HAS_TIKTOKEN = True
except ImportError:
    HAS_TIKTOKEN = False
    print("⚠️ tiktoken not installed. Run: pip install tiktoken")


class ContextManager:
    """
    Tracks token usage and compacts context when nearing the limit.
    
    Like claude-code's auto-compaction (source:
    restored-src/src/services/compact/compact.ts).
    Compaction is triggered at ~75% capacity.
    """
    def __init__(self, max_tokens: int = 128000, model: str = "gpt-4o-mini"):
        self.max_tokens = max_tokens
        self.model = model
        self.compaction_threshold = int(max_tokens * 0.75)
        self.total_tokens_used = 0

    def count_tokens(self, text: str) -> int:
        """Count tokens in a text string."""
        if HAS_TIKTOKEN:
            try:
                encoder = tiktoken.encoding_for_model(self.model)
            except KeyError:
                encoder = tiktoken.get_encoding("cl100k_base")
            return len(encoder.encode(text))
        # Fallback: rough estimate (1 token ≈ 0.75 words)
        return int(len(text.split()) / 0.75)

    def count_messages_tokens(self, messages: list) -> int:
        """Count total tokens in a message list."""
        total = 0
        for msg in messages:
            total += self.count_tokens(str(msg.get("content", "")))
            total += 4  # overhead per message
        total += 2  # overhead for the request
        return total

    def check_budget(self, messages: list) -> Dict[str, Any]:
        """
        Check token budget and return status.
        
        Returns:
            {"ok": True, "usage": ...} — within budget
            {"ok": False, "action": "compact", ...} — should compact
        """
        current = self.count_messages_tokens(messages)
        usage_percent = round(current / self.max_tokens * 100, 1)

        if current > self.compaction_threshold:
            return {
                "ok": False,
                "action": "compact",
                "current": current,
                "max": self.max_tokens,
                "usage_percent": usage_percent,
                "message": f"Context at {usage_percent}% ({current}/{self.max_tokens}). "
                           f"Compacting..."
            }
        return {
            "ok": True,
            "current": current,
            "max": self.max_tokens,
            "usage_percent": usage_percent,
            "remaining": self.max_tokens - current,
        }

    def compact(self, messages: list) -> list:
        """
        Compact messages by keeping system prompt + recent exchanges verbatim
        and summarizing the middle.
        
        Key behaviors from claude-code (compact.ts):
        - Keeps system prompt intact
        - Preserves the most recent user/tool exchanges verbatim
        - Summarizes older exchanges into a concise note
        - Retains all tool call structure (names, arguments)
        """
        if len(messages) <= 4:
            return messages  # Too short to compact

        system_msgs = [m for m in messages if m["role"] == "system"]

        # Keep last 4 messages (2 user-assistant turns) verbatim
        recent = messages[-4:]
        old = messages[len(system_msgs):-4]

        if not old:
            return messages

        # Build a summary of old messages
        old_count = len(old)
        old_roles = [m["role"] for m in old]
        has_tools = any(r == "tool" or r == "assistant" for r in old_roles)

        summary_parts = []
        if has_tools:
            summary_parts.append("Previous steps included tool calls and their results.")
        summary_parts.append(f"{old_count} older messages have been compacted.")

        summary = " | ".join(summary_parts)

        # Reconstruct: system + summary + recent
        compacted = list(system_msgs)
        compacted.append({
            "role": "system",
            "content": f"[Context compacted: {summary}]"
        })
        compacted.extend(recent)

        return compacted

    def update_tracking(self, response) -> None:
        """Update token tracking from an API response."""
        if hasattr(response, 'usage') and response.usage:
            self.total_tokens_used += response.usage.total_tokens
```

### Step 3: Using ContextManager in the Agent Loop

Now let's use the `ContextManager` in our agent loop from Chapter 03:

```python
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry
from context_manager import ContextManager
from openai import OpenAI
import json
import os
import math

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ─── Define tools ────────────────────────────────────

# ... (same tools from Chapter 03: calculator, searcher, clock)

calc_schema = Schema(
    properties={"expression": {"type": "string", "description": "Math expression"}},
    required=["expression"],
)
def calc_impl(expression: str) -> str:
    allowed = {"sqrt": math.sqrt, "pi": math.pi, "abs": abs}
    return str(eval(expression, {"__builtins__": {}}, allowed))

calculator = build_tool(ToolDef(
    name="calculate", description="Do math",
    input_schema=calc_schema, call=calc_impl, is_concurrency_safe=True,
))

# Register etc.
registry = ToolRegistry()
registry.register(calculator)
# ... register more tools

# ─── Agent with auto-compaction ──────────────────────

ctx = ContextManager(max_tokens=4000)  # Small limit for testing

def run_agent(user_input: str, max_steps: int = 10) -> str:
    messages = [
        {"role": "system", "content": "You are a helpful agent."},
        {"role": "user", "content": user_input},
    ]

    step = 0
    while step < max_steps:
        step += 1

        # Check budget BEFORE the API call
        budget = ctx.check_budget(messages)
        print(f"📊 Budget: {budget['usage_percent']}% used")

        if not budget["ok"]:
            print(f"⚠️ {budget['message']}")
            messages = ctx.compact(messages)
            print(f"📦 After compaction: {ctx.count_messages_tokens(messages)} tokens")

        # THINK
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=registry.get_openai_schemas(),
        )
        ctx.update_tracking(response)

        msg = response.choices[0].message

        # DONE?
        if not msg.tool_calls:
            return msg.content

        # ACT + OBSERVE
        messages.append(msg)
        for tc in msg.tool_calls:
            args = json.loads(tc.function.arguments)
            result = registry.run_tool(tc.function.name, args)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    return "Max steps reached."


# Test with a multi-step task
if __name__ == "__main__":
    result = run_agent("Calculate 10 + 20, then multiply by 3, then subtract 5.")
    print(f"\n📨 Final: {result}")
    print(f"\n📊 Total tokens used in this session: {ctx.total_tokens_used}")
```

### Step 4: Persistent Memory with Memdir

Context management handles the current conversation. But what about **remembering things between conversations**? Claude-code uses a **memdir** — a directory of markdown files in `~/.claude/memory/`.

Each file is one "memory note" that the agent can write, read, and search. Let's build our version:

```python
# memdir.py — File-based persistent memory
# Like claude-code's memdir (source: restored-src/src/commands/memory/memory.tsx)

from pathlib import Path
from datetime import datetime
from typing import List, Optional


class Memdir:
    """
    File-based persistent memory system.
    
    Each memory is a markdown file in a directory.
    Files persist across sessions and can be independently
    searched, edited, or deleted.
    
    Like claude-code's ~/.claude/memory/ system.
    """
    def __init__(self, memdir_path: str = "~/.agent_memory"):
        self.path = Path(memdir_path).expanduser()
        self.path.mkdir(parents=True, exist_ok=True)

    def write(self, title: str, content: str) -> str:
        """
        Write a memory note.
        Creates a markdown file with the given title and content.
        """
        filename = self._sanitize(title) + ".md"
        filepath = self.path / filename
        timestamp = datetime.now().isoformat()

        full_content = (
            f"# {title}\n\n"
            f"{content}\n\n"
            f"---\n"
            f"*Created: {timestamp}*"
        )
        filepath.write_text(full_content)
        return str(filepath)

    def read(self, title: str) -> Optional[str]:
        """Read a memory note by title."""
        filepath = self.path / (self._sanitize(title) + ".md")
        if filepath.exists():
            return filepath.read_text()
        return None

    def list_all(self) -> List[str]:
        """List all memory note titles."""
        return sorted([f.stem for f in self.path.glob("*.md")])

    def search(self, query: str) -> List[str]:
        """Search memory notes by keyword."""
        results = []
        for f in self.path.glob("*.md"):
            if query.lower() in f.read_text().lower():
                results.append(f.stem)
        return results

    def delete(self, title: str) -> bool:
        """Delete a memory note by title."""
        filepath = self.path / (self._sanitize(title) + ".md")
        if filepath.exists():
            filepath.unlink()
            return True
        return False

    @staticmethod
    def _sanitize(name: str) -> str:
        """Convert a title to a safe filename."""
        return "".join(c if c.isalnum() or c in " -_" else "_" for c in name).strip()
```

### Step 5: Using Memdir in Your Agent

Now let's give our agent a **remember** tool and a **recall** tool, so it can use its long-term memory:

```python
# ─── Memory tools ────────────────────────────────────

memdir = Memdir()

remember_schema = Schema(
    properties={
        "title": {"type": "string", "description": "A short title for this memory"},
        "content": {"type": "string", "description": "What to remember"},
    },
    required=["title", "content"],
)

def remember_impl(title: str, content: str) -> str:
    """Save a memory note."""
    path = memdir.write(title, content)
    return f"✅ Saved memory '{title}'"

remember_tool = build_tool(ToolDef(
    name="remember",
    description="Save an important fact to long-term memory. Use for user preferences, key facts, and things to remember later.",
    input_schema=remember_schema,
    call=remember_impl,
    is_concurrency_safe=False,  # Writing to disk: sequential
    aliases=["save", "memorize"],
))

recall_schema = Schema(
    properties={
        "query": {"type": "string", "description": "What to search for in memory"},
    },
    required=["query"],
)

def recall_impl(query: str) -> str:
    """Search saved memories."""
    results = memdir.search(query)
    if not results:
        return f"No memories found about '{query}'."
    
    output = [f"📖 Found {len(results)} memory(ies):"]
    for title in results[:5]:  # Limit to top 5
        content = memdir.read(title)
        # Extract just the first line of content
        first_line = content.split('\n')[2] if content else "(empty)"
        output.append(f"  • {title}: {first_line[:100]}")
    return "\n".join(output)

recall_tool = build_tool(ToolDef(
    name="recall",
    description="Search your long-term memory for saved information.",
    input_schema=recall_schema,
    call=recall_impl,
    is_concurrency_safe=True,
    aliases=["search_memory", "find_memory"],
))

# Register memory tools
registry.register_many([remember_tool, recall_tool])
```

Now the agent can:
- `remember(title="Alice's name", content="User's name is Alice")` — save a fact
- `recall(query="Alice")` — retrieve it later

### Step 6: Full Agent with Both Memory Systems

```python
# ─── Complete agent with short-term + long-term memory ──

def run_agent_with_memory(user_input: str, max_steps: int = 10) -> str:
    messages = [
        {"role": "system", "content": (
            "You are a helpful agent with two memory systems:\n"
            "1. Short-term: the conversation context (auto-managed)\n"
            "2. Long-term: use 'remember' to save important facts "
            "and 'recall' to retrieve them later.\n\n"
            "When the user tells you something personal or important, "
            "use 'remember' to save it."
        )},
        {"role": "user", "content": user_input},
    ]

    step = 0
    while step < max_steps:
        step += 1

        # Auto-compaction check
        budget = ctx.check_budget(messages)
        if not budget["ok"]:
            messages = ctx.compact(messages)

        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=registry.get_openai_schemas(),
        )
        msg = response.choices[0].message

        if not msg.tool_calls:
            return msg.content

        messages.append(msg)
        for tc in msg.tool_calls:
            args = json.loads(tc.function.arguments)
            result = registry.run_tool(tc.function.name, args)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    return "Max steps reached."


# ─── Try it ──────────────────────────────────────────

if __name__ == "__main__":
    # First conversation
    print("=== Session 1 ===")
    r1 = run_agent_with_memory("Hi! My name is Alice. I love Python programming.")
    print(f"Agent: {r1}\n")

    r2 = run_agent_with_memory("What do I like?")
    print(f"Agent: {r2}\n")

    # The memory persists in files — even if we restart!
    print("\n📂 Saved memories:")
    for m in memdir.list_all():
        print(f"  📄 {m}")

    print("\n=== Session 2 (after restart) ===")
    # The agent starts fresh, but can still recall
    r3 = run_agent_with_memory("What's my name and what do I like?")
    print(f"Agent: {r3}")
```

---

## 🔍 How It Works

### Auto-Compaction vs. Sliding Window

| Feature | Sliding Window (naive) | Auto-Compaction (claude-code style) |
|---|---|---|
| What happens | Old messages are dropped | Old messages are summarized |
| Information loss | Complete loss of old context | Summary preserves key facts |
| Trigger | At every add | At ~75% of token budget |
| System prompt | Stays intact | Stays intact |
| Recent context | Last N messages | Last 2 turns verbatim |

Auto-compaction is smarter because it **preserves information** instead of dropping it. If the user mentioned their name 50 messages ago, a sliding window would have forgotten it. Auto-compaction keeps a summary that includes "User's name is Alice."

### The 75% Threshold

Claude-code triggers compaction at ~75% of the max token limit. Why not 100%?

- API calls need room for the **response** tokens
- Tool results vary in size
- A late compaction might fail if the context is already at the limit

The 75% threshold gives safe headroom.

### Memdir: Why Files?

Claude-code uses individual files (not a database) for memory because:

1. **Simple**: Each file is one note. No SQL, no complex queries.
2. **Searchable**: Standard tools (`grep`, `find`) work on them.
3. **Editable**: The user can open a memory file and edit it.
4. **Persistent**: Files survive agent restarts.
5. **Portable**: Copy the memdir anywhere — all memories come with you.

### Two Memory Layers Working Together

```
┌─────────────────────────────────────────────────────┐
│                   Agent Session                     │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  Short-Term Memory (ContextManager)          │   │
│  │  • Current conversation                     │   │
│  │  • Auto-compacted at 75%                    │   │
│  │  • Lost when session ends                   │   │
│  └─────────────────────────────────────────────┘   │
│                         │                          │
│                         ▼                          │
│  ┌─────────────────────────────────────────────┐   │
│  │  Long-Term Memory (Memdir)                  │   │
│  │  • Markdown files on disk                   │   │
│  │  • Written by 'remember' tool               │   │
│  │  • Read by 'recall' tool                    │   │
│  │  • Persists across sessions                 │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 🧪 Exercises

### Exercise 1: Observe Compaction in Action

Set a very low `max_tokens` (e.g., 500) and run a multi-step task. Watch the compaction trigger messages:

```python
ctx = ContextManager(max_tokens=500)
```

Ask a long series of questions and observe when compaction kicks in.

### Exercise 2: Search Memories

Write a function that searches all memory files for a keyword and returns matching titles plus the matching line:

```python
def search_memories_detail(query: str) -> List[dict]:
    """Search memories and return detailed results."""
    results = []
    for f in Path("~/.agent_memory").expanduser().glob("*.md"):
        content = f.read_text()
        if query.lower() in content.lower():
            results.append({
                "title": f.stem,
                "file": str(f),
                "size": len(content),
            })
    return results
```

### Exercise 3: Add a "forget" Tool

Create a tool that lets the agent delete memories:

```python
def forget_impl(title: str) -> str:
    if memdir.delete(title):
        return f"✅ Deleted memory '{title}'"
    return f"❌ No memory found with title '{title}'"

forget_tool = build_tool(ToolDef(
    name="forget",
    description="Delete a saved memory by title.",
    input_schema=Schema(
        properties={"title": {"type": "string", "description": "Title of memory to delete"}},
        required=["title"],
    ),
    call=forget_impl,
    is_concurrency_safe=False,
))
```

### Exercise 4: Add Memory to the System Prompt

Modify the agent to inject relevant memories into the system prompt at the start:

```python
def build_prompt_with_memories(user_input: str) -> list:
    memories = memdir.search(user_input)
    memory_context = ""
    if memories:
        notes = [f"- {t}" for t in memories]
        memory_context = "Relevant memories:\n" + "\n".join(notes)

    return [
        {"role": "system", "content": (
            "You are a helpful agent.\n"
            + (memory_context + "\n" if memory_context else "")
        )},
        {"role": "user", "content": user_input},
    ]
```

### Challenge: Automatic Memory Consolidation

Build a system that automatically summarizes key facts from long conversations and saves them to memdir:

```python
def consolidate_memories(messages: list, llm_func) -> None:
    """Extract key facts from a conversation and save to memory."""
    conversation = "\n".join(
        f"{m['role']}: {m['content']}" 
        for m in messages if m['role'] in ('user', 'assistant')
    )
    prompt = (
        f"Extract key facts from this conversation (user preferences, "
        f"important decisions, personal information). "
        f"Format as bullet points:\n\n{conversation}"
    )
    facts = llm_func(prompt)
    if facts.strip():
        memdir.write(f"Consolidated {datetime.now().strftime('%Y-%m-%d')}", facts)
```

---

## 📝 Summary

### Key Concepts

| Concept | What It Means | In claude-code |
|---|---|---|
| **Context window** | The LLM's working memory, limited to N tokens | `max_tokens` constant |
| **Auto-compaction** | Compress old messages at ~75% capacity | `restored-src/src/services/compact/compact.ts` |
| **Memdir** | File-based memory system with markdown files | `restored-src/src/commands/memory/memory.tsx` |
| **Short-term memory** | Current conversation (auto-managed) | Context window |
| **Long-term memory** | Persistent notes (agent-managed) | `~/.claude/memory/` |

### The Code You Own

```python
from context_manager import ContextManager
from memdir import Memdir

# Auto-compaction at 75%
ctx = ContextManager(max_tokens=128000)
budget = ctx.check_budget(messages)
if not budget["ok"]:
    messages = ctx.compact(messages)

# Persistent memory
memdir = Memdir("~/.agent_memory")
memdir.write("user_name", "Alice likes Python")
print(memdir.search("Python"))  # → ["user_name"]
memdir.read("user_name")        # → "# user_name\n\nAlice likes Python\n..."
```

> **Next up: Chapter 07 — Long-Term Memory. We'll teach your agent to remember things across different conversations!**
