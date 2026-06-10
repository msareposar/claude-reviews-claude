# 06. Context & Working Memory

> **In this chapter: What is context window? How does your agent remember what just happened? You'll build a context manager that tracks conversation history and trims it intelligently.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand what a "context window" is and why it matters
- Know how conversation history works in LLM APIs
- Build a sliding window that keeps only recent messages
- Implement token counting and smart truncation
- Build a summary-based compression system

---

## 📖 Explain Like I'm 10

### Your Agent's Short-Term Memory

Imagine you're talking to a friend at a party. Your friend can remember what you said in the last few minutes — that's their **working memory**.

But if the conversation goes on for hours, they start forgetting the early parts. Same with your agent.

The **context window** is like your agent's desk. It can only fit so many papers on it at once. When too many papers pile up, it has to put some away (forget them) or summarize them into a single note.

### The Problem

```
[User]  → What's the weather in Tokyo?
[Agent] → Let me check... It's 22°C and sunny.
[User]  → What about Osaka?
[Agent] → (Remembers you asked about Japan) 25°C and rainy.
[User]  → Book a hotel in Tokyo for next week.
[Agent] → (Still remembers you were asking about Japan weather) → OK!
... 50 more messages ...
[User]  → What was the first thing I asked?
[Agent] → 😅 I... I don't remember
```

Your agent needs to **manage its own memory** so it doesn't forget important things.

---

## 🔧 Hands-On: Building a Context Manager

### Step 1: The Messages Structure

LLM APIs use a list of messages:

```python
messages = [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "What's the weather in Tokyo?"},
    {"role": "assistant", "content": "It's 22°C and sunny."},
]
```

Each message has a **role** (system, user, assistant) and **content**.

### Step 2: Token Counting

Different models have different context limits:

| Model | Max Context | Suggested Max Output |
|---|---|---|
| GPT-4o-mini | 128,000 tokens | 16,384 tokens |
| GPT-4o | 128,000 tokens | 16,384 tokens |
| Claude 3.5 Sonnet | 200,000 tokens | 8,192 tokens |
| Claude 4 Sonnet | 200,000 tokens | 8,192 tokens |

A rough rule: **1 token ≈ 0.75 words** in English.

Let's count tokens without needing a full tokenizer:

```python
import tiktoken  # OpenAI's tokenizer

def count_tokens(text: str, model: str = "gpt-4o-mini") -> int:
    """Count the number of tokens in a text string."""
    try:
        encoder = tiktoken.encoding_for_model(model)
    except KeyError:
        encoder = tiktoken.get_encoding("cl100k_base")
    return len(encoder.encode(text))

def count_messages_tokens(messages: list, model: str = "gpt-4o-mini") -> int:
    """Count total tokens in a message list."""
    total = 0
    for msg in messages:
        total += count_tokens(msg["content"], model)
        total += 4  # overhead per message
    total += 2  # overhead for the whole request
    return total
```

> **Install tiktoken**: `pip install tiktoken`

### Step 3: Sliding Window Context Manager

The simplest strategy: keep the **system prompt** + the **last N messages**.

```python
class SlidingWindowContext:
    """Keep only the most recent messages within token budget."""

    def __init__(self, system_prompt: str, max_tokens: int = 8000, model: str = "gpt-4o-mini"):
        self.system_prompt = {"role": "system", "content": system_prompt}
        self.messages = []
        self.max_tokens = max_tokens
        self.model = model

    def add_message(self, role: str, content: str):
        """Add a message and trim if needed."""
        self.messages.append({"role": role, "content": content})
        self._trim()

    def _trim(self):
        """Remove oldest messages until within budget."""
        while True:
            all_msgs = [self.system_prompt] + self.messages
            total = count_messages_tokens(all_msgs, self.model)
            if total <= self.max_tokens or len(self.messages) <= 1:
                break
            # Remove the oldest user+assistant pair
            self.messages.pop(0)  # Remove oldest message
            # If it was a user message, also remove the corresponding assistant response
            if self.messages and self.messages[0]["role"] == "assistant":
                self.messages.pop(0)

    def get_messages(self) -> list:
        """Get the full message list for API call."""
        return [self.system_prompt] + self.messages

    def get_stats(self) -> dict:
        """Show memory usage statistics."""
        all_msgs = [self.system_prompt] + self.messages
        return {
            "total_messages": len(all_msgs),
            "total_tokens": count_messages_tokens(all_msgs, self.model),
            "max_tokens": self.max_tokens,
            "usage_percent": round(
                count_messages_tokens(all_msgs, self.model) / self.max_tokens * 100, 1
            ),
        }
```

### Step 4: Using It With Your Agent

```python
import openai

def agent_with_memory(user_input: str, context: SlidingWindowContext) -> str:
    """An agent that remembers the conversation."""
    # Add user message
    context.add_message("user", user_input)

    # Get messages within budget
    messages = context.get_messages()

    # Call the LLM
    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
    )

    reply = response.choices[0].message.content
    context.add_message("assistant", reply)
    return reply

# Let's try it!
context = SlidingWindowContext(
    system_prompt="You are a helpful agent. Be concise.",
    max_tokens=4000,
)

print(agent_with_memory("Hi! My name is Alice.", context))
print(context.get_stats())

print(agent_with_memory("What's my name?", context))
# Should remember: Alice!

print(agent_with_memory("Tell me a joke.", context))
print(context.get_stats())
```

### Step 5: Summary-Based Compression

