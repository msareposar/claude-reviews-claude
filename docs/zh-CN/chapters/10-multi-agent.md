# 10. 多智能体协作

> **一个智能体不够用怎么办？组建一个智能体团队！**

---

## 🎯 目标
- 理解多智能体架构和分工
- 为智能体分配不同角色
- 实现智能体之间的消息传递
- 构建编排器（Orchestrator）

## 🔧 代码

### 角色定义
```python
RESEARCHER = "你是一个研究员。搜索信息、整理发现、提供准确引用。"
WRITER = "你是一个作者。把研究成果写成流畅易读的文章。风格生动清晰。"
CRITIC = "你是一个审查员。检查文章的问题：事实错误、逻辑矛盾、遗漏信息。"
```

### 多智能体编排器
```python
import openai, json

def call(messages):
    r = openai.chat.completions.create(model="gpt-4o-mini", messages=messages)
    return r.choices[0].message.content

class AgentTeam:
    def __init__(self):
        self.agents = {}

    def add_agent(self, name: str, system_prompt: str):
        self.agents[name] = system_prompt

    def run(self, agent_name: str, task: str, context: str = "") -> str:
        prompt = f"{context}\n\n任务：{task}" if context else task
        return call([{"role": "system", "content": self.agents[agent_name]}, {"role": "user", "content": prompt}])

# 示例：协作写文章
team = AgentTeam()
team.add_agent("研究员", RESEARCHER)
team.add_agent("作者", WRITER)
team.add_agent("审查员", CRITIC)

# 1. 研究
research = team.run("研究员", "研究 AI agent 的 3 个主要类型")
# 2. 写作
draft = team.run("作者", "写一篇介绍 AI agent 类型的短文", context=f"研究发现：{research}")
# 3. 审查
review = team.run("审查员", f"审查这篇文章：\n{draft}")
```

## 🧪 练习
1. 添加"总结员"角色，汇总团队成果
2. 实现循环协作：审查发现问题→退回作者修改→再审查
3. 让智能体互相投票选择最佳方案

下一章：插件系统。
