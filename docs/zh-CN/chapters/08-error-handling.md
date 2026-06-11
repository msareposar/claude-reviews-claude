# 08. 错误处理与韧性

> **本章内容：当事情出错时会发生什么？API 失败、工具故障、LLM 给出错误响应。你将构建一个能够优雅处理错误的智能体——使用 claude-code 的"先验证再执行"模式。**

---

## 🎯 目标

完成本章后，你将能够：

- 理解 AI 智能体常见的故障模式
- 使用 **Schema 验证** 在工具执行前捕获错误输入
- 实现 **canUseTool** 权限门控（类似 claude-code 的权限系统）
- 构建带指数退避的重试逻辑
- 创建 **ValidationResult**——LLM 能理解的结构化错误消息
- 构建一个能够优雅处理错误的弹性智能体

---

## 📖 用 10 岁孩子能懂的方式解释

### 事情总会出错

你的智能体经常会出问题。以下是一些可能出错的情况：

```
❌ LLM API 宕机      → "服务不可用"
❌ 工具抛出异常      → "除以零"
❌ 网络超时          → "连接超时"
❌ 错误输入          → LLM 传了数字而不是字符串
❌ 超出速率限制      → "请求过多"
```

一个**弹性智能体**不会直接崩溃。它会：

1. **在执行前捕获错误输入**——验证是第一道防线
2. **重试**——对临时故障使用退避策略
3. **降级**——回退到更简单的方法
4. **报告结构化错误**——LLM 能理解并从中重试

---

## 🔧 动手实践：构建弹性智能体

### 第 1 步：ValidationResult——在执行前捕获错误

从 claude-code 中学到的最重要一课：**先验证再执行**。不要让工具函数看到错误输入。

在 claude-code 中，每个工具的 `canUseTool` 和输入 schema 在 `run()` 被调用之前就会进行检查。让我们构建这个模式：

```python
# error_handling.py

from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry
from typing import Tuple, Optional, Dict, Any

# ─── ValidationResult：类型化的验证结果 ──────

class ValidationResult:
    """
    工具输入执行前验证的结果。
    
    类似 claude-code 的 ValidationResult<Input> 类型
    （源码：restored-src/src/Tool.ts）。
    
    两种状态：
    - success：输入有效 → 工具应执行
    - failure：输入无效 → 向 LLM 返回错误
    """
    def __init__(self, is_valid: bool, error_message: Optional[str] = None):
        self.is_valid = is_valid
        self.error_message = error_message

    @classmethod
    def success(cls):
        return cls(is_valid=True)

    @classmethod
    def failure(cls, message: str):
        return cls(is_valid=False, error_message=message)

    def __bool__(self):
        return self.is_valid

    def __str__(self):
        if self.is_valid:
            return "ValidationResult(success)"
        return f"ValidationResult(failure: {self.error_message})"
```

### 第 2 步：使用 canUseTool 进行权限门控

在 claude-code 中，每个工具可以声明 `canUseTool`——一个在执行前检查运行时权限的函数。这与输入验证是分开的：权限检查的是**上下文**（而不是输入），例如"此工具在干运行模式下是否允许？"