When the conversation gets long, instead of just dropping old messages, we can **summarize** them:

```python
class SummaryCompressionContext:
    """Summarize old messages instead of discarding them."""

    def __init__(self, system_prompt: str, llm_func, max_tokens: int = 8000,
                 summarize_threshold: float = 0.7, model: str = "gpt-4o-mini"):
        self.system_prompt = {"role": "system", "content": system_prompt}
        self.recent_messages = []
        self.summary = "No previous conversation."
        self.max_tokens = max_tokens
        self.summarize_threshold = summarize_threshold
        self.model = model
        self.llm_func = llm_func  # A function that calls the LLM
        self.conversation_turns = 0

    def add_message(self, role: str, content: str):
        self.recent_messages.append({"role": role, "content": content})
        self.conversation_turns += 1
        self._maybe_summarize()

    def _maybe_summarize(self):
        """If we're over budget, summarize everything except the last 2 turns."""
        all_msgs = [self.system_prompt]
        if self.summary:
            all_msgs.append({"role": "system", "content": f"Previous summary: {self.summary}"})
        all_msgs += self.recent_messages

        total = count_messages_tokens(all_msgs, self.model)
        # Keep last 4 messages (2 turns) safe
        keep_count = 4
        while total > self.max_tokens * self.summarize_threshold and len(self.recent_messages) > keep_count:
            # Take the oldest messages to summarize
            old_msgs = self.recent_messages[:-keep_count]
            self.recent_messages = self.recent_messages[-keep_count:]

            # Summarize them
            text_to_summarize = "\n".join(
                f"{m['role']}: {m['content']}" for m in old_msgs
            )
            summary_prompt = (
                f"Summarize this conversation concisely, keeping key facts, names, "
                f"preferences, and task states:\n\n{text_to_summarize}"
            )
            self.summary = self.llm_func(summary_prompt)

            # Recalculate
            all_msgs = [self.system_prompt]
            if self.summary:
                all_msgs.append({"role": "system", "content": f"Previous summary: {self.summary}"})
            all_msgs += self.recent_messages
            total = count_messages_tokens(all_msgs, self.model)

    def get_messages(self) -> list:
        msgs = [self.system_prompt]
        if self.summary and self.summary != "No previous conversation.":
            msgs.append({"role": "system", "content": f"Conversation summary so far: {self.summary}"})
        msgs += self.recent_messages
        return msgs
```

### Step 6: Putting It All Together

```python
# A complete working agent with context management
import openai

class SmartAgent:
    def __init__(self, system_prompt: str = "You are a helpful agent.", max_tokens: int = 8000):
        self.context = SlidingWindowContext(system_prompt, max_tokens)

    def run(self, user_input: str) -> str:
        self.context.add_message("user", user_input)
        messages = self.context.get_messages()

        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
        )

        reply = response.choices[0].message.content
        self.context.add_message("assistant", reply)
        return reply

    def memory_usage(self):
        return self.context.get_stats()

# Demo
agent = SmartAgent(
    system_prompt="You're a friendly assistant. Remember user preferences.",
    max_tokens=2000,
)

print("=== Agent with Memory ===")
print(agent.run("Hi! I'm Bob and I love science fiction books."))
print(f"Memory: {agent.memory_usage()}")
print()
print(agent.run("What genre do I like?"))
print(f"Memory: {agent.memory_usage()}")
```

---

## 🔍 How It Works

### Token Counting

Different models use different tokenizers:
- **OpenAI**: uses `cl100k_base` (GPT-4, GPT-4o) or `r50k_base` (GPT-3)
- **Anthropic**: Claude uses its own tokenizer
- **General rule**: English text ≈ 1 token per 0.75 words

The context window includes **both input and output tokens**. If your limit is 8,000 tokens and you send 6,000 tokens of messages, the model can only generate 2,000 tokens of response.

### Sliding Window vs Summary Compression

| Strategy | Pros | Cons |
|---|---|---|
| Sliding Window | Simple, fast, lossless for recent messages | Loses old information completely |
| Summary Compression | Retains key information from entire conversation | Slower, may lose details, extra LLM cost |

### Pro Tip: Hybrid Approach

Use a **sliding window** for short conversations and **summary compression** for long ones:

```python
class HybridContext:
    def __init__(self, system_prompt, model="gpt-4o-mini"):
        self.inner = SlidingWindowContext(system_prompt, max_tokens=16000, model=model)
        self.inner.max_tokens = 16000  # Use sliding window for most
        
    # ... uses sliding window until ~60% full, then switches to compression
```

---

## 🧪 Exercises

1. **Try different window sizes**: Change `max_tokens` to 500, 2000, 16000. How does the agent's behavior change?

2. **Track token usage**: Add logging that prints token count and window size after every message.

3. **Build priority memory**: Instead of just keeping recent messages, keep messages where the user said something important (has "remember", "my name is", "I like").

4. **Compare strategies**: Build both context managers, run the same long conversation through both, and see which one retains more useful information.

5. **Add a "reminder" feature**: Let the user say "remember this: ..." and keep that fact permanently in the system prompt.

---

## 📝 Summary

- **Context window** is your agent's desk — it can only fit so much
- **Tokens** are how LLMs measure text length (~0.75 words per token)
- **Sliding window** keeps the most recent messages within budget
- **Summary compression** condenses old messages to save space
- A good memory system is essential for useful agents

> **Next up: Chapter 07 — Long-Term Memory. We'll teach your agent to remember things across different conversations!**
