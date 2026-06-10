# 15. Persistence & Storage

> **In this chapter: When your agent restarts, does it forget everything? It shouldn't. You'll build a persistence layer using SQLite that stores conversation history, user data, and agent state. Your agent will remember things even after it's turned off and on again.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand what data your agent needs to persist (and what it doesn't)
- Build a **SQLite-based storage layer** for conversation history
- Store **user data** (preferences, profiles, settings)
- Implement **file storage strategies** for different data sizes
- Learn about **data models** and **schema design**
- Have a complete persistence layer you can use in any agent

---

## 📖 Explain Like I'm 10

### The Problem: Agent Amnesia

Right now, your agent only remembers what's in its current conversation. Close the app and open it again? Gone. All memories erased.

Like Dory from *Finding Nemo* — "Hello. I'm Dory. I suffer from short-term memory loss."

This is fine for simple chatbots. But what if you want:

- **Continuity**: "Remember that research topic I asked about yesterday?"
- **User preferences**: "I always prefer metric units for weather."
- **Learning**: "Last time you gave me a good recipe for pasta."
- **Analytics**: "How many conversations did I have this week?"

For this, you need **persistent storage** — data that survives restarts.

### Types of Data

```
                   How much data?
                   │
    ┌──────────────┼──────────────┐
    ▼              ▼              ▼
Small data     Medium data     Large data
(settings,     (conversation   (files, images,
user prefs)     history)        uploads)
    │              │              │
    ▼              ▼              ▼
Config file     SQLite DB      File system
.env, YAML      Structured     Flat files,
                queries        blob storage
```

### Why SQLite?

SQLite is the perfect database for an agent:

- **No server** — it's just a file on disk
- **Zero setup** — `pip install` not needed, it's in Python's standard library
- **Fast enough** — handles millions of rows
- **Reliable** — used in billions of devices (phones, browsers, cars)
- **Portable** — one file, copy it anywhere

Think of SQLite as a **supercharged Excel file** — structured data with search capabilities, but without needing to install a database server.

---

## 🔧 Hands-On: Build a Persistence Layer

### Step 1: Database Setup

We'll build a `DatabaseManager` that handles connections, tables, and queries.