```python
class PermissionCheck:
    """
    工具执行前权限检查的结果。
    
    类似 claude-code 的 canUseTool 模式
    （源码：restored-src/src/Tool.ts）。
    """
    def __init__(self, allowed: bool, reason: str = ""):
        self.allowed = allowed
        self.reason = reason

    @classmethod
    def grant(cls):
        return cls(allowed=True)

    @classmethod
    def deny(cls, reason: str):
        return cls(allowed=False, reason=reason)

    def __bool__(self):
        return self.allowed


class PermissionedTool:
    """
    带权限检查的工具包装器。
    
    类似 claude-code 的 canUseTool 系统——检查在工具运行之前执行，
    而不是在工具内部。
    """
    def __init__(self, tool: Tool, context: Dict[str, Any] = None):
        self.tool = tool
        self.context = context or {}

    def check_permissions(self, **kwargs) -> PermissionCheck:
        """
        检查此工具是否可在当前上下文中使用。
        在子类中重写以实现自定义权限逻辑。
        """
        # 默认：始终允许
        return PermissionCheck.grant()

    def safe_execute(self, **kwargs) -> str:
        """
        执行工具，包含完整的权限和验证检查。
        这是 claude-code 在每次工具调用前使用的模式。
        """
        # 第 1 层：权限检查（canUseTool）
        perm = self.check_permissions(**kwargs)
        if not perm.allowed:
            return self._format_permission_error(perm)

        # 第 2 层：Schema 验证（ValidationResult）
        is_valid, error = self.tool.input_schema.validate(kwargs)
        if not is_valid:
            return self._format_validation_error(error)

        # 第 3 层：带错误边界的执行
        try:
            return self.tool.call(**kwargs)
        except Exception as e:
            return self._format_execution_error(e)

    def _format_permission_error(self, perm: PermissionCheck) -> str:
        """格式化权限错误，让 LLM 能理解。"""
        return (
            f"<tool_use_error>\n"
            f"  Tool: {self.tool.name}\n"
            f"  Error: PermissionDenied\n"
            f"  Reason: {perm.reason}\n"
            f"  Action: 尝试其他工具或其他方法。\n"
            f"</tool_use_error>"
        )

    def _format_validation_error(self, error_message: str) -> str:
        """格式化验证错误，让 LLM 能修复。"""
        return (
            f"<tool_use_error>\n"
            f"  Tool: {self.tool.name}\n"
            f"  Error: ValidationError\n"
            f"  Message: {error_message}\n"
            f"  Action: 检查输入参数后重试。\n"
            f"</tool_use_error>"
        )

    def _format_execution_error(self, error: Exception) -> str:
        """格式化运行时错误，附带建议修复方案。"""
        return (
            f"<tool_use_error>\n"
            f"  Tool: {self.tool.name}\n"
            f"  Error: RuntimeError ({type(error).__name__})\n"
            f"  Message: {error}\n"
            f"  Action: 检查输入参数后重试。\n"
            f"</tool_use_error>"
        )
```

### 第 3 步：结构化错误消息（FallbackToolUseErrorMessage）

在 claude-code 中，当工具失败时，错误会以结构化格式显示，LLM 可以理解并从中重试——这就是 `FallbackToolUseErrorMessage` 组件。

`<tool_use_error>` XML 标签很重要：它们告诉 LLM 到底发生了什么以及下一步该怎么做。这些标签易于解析（对 LLM 和我们的代码都是如此）。

### 第 4 步：构建带权限的工具

现在让我们用权限系统创建一些工具：

```python
# ─── 示例：带输入验证的计算器 ───────

import math

calc_schema = Schema(
    properties={
        "expression": {
            "type": "string",
            "description": "数学表达式，例如 '2 + 2'",
        },
    },
    required=["expression"],
)

def calc_impl(expression: str) -> str:
    allowed = {"sqrt": math.sqrt, "pi": math.pi, "abs": abs, "pow": pow}
    return str(eval(expression, {"__builtins__": {}}, allowed))

calculator = build_tool(ToolDef(
    name="calculate",
    description="计算数学表达式",
    input_schema=calc_schema,
    call=calc_impl,
    is_concurrency_safe=True,
    aliases=["calc"],
))


# ─── 示例：带权限检查的文件写入工具 ──

file_write_schema = Schema(
    properties={
        "path": {"type": "string", "description": "要写入的文件路径"},
        "content": {"type": "string", "description": "要写入的内容"},
    },
    required=["path", "content"],
)

def write_file_impl(path: str, content: str) -> str:
    with open(path, 'w') as f:
        f.write(content)
    return f"已将 {len(content)} 个字符写入 {path}"

file_writer = build_tool(ToolDef(
    name="write_file",
    description="将内容写入文件",
    input_schema=file_write_schema,
    call=write_file_impl,
    is_concurrency_safe=False,  # 有副作用
    aliases=["save"],
))


# ─── 文件写入器的权限包装 ─────────────

class PermissionedFileWriter(PermissionedTool):
    """
    带权限检查的文件写入器。
    阻止写入系统目录。
    """
    SAFE_DIRS = ["/tmp", os.getcwd()]  # 只有这些目录可写

    def check_permissions(self, **kwargs) -> PermissionCheck:
        path = kwargs.get("path", "")
        abs_path = os.path.abspath(os.path.expanduser(path))

        # 检查路径是否在安全目录中
        for safe_dir in self.SAFE_DIRS:
            if abs_path.startswith(os.path.abspath(safe_dir)):
                return PermissionCheck.grant()

        return PermissionCheck.deny(
            f"无法写入 '{path}'。允许的目录："
            f"{', '.join(self.SAFE_DIRS)}"
        )


# ─── 注册表 ────────────────────────────────────────

registry = ToolRegistry()
registry.register_many([calculator, file_writer])
```

### 第 5 步：安全执行器（SafeExecutor）

现在让我们构建一个使用权限检查的执行器：

