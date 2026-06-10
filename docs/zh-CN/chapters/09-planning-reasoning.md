# 09. 任务规划与推理

> **如何让智能体不只是"接一句话"，而是"完成一个任务"？**

---

## 🎯 目标
- 理解 ReAct 模式（推理 + 行动）
- 实现任务分解（把复杂任务拆成小步骤）
- 使用思维链（Chain of Thought）提升推理能力
- 构建任务规划器

## 🔧 代码

### ReAct 模式
```python
def react_agent(task: str, tools: dict, max_steps=10):
    messages = [{"role": "system", "content": """每步用以下格式：
思考：<你的推理>
行动：{"tool": "工具名", "args": {...}}
当完成时输出：
最终：<最终回答>"""},
        {"role": "user", "content": task}]

    for _ in range(max_steps):
        r = openai.chat.completions.create(model="gpt-4o-mini", messages=messages)
        text = r.choices[0].message.content

        if "最终：" in text:
            return text.split("最终：")[-1]

        # 解析行动
        if "行动：" in text:
            action_line = text.split("行动：")[-1].strip()
            action = json.loads(action_line)
            tool_name, args = action["tool"], action["args"]
            result = tools[tool_name](**args) if tool_name in tools else f"未知工具：{tool_name}"
            messages.append({"role": "assistant", "content": text})
            messages.append({"role": "user", "content": f"观察结果：{result}"})
    return "无法在步数限制内完成。"
```

### 思维链
```python
def chain_of_thought(prompt: str) -> str:
    r = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": f"一步一步思考，然后回答：\n{prompt}"}],
        temperature=0.3,
    )
    return r.choices[0].message.content
```

### 任务分解
```python
def decompose(task: str) -> list:
    r = openai.chat.completions.create(model="gpt-4o-mini",
        messages=[{"role": "user", "content": f"把这个任务分解成 3-5 个步骤，返回JSON数组：\n{task}"}])
    import re
    m = re.search(r'\[.*\]', r.choices[0].message.content, re.DOTALL)
    return json.loads(m.group(0)) if m else [{"step": 1, "action": task}]
```

## 🧪 练习
1. 让智能体每一步输出进度（"步骤 2/5"）
2. 如果某步失败，重新规划剩余步骤
3. 实现树状思维（Tree of Thought）：探索多种可能性再选最佳

下一章：多智能体协作。
