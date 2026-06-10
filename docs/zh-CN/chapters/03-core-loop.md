# 03. 思考→行动→观察循环

> **本章内容：智能体的核心运行机制——持续循环，直到任务完成。**

---

## 🎯 目标

学完本章，你将能够：

- 理解思考→行动→观察（Think→Act→Observe）循环
- 构建一个持续运行直到任务完成的智能体
- 处理需要多步工具调用的复杂任务
- 实现任务完成检测

---

## 📖 给 10 岁孩子解释

想象你在做一道复杂的菜。你不是一次性搞定，而是：

1. **思考**：下一步该做什么？"哦，需要切洋葱。"
2. **行动**：切洋葱。
3. **观察**：洋葱切好了，碗里有了碎洋葱。
4. **重复**：下一步做什么？"需要炒洋葱..."

智能体也是这样工作的。它在一个循环中不断重复"想→做→看"：

```
思考："用户让我算租金。我需要查一下数据。"
行动：→ 调用文件读取工具 → 
观察："文件中有 3 个月的数据。"
思考："现在需要算平均值。"
行动：→ 调用计算器工具 →
观察："平均租金是 3500 元。"
思考："准备好了。可以回复了。"
行动：→ 回复用户 →
```

---

## 🔧 动手实践

### Step 1：最简单的循环

```python
def agent_loop(user_input: str, max_steps: int = 10) -> str:
    """核心智能体循环。"""
    messages = [{"role": "user", "content": user_input}]

    for step in range(max_steps):
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=tools,
        )
        msg = response.choices[0].message

        # 没有工具调用 = 任务完成
        if not msg.tool_calls:
            return msg.content

        # 有工具调用 = 继续循环
        messages.append(msg)
        for tc in msg.tool_calls:
            result = execute_tool(tc)
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    return "步骤用完了。"


def execute_tool(tool_call) -> str:
    """执行工具调用。"""
    args = json.loads(tool_call.function.arguments)
    if tool_call.function.name == "calculate":
        return calculate(args["expression"])
    elif tool_call.function.name == "get_weather":
        return get_weather(args["city"])
    return f"未知工具：{tool_call.function.name}"
```

### Step 2：加入思考日志

```python
def agent_with_thinking_log(user_input: str) -> str:
    """每一步都展示思考过程。"""
    messages = [
        {"role": "system", "content": "你是一个会思考的智能体。每次行动前先说你的推理。"},
        {"role": "user", "content": user_input},
    ]

    for step in range(10):
        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
            tools=more_tools,
        )
        msg = response.choices[0].message
        print(f"\n[步骤 {step+1}] 思考：{msg.content}")

        if not msg.tool_calls:
            return msg.content

        messages.append(msg)
        for tc in msg.tool_calls:
            result = execute_tool(tc)
            print(f"  → 行动：{tc.function.name}({tc.function.arguments})")
            print(f"  → 观察：{result}")
            messages.append({"role": "tool", "tool_call_id": tc.id, "content": result})

    return "已达到最大步数。"
```

---

## 🧪 练习

1. 给循环加一个计数器，限制最大步数
2. 如果某一步超时了，跳过它继续
3. 让智能体每一步都报告进度："步骤 1/5：正在计算..."
4. 记录每一步花费的 token 数量
5. 如果循环超过 5 步，让智能体自动简化任务

---

## 📝 总结

| 阶段 | 说明 | 代码 |
|---|---|---|
| 思考 | LLM 决定下一步做什么 | LLM 生成回复 |
| 行动 | 执行工具 | 你的函数 |
| 观察 | 把结果喂给 LLM | 添加 tool 消息 |
| 重复 | 直到 LLM 不调用工具 | while 循环 |

下一章：给智能体装上一个完整的工具系统！