```python
# ─── SafeExecutor：带权限 + 验证的工具执行 ──

class SafeExecutor:
    """
    使用分层错误处理执行工具。
    
    每次工具调用都会经过：
    1. 权限检查（canUseTool）
    2. Schema 验证（ValidationResult）
    3. 带错误边界的执行
    """
    def __init__(self, registry: ToolRegistry, context: dict = None):
        self.registry = registry
        self.context = context or {}
        self._permissioned_tools = {}

    def _get_permissioned(self, tool: Tool) -> PermissionedTool:
        """获取或创建 PermissionedTool 包装器。"""
        if tool.name not in self._permissioned_tools:
            self._permissioned_tools[tool.name] = PermissionedTool(tool, self.context)
        return self._permissioned_tools[tool.name]

    def execute(self, name: str, args: dict) -> str:
        """执行工具，包含完整的错误处理层。"""
        tool = self.registry.find_tool(name)
        if not tool:
            # 未知工具——告诉 LLM 有哪些可用工具
            available = list(self.registry._tools.keys())
            return (
                f"<tool_use_error>\n"
                f"  Error: UnknownTool\n"
                f"  Message: 没有名为 '{name}' 的工具\n"
                f"  Available tools: {', '.join(available)}\n"
                f"</tool_use_error>"
            )

        # 使用权限包装器
        perm_tool = self._get_permissioned(tool)
        return perm_tool.safe_execute(**args)


# ─── 带指数退避的重试 ──────────────────

import time
import openai

def call_llm_with_retry(messages: list, tools: list,
                         model: str = "gpt-4o-mini",
                         max_retries: int = 3) -> str:
    """
    调用 LLM 并带重试和指数退避。
    仅重试临时性错误（超时、速率限制、连接问题）。
    """
    last_error = None

    for attempt in range(1, max_retries + 1):
        try:
            response = openai.chat.completions.create(
                model=model,
                messages=messages,
                tools=tools,
                timeout=30,
            )
            return response

        except (openai.APITimeoutError, openai.RateLimitError,
                openai.APIConnectionError) as e:
            last_error = e
            if attempt < max_retries:
                wait_time = 2 ** (attempt - 1)  # 1s, 2s, 4s
                print(f"  [重试 {attempt}/{max_retries}] 等待 {wait_time}s...")
                time.sleep(wait_time)

        except openai.AuthenticationError as e:
            # 认证错误无需重试
            return f"⚠️ 认证失败：{e}"

        except Exception as e:
            last_error = e
            if attempt < max_retries:
                print(f"  [重试 {attempt}/{max_retries}] 未知错误，正在重试...")
                time.sleep(1)

    return f"⚠️ 重试 {max_retries} 次后仍失败。最后错误：{last_error}"
```

### 第 6 步：完整的弹性智能体

```python
# ─── 弹性智能体 ─────────────────────────────────

import json
import os

class ResilientAgent:
    """
    永不崩溃的智能体——它会捕获、报告和重试。
    
    三层错误处理：
    1. API 调用重试（临时性故障）
    2. 权限 + 验证检查（错误输入）
    3. 工具执行错误（运行时故障）
    """
    def __init__(self, executor: SafeExecutor, tools_schema: list):
        self.executor = executor
        self.tools_schema = tools_schema

    def run(self, user_input: str, max_steps: int = 10) -> str:
        messages = [
            {"role": "system", "content": (
                "你是一个可以使用工具的助手。\n\n"
                "当工具返回包含 <tool_use_error> 标签的错误时，"
                "仔细阅读错误信息，修复你的输入或尝试其他方法。\n\n"
                "工具错误类型：\n"
                "- PermissionDenied：不允许执行此操作\n"
                "- ValidationError：输入格式有误\n"
                "- RuntimeError：执行过程中出错\n"
                "- UnknownTool：使用了不存在的工具名称"
            )},
            {"role": "user", "content": user_input},
        ]

        step = 0
        while step < max_steps:
            step += 1
            print(f"\n🔄 步骤 {step}")

            # 思考（带重试）
            response = call_llm_with_retry(messages, self.tools_schema)
            if isinstance(response, str) and response.startswith("⚠️"):
                return response  # 所有重试已耗尽

            msg = response.choices[0].message

            # 完成？
            if not msg.tool_calls:
                return msg.content

            # 行动 + 观察（带权限和验证检查）
            messages.append(msg)
            for tc in msg.tool_calls:
                tool_name = tc.function.name
                args = json.loads(tc.function.arguments)

                print(f"  🔧 {tool_name}({args})")

                # 通过 SafeExecutor 执行（含 3 层错误处理）
                result = self.executor.execute(tool_name, args)

                # 检查结果是否为错误
                if "<tool_use_error>" in result:
                    print(f"  ⚠️ 错误：{result.split(chr(10))[3].strip()}")
                else:
                    print(f"  ✅ 结果：{result[:60]}...")

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": result,
                })

        return "⚠️ 已达到最大步骤数。"


# ─── 运行 ──────────────────────────────────────────

if __name__ == "__main__":
    executor = SafeExecutor(registry)
    agent = ResilientAgent(executor, registry.get_openai_schemas())

    print("=== 测试弹性智能体 ===\n")

    # 测试 1：正常计算
    print("📌 测试 1：正常计算")
    print(agent.run("计算 42 * 15"))
    print()

    # 测试 2：错误输入（字符串而非数字会触发验证）
    print("📌 测试 2：权限拒绝（写入受保护路径）")
    print(agent.run("将 'hello' 写入 /etc/passwd"))
    print()

    # 测试 3：未知工具
    print("📌 测试 3：未知工具名称")
    print(agent.run("使用 'delete_all_files' 工具清理"))
    print()

    # 测试 4：从工具错误中恢复
    print("📌 测试 4：错误恢复")
    print(agent.run("先计算 1/0，再计算 2+2"))
```