```python
import sqlite3
import json
import os
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any

# ─── DATABASE MANAGER ───────────────────────────────

class DatabaseManager:
    """
    Manages the SQLite database connection and schema.
    
    Features:
    - Automatic table creation
    - Connection management (open/close)
    - Schema versioning for future upgrades
    - Safe concurrent access (WAL mode)
    """

    def __init__(self, db_path: str = "agent_data.db"):
        self.db_path = db_path
        self.conn: Optional[sqlite3.Connection] = None

    def connect(self):
        """Open a connection to the database."""
        # Ensure the directory exists
        Path(self.db_path).parent.mkdir(parents=True, exist_ok=True)
        
        self.conn = sqlite3.connect(self.db_path)
        self.conn.row_factory = sqlite3.Row  # Access columns by name
        
        # Enable WAL mode for better concurrent access
        self.conn.execute("PRAGMA journal_mode=WAL")
        # Enable foreign keys
        self.conn.execute("PRAGMA foreign_keys=ON")
        
        print(f"📁 Connected to database: {self.db_path}")
        return self.conn

    def disconnect(self):
        """Close the database connection."""
        if self.conn:
            self.conn.close()
            self.conn = None
            print("📁 Disconnected from database")

    def execute(self, query: str, params: tuple = ()) -> sqlite3.Cursor:
        """Execute a query with safety parameters."""
        if not self.conn:
            raise RuntimeError("Database not connected. Call connect() first.")
        return self.conn.execute(query, params)

    def executemany(self, query: str, params_list: list) -> sqlite3.Cursor:
        """Execute a query for many parameter sets."""
        if not self.conn:
            raise RuntimeError("Database not connected. Call connect() first.")
        return self.conn.executemany(query, params_list)

    def commit(self):
        """Commit the current transaction."""
        if self.conn:
            self.conn.commit()

    def create_tables(self):
        """Create all required tables if they don't exist."""
        
        # ── Conversations ──
        self.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id  TEXT NOT NULL,
                user_id     TEXT NOT NULL DEFAULT 'default',
                role        TEXT NOT NULL CHECK(role IN ('system', 'user', 'assistant', 'tool')),
                content     TEXT NOT NULL,
                model       TEXT,
                tokens_in   INTEGER DEFAULT 0,
                tokens_out  INTEGER DEFAULT 0,
                timestamp   TEXT NOT NULL DEFAULT (datetime('now')),
                metadata    TEXT DEFAULT '{}'
            )
        """)

        # ── Users ──
        self.execute("""
            CREATE TABLE IF NOT EXISTS users (
                user_id     TEXT PRIMARY KEY,
                name        TEXT,
                preferences TEXT DEFAULT '{}',
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                last_active TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # ── Agent State ──
        self.execute("""
            CREATE TABLE IF NOT EXISTS agent_state (
                key         TEXT PRIMARY KEY,
                value       TEXT NOT NULL,
                updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
            )
        """)

        # ── Knowledge / Long-term memories ──
        self.execute("""
            CREATE TABLE IF NOT EXISTS knowledge (
                id          INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id     TEXT NOT NULL DEFAULT 'default',
                topic       TEXT NOT NULL,
                content     TEXT NOT NULL,
                source      TEXT DEFAULT 'conversation',
                confidence  REAL DEFAULT 1.0,
                created_at  TEXT NOT NULL DEFAULT (datetime('now')),
                last_accessed TEXT
            )
        """)

        # Create indexes for faster queries
        self.execute("""
            CREATE INDEX IF NOT EXISTS idx_conversations_session 
            ON conversations(session_id)
        """)
        self.execute("""
            CREATE INDEX IF NOT EXISTS idx_conversations_user 
            ON conversations(user_id)
        """)
        self.execute("""
            CREATE INDEX IF NOT EXISTS idx_knowledge_user 
            ON knowledge(user_id)
        """)

        self.commit()
        print("✅ Database tables created")

    def get_db_size(self) -> int:
        """Get the database file size in bytes."""
        try:
            return os.path.getsize(self.db_path)
        except OSError:
            return 0

    def get_stats(self) -> dict:
        """Get database statistics."""
        stats = {"db_path": self.db_path, "db_size_bytes": self.get_db_size()}
        
        try:
            stats["conversations"] = self.execute(
                "SELECT COUNT(*) FROM conversations"
            ).fetchone()[0]
            stats["users"] = self.execute(
                "SELECT COUNT(*) FROM users"
            ).fetchone()[0]
            stats["knowledge"] = self.execute(
                "SELECT COUNT(*) FROM knowledge"
            ).fetchone()[0]
        except Exception:
            pass
        
        return stats

    def __enter__(self):
        self.connect()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.disconnect()
```

### Step 2: Conversation Storage

Store and retrieve conversation history.

