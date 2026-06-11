# 06. 上下文与工作记忆

> **本章内容：什么是上下文窗口？智能体如何记住刚刚发生的事情？你将构建一个带自动压缩的上下文管理器和一个基于文件的持久化记忆系统 —— 灵感来自 claude-code 的 memdir。**

---

## 🎯 目标

学完本章后，你将能够：

- 理解什么是"上下文窗口"以及它为何重要
- 构建一个带 Token 预算追踪的 **ContextManager**（类似 claude-code 的 `compact.ts`）
- 实现在接近限制时自动压缩旧消息的 **自动压缩** 机制
- 构建一个 **Memdir** —— 基于文件的持久化记忆系统（类似 claude-code 的 `~/.claude/memory/`）
- 在智能体中组合使用短期记忆和长期记忆

---

## 📖 用孩子也能懂的方式解释

### 智能体的短期记忆

想象你和朋友在派对上聊天。你的朋友能记住你最近几分钟说的话 —— 这就是他们的**工作记忆**。

但如果聊天持续数小时，他们就会开始忘记早期的内容。你的智能体也是一样。

**上下文窗口**就像智能体的办公桌。桌上一次只能放那么多文件。当文件堆得太高时，它就得收起一些（遗忘）或者把它们总结成一张便签。

### 两种记忆

| 类型 | 作用 | 在 claude-code 中 |
|---|---|---|
| **上下文 / 工作记忆** | 当前对话内容 | 自动压缩（compact.ts） |
| **长期记忆** | 跨会话持久化 | Memdir（memory.tsx） |

第一种是自动的——当对话变长时，智能体会自动压缩旧消息。第二种是有意的——智能体主动将笔记写入文件，并在之后读取它们。

---

## 🔧 动手实践：构建上下文管理

### 第一步：准备工作

我们将基于之前章节的 `tool_system.py` 模块来构建。请确保它在你的项目目录中。

我们将使用 `tiktoken` 来统计 Token 数量：

```bash
pip install tiktoken
```

### 第二步：带自动压缩的 ContextManager

在 claude-code 中，上下文压缩是自动的——当 Token 数量达到限制的 ~75% 时，旧消息会被压缩成摘要。这样可以保留关键的决策和结果，同时丢弃逐字的工具输出。

我们来构建自己的版本，模拟 `restored-src/src/services/compact/compact.ts` 的逻辑：

```python
# context_manager.py

from typing import List, Optional, Dict, Any

try:
    import tiktoken
    HAS_TIKTOKEN = True
except ImportError:
    HAS_TIKTOKEN = False
    print("⚠️ tiktoken 未安装。运行: pip install tiktoken")


class ContextManager:
    """
    追踪 Token 使用量，在接近限制时压缩上下文。
    
    类似 claude-code 的自动压缩（源码：
    restored-src/src/services/compact/compact.ts）。
    压缩在约 75% 容量时触发。
    """
    def __init__(self, max_tokens: int = 128000, model: str = "gpt-4o-mini"):
        self.max_tokens = max_tokens
        self.model = model
        self.compaction_threshold = int(max_tokens * 0.75)
        self.total_tokens_used = 0

    def count_tokens(self, text: str) -> int:
        """统计文本中的 Token 数量。"""
        if HAS_TIKTOKEN:
            try:
                encoder = tiktoken.encoding_for_model(self.model)
            except KeyError:
                encoder = tiktoken.get_encoding("cl100k_base")
            return len(encoder.encode(text))
        # 备用方案：粗略估算（1 token ≈ 0.75 个单词）
        return int(len(text.split()) / 0.75)

    def count_messages_tokens(self, messages: list) -> int:
        """统计消息列表中的总 Token 数。"""
        total = 0
        for msg in messages:
            total += self.count_tokens(str(msg.get("content", "")))
            total += 4  # 每条消息的开销
        total += 2  # 请求的开销
        return total

    def check_budget(self, messages: list) -> Dict[str, Any]:
        """
        检查 Token 预算并返回状态。
        
        返回：
            {"ok": True, "usage": ...} — 在预算内
            {"ok": False, "action": "compact", ...} — 应进行压缩
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
                "message": f"上下文使用率为 {usage_percent}%（{current}/{self.max_tokens}）。"
                           f"正在压缩..."
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
        压缩消息列表：保留系统提示 + 最近的完整对话，
        将中间部分总结为摘要。
        
        来自 claude-code（compact.ts）的关键行为：
        - 保持系统提示完整
        - 保留最近的用户/工具交互逐字内容
        - 将较早的交互总结为简洁的笔记
        - 保留所有工具调用结构（名称、参数）
        """
        if len(messages) <= 4:
            return messages  # 太短，无需压缩

        system_msgs = [m for m in messages if m["role"] == "system"]

        # 保留最近 4 条消息（2 轮用户-助手的对话）逐字内容
        recent = messages[-4:]
        old = messages[len(system_msgs):-4]

        if not old:
            return messages

        # 构建旧消息的摘要
        old_count = len(old)
        old_roles = [m["role"] for m in old]
        has_tools = any(r == "tool" or r == "assistant" for r in old_roles)

        summary_parts = []
        if has_tools:
            summary_parts.append("之前的步骤包含工具调用及其结果。")
        summary_parts.append(f"已压缩 {old_count} 条旧消息。")

        summary = " | ".join(summary_parts)

        # 重组：系统 + 摘要 + 最近消息
        compacted = list(system_msgs)
        compacted.append({
            "role": "system",
            "content": f"[上下文已压缩: {summary}]"
        })
        compacted.extend(recent)

        return compacted

    def update_tracking(self, response) -> None:
        """从 API 响应中更新 Token 追踪。"""
        if hasattr(response, 'usage') and response.usage:
            self.total_tokens_used += response.usage.total_tokens
```