---

## 🔍 工作原理

### 三层错误处理

```
                    LLM 想要调用工具
                              │
                              ▼
               ┌──────────────────────────┐
     第 1 层   │   canUseTool             │
     (上下文)  │   "这个操作允许吗？"      │
               │   PermissionDenied → 返回 │
               └──────────┬───────────────┘
                          ▼
               ┌──────────────────────────┐
     第 2 层   │   Schema 验证             │
     (输入)    │   "输入参数有效吗？"      │
               │   ValidationError → 返回  │
               └──────────┬───────────────┘
                          ▼
               ┌──────────────────────────┐
     第 3 层   │   执行                    │
     (运行时)  │   "能正常运行吗？"        │
               │   RuntimeError → 返回     │
               └──────────┬───────────────┘
                          ▼
                    结果或错误
```

每一层捕获不同类型的故障：

| 层 | 检查内容 | 错误类型 |
|---|---|---|
| **canUseTool** | 此操作在当前上下文中是否允许？ | `PermissionDenied` |
| **Schema 验证** | 输入的类型和值是否正确？ | `ValidationError` |
| **运行时执行** | 函数是否能无异常运行？ | `RuntimeError` |

### 为什么用三层而不是一个 try/except？

Claude-code 使用这种分层方法，因为每一层都有**不同的恢复策略**：

- **权限错误**：LLM 应使用完全不同的工具
- **验证错误**：LLM 应修复输入后重试
- **运行时错误**：LLM 应检查参数后重试

如果将所有内容包裹在一个 `try/except` 中，就会丢失这种区分。LLM 只会收到一条泛泛的"出了点问题"的消息，不知道该如何回应。

### <tool_use_error> 格式

结构化的 XML 风格格式专为 LLM 解析而设计：

- `<tool_use_error>` 标签清晰地将错误与正常输出区分开
- `Error:` 行告诉 LLM 错误类型
- `Message:` 行提供详细信息
- `Action:` 行告诉 LLM 下一步该做什么

这正是 claude-code 的 `FallbackToolUseErrorMessage` 的工作方式——它生成一个模型能够理解并据此采取行动的结构化错误。

### 重试 vs. 快速失败

并非所有错误都应该重试：

| 错误 | 重试？ | 原因 |
|---|---|---|
| `APITimeoutError` | ✅ 是（指数退避） | 网络问题是临时性的 |
| `RateLimitError` | ✅ 是（等待后） | 限制重置后会恢复 |
| `APIConnectionError` | ✅ 是（带退避） | 服务可能恢复 |
| `AuthenticationError` | ❌ 否 | API 密钥错误——重试无济于事 |
| `ValidationError` | ❌ 否（让 LLM 重试） | 输入错误——告诉 LLM 修复 |
| `PermissionDenied` | ❌ 否（让 LLM 重试） | 不允许——LLM 应尝试其他方法 |

API 调用的重试逻辑与工具错误的重试逻辑是分开的。API 重试是自动的（代码等待并重试）。工具错误会返回给 LLM，由 LLM 决定是否使用不同的输入重试。

---

## 🧪 练习

### 练习 1：添加沙箱文件工具

创建一个权限检查器，只允许写入 `/tmp/`：

