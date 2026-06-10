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

### 真实的 claude-code 如何处理错误

上面的教学示例使用 `try/except` 处理错误。在真实的 **claude-code**（[源码](https://github.com/ChinaSiro/claude-code-sourcemap)）中，错误在工具系统层面被捕获，使用结构化结果和权限检查：

**源码：[`restored-src/src/Tool.ts`](https://github.com/ChinaSiro/claude-code-sourcemap/blob/main/restored-src/src/Tool.ts)**

#### ValidationResult 模式

每个工具在执行前验证输入，返回结构化结果：

```python
# claude-code 的 ValidationResult 模式的概念模型
# 源码：restored-src/src/Tool.ts

from typing import Generic, TypeVar, Union, Optional

T = TypeVar('T')

class ValidationSuccess:
    """输入通过验证。源码：Tool.ts 中的 ValidationResult"""
    def __init__(self, result: bool = True):
        self.valid = True

class ValidationFailure:
    """输入未通过验证。源码：Tool.ts 中的 ValidationResult"""
    def __init__(self, message: str):
        self.valid = False
        self.message = message

ValidationResult = Union[ValidationSuccess, ValidationFailure]

def validate_tool_input(tool_name: str, args: dict, schema: dict) -> ValidationResult:
    """在执行前验证工具输入。
    对应 claude-code 在调用 run() 前的验证。"""
    for key, props in schema.get("properties", {}).items():
        if props.get("required", False) and key not in args:
            return ValidationFailure(f"缺少必填参数: {key}")
        if key in args and "allowed_values" in props:
            if args[key] not in props["allowed_values"]:
                return ValidationFailure(
                    f"{key} 的值无效: '{args[key]}'。允许的值: {props['allowed_values']}"
                )
    return ValidationSuccess()
```

#### 用 canUseTool 进行权限检查

claude-code 工具声明 `canUseTool` 在运行时检查权限：

```python
# claude-code 的 canUseTool 权限系统的概念模型
# 源码：restored-src/src/Tool.ts

class PermissionCheck:
    """
    工具运行时权限检查。
    
    claude-code 检查：
    - 当前上下文中是否启用了该工具？
    - 用户的权限级别是否允许此操作？
    - 是否存在安全约束（沙箱、网络、文件系统）？
    """
    def __init__(self, allowed: bool, reason: str = ""):
        self.allowed = allowed
        self.reason = reason

class SafeTool:
    """
    带有权限和验证检查的工具包装器。
    对应 claude-code 用守卫包装工具执行的方式。
    """
    def __init__(self, name: str, call_fn, is_destructive: bool = False):
        self.name = name
        self._call = call_fn
        self.is_destructive = is_destructive
    
    def check_permissions(self, context: dict) -> PermissionCheck:
        """检查此工具是否可在当前上下文中使用。
        源码：Tool.ts — canUseTool"""
        if self.is_destructive and context.get("dry_run", False):
            return PermissionCheck(False, "在干运行模式下阻止了破坏性工具")
        return PermissionCheck(True)
    
    def safe_call(self, context: dict, **kwargs) -> str:
        """使用完整的权限和验证检查执行工具。"""
        # 1. 权限检查
        perm = self.check_permissions(context)
        if not perm.allowed:
            return f"PermissionDenied: {perm.reason}"
        
        # 2. 验证检查
        validation = validate_tool_input(self.name, kwargs, {})
        if not validation.valid:
            return f"ValidationError: {validation.message}"
        
        # 3. 带错误边界的执行
        try:
            return self._call(**kwargs)
        except Exception as e:
            # claude-code 用 FallbackToolUseErrorMessage 包装错误
            # 源码：restored-src/src/components/FallbackToolUseErrorMessage.tsx
            return (
                f"tool_use_error\n"
                f"工具 '{self.name}' 遇到错误: {type(e).__name__}: {e}\n"
                f"建议修复: 检查输入参数并重试。"
            )
```

#### 降级错误显示

当工具失败时，claude-code 显示一个结构化错误消息，LLM 可以理解并重试：

```python
# claude-code 用以下模式包装错误
# 源码：FallbackToolUseErrorMessage.tsx
def format_tool_error(tool_name: str, error: str, context: dict) -> str:
    """
    格式化工具错误，让 LLM 能理解问题所在并知道如何修复。
    """
    return (
        f"工具错误 — {tool_name}\n"
        f"━━━━━━━━━━━━━━━━━━\n"
        f"类型: {context.get('error_type', 'runtime')}\n"
        f"消息: {error}\n"
        f"操作: {'检查参数后重试' if context.get('retryable', True) else '放弃此方案'}"
    )
```

来自 claude-code 的关键洞察：**验证在执行之前**（输入 schema 检查），**权限在验证之前**（canUseTool）。这种分层方法意味着工具函数本身几乎不需要错误处理——守卫层在上游捕获所有内容。

下一章：任务规划与推理。
