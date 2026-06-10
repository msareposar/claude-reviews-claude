# 🤖 智能体开发指南

**从零开始，搭建属于你自己的 AI 智能体。**

> 这本指南为**所有人**设计。不管你是学生、程序员、还是对 AI 好奇的爱好者，跟着步骤走，你就能搭出一个真正能用的智能体。

## 你要造什么？

一个完整的 AI 智能体，它能：
- 听懂人话，按指令做事
- 使用工具（搜索网页、算数学题、读文件）
- 记住上下文和之前的对话
- 规划和执行多步任务
- 和其他智能体一起协作
- 在生产环境中稳定运行

## 为什么读这个？

| 传统方式 | 本指南 |
|---|---|
| 晦涩的论文 | **步骤清晰，图文并茂** |
| 只讲理论，不给代码 | **每章都有可以跑的代码** |
| 必须用某个特定框架 | **从零搭建，真正理解一切** |
| 需要好几年经验 | **新手也能看懂** |

## 章节结构

### 第一部分：基础篇
- **00** — 欢迎来到智能体世界
- **01** — 智能体的大脑：认识 LLM
- **02** — 动手搭建第一个智能体

### 第二部分：核心循环
- **03** — 思考→行动→观察循环
- **04** — 工具系统：手脚并用的智能体
- **05** — 智能体提示词工程

### 第三部分：让它变聪明
- **06** — 上下文与工作记忆
- **07** — 长期记忆系统
- **08** — 错误处理与韧性
- **09** — 任务规划与推理

### 第四部分：进阶能力
- **10** — 多智能体协作
- **11** — 插件系统
- **12** — 安全与权限管理

### 第五部分：工程实践
- **13** — 测试你的智能体
- **14** — 配置与环境管理
- **15** — 持久化存储
- **16** — 部署上线

### 第六部分：运营运维
- **17** — 监控与持续改进

## 快速开始

```bash
# 克隆仓库
git clone https://github.com/msareposar/claude-reviews-claude.git
cd claude-reviews-claude

# 安装依赖
npm install

# 开始阅读
npm run docs:dev
```

从 **第 00 章：欢迎来到智能体世界** 开始你的旅程。

## 代码示例

每一章都包含**完整的、可运行的 Python 代码**。你将一步步地从零搭建你的智能体：

```python
# 第 02 章：你的第一个智能体
import openai  # 或者任何 LLM 提供商

def simple_agent(user_input: str) -> str:
    """一个能回话的最简智能体"""
    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": user_input}]
    )
    return response.choices[0].message.content
```

到了第 17 章，你的智能体会长这样：

```python
agent = Agent(
    llm=GPT4o(),
    tools=[WebSearch(), Calculator(), FileReader()],
    memory=HybridMemory(short_term=100, long_term="sqlite:///agent.db"),
    planner=TreeOfThought(depth=3),
    error_handler=RetryWithFallback(max_retries=3)
)
result = agent.run("调研 AI 智能体，总结发现并保存到 report.md")
```

## 准备工作

- 电脑上装了 **Python 3.9+**
- 会基本的命令行操作
- 有一个 LLM 提供商的 API 密钥（如 OpenAI、Anthropic 等）
- 好奇心和耐心 ❤️

## 在线预览

访问 [在线站点](https://msareposar.github.io/claude-reviews-claude/) 可以直接开始阅读。

---

*用心打造。MIT 许可证。*
