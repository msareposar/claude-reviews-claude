# 07. Long-Term Memory

> **In this chapter: How does your agent remember things across conversations? You'll build a memory system that stores facts, recalls them later, and never forgets what you taught it.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand the difference between short-term and long-term memory
- Build a file-based memory store that persists between conversations
- Implement memory recall — finding relevant information when needed
- Use vector embeddings for semantic memory search
- Build a complete agent that remembers user preferences across sessions

---

## 📖 Explain Like I'm 10

### Two Kinds of Memory

You have two kinds of memory:

1. **Working memory** — What you're thinking about right now (~7 items)
2. **Long-term memory** — Everything you know (your name, your address, how to ride a bike)

Your agent is the same:

- **Working memory (context window)** — What's in the current conversation
- **Long-term memory (storage)** — Facts, preferences, past conversations

> **Context = short-term memory. Storage = long-term memory.**

### The Problem

Without long-term memory, every conversation starts from scratch:

```
Session 1:
User: Hi, I'm Alice. I love Italian food.
Agent: Nice to meet you, Alice!

Session 2 (next day):
User: Suggest a restaurant.
Agent: What kind of food do you like? 🤷
```

That's frustrating. Let's fix it.

---

## 🔧 Hands-On: Building Long-Term Memory

### Step 1: Simple JSON Memory Store

The simplest way to store memory: a JSON file.

```python
import json
import os
from datetime import datetime

class JSONMemory:
    """Simple long-term memory using a JSON file."""

    def __init__(self, filepath: str = "agent_memory.json"):
        self.filepath = filepath
        self.memories = self._load()

    def _load(self) -> list:
        if os.path.exists(self.filepath):
            with open(self.filepath, "r") as f:
                return json.load(f)
        return []

    def _save(self):
        with open(self.filepath, "w") as f:
            json.dump(self.memories, f, indent=2, ensure_ascii=False)

    def add(self, fact: str, category: str = "general", source: str = ""):
        """Store a new memory."""
        memory = {
            "fact": fact,
            "category": category,
            "source": source,
            "timestamp": datetime.now().isoformat(),
            "id": len(self.memories) + 1,
        }
        self.memories.append(memory)
        self._save()
        return memory

    def get_all(self, category: str = None) -> list:
        """Get all memories, optionally filtered by category."""
        if category:
            return [m for m in self.memories if m["category"] == category]
        return self.memories

    def search(self, keyword: str) -> list:
        """Find memories containing a keyword."""
        keyword = keyword.lower()
        return [
            m for m in self.memories
            if keyword in m["fact"].lower()
        ]

    def delete(self, memory_id: int) -> bool:
        """Delete a memory by ID."""
        before = len(self.memories)
        self.memories = [m for m in self.memories if m["id"] != memory_id]
        self._save()
        return len(self.memories) < before

    def clear(self):
        """Wipe all memories."""
        self.memories = []
        self._save()
```

### Step 2: Using Memory With Your Agent

```python
import openai

class AgentWithMemory:
    def __init__(self, memory_file: str = "agent_memory.json"):
        self.memory = JSONMemory(memory_file)

    def extract_and_store(self, user_input: str, assistant_reply: str):
        """Extract important facts from the conversation and store them."""
        extract_prompt = f"""
        From this conversation, extract any personal facts about the user.
        Examples: their name, preferences, things they own, people they know.
        Return ONLY a JSON array of strings, nothing else.
        If no facts found, return empty array [].

        User: {user_input}
        Assistant: {assistant_reply}
        """

        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": extract_prompt}],
            temperature=0,
        )

        try:
            import json
            facts = json.loads(response.choices[0].message.content)
            for fact in facts:
                self.memory.add(fact, category="user_info", source="conversation")
        except (json.JSONDecodeError, Exception):
            pass  # No facts extracted

    def build_memory_context(self) -> str:
        """Build a context string from stored memories."""
        memories = self.memory.get_all("user_info")
        if not memories:
            return "No previous information about the user."

        context = "## Information you know about the user:\n"
        for m in memories[-20:]:  # Most recent 20 facts
            context += f"- {m['fact']}\n"
        return context

    def run(self, user_input: str) -> str:
        # Get memory context
        memory_context = self.build_memory_context()

        system_prompt = f"""You are a helpful assistant with memory.
Here is what you know about the user:

{memory_context}

Use this information to personalize your responses.
If the user says something new about themselves, remember it."""

        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_input},
            ],
        )

        reply = response.choices[0].message.content
        self.extract_and_store(user_input, reply)
        return reply

# Demo
agent = AgentWithMemory("test_memory.json")

print("=== Session 1 ===")
print(agent.run("Hi! I'm Alice and I love Italian food."))
print()

print("=== Session 2 (new conversation) ===")
agent2 = AgentWithMemory("test_memory.json")
print(agent2.run("Suggest a restaurant for dinner."))
print()

# Clean up test file
import os
if os.path.exists("test_memory.json"):
    os.remove("test_memory.json")
```