```python
# ─── CONVERSATION STORE ─────────────────────────────

class ConversationStore:
    """
    Stores and retrieves conversation messages.
    
    Each conversation has a session_id. A session is one
    back-and-forth interaction between user and agent.
    """

    def __init__(self, db: DatabaseManager):
        self.db = db

    def add_message(self, session_id: str, role: str, content: str,
                    user_id: str = "default", model: str = None,
                    tokens_in: int = 0, tokens_out: int = 0,
                    metadata: dict = None):
        """Add a message to the conversation history."""
        self.db.execute(
            """INSERT INTO conversations 
               (session_id, user_id, role, content, model, tokens_in, tokens_out, metadata)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session_id,
                user_id,
                role,
                content,
                model,
                tokens_in,
                tokens_out,
                json.dumps(metadata or {}),
            ),
        )
        self.db.commit()

    def get_session_messages(self, session_id: str) -> list:
        """Get all messages in a session, oldest first."""
        cursor = self.db.execute(
            """SELECT role, content, model, timestamp, tokens_in, tokens_out
               FROM conversations
               WHERE session_id = ?
               ORDER BY id ASC""",
            (session_id,),
        )
        return [dict(row) for row in cursor.fetchall()]

    def get_recent_sessions(self, user_id: str = "default", limit: int = 10) -> list:
        """Get the most recent sessions for a user."""
        cursor = self.db.execute(
            """SELECT session_id, MIN(timestamp) as start_time, 
                      MAX(timestamp) as last_time, COUNT(*) as message_count,
                      SUM(tokens_in + tokens_out) as total_tokens
               FROM conversations
               WHERE user_id = ?
               GROUP BY session_id
               ORDER BY last_time DESC
               LIMIT ?""",
            (user_id, limit),
        )
        return [dict(row) for row in cursor.fetchall()]

    def search_conversations(self, query: str, user_id: str = "default", 
                              limit: int = 20) -> list:
        """Search conversation content for a query."""
        cursor = self.db.execute(
            """SELECT session_id, role, content, timestamp
               FROM conversations
               WHERE user_id = ? AND content LIKE ?
               ORDER BY timestamp DESC
               LIMIT ?""",
            (user_id, f"%{query}%", limit),
        )
        return [dict(row) for row in cursor.fetchall()]

    def delete_session(self, session_id: str):
        """Delete all messages in a session."""
        self.db.execute(
            "DELETE FROM conversations WHERE session_id = ?",
            (session_id,),
        )
        self.db.commit()

    def count_user_messages(self, user_id: str = "default") -> int:
        """Count total messages for a user."""
        cursor = self.db.execute(
            "SELECT COUNT(*) FROM conversations WHERE user_id = ?",
            (user_id,),
        )
        return cursor.fetchone()[0]

    def get_token_usage(self, user_id: str = "default") -> dict:
        """Get total token usage for a user."""
        cursor = self.db.execute(
            """SELECT SUM(tokens_in) as total_in, 
                      SUM(tokens_out) as total_out,
                      SUM(tokens_in + tokens_out) as total
               FROM conversations
               WHERE user_id = ?""",
            (user_id,),
        )
        row = cursor.fetchone()
        return {
            "tokens_in": row[0] or 0,
            "tokens_out": row[1] or 0,
            "total": row[2] or 0,
        }

    def export_session_to_json(self, session_id: str) -> str:
        """Export a session as a JSON string (useful for debugging)."""
        messages = self.get_session_messages(session_id)
        return json.dumps({"session_id": session_id, "messages": messages}, indent=2)
```

### Step 3: User Data Storage

Store user preferences and profiles.

```python
# ─── USER STORE ──────────────────────────────────────

class UserStore:
    """
    Stores user data: preferences, profiles, settings.
    
    Each user has:
    - user_id (unique identifier)
    - name (optional display name)
    - preferences (JSON dict — model, temperature, units, etc.)
    """

    def __init__(self, db: DatabaseManager):
        self.db = db

    def create_user(self, user_id: str, name: str = None, 
                     preferences: dict = None) -> dict:
        """Create a new user."""
        try:
            self.db.execute(
                """INSERT INTO users (user_id, name, preferences)
                   VALUES (?, ?, ?)""",
                (user_id, name or user_id, json.dumps(preferences or {})),
            )
            self.db.commit()
            return {"status": "created", "user_id": user_id}
        except sqlite3.IntegrityError:
            return {"status": "exists", "user_id": user_id}

    def get_user(self, user_id: str) -> Optional[dict]:
        """Get user by ID."""
        cursor = self.db.execute(
            "SELECT * FROM users WHERE user_id = ?",
            (user_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None
        
        user = dict(row)
        user["preferences"] = json.loads(user.get("preferences", "{}"))
        return user

    def get_or_create_user(self, user_id: str, name: str = None) -> dict:
        """Get existing user or create if not found."""
        user = self.get_user(user_id)
        if user:
            return user
        self.create_user(user_id, name)
        return self.get_user(user_id)

    def update_preferences(self, user_id: str, preferences: dict):
        """Update user preferences (merge with existing)."""
        user = self.get_user(user_id)
        if not user:
            raise ValueError(f"User not found: {user_id}")
        
        # Deep merge preferences
        existing = user["preferences"]
        existing.update(preferences)
        
        self.db.execute(
            """UPDATE users 
               SET preferences = ?, last_active = datetime('now')
               WHERE user_id = ?""",
            (json.dumps(existing), user_id),
        )
        self.db.commit()

    def update_last_active(self, user_id: str):
        """Update the last_active timestamp."""
        self.db.execute(
            "UPDATE users SET last_active = datetime('now') WHERE user_id = ?",
            (user_id,),
        )
        self.db.commit()

    def get_preference(self, user_id: str, key: str, default: Any = None) -> Any:
        """Get a specific preference for a user."""
        user = self.get_user(user_id)
        if not user:
            return default
        return user["preferences"].get(key, default)

    def list_users(self, limit: int = 100) -> list:
        """List all users."""
        cursor = self.db.execute(
            "SELECT user_id, name, created_at, last_active FROM users ORDER BY last_active DESC LIMIT ?",
            (limit,),
        )
        return [dict(row) for row in cursor.fetchall()]

    def delete_user(self, user_id: str):
        """Delete a user and all their data."""
        self.db.execute("DELETE FROM users WHERE user_id = ?", (user_id,))
        self.db.execute("DELETE FROM conversations WHERE user_id = ?", (user_id,))
        self.db.execute("DELETE FROM knowledge WHERE user_id = ?", (user_id,))
        self.db.commit()
```