### 第三步：在智能体循环中使用 ContextManager

现在让我们将 `ContextManager` 应用到第 03 章的智能体循环中：

```python
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry
from context_manager import ContextManager
from openai import OpenAI
import json
import os
import math

client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

# ─── 定义工具 ────────────────────────────────────

# ...（与第 03 章相同的工具：calculator, searcher, clock）

calc_schema = Schema(
    properties={"expression": {"type": "string", "description": "数学表达式"}},
    required=["expression"],
)
def calc_impl(expression: str) -> str:
    allowed = {"sqrt": math.sqrt, "pi": math.pi, "abs": abs}
    return str(eval(expression, {"__builtins__": {}}, allowed))

calculator = build_tool(ToolDef(
    name="calculate", description="做数学运算",
    input_schema=calc_schema, call=calc_impl, is_concurrency_safe=True,
))

# 注册等操作
registry = ToolRegistry()
registry.register(calculator)
# ... 注册更多工具

# ─── 带自动压缩的智能体 ──────────────────────

ctx = ContextManager(max_tokens=4000)  # 小限制用于测试

def run_agent(user_input: str, max_steps: int = 10) -> str:
    messages = [
        {"role": "system", "content": "你是一个有用的智能体。"},
        {"role": "user", "content": user_input},
    ]

    step = 0
    while step < max_steps:
        step += 1

        # 在 API 调用前检查预算
        budget = ctx.check_budget(messages)
        print(f"📊 预算：使用率 {budget['usage_percent']}%")

        if not budget["ok"]:
            print(f"⚠️ {budget['message']}")
            messages = ctx.compact(messages)
            print(f"📦 压缩后：{ctx.count_messages_tokens(messages)} tokens")

        # 思考
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=registry.get_openai_schemas(),
        )
        ctx.update_tracking(response)

        msg = response.choices[0].message

        # 完成？
        if not msg.tool_calls:
            return msg.content

        # 行动 + 观察
        messages.append(msg)
        for tc in msg.tool_calls:
            args = json.loads(tc.function.arguments)
            result = registry.run_tool(tc.function.name, args)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    return "达到最大步数。"


# 用多步任务测试
if __name__ == "__main__":
    result = run_agent("计算 10 + 20，然后乘以 3，再减去 5。")
    print(f"\n📨 最终结果：{result}")
    print(f"\n📊 本次会话总共使用的 Token 数：{ctx.total_tokens_used}")
```

### 第四步：用 Memdir 实现持久化记忆