```python
class SandboxedFileWriter(PermissionedTool):
    SAFE_PREFIX = "/tmp/"

    def check_permissions(self, **kwargs) -> PermissionCheck:
        path = kwargs.get("path", "")
        if not path.startswith(self.SAFE_PREFIX):
            return PermissionCheck.deny(
                f"写入被拒绝：路径必须以 '{self.SAFE_PREFIX}' 开头"
            )
        return PermissionCheck.grant()
```

测试："将 'test' 写入 ~/test.txt" 和 "将 'test' 写入 /tmp/test.txt"

### 练习 2：模拟 API 故障

创建一个随机失败的包装器来测试重试逻辑：

```python
import random

def flaky_tool(impl):
    """用随机失败包装工具实现。"""
    def wrapper(**kwargs):
        if random.random() < 0.3:  # 30% 失败率
            raise ConnectionError("模拟网络故障")
        return impl(**kwargs)
    return wrapper

# 使用
unreliable_calc = build_tool(ToolDef(
    name="calculate",
    description="不可靠的计算器",
    input_schema=calc_schema,
    call=flaky_tool(calc_impl),
))
```

### 练习 3：记录所有错误

为 SafeExecutor 添加错误日志：

```python
class LoggingExecutor(SafeExecutor):
    def __init__(self, registry, log_file="errors.log", context=None):
        super().__init__(registry, context)
        self.log_file = log_file

    def execute(self, name, args):
        result = super().execute(name, args)
        if "<tool_use_error>" in result:
            with open(self.log_file, "a") as f:
                f.write(f"[{time.strftime('%H:%M:%S')}] {name}: {result}\n")
        return result
```

### 练习 4：优雅降级

如果关键工具失败，智能体仍应使用剩余工具继续工作：

```python
# 在智能体循环中，当工具返回 PermissionDenied 时：
# LLM 读取错误并尝试其他方法。
# 这是通过将错误包含在对话中自然处理的。
```

测试："将 'backup' 写入 /etc/critical_file" → LLM 应意识到被阻止，并尝试写入 /tmp。

### 挑战：降级链

构建一个工具降级系统：

```python
class FallbackTool:
    """先尝试工具 A，如果失败，再尝试工具 B。"""
    def __init__(self, primary: str, fallback: str, registry: ToolRegistry):
        self.primary = primary
        self.fallback = fallback
        self.registry = registry

    def execute(self, args: dict) -> str:
        result = self.registry.run_tool(self.primary, args)
        if "<tool_use_error>" in result and self.fallback:
            print(f"  ⚠️ 主要工具 '{self.primary}' 失败，尝试备用工具 '{self.fallback}'")
            result = self.registry.run_tool(self.fallback, args)
        return result
```

---

## 📝 总结

### 关键概念

| 概念 | 含义 | 在 claude-code 中 |
|---|---|---|
| **ValidationResult** | 类型化的验证结果：成功或带消息的失败 | `Tool.ts` 中的 `ValidationResult<Input>` |
| **canUseTool** | 执行前的权限检查 | `Tool.ts` 中的 `canUseTool` |
| **FallbackToolUseErrorMessage** | 供 LLM 使用的结构化错误格式 | `FallbackToolUseErrorMessage.tsx` |
| **指数退避** | 等待 1s、2s、4s 后重试 | 标准重试模式 |
| **三层错误处理** | 权限 → 验证 → 执行 | 在 `Tool.call()` 中分层实现 |
| **<tool_use_error>** | LLM 可解析的 XML 标签错误 | `FallbackToolUseErrorMessage.tsx` |

### 你拥有的代码

```python
from tool_system import Schema, Tool, ToolDef, build_tool, ToolRegistry

class SafeExecutor:
    """所有工具调用的三层错误处理。"""
    def execute(self, name, args):
        tool = self.registry.find_tool(name)
        if not tool:
            return f"<tool_use_error>未知工具 '{name}'</tool_use_error>"

        # 第 1 层：权限
        perm = self.check_permissions(tool, args)
        if not perm.allowed:
            return f"<tool_use_error>PermissionDenied: {perm.reason}</tool_use_error>"

        # 第 2 层：验证
        is_valid, error = tool.input_schema.validate(args)
        if not is_valid:
            return f"<tool_use_error>ValidationError: {error}</tool_use_error>"

        # 第 3 层：执行
        try:
            return tool.call(**args)
        except Exception as e:
            return f"<tool_use_error>RuntimeError: {e}</tool_use_error>"
```

> **下一章：第 09 章——规划与推理。你的智能体如何思考复杂任务？**