### Step 3: SQLite Memory for Better Queries

JSON is simple but slow with lots of memories. Let's use SQLite:

```python
import sqlite3

class SQLiteMemory:
    """Long-term memory using SQLite for better queries."""

    def __init__(self, db_path: str = "agent_memory.db"):
        self.conn = sqlite3.connect(db_path)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fact TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                source TEXT DEFAULT '',
                timestamp TEXT DEFAULT (datetime('now')),
                importance INTEGER DEFAULT 1
            )
        """)
        self.conn.commit()

    def add(self, fact: str, category: str = "general",
            source: str = "", importance: int = 1):
        self.conn.execute(
            "INSERT INTO memories (fact, category, source, importance) VALUES (?, ?, ?, ?)",
            (fact, category, source, importance)
        )
        self.conn.commit()

    def recall(self, query: str, limit: int = 5) -> list:
        """Simple keyword recall."""
        cursor = self.conn.execute(
            """SELECT fact, category, importance, timestamp FROM memories
               WHERE fact LIKE ?
               ORDER BY importance DESC, timestamp DESC LIMIT ?""",
            (f"%{query}%", limit)
        )
        return [{"fact": row[0], "category": row[1],
                  "importance": row[2], "timestamp": row[3]}
                for row in cursor.fetchall()]

    def get_recent(self, limit: int = 10) -> list:
        cursor = self.conn.execute(
            "SELECT fact, category, timestamp FROM memories ORDER BY timestamp DESC LIMIT ?",
            (limit,)
        )
        return [{"fact": row[0], "category": row[1], "timestamp": row[2]}
                for row in cursor.fetchall()]

    def get_by_category(self, category: str) -> list:
        cursor = self.conn.execute(
            "SELECT fact, timestamp, importance FROM memories WHERE category = ? ORDER BY importance DESC",
            (category,)
        )
        return [{"fact": row[0], "timestamp": row[1], "importance": row[2]}
                for row in cursor.fetchall()]
```

### Step 4: Semantic Memory with Embeddings

Keyword search is limited. If you stored "I love Italian food" and search "pasta", keyword search won't find it.

**Vector embeddings** solve this. They convert text to a list of numbers (a "vector") where similar texts have similar vectors.

```python
# First, install: pip install sentence-transformers
from sentence_transformers import SentenceTransformer
import numpy as np

class VectorMemory:
    """Memory with semantic search using embeddings."""

    def __init__(self, db_path: str = "agent_memory.db", model_name: str = "all-MiniLM-L6-v2"):
        # Use a lightweight embedding model
        self.encoder = SentenceTransformer(model_name)
        self.conn = sqlite3.connect(db_path)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS vector_memories (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                fact TEXT NOT NULL,
                category TEXT DEFAULT 'general',
                embedding BLOB,
                timestamp TEXT DEFAULT (datetime('now'))
            )
        """)
        self.conn.commit()

    def add(self, fact: str, category: str = "general"):
        """Store fact with its vector embedding."""
        embedding = self.encoder.encode(fact).astype(np.float32).tobytes()
        self.conn.execute(
            "INSERT INTO vector_memories (fact, category, embedding) VALUES (?, ?, ?)",
            (fact, category, embedding)
        )
        self.conn.commit()

    def search(self, query: str, top_k: int = 5) -> list:
        """Find most semantically similar memories."""
        query_vec = self.encoder.encode(query).astype(np.float32)

        cursor = self.conn.execute(
            "SELECT id, fact, category, embedding FROM vector_memories"
        )

        results = []
        for row in cursor.fetchall():
            mem_id, fact, category, emb_bytes = row
            stored_vec = np.frombuffer(emb_bytes, dtype=np.float32)
            # Cosine similarity
            similarity = np.dot(query_vec, stored_vec) / (
                np.linalg.norm(query_vec) * np.linalg.norm(stored_vec)
            )
            results.append((similarity, fact, category, mem_id))

        results.sort(reverse=True)
        return [
            {"fact": fact, "category": cat, "score": round(float(score), 3)}
            for score, fact, cat, _ in results[:top_k]
        ]
```

