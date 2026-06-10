# 08. 错误处理与韧性

> **智能体一定会出错。学会优雅地处理错误，让它继续工作。**

---

## 🎯 目标
- 理解智能体常见的失败模式
- 实现重试机制和指数退避
- 设计降级策略（工具坏了怎么办）
- 让错误信息对用户友好

## 🔧 代码

### 带重试的 LLM 调用
```python
import openai, time

def call_llm_with_retry(messages, max_retries=3):
    for attempt in range(1, max_retries + 1):
        try:
            return openai.chat.completions.create(model="gpt-4o-mini", messages=messages, timeout=30)
        except (openai.APITimeoutError, openai.RateLimitError) as e:
            if attempt < max_retries:
                wait = 2 ** (attempt - 1)
                print(f"[重试 {attempt}] 等待 {wait}s...")
                time.sleep(wait)
            else:
                return f"⚠️ 多次尝试后失败：{e}"
        except openai.AuthenticationError:
            return "⚠️ API 密钥无效，请检查配置"
```

### 安全工具调用包装
```python
class SafeTool:
    def execute(self, tool_call):
        try:
            args = json.loads(tool_call.function.arguments)
            name = tool_call.function.name
            return self._run_tool(name, args)
        except json.JSONDecodeError:
            return "⚠️ 参数格式错误"
        except Exception as e:
            return f"⚠️ 工具执行失败：{e}"

    def _run_tool(self, name, args):
        tools = {"calculate": lambda e: str(eval(e)), "search": lambda q: f"模拟搜索：{q}"}
        if name not in tools:
            return f"⚠️ 未知工具：{name}"
        return tools[name](list(args.values())[0])
```

### 优雅降级
```python
class ResilientAgent:
    def __init__(self, tools):
        self.tools = tools
        self.failed_tools = set()  # 已失败的暂时禁用

    def run(self, user_input):
        # 排除已失败的
        available = [t for t in self.tools if t not in self.failed_tools]
        system = f"你可以使用这些工具：{', '.join(available)}。如果工具不可用，直接回答。"
        # ... 循环 ...
```

## 🧪 练习
1. 断路器模式：连续失败 3 次后暂停该工具 30 秒
2. 备选方案：如果搜索失败，问 LLM 用自己的知识回答
3. 日志记录：记录每次错误的时间、类型、上下文

下一章：任务规划与推理。
