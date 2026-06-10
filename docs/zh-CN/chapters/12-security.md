# 12. 安全与权限

> **智能体能做很多事情。但有些事情它不应该做。**

---

## 🎯 目标
- 防范提示词注入攻击
- 实现工具权限分级
- 敏感操作需要用户确认
- 限流保护

## 🔧 代码

### 输入过滤
```python
def sanitize_input(text: str) -> str:
    """过滤掉潜在的提示词注入。"""
    dangerous = ["忽略之前的指令", "system", "你是一个", "忽略以上"]
    for d in dangerous:
        if d in text.lower():
            return "[已过滤可疑输入]"
    return text
```

### 权限系统
```python
from enum import Enum

class Permission(Enum):
    READ = "read"      # 只读，安全
    WRITE = "write"    # 写文件，需确认
    DANGEROUS = "danger"  # 危险，必须确认

class SecureTool(Tool):
    def __init__(self, name, permission: Permission):
        self._name = name
        self.permission = permission

    def run_with_approval(self, user_input: str, **kwargs):
        if self.permission == Permission.WRITE:
            confirm = input(f"⚠️ {self._name} 是写操作，确认？(y/n): ")
            if confirm.lower() != "y":
                return "操作已取消"
        return self.run(**kwargs)
```

### 限流
```python
import time
class RateLimiter:
    def __init__(self, max_calls=10, per_seconds=60):
        self.max_calls = max_calls
        self.per_seconds = per_seconds
        self.calls = []

    def allow(self) -> bool:
        now = time.time()
        self.calls = [c for c in self.calls if now - c < self.per_seconds]
        if len(self.calls) >= self.max_calls:
            return False
        self.calls.append(now)
        return True
```

## 🧪 练习
1. 测试提示词注入：尝试让智能体忽略用户指令
2. 添加"危险命令白名单"
3. 记录所有安全事件日志

下一章：测试你的智能体。