上下文管理处理当前的对话。但**跨对话记住信息**呢？Claude-code 使用 **memdir** —— 一个存放在 `~/.claude/memory/` 中的 markdown 文件目录。

每个文件是一条"记忆笔记"，智能体可以写入、读取和搜索。我们来构建自己的版本：

```python
# memdir.py —— 基于文件的持久化记忆
# 类似 claude-code 的 memdir（源码：restored-src/src/commands/memory/memory.tsx）

from pathlib import Path
from datetime import datetime
from typing import List, Optional


class Memdir:
    """
    基于文件的持久化记忆系统。
    
    每条记忆是一个 markdown 文件，存放在一个目录中。
    文件跨会话持久化，可以独立搜索、编辑或删除。
    
    类似 claude-code 的 ~/.claude/memory/ 系统。
    """
    def __init__(self, memdir_path: str = "~/.agent_memory"):
        self.path = Path(memdir_path).expanduser()
        self.path.mkdir(parents=True, exist_ok=True)

    def write(self, title: str, content: str) -> str:
        """
        写入一条记忆笔记。
        用给定的标题和内容创建一个 markdown 文件。
        """
        filename = self._sanitize(title) + ".md"
        filepath = self.path / filename
        timestamp = datetime.now().isoformat()

        full_content = (
            f"# {title}\n\n"
            f"{content}\n\n"
            f"---\n"
            f"*创建时间：{timestamp}*"
        )
        filepath.write_text(full_content)
        return str(filepath)

    def read(self, title: str) -> Optional[str]:
        """按标题读取一条记忆笔记。"""
        filepath = self.path / (self._sanitize(title) + ".md")
        if filepath.exists():
            return filepath.read_text()
        return None

    def list_all(self) -> List[str]:
        """列出所有记忆笔记的标题。"""
        return sorted([f.stem for f in self.path.glob("*.md")])

    def search(self, query: str) -> List[str]:
        """按关键词搜索记忆笔记。"""
        results = []
        for f in self.path.glob("*.md"):
            if query.lower() in f.read_text().lower():
                results.append(f.stem)
        return results

    def delete(self, title: str) -> bool:
        """按标题删除一条记忆笔记。"""
        filepath = self.path / (self._sanitize(title) + ".md")
        if filepath.exists():
            filepath.unlink()
            return True
        return False

    @staticmethod
    def _sanitize(name: str) -> str:
        """将标题转换为安全的文件名。"""
        return "".join(c if c.isalnum() or c in " -_" else "_" for c in name).strip()
```

### 第五步：在智能体中使用 Memdir

现在让我们的智能体拥有一个 **remember** 工具和一个 **recall** 工具，这样它就可以使用长期记忆了：

```python
# ─── 记忆工具 ────────────────────────────────────

memdir = Memdir()

remember_schema = Schema(
    properties={
        "title": {"type": "string", "description": "这条记忆的简短标题"},
        "content": {"type": "string", "description": "要记住的内容"},
    },
    required=["title", "content"],
)

def remember_impl(title: str, content: str) -> str:
    """保存一条记忆笔记。"""
    path = memdir.write(title, content)
    return f"✅ 已保存记忆 '{title}'"

remember_tool = build_tool(ToolDef(
    name="remember",
    description="将重要事实保存到长期记忆。用于用户偏好、关键事实以及以后需要记住的事情。",
    input_schema=remember_schema,
    call=remember_impl,
    is_concurrency_safe=False,  # 写入磁盘：顺序执行
    aliases=["save", "memorize"],
))

recall_schema = Schema(
    properties={
        "query": {"type": "string", "description": "要在记忆中搜索的内容"},
    },
    required=["query"],
)

def recall_impl(query: str) -> str:
    """搜索已保存的记忆。"""
    results = memdir.search(query)
    if not results:
        return f"没有找到关于 '{query}' 的记忆。"

    output = [f"📖 找到 {len(results)} 条记忆："]
    for title in results[:5]:  # 限制前 5 条
        content = memdir.read(title)
        # 只提取内容的第一行
        first_line = content.split('\n')[2] if content else "(空)"
        output.append(f"  • {title}: {first_line[:100]}")
    return "\n".join(output)

recall_tool = build_tool(ToolDef(
    name="recall",
    description="搜索长期记忆中已保存的信息。",
    input_schema=recall_schema,
    call=recall_impl,
    is_concurrency_safe=True,
    aliases=["search_memory", "find_memory"],
))

# 注册记忆工具
registry.register_many([remember_tool, recall_tool])
```