### Step 4: Agent State Persistence

Store the agent's persistent state — things it should remember across sessions.

```python
# ─── AGENT STATE STORE ───────────────────────────────

class AgentStateStore:
    """
    Stores agent-level state that persists across restarts.
    
    Examples:
    - Total conversations served
    - Last model used
    - Feature flags
    - Version info
    - Maintenance mode flag
    """

    def __init__(self, db: DatabaseManager):
        self.db = db

    def set(self, key: str, value: Any):
        """Set a state value (serializes to JSON)."""
        serialized = json.dumps(value)
        self.db.execute(
            """INSERT INTO agent_state (key, value, updated_at)
               VALUES (?, ?, datetime('now'))
               ON CONFLICT(key) DO UPDATE SET 
                   value = excluded.value,
                   updated_at = datetime('now')""",
            (key, serialized),
        )
        self.db.commit()

    def get(self, key: str, default: Any = None) -> Any:
        """Get a state value (deserializes from JSON)."""
        cursor = self.db.execute(
            "SELECT value FROM agent_state WHERE key = ?",
            (key,),
        )
        row = cursor.fetchone()
        if not row:
            return default
        try:
            return json.loads(row[0])
        except (json.JSONDecodeError, TypeError):
            return row[0]

    def delete(self, key: str):
        """Delete a state value."""
        self.db.execute("DELETE FROM agent_state WHERE key = ?", (key,))
        self.db.commit()

    def get_all(self) -> dict:
        """Get all state values as a dict."""
        cursor = self.db.execute("SELECT key, value FROM agent_state")
        result = {}
        for row in cursor.fetchall():
            try:
                result[row["key"]] = json.loads(row["value"])
            except (json.JSONDecodeError, TypeError):
                result[row["key"]] = row["value"]
        return result

    def increment(self, key: str, amount: int = 1) -> int:
        """Atomically increment a counter and return the new value."""
        current = self.get(key, 0)
        new_value = current + amount
        self.set(key, new_value)
        return new_value
```

### Step 5: Knowledge / Long-Term Memory

Store facts and knowledge the agent learns.

