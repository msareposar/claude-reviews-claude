# 04. 工具系统：手脚并用的智能体

> **本章内容：如何设计一个可扩展的工具系统，让你的智能体拥有各种能力。**

---

## 🎯 目标

学完本章，你将能够：
- 用抽象基类设计工具系统
- 实现工具的注册、发现和调度
- 构建多种工具（计算、文件、搜索）
- 处理工具的错误

---

## 📖 给 10 岁孩子解释

工具就是智能体的"手脚"。你没有手，就只能说话；有了手，你就能做事。

好的工具系统像一个工具箱：
- 每个工具有名字和说明书
- 你可以随时添加新工具
- 智能体自己决定用什么工具

---

## 🔧 动手实践

### Step 1：工具基类

```python
from abc import ABC, abstractmethod

class Tool(ABC):
    """所有工具的基类。"""

    @property
    @abstractmethod
    def name(self) -> str:
        """工具名称。"""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """工具描述（给 LLM 看）。"""
        pass

    @abstractmethod
    def run(self, **kwargs) -> str:
        """执行工具。"""
        pass

    def to_openai_tool(self) -> dict:
        """转成 OpenAI 工具格式。"""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.get_parameters(),
            },
        }

    @abstractmethod
    def get_parameters(self) -> dict:
        """返回 JSON Schema 参数定义。"""
        pass
```

### Step 2：具体工具

```python
class CalculatorTool(Tool):
    @property
    def name(self): return "calculator"

    @property
    def description(self): return "计算数学表达式"

    def get_parameters(self):
        return {
            "type": "object",
            "properties": {
                "expression": {"type": "string", "description": "数学表达式"}
            },
            "required": ["expression"],
        }

    def run(self, expression: str) -> str:
        allowed = set("0123456789+-*/.() ")
        if not all(c in allowed for c in expression):
            return "错误：非法字符"
        try:
            return str(eval(expression, {"__builtins__": {}}, {}))
        except Exception as e:
            return f"错误：{e}"


class FileReadTool(Tool):
    @property
    def name(self): return "file_reader"

    @property
    def description(self): return "读取文件内容"

    def get_parameters(self):
        return {
            "type": "object",
            "properties": {
                "path": {"type": "string", "description": "文件路径"}
            },
            "required": ["path"],
        }

    def run(self, path: str) -> str:
        try:
            with open(path, "r") as f:
                return f.read()[:2000]  # 限制长度
        except Exception as e:
            return f"读取失败：{e}"
```

### Step 3：工具注册和管理

```python
class ToolRegistry:
    """管理所有可用工具。"""

    def __init__(self):
        self._tools = {}

    def register(self, tool: Tool):
        """注册一个工具。"""
        self._tools[tool.name] = tool

    def get(self, name: str) -> Tool:
        return self._tools.get(name)

    def get_all_tools(self) -> list:
        return list(self._tools.values())

    def get_openai_tools(self) -> list:
        return [t.to_openai_tool() for t in self._tools.values()]

    def execute(self, name: str, **kwargs) -> str:
        tool = self.get(name)
        if not tool:
            return f"未找到工具：{name}"
        return tool.run(**kwargs)

# 使用
registry = ToolRegistry()
registry.register(CalculatorTool())
registry.register(FileReadTool())
```

### Step 4：工具调度

```python
class ToolAgent:
    """使用工具注册表的智能体。"""

    def __init__(self, registry: ToolRegistry):
        self.registry = registry

    def run(self, user_input: str) -> str:
        messages = [{"role": "user", "content": user_input}]
        tools_config = self.registry.get_openai_tools()

        for _ in range(10):
            response = openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                tools=tools_config if tools_config else None,
            )
            msg = response.choices[0].message
            if not msg.tool_calls:
                return msg.content

            messages.append(msg)
            for tc in msg.tool_calls:
                args = json.loads(tc.function.arguments)
                result = self.registry.execute(tc.function.name, **args)
                messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

        return "任务完成。"

# 使用
agent = ToolAgent(registry)
print(agent.run("帮我计算 345 * 678"))
```

---

## 🧪 练习

1. 添加一个 `CurrentTimeTool`，返回当前时间
2. 添加一个 `WebSearchTool`，使用模拟搜索
3. 让工具结果先经过 LLM 再返回用户（而不是直接输出）
4. 给工具添加"权限等级"（只读/读写）

---

## 📝 总结

- **Tool 基类**统一了工具接口
- **ToolRegistry** 管理所有工具的注册和发现
- 工具描述（JSON Schema）告诉 LLM 怎么用
- 用抽象基类设计，添加新工具不需要改核心代码

下一章：提示词工程——如何跟智能体好好说话。
