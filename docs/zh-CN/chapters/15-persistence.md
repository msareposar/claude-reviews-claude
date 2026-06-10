# 15. 持久化存储

> **断电不怕，重启不丢。让智能体拥有真正的持久记忆。**

---

## 🎯 目标
- 用 SQLite 存储对话历史
- 存储用户偏好和设置
- 实现数据导出和备份

## 🔧 代码

```python
import sqlite3, json
from datetime import datetime

class Persistence:
    def __init__(self, db="agent_data.db"):
        self.conn = sqlite3.connect(db)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT,
                role TEXT,
                content TEXT,
                timestamp TEXT
            )
        """)
        self.conn.execute("""
            CREATE TABLE IF NOT EXISTS user_data (
                key TEXT PRIMARY KEY,
                value TEXT
            )
        """)
        self.conn.commit()

    def save_message(self, session_id: str, role: str, content: str):
        self.conn.execute(
            "INSERT INTO conversations (session_id, role, content, timestamp) VALUES (?, ?, ?, ?)",
            (session_id, role, content, datetime.now().isoformat())
        )
        self.conn.commit()

    def get_conversation(self, session_id: str, limit: int = 50):
        c = self.conn.execute(
            "SELECT role, content FROM conversations WHERE session_id = ? ORDER BY id DESC LIMIT ?",
            (session_id, limit)
        )
        return list(reversed(c.fetchall()))

    def save_user_data(self, key: str, value: str):
        self.conn.execute(
            "INSERT OR REPLACE INTO user_data (key, value) VALUES (?, ?)", (key, value)
        )
        self.conn.commit()

    def get_user_data(self, key: str) -> str:
        c = self.conn.execute("SELECT value FROM user_data WHERE key = ?", (key,))
        row = c.fetchone()
        return row[0] if row else None
```

## 🧪 练习
1. 实现对话导出为 JSON/Markdown
2. 添加数据过期策略（自动删除旧记录）
3. 支持加密存储敏感数据

下一章：部署上线。