```python
# ─── KNOWLEDGE STORE ─────────────────────────────────

class KnowledgeStore:
    """
    Stores long-term knowledge — facts the agent learns and can recall later.
    
    This is different from conversation history. Knowledge is:
    - Curated (not every message, just important facts)
    - Structured (topic, content, source)
    - Searchable (find by topic or content)
    - Confidence-scored (how sure are we this is correct?)
    """

    def __init__(self, db: DatabaseManager):
        self.db = db

    def add_knowledge(self, user_id: str, topic: str, content: str,
                       source: str = "conversation", confidence: float = 1.0):
        """Store a piece of knowledge."""
        # Check if similar knowledge exists
        existing = self.find_knowledge(user_id, topic)
        if existing:
            # Update existing with higher confidence if applicable
            if confidence > existing[0]["confidence"]:
                self.db.execute(
                    """UPDATE knowledge 
                       SET content = ?, confidence = ?, last_accessed = datetime('now')
                       WHERE id = ?""",
                    (content, confidence, existing[0]["id"]),
                )
        else:
            self.db.execute(
                """INSERT INTO knowledge (user_id, topic, content, source, confidence)
                   VALUES (?, ?, ?, ?, ?)""",
                (user_id, topic, content, source, confidence),
            )
        self.db.commit()

    def find_knowledge(self, user_id: str, topic: str) -> list:
        """Find knowledge by topic (partial match)."""
        cursor = self.db.execute(
            """SELECT * FROM knowledge 
               WHERE user_id = ? AND topic LIKE ?
               ORDER BY confidence DESC, last_accessed DESC""",
            (user_id, f"%{topic}%"),
        )
        return [dict(row) for row in cursor.fetchall()]

    def search_knowledge(self, query: str, user_id: str = "default") -> list:
        """Search all knowledge fields for a query."""
        cursor = self.db.execute(
            """SELECT * FROM knowledge 
               WHERE user_id = ? AND (topic LIKE ? OR content LIKE ?)
               ORDER BY confidence DESC, last_accessed DESC""",
            (user_id, f"%{query}%", f"%{query}%"),
        )
        return [dict(row) for row in cursor.fetchall()]

    def get_recent_knowledge(self, user_id: str = "default", limit: int = 10) -> list:
        """Get the most recently added knowledge."""
        cursor = self.db.execute(
            """SELECT * FROM knowledge 
               WHERE user_id = ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (user_id, limit),
        )
        return [dict(row) for row in cursor.fetchall()]

    def delete_knowledge(self, knowledge_id: int):
        """Delete a piece of knowledge."""
        self.db.execute(
            "DELETE FROM knowledge WHERE id = ?",
            (knowledge_id,),
        )
        self.db.commit()
```

### Step 6: The Complete Persistence Layer