### Step 5: The Complete Memory Agent

```python
import openai

class CompleteAgent:
    """Agent with both short-term and long-term memory."""

    def __init__(self, memory_db: str = "agent_memory.db"):
        self.short_term = []  # Current conversation
        self.long_term = SQLiteMemory(memory_db)

    def _build_context(self) -> str:
        """Build system prompt with relevant long-term memories."""
        context = "## User Information:\n"

        # Get all important memories about the user
        user_info = self.long_term.get_by_category("user_preference")
        user_info += self.long_term.get_by_category("user_fact")

        if user_info:
            for item in user_info:
                context += f"- {item['fact']}\n"
        else:
            context += "- No stored information yet.\n"

        return context

    def _store_important_facts(self, user_input: str):
        """Store facts from user input if they seem important."""
        # Simple rule-based extraction
        patterns = {
            "user_fact": ["my name is", "i am", "i work", "i live"],
            "user_preference": ["i like", "i love", "i prefer", "i hate",
                                "my favorite", "i enjoy", "i don't like"],
        }
        text_lower = user_input.lower()

        for category, keywords in patterns.items():
            for keyword in keywords:
                if keyword in text_lower:
                    self.long_term.add(
                        fact=user_input,
                        category=category,
                        source="user_stated",
                        importance=3,
                    )
                    break  # One match per category is enough

    def run(self, user_input: str) -> str:
        # Store important facts
        self._store_important_facts(user_input)

        # Build context with memories
        memory_context = self._build_context()

        # Build conversation
        system_prompt = f"""You are a helpful agent with memory.
{memory_context}
Personalize your responses based on what you know."""

        messages = [{"role": "system", "content": system_prompt}]
        messages += self.short_term[-10:]  # Last 10 exchanges
        messages.append({"role": "user", "content": user_input})

        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
        )

        reply = response.choices[0].message.content

        # Update short-term memory
        self.short_term.append({"role": "user", "content": user_input})
        self.short_term.append({"role": "assistant", "content": reply})

        return reply

# Demo
agent = CompleteAgent()

print("=== Session 1 ===")
print(agent.run("Hi! My name is Bob and I love science fiction books."))
print(agent.run("What books do you recommend?"))
print()

print("=== Session 2: Agent remembers Bob ===")
agent2 = CompleteAgent("agent_memory.db")
print(agent2.run("What do you know about me?"))
```

---

## 🔍 How It Works

### Memory Pipeline

```
User says: "I like spicy food"
         │
         ▼
┌─────────────────┐
│ Extract facts   │ ← Rule-based or LLM-based extraction
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Store + Embed   │ ← Save to SQLite, compute vector
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Recall on query │ ← Find relevant memories
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│ Inject into     │ ← Add to system prompt
│ system prompt   │
└─────────────────┘
```

### Storage Options Comparison

| Storage | Pros | Cons | Best For |
|---|---|---|---|
| JSON file | Simple, readable | Slow with 1000+ items | Prototyping, small projects |
| SQLite | Fast, queries, ACID | Setup overhead | Production single-user |
| Vector DB (Chroma, Pinecone) | Semantic search | Extra dependency | Large-scale apps |

---

## 🧪 Exercises

1. **Build a "remember this" feature**: Let users explicitly say "remember that my favorite color is blue" and store it immediately.

2. **Forget mechanism**: Add a `forget()` function that deletes memories by keyword or category.

3. **Memory importance**: Add an importance score and let the agent decide what's worth remembering.

4. **Cross-session chat**: Run two different Python sessions, save memory in one, load in the other.

5. **Memory consolidation**: Build a function that deduplicates similar memories and merges them.

---

## 📝 Summary

- **Long-term memory** persists across conversations
- **JSON** is great for prototyping, **SQLite** for production
- **Vector embeddings** enable semantic search (find by meaning, not just keywords)
- Extract facts from conversations automatically
- Inject relevant memories into the system prompt

> **Next up: Chapter 08 — Error Handling & Resilience. What happens when your agent breaks?**
