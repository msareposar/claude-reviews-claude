# 06. 上下文与工作记忆

> **如何管理智能体的短期记忆？当对话变长时怎么保证不丢失重要信息？**

---

## 🎯 目标
- 理解上下文窗口的概念
- 构建滑动窗口上下文管理器
- 实现 Token 计数和智能截断
- 学习摘要压缩策略

## 📖 核心概念

上下文窗口就是智能体的"桌面"。桌面有限，东西多了就得收拾。

**滑动窗口**：只保留最近的 N 条消息。最简单也最有效。

**摘要压缩**：把旧消息总结成一句话，腾出空间。

## 🔧 代码

```python
import tiktoken

def count_tokens(text: str, model: str = "gpt-4o-mini") -> int:
    try:
        enc = tiktoken.encoding_for_model(model)
    except KeyError:
        enc = tiktoken.get_encoding("cl100k_base")
    return len(enc.encode(text))

class SlidingWindow:
    def __init__(self, system_prompt: str, max_tokens: int = 8000):
        self.system = {"role": "system", "content": system_prompt}
        self.messages = []
        self.max_tokens = max_tokens

    def add(self, role, content):
        self.messages.append({"role": role, "content": content})
        self._trim()

    def _trim(self):
        all_msgs = [self.system] + self.messages
        total = sum(count_tokens(m["content"]) for m in all_msgs) + len(all_msgs) * 4
        while total > self.max_tokens and len(self.messages) > 2:
            self.messages.pop(0)
            all_msgs = [self.system] + self.messages
            total = sum(count_tokens(m["content"]) for m in all_msgs) + len(all_msgs) * 4

    def get(self):
        return [self.system] + self.messages
```

## 🧪 练习
1. 测试不同的 max_tokens 对记忆的影响
2. 让智能体在上下文中标注"记住：用户喜欢..."的关键信息
3. 实现 HybridContext：先用滑动窗口，满了后自动切换摘要压缩

### 真实的 claude-code 如何管理上下文和记忆

真实的 **claude-code**（[源码](https://github.com/ChinaSiro/claude-code-sourcemap)）处理上下文管理的方式与上面的教学示例有很大不同：

**源码：[`restored-src/src/services/compact/compact.ts`](https://github.com/ChinaSiro/claude-code-sourcemap/blob/main/restored-src/src/services/compact/compact.ts)**

#### 自动压缩

claude-code 使用**自动压缩**——在上下文即将溢出时自动压缩：

```python
# claude-code 自动压缩的概念模型
# 源码：restored-src/src/services/compact/compact.ts

class ContextCompactor:
    """
    在接近 token 限制时自动压缩上下文。
    
    在真实的 claude-code 中，这会产生一个"紧凑转录本"，
    将旧消息替换为摘要版本，保留关键决策和结果，
    同时丢弃详细的工具输出。
    """
    def __init__(self, max_tokens: int = 128000):
        self.max_tokens = max_tokens
        self.compaction_threshold = int(max_tokens * 0.75)  # 75% 触发压缩
        
    def needs_compaction(self, current_tokens: int) -> bool:
        """检查上下文是否需要压缩（约 75% 容量时触发）。"""
        return current_tokens > self.compaction_threshold
    
    def compact(self, messages: list) -> list:
        """通过摘要化较旧的交互来压缩消息列表。"""
        system_msgs = [m for m in messages if m["role"] == "system"]
        recent = messages[-6:] if len(messages) > 6 else messages  # 保留最近 3 轮
        old = messages[len(system_msgs):-6] if len(messages) > 6 else []
        
        if not old:
            return messages
        
        summary = f"[紧凑: {len(old)} 条旧消息已摘要]"
        compacted = system_msgs + [
            {"role": "system", "content": f"先前上下文: {summary}"}
        ] + recent
        return compacted
```

#### Memdir：基于文件的记忆系统

claude-code 不把记忆存在对话里——它使用 **memdir**（`~/.claude/memory/`）以单独的 markdown 文件存储：

**源码：[`restored-src/src/commands/memory/memory.tsx`](https://github.com/ChinaSiro/claude-code-sourcemap/blob/main/restored-src/src/commands/memory/memory.tsx)**

```python
# claude-code 记忆系统的概念模型
# 源码：restored-src/src/memory.ts

import os
from pathlib import Path
from datetime import datetime

class Memdir:
    """
    基于文件的记忆存储。
    
    claude-code 将每条记忆作为 markdown 文件存储在 ~/.claude/memory/ 中。
    每个文件是一条独立的"笔记"，智能体可以写入和读取。
    """
    def __init__(self, memdir_path: str = "~/.claude/memory"):
        self.path = Path(memdir_path).expanduser()
        self.path.mkdir(parents=True, exist_ok=True)
    
    def write(self, title: str, content: str) -> str:
        """写入记忆文件。源码：memory.tsx — writeMemory。"""
        filename = self._sanitize_filename(title) + ".md"
        filepath = self.path / filename
        timestamp = datetime.now().isoformat()
        full_content = f"# {title}\n\n{content}\n\n---\n*创建时间: {timestamp}*"
        filepath.write_text(full_content)
        return str(filepath)
    
    def read(self, title: str) -> Optional[str]:
        """读取记忆文件。源码：memory.tsx — readMemory。"""
        filepath = self.path / (self._sanitize_filename(title) + ".md")
        if filepath.exists():
            return filepath.read_text()
        return None
    
    def list_all(self) -> List[str]:
        """列出所有记忆文件。源码：memory.tsx — listMemories。"""
        return sorted([f.stem for f in self.path.glob("*.md")])
    
    def search(self, query: str) -> List[str]:
        """按关键词搜索记忆。源码：memory.tsx — searchMemories。"""
        results = []
        for f in self.path.glob("*.md"):
            if query.lower() in f.read_text().lower():
                results.append(f.stem)
        return results
    
    @staticmethod
    def _sanitize_filename(name: str) -> str:
        """将标题转换为安全的文件名。"""
        return "".join(c if c.isalnum() or c in " -_" else "_" for c in name).strip()
```

这种基于文件的方式意味着记忆**跨会话持久化**，可以独立搜索、编辑或删除。而且记忆系统不会消耗对话 token，除非显式加载。

下一章：长期记忆系统。