```python
# ─── COMPLETE PERSISTENCE LAYER ──────────────────────

class AgentPersistence:
    """
    Complete persistence layer for an agent.
    
    Combines:
    - ConversationStore (message history)
    - UserStore (user data)
    - AgentStateStore (agent state)
    - KnowledgeStore (long-term memory)
    """

    def __init__(self, db_path: str = "agent_data.db"):
        self.db = DatabaseManager(db_path)
        self.conversations = ConversationStore(self.db)
        self.users = UserStore(self.db)
        self.agent_state = AgentStateStore(self.db)
        self.knowledge = KnowledgeStore(self.db)

    def initialize(self):
        """Connect to DB and create all tables."""
        self.db.connect()
        self.db.create_tables()
        return self

    def close(self):
        """Close the database connection."""
        self.db.disconnect()

    def get_full_stats(self) -> dict:
        """Get comprehensive statistics about all stored data."""
        return {
            "database": self.db.get_stats(),
            "conversations": {
                "total_messages": self.conversations.count_user_messages(),
            },
            "users": {
                "total": len(self.users.list_users()),
            },
        }

    def cleanup_old_data(self, days: int = 30):
        """Delete conversation data older than specified days."""
        import time
        cutoff = (datetime.now().timestamp() - days * 86400) * 1000  # approximate
        # SQLite datetime comparison
        self.db.execute(
            """DELETE FROM conversations 
               WHERE timestamp < datetime('now', ?)""",
            (f"-{days} days",),
        )
        deleted = self.db.conn.total_changes if self.db.conn else 0
        self.db.commit()
        return deleted

    def __enter__(self):
        self.initialize()
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()


# ─── DEMO ─────────────────────────────────────────────

if __name__ == "__main__":
    import tempfile

    print("💾 Persistence Layer Demo")
    print("=" * 60)

    # Use a temporary database for the demo
    with tempfile.TemporaryDirectory() as tmp_dir:
        db_path = os.path.join(tmp_dir, "agent_demo.db")

        # Initialize persistence
        persistence = AgentPersistence(db_path)
        persistence.initialize()

        # ── Store conversations ──
        print("\n📝 Storing conversations...")
        store = persistence.conversations
        store.add_message("session_1", "user", "What's the weather in Paris?")
        store.add_message("session_1", "assistant", "It's 22°C and sunny in Paris!", 
                         model="gpt-4o-mini", tokens_in=15, tokens_out=12)
        store.add_message("session_1", "user", "What about London?")
        store.add_message("session_1", "assistant", "15°C and cloudy in London.",
                         model="gpt-4o-mini", tokens_in=10, tokens_out=10)

        # ── Retrieve conversations ──
        messages = store.get_session_messages("session_1")
        print(f"  Session messages: {len(messages)}")
        for msg in messages:
            print(f"    [{msg['role']}] {msg['content'][:50]}...")

        # ── Token usage ──
        usage = store.get_token_usage()
        print(f"\n  Token usage: {usage}")

        # ── Store user data ──
        print("\n👤 Storing user data...")
        user_store = persistence.users
        user_store.create_user("alice", "Alice Johnson", 
                              {"temperature": 0.5, "units": "metric"})
        user_store.create_user("bob", "Bob Smith",
                              {"temperature": 0.3, "units": "imperial"})

        alice = user_store.get_user("alice")
        print(f"  User: {alice['name']}")
        print(f"  Preferences: {alice['preferences']}")

        # Update preferences
        user_store.update_preferences("alice", {"theme": "dark"})
        alice = user_store.get_user("alice")
        print(f"  Updated prefs: {alice['preferences']}")

        # ── Store agent state ──
        print("\n⚙️ Storing agent state...")
        state = persistence.agent_state
        state.set("total_conversations", 42)
        state.set("last_model", "gpt-4o-mini")
        state.set("version", "1.2.0")
        state.set("feature_flags", {"image_gen": True, "web_search": True})
        state.increment("total_conversations")

        print(f"  Total conversations: {state.get('total_conversations')}")
        print(f"  Last model: {state.get('last_model')}")
        print(f"  Feature flags: {state.get('feature_flags')}")
        print(f"  All state: {state.get_all()}")

        # ── Store knowledge ──
        print("\n🧠 Storing knowledge...")
        knowledge = persistence.knowledge
        knowledge.add_knowledge("alice", "favorite_food", "Alice loves Italian cuisine",
                               source="conversation", confidence=0.8)
        knowledge.add_knowledge("alice", "pet", "Alice has a cat named Whiskers",
                               source="conversation", confidence=0.9)

        results = knowledge.find_knowledge("alice", "pet")
        for r in results:
            print(f"  Found: [{r['topic']}] {r['content']} (confidence: {r['confidence']})")

        # ── Stats ──
        print(f"\n📊 Database stats: {persistence.get_full_stats()}")
        print(f"  DB file size: {persistence.db.get_db_size()} bytes")

        # Cleanup
        persistence.close()
```

---

## 🔍 How It Works

### Database Schema

```
┌─────────────────────────────────────────────────┐
│                    SQLite DB                      │
│                                                   │
│  ┌──────────────┐  ┌──────────┐  ┌────────────┐ │
│  │ conversations │  │  users   │  │ agent_state│ │
│  ├──────────────┤  ├──────────┤  ├────────────┤ │
│  │ id (PK)      │  │ user_id  │  │ key (PK)   │ │
│  │ session_id   │  │ name     │  │ value      │ │
│  │ user_id      │  │ prefs    │  │ updated_at │ │
│  │ role         │  │ created  │  └────────────┘ │
│  │ content      │  │ last_act │                   │
│  │ model        │  └──────────┘                   │
│  │ tokens_in    │  ┌──────────────┐              │
│  │ tokens_out   │  │  knowledge   │              │
│  │ timestamp    │  ├──────────────┤              │
│  │ metadata     │  │ id (PK)      │              │
│  └──────────────┘  │ user_id      │              │
│                     │ topic        │              │
│                     │ content      │              │
│                     │ source       │              │
│                     │ confidence   │              │
│                     │ created_at   │              │
│                     │ last_accessed│              │
│                     └──────────────┘              │
└─────────────────────────────────────────────────┘
```

### Why Separate Tables?

Each table stores a different **type of data**:

| Table | Stores | Example Row |
|---|---|---|
| `conversations` | Individual messages | "user: What's the weather?" |
| `users` | User profiles | alice, prefs={temp: 0.5} |
| `agent_state` | Agent-level key-values | total_calls=42 |
| `knowledge` | Long-term facts | alice loves Italian food |

