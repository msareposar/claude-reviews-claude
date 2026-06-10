# 02. 动手搭建第一个智能体

> **本章内容：从"对话"到"行动"——给你的 LLM 装上一个工具，打造你的第一个真正意义上的智能体！**

---

## 🎯 目标

学完本章，你将能够：

- 理解"智能体 = LLM + 工具"这个核心公式
- 用 LLM 的函数调用（Function Calling）功能实现工具使用
- 构建一个能计算的智能体
- 理解 LLM 如何决定"什么时候用工具，什么时候直接回答"

---

## 📖 给 10 岁孩子解释

### 聊天机器人和智能体的区别

**聊天机器人**：你说一句话，它回你一句话。像一个笔友。

**智能体**：你给它一个任务，它**去做**。像一个私人助理。

```
聊天机器人： "法国的首都是什么？"
            → "巴黎。"
            互动结束。

智能体：     "帮我算 1234 * 5678，然后查一下东京的天气。"
            → 第一步：计算 1234 * 5678 = 7,006,652
            → 第二步：搜索东京天气
            → 第三步：汇总结果
            → "1234 * 5678 等于 7,006,652。东京现在约 22°C，多云。"
```

区别在于**智能体能用工具**。它不只是知道信息——它还能**做事情**。

---

## 🔧 动手实践：构建你的第一个智能体

### Step 1：什么是函数调用（Function Calling）？

函数调用是 LLM 的一个超能力：你告诉模型有哪些工具可用，模型自己决定什么时候用。

你来定义工具：

```python
def calculator(expression: str) -> str:
    """计算数学表达式。"""
    try:
        result = eval(expression)
        return f"结果：{result}"
    except Exception as e:
        return f"计算错误：{e}"
```

然后你告诉 LLM："你有一个叫 calculator 的工具，可以做数学运算。"

当用户问算术问题时，模型会说："我需要用 calculator 工具。"

### Step 2：最简单的工具函数

```python
import json

def calculate(expression: str) -> str:
    """安全的数学计算。"""
    # 只允许安全字符
    allowed = set("0123456789+-*/.() ")
    if not all(c in allowed for c in expression):
        return "错误：包含非法字符"

    try:
        result = eval(expression, {"__builtins__": {}}, {})
        return f"结果：{result}"
    except ZeroDivisionError:
        return "错误：不能除以零"
    except Exception as e:
        return f"错误：{e}"

# 测试
print(calculate("2 + 2"))       # → 结果：4
print(calculate("10 / 0"))      # → 错误：不能除以零
print(calculate("3 * 4 + 5"))   # → 结果：17
```

### Step 3：把工具描述告诉 LLM

现在我们需要告诉 LLM 这个工具的存在。我们用 OpenAI 的函数调用格式：

```python
import openai

# 定义工具描述（按照 OpenAI 的格式）
tools = [
    {
        "type": "function",
        "function": {
            "name": "calculate",
            "description": "计算数学表达式的值",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "数学表达式，例如 '2 + 2' 或 '3 * 4 + 5'",
                    }
                },
                "required": ["expression"],
            },
        },
    }
]
```

### Step 4：你的第一个智能体循环

```python
def simple_agent(user_input: str) -> str:
    """一个能使用工具的智能体。"""
    # Step 1：调用 LLM，传入工具描述
    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": user_input}],
        tools=tools,  # ← 告诉 LLM 可用工具
        tool_choice="auto",  # ← LLM 自己决定用不用
    )

    message = response.choices[0].message

    # Step 2：检查 LLM 是否想用工具
    if message.tool_calls:
        # LLM 决定使用工具
        for tool_call in message.tool_calls:
            if tool_call.function.name == "calculate":
                args = json.loads(tool_call.function.arguments)
                result = calculate(args["expression"])
                return f"我需要算一下...\n{result}"
    
    # Step 3：如果没调用工具，直接返回回复
    return message.content


# 试试看！
print("=== 我的第一个智能体 ===")
print(simple_agent("你好！你是谁？"))
print()
print(simple_agent("帮我算 12345 * 6789"))
print()
print(simple_agent("15 的平方根是多少？"))
```

### Step 5：完整的智能体循环

真正的智能体需要多步交互——不止一次工具调用：

