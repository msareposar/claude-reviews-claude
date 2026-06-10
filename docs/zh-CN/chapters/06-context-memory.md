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

下一章：长期记忆系统。
