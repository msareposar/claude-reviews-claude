# 07. 长期记忆系统

> **如何让智能体跨对话记住信息？就像人类的大脑——有些东西永远不会忘。**

---

## 🎯 目标
- 理解短期记忆和长期记忆的区别
- 用 JSON/SQLite 构建持久化存储
- 用向量嵌入实现语义搜索
- 让智能体自动提取和存储重要信息

## 🔧 代码

### JSON 记忆存储
```python
import json, os
class JSONMemory:
    def __init__(self, path="memory.json"):
        self.path = path
        self.data = json.load(open(path)) if os.path.exists(path) else []

    def add(self, fact, category="general"):
        self.data.append({"fact": fact, "category": category})
        json.dump(self.data, open(self.path, "w"), ensure_ascii=False, indent=2)

    def search(self, keyword):
        return [m for m in self.data if keyword.lower() in m["fact"].lower()]

    def get_category(self, cat):
        return [m for m in self.data if m["category"] == cat]
```

### SQLite 记忆
```python
import sqlite3
class SQLiteMemory:
    def __init__(self, db="agent.db"):
        self.conn = sqlite3.connect(db)
        self.conn.execute("CREATE TABLE IF NOT EXISTS memories (id INTEGER PRIMARY KEY AUTOINCREMENT, fact TEXT, category TEXT)")

    def add(self, fact, category="general"):
        self.conn.execute("INSERT INTO memories (fact, category) VALUES (?, ?)", (fact, category))
        self.conn.commit()

    def search(self, keyword):
        cursor = self.conn.execute("SELECT fact FROM memories WHERE fact LIKE ?", (f"%{keyword}%",))
        return [row[0] for row in cursor.fetchall()]
```

### 智能体集成
```python
class AgentWithLongMemory:
    def __init__(self):
        self.memory = SQLiteMemory()

    def run(self, user_input):
        # 从记忆中提取相关信息
        relevant = self.memory.search(user_input)
        context = "## 我记得的内容\n" + "\n".join(f"- {f}" for f in relevant) if relevant else ""

        # 构建提示词
        system = f"你是一个有记忆的助手。\n{context}\n如果用户说了新信息，记住它。"
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user_input}],
        )
        reply = response.choices[0].message.content

        # 提取事实并存储
        self._extract_and_store(user_input, reply)
        return reply

    def _extract_and_store(self, user_input, reply):
        facts_prompt = f"从这段对话中提取用户个人事实（名字、偏好等）。如果没有则返回空列表。\n用户：{user_input}\n助手：{reply}"
        r = openai.chat.completions.create(model="gpt-4o-mini", messages=[{"role": "user", "content": facts_prompt}])
        try:
            facts = json.loads(r.choices[0].message.content)
            for f in facts:
                self.memory.add(f, "user_info")
        except:
            pass
```

## 🧪 练习
1. 添加"记住这个"和"忘记这个"命令
2. 向量化存储实现语义搜索（用 sentence-transformers）
3. 让智能体给记忆打分（重要性），只回忆高价值记忆

下一章：错误处理与韧性。