现在智能体可以：
- `remember(title="Alice 的名字", content="用户的名字是 Alice")` —— 保存一个事实
- `recall(query="Alice")` —— 之后检索它

### 第六步：完整的两层记忆智能体

```python
# ─── 具备短期 + 长期记忆的完整智能体 ──

def run_agent_with_memory(user_input: str, max_steps: int = 10) -> str:
    messages = [
        {"role": "system", "content": (
            "你是一个拥有两套记忆系统的智能体：\n"
            "1. 短期记忆：对话上下文（自动管理）\n"
            "2. 长期记忆：使用 'remember' 保存重要事实，"
            "使用 'recall' 之后检索。\n\n"
            "当用户告诉你关于个人的重要信息时，"
            "使用 'remember' 来保存。"
        )},
        {"role": "user", "content": user_input},
    ]

    step = 0
    while step < max_steps:
        step += 1

        # 自动压缩检查
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

    return "达到最大步数。"


# ─── 试试看 ──────────────────────────────────────────

if __name__ == "__main__":
    # 第一次对话
    print("=== 会话 1 ===")
    r1 = run_agent_with_memory("你好！我叫 Alice。我喜欢 Python 编程。")
    print(f"智能体：{r1}\n")

    r2 = run_agent_with_memory("我喜欢什么？")
    print(f"智能体：{r2}\n")

    # 记忆保存在文件中 —— 即使重启也在！
    print("\n📂 已保存的记忆：")
    for m in memdir.list_all():
        print(f"  📄 {m}")

    print("\n=== 会话 2 （重启后） ===")
    # 智能体从头开始，但仍然可以回忆
    r3 = run_agent_with_memory("我叫什么名字？我喜欢什么？")
    print(f"智能体：{r3}")
```

---

## 🔍 工作原理

### 自动压缩 vs. 滑动窗口

| 特性 | 滑动窗口（简单版） | 自动压缩（claude-code 风格） |
|---|---|---|
| 行为 | 丢弃旧消息 | 总结旧消息 |
| 信息丢失 | 完全丢失旧上下文 | 摘要保留关键事实 |
| 触发时机 | 每次添加消息时 | 在 Token 预算约 75% 时 |
| 系统提示 | 保持完整 | 保持完整 |
| 近期上下文 | 最后 N 条消息 | 最近 2 轮逐字保留 |

自动压缩更智能，因为它**保留信息**而不是丢弃信息。如果用户在 50 条消息前提到了名字，滑动窗口早已忘记。自动压缩则保留包含"用户的名字是 Alice"的摘要。

### 75% 阈值

Claude-code 在达到最大 Token 限制的约 75% 时触发压缩。为什么不是 100%？

- API 调用需要为**响应** Token 留出空间
- 工具结果的大小各不相同
- 如果上下文已经达到限制，延迟压缩可能会失败

75% 的阈值提供了安全的缓冲空间。

### Memdir：为什么用文件？

Claude-code 使用单独的文件（而不是数据库）来存储记忆，因为：

1. **简单**：每个文件就是一条笔记。不需要 SQL，不需要复杂查询。
2. **可搜索**：标准工具（`grep`、`find`）就能处理。
3. **可编辑**：用户可以打开记忆文件并编辑。
4. **持久化**：文件在智能体重启后依然存在。
5. **可移植**：把 memdir 复制到任何地方——所有记忆都跟着你。

### 两层记忆协同工作