Separating them means:
- You can query each type independently
- Schema is clear about what goes where
- Performance is better (smaller indexes)
- Backup/cleanup can target specific tables

### Read vs Write Patterns

```
Write path:
  Agent responds → Store message in conversations table
                  → Update user's last_active
                  → Maybe store knowledge
                  → Commit

Read path:
  User asks question → Load recent conversation history
                     → Load user preferences
                     → Load relevant knowledge
                     → Build context → Send to LLM
```

### Query Performance

For small datasets (thousands of messages), SQLite is instant. For larger datasets:

- **Indexes** on `session_id` and `user_id` speed up lookups
- **LIKE queries** are fine for small text; for full-text search, add a FTS5 index
- **WAL mode** allows concurrent reads while writing

```sql
-- Add full-text search for conversations (advanced)
CREATE VIRTUAL TABLE conversations_fts USING fts5(content, session_id);
```

---

## 🧪 Exercises

### Exercise 1: Add Full-Text Search

Implement full-text search on conversation content using SQLite FTS5. This lets users search for past conversations by keyword.

```sql
CREATE VIRTUAL TABLE conversations_fts USING fts5(session_id, content);
```

### Exercise 2: Data Export

Add a method to export all user data to a JSON file (for GDPR compliance or data portability).

```python
def export_user_data(self, user_id: str) -> str:
    """Export all data for a user as JSON."""
    # Conversations + user profile + knowledge
    pass
```

### Exercise 3: Database Migration

Add a schema version number and a migration system. When you add new columns or tables, migration scripts update existing databases.

```python
CURRENT_SCHEMA_VERSION = 2

def migrate(self):
    version = self.agent_state.get("schema_version", 0)
    if version < 1:
        self._migrate_v1()  # Initial schema
    if version < 2:
        self._migrate_v2()  # Add knowledge table
    self.agent_state.set("schema_version", CURRENT_SCHEMA_VERSION)
```

### Exercise 4: Automated Cleanup

Implement an auto-cleanup feature that:
- Deletes conversations older than 90 days
- Archives them to a compressed JSON file before deletion
- Runs automatically every time the agent starts

### Exercise 5: Connection Pooling

For production use with many users, implement a connection pool that reuses database connections efficiently. Use `queue.Queue` to manage connections.

### Challenge: Build a Backup System

Create a backup system that:
1. Copies the SQLite database to a backup location
2. Compresses it with gzip
3. Adds a timestamp to the filename
4. Keeps only the last 7 backups
5. Runs automatically every hour

---

## 📝 Summary

### Key Concepts

| Concept | What It Means |
|---|---|
| **Persistence** | Data that survives restarts (disk storage) |
| **SQLite** | A file-based database — no server needed, built into Python |
| **Schema** | The structure of your database (tables, columns, types) |
| **CRUD** | Create, Read, Update, Delete — the four basic operations |
| **Index** | A data structure that speeds up database queries |
| **Migration** | Safely updating the database schema when code changes |
| **WAL Mode** | Write-Ahead Logging — better concurrency for SQLite |

### Data Flow

```
User says: "Remember I like Italian food"
    │
    ▼
Agent: "I'll store that in your profile."
    │
    ▼
KnowledgeStore.add_knowledge("alice", "food_preference", "Italian")
    │
    ▼
SQLite: INSERT INTO knowledge ...
    │
    ▼
Disk: agent_data.db (survives restarts)
    │
    ▼
Next session: "What do I like to eat?"
    │
    ▼
KnowledgeStore.find_knowledge("alice", "food")
    │
    ▼
Agent: "You love Italian food!"
```

### The Key Insight

> **An agent that forgets everything when it restarts is a toy. An agent with persistent storage can learn, remember, and improve over time. SQLite gives you a production-grade database with zero infrastructure.**

### What's Next?

In **[Chapter 16: Deployment](./16-deployment.md)**, you'll learn how to take your agent from your laptop to the cloud. You'll build a FastAPI web server, containerize it with Docker, and deploy it for the world to use.

---

*"Memory is the treasure of the mind." — Proverb*