```python
def full_agent_loop(user_input: str, max_turns: int = 5) -> str:
    """完整的多步智能体循环。"""
    messages = [{"role": "user", "content": user_input}]

    for turn in range(max_turns):
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=tools,
            tool_choice="auto",
        )

        message = response.choices[0].message

        # 如果 LLM 没有调用工具，返回回复
        if not message.tool_calls:
            return message.content

        # 执行工具调用
        messages.append(message)  # 把 LLM 的回复加入对话

        for tool_call in message.tool_calls:
            if tool_call.function.name == "calculate":
                args = json.loads(tool_call.function.arguments)
                result = calculate(args["expression"])

                # 把工具结果加入对话
                messages.append({
                    "role": "tool",
                    "tool_call_id": tool_call.id,
                    "content": result,
                })

    return "我已完成我能做的步骤。"

# 试试多步任务
print("=== 多步智能体 ===")
result = full_agent_loop("计算 (15 + 3) * 2 和 100 / 4，然后告诉我两个结果中哪个更大")
print(result)
```

### Step 6：加上更多工具

```python
def get_weather(city: str) -> str:
    """获取城市天气（模拟）。"""
    weather_data = {
        "北京": "22°C，晴",
        "上海": "25°C，多云",
        "深圳": "28°C，阵雨",
        "东京": "18°C，阴",
        "纽约": "15°C，晴",
    }
    return weather_data.get(city, f"没有 {city} 的天气数据")

# 更多工具描述
more_tools = tools + [
    {
        "type": "function",
        "function": {
            "name": "get_weather",
            "description": "查询城市天气",
            "parameters": {
                "type": "object",
                "properties": {
                    "city": {
                        "type": "string",
                        "description": "城市名称，如'北京'、'上海'",
                    }
                },
                "required": ["city"],
            },
        },
    }
]

def agent_with_multiple_tools(user_input: str) -> str:
    """带多个工具的智能体。"""
    messages = [{"role": "user", "content": user_input}]

    for turn in range(5):
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=more_tools,
            tool_choice="auto",
        )

        message = response.choices[0].message

        if not message.tool_calls:
            return message.content

        messages.append(message)

        for tool_call in message.tool_calls:
            args = json.loads(tool_call.function.arguments)

            if tool_call.function.name == "calculate":
                result = calculate(args["expression"])
            elif tool_call.function.name == "get_weather":
                result = get_weather(args["city"])
            else:
                result = f"未知工具：{tool_call.function.name}"

            messages.append({
                "role": "tool",
                "tool_call_id": tool_call.id,
                "content": result,
            })

    return "任务完成。"

# 试试多工具任务
print("=== 带多个工具的智能体 ===")
result = agent_with_multiple_tools("北京现在多少度？顺便帮我算 2 月有几天 × 3 小时")
print(result)
```

---

## 🔍 工作原理

### 函数调用流程

```
用户说："帮我算 2 + 2"
         │
         ▼
┌──────────────────┐
│ LLM 分析意图      │ "用户想让我计算"
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ LLM 返回工具调用  │ {"name": "calculate",
│                  │  "args": {"expression": "2 + 2"}}
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 执行工具         │ → 结果："4"
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ 结果送回 LLM     │ "工具返回：4。现在组织回复。"
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│ LLM 给出最终回复 │ "2 + 2 = 4"
└──────────────────┘
```

### LLM 怎么决定什么时候用工具？

这取决于三件事：

1. **用户的问题**：如果涉及数学，LLM 倾向于用 calculate
2. **工具的描述**：描述越清晰，LLM 越会用对
3. **你的设置**：`tool_choice="auto"` 让 LLM 自己决定，`tool_choice="required"` 强制用工具

---

## 🧪 练习

1. **加一个新工具**：创建一个 `get_time(city)` 函数，返回城市当前时间。把它加到智能体里。

2. **错误处理**：如果计算器收到 `calculate("你好")`，会发生什么？优化错误信息。

3. **工具链**：让智能体先查天气，再根据温度推荐穿什么。需要多次交互。

4. **对比测试**：用一个纯聊天 LLM（没有工具）和你的智能体同时回答"327 * 891"，谁对？

5. **建造者挑战**：创建一个 `translate(text, target_language)` 工具，用另一个 LLM 调用来实现翻译。

---

## 📝 总结

- **智能体 = LLM + 工具**——这是最核心的公式
- **函数调用（Function Calling）** 让 LLM 决定什么时候用什么工具
- LLM 不直接执行工具——它**申请**使用，你的代码来执行
- 工具描述写得好，LLM 用得对
- 多步循环让智能体能完成复杂的任务

> **下一章：思考→行动→观察循环——深入理解智能体的核心运行机制！**