```
┌─────────────────────────────────────────────────────┐
│                    智能体会话                         │
│                                                     │
│  ┌─────────────────────────────────────────────┐   │
│  │  短期记忆（ContextManager）                   │   │
│  │  • 当前对话                                  │   │
│  │  • 75% 时自动压缩                            │   │
│  │  • 会话结束后丢失                            │   │
│  └─────────────────────────────────────────────┘   │
│                         │                          │
│                         ▼                          │
│  ┌─────────────────────────────────────────────┐   │
│  │  长期记忆（Memdir）                           │   │
│  │  • 磁盘上的 Markdown 文件                    │   │
│  │  • 通过 'remember' 工具写入                  │   │
│  │  • 通过 'recall' 工具读取                    │   │
│  │  • 跨会话持久化                              │   │
│  └─────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

---

## 🧪 练习

### 练习 1：观察压缩的实际运行

设置一个非常低的 `max_tokens`（例如 500），然后运行一个多步任务。观察压缩触发的消息：

```python
ctx = ContextManager(max_tokens=500)
```

连续提出一系列问题，观察压缩何时触发。

### 练习 2：搜索记忆

编写一个函数，搜索所有记忆文件中包含关键词的内容，返回匹配的标题和匹配行：

```python
def search_memories_detail(query: str) -> List[dict]:
    """搜索记忆并返回详细结果。"""
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

### 练习 3：添加 "forget" 工具

创建一个让智能体可以删除记忆的工具：

```python
def forget_impl(title: str) -> str:
    if memdir.delete(title):
        return f"✅ 已删除记忆 '{title}'"
    return f"❌ 未找到标题为 '{title}' 的记忆"

forget_tool = build_tool(ToolDef(
    name="forget",
    description="按标题删除已保存的记忆。",
    input_schema=Schema(
        properties={"title": {"type": "string", "description": "要删除的记忆标题"}},
        required=["title"],
    ),
    call=forget_impl,
    is_concurrency_safe=False,
))
```

### 练习 4：将记忆注入系统提示

修改智能体，在启动时将相关记忆注入系统提示：

```python
def build_prompt_with_memories(user_input: str) -> list:
    memories = memdir.search(user_input)
    memory_context = ""
    if memories:
        notes = [f"- {t}" for t in memories]
        memory_context = "相关记忆：\n" + "\n".join(notes)

    return [
        {"role": "system", "content": (
            "你是一个有用的智能体。\n"
            + (memory_context + "\n" if memory_context else "")
        )},
        {"role": "user", "content": user_input},
    ]
```

### 挑战：自动记忆整合

构建一个系统，自动从长对话中提取关键事实并保存到 memdir：

```python
def consolidate_memories(messages: list, llm_func) -> None:
    """从对话中提取关键事实并保存到记忆。"""
    conversation = "\n".join(
        f"{m['role']}: {m['content']}" 
        for m in messages if m['role'] in ('user', 'assistant')
    )
    prompt = (
        f"从这段对话中提取关键事实（用户偏好、"
        f"重要决定、个人信息）。"
        f"格式化为要点列表：\n\n{conversation}"
    )
    facts = llm_func(prompt)
    if facts.strip():
        memdir.write(f"整合记忆 {datetime.now().strftime('%Y-%m-%d')}", facts)
```

---

## 📝 总结

### 关键概念

| 概念 | 含义 | 在 claude-code 中 |
|---|---|---|
| **上下文窗口** | LLM 的工作记忆，限制在 N 个 Token | `max_tokens` 常量 |
| **自动压缩** | 在 ~75% 容量时压缩旧消息 | `restored-src/src/services/compact/compact.ts` |
| **Memdir** | 基于文件的记忆系统，使用 markdown 文件 | `restored-src/src/commands/memory/memory.tsx` |
| **短期记忆** | 当前对话（自动管理） | 上下文窗口 |
| **长期记忆** | 持久化笔记（智能体管理） | `~/.claude/memory/` |

### 你拥有的代码

```python
from context_manager import ContextManager
from memdir import Memdir

# 75% 自动压缩
ctx = ContextManager(max_tokens=128000)
budget = ctx.check_budget(messages)
if not budget["ok"]:
    messages = ctx.compact(messages)

# 持久化记忆
memdir = Memdir("~/.agent_memory")
memdir.write("user_name", "Alice 喜欢 Python")
print(memdir.search("Python"))  # → ["user_name"]
memdir.read("user_name")        # → "# user_name\n\nAlice 喜欢 Python\n..."
```

> **下一章：第 07 章 —— 长期记忆。我们将教你的智能体跨不同对话记住事情！**
