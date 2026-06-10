# 01. 智能体的大脑：认识 LLM

> **本章内容：什么是 LLM？怎么和它对话？你会写出 Python 代码来调用 LLM API 并得到回复。**

---

## 🎯 目标

学完本章，你将能够：

- 理解什么是大语言模型（LLM）——没有噱头，只有事实
- 区分系统消息（System Message）和用户消息（User Message）
- 用 Python 调用 OpenAI GPT-4o-mini API
- 通过 **temperature** 和 **tokens** 控制模型行为
- 拥有一个可复用的发送提示词并获取回复的函数

---

## 📖 给 10 岁孩子解释

### 什么是 LLM？

想象你有一个朋友，他读了**几乎整个互联网**。所有的书、维基百科页面、Reddit 帖子、菜谱、诗歌、新闻文章。这个朋友不是像你那样"思考"——他只是在预测下一个词是什么。

你说：*"法国的首都是..."*

他立刻回答：*"巴黎。"*

就是这样。这就是秘密。

LLM（大语言模型）就是一个"超级自动补全"。你给它一些文字开头，它预测接下来应该是什么。

### 为什么它看起来像在"思考"？

你教一个孩子"2+2="，他们学会了说"4"。孩子不是在做数学——他们记住了模式。

LLM 也是这样。当它被上万亿个文本片段训练过后，它学会了模式，所以看起来像在推理。但它只是在玩一个"下一个词是什么？"的游戏，玩得真的非常好。

> **LLM 就像一个读过整个互联网的自动补全工具。**

---

## 🔧 动手实践：你的第一个 LLM 调用

### Step 1：安装必要的包

```bash
pip install openai python-dotenv
```

### Step 2：获取 API 密钥

1. 访问 [platform.openai.com](https://platform.openai.com)
2. 注册/登录
3. 点击右上角 → View API Keys → Create new secret key
4. 复制密钥

> **省钱提示**：GPT-4o-mini 很便宜（~$0.15/百万输入 token）。一个简单的对话大概花不到一分钱。

### Step 3：设置 API 密钥

创建一个 `.env` 文件：

```bash
echo "OPENAI_API_KEY=sk-your-key-here" > .env
```

或者直接设置环境变量：

```bash
export OPENAI_API_KEY="sk-your-key-here"
```

### Step 4：写你的第一个 LLM 调用

```python
import openai
import os
from dotenv import load_dotenv

# 加载 API 密钥
load_dotenv()
openai.api_key = os.getenv("OPENAI_API_KEY")

def ask_llm(prompt: str) -> str:
    """向 LLM 发送提示词并返回回复。"""
    response = openai.chat.completions.create(
        model="gpt-4o-mini",  # 快速且便宜
        messages=[
            {"role": "user", "content": prompt}
        ],
    )
    return response.choices[0].message.content

# 试试看！
print(ask_llm("法国的首都是什么？"))
```

运行它：

```bash
python your_first_llm.py
```

你应该看到输出：`法国的首都是巴黎。` 或其他类似回答。

### Step 5：理解消息结构

LLM API 接受一个**消息列表**。每条消息有一个**角色**和**内容**：

```python
messages = [
    {"role": "system", "content": "你是一个乐于助人的助手。"},
    {"role": "user", "content": "1 月东京天气怎么样？"},
    {"role": "assistant", "content": "东京一月份天气通常寒冷干燥。"},
    {"role": "user", "content": "我该穿什么？"},
]
```

| 角色 | 用途 | 谁能写这个 |
|---|---|---|
| **system** | 设定 AI 的行为、语气、规则 | 你（开发者） |
| **user** | 用户输入的问题或指令 | 用户 |
| **assistant** | AI 的回复 | 只有 AI |

```python
def ask_with_system(system_prompt: str, user_prompt: str) -> str:
    """带系统提示词调用 LLM。"""
    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ],
    )
    return response.choices[0].message.content

# 试试不同的系统提示词
print("=== 友好的助手 ===")
print(ask_with_system("你是一个友好的助手。用 emoji 回复。", "你好吗？"))

print("\n=== 严格的老师 ===")
print(ask_with_system("你是一个严格的老师。纠正语法错误。", "我今天很开心。"))

print("\n=== 诗人 ===")
print(ask_with_system("你是一个诗人。用押韵回复。", "写一首关于猫的诗。"))
```

### Step 6：理解参数

#### Temperature（温度）

Temperature 控制随机性：

```python
def ask_with_temperature(prompt: str, temperature: float) -> str:
    """用不同的 temperature 调用 LLM。"""
    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=temperature,  # 0.0 = 精确, 1.0 = 随机
    )
    return response.choices[0].message.content

prompt = "给我起一个太空猫的名字。"

print("=== Temperature 0.0 (总是相同) ===")
for i in range(3):
    print(f"  尝试 {i+1}: {ask_with_temperature(prompt, 0.0)}")

print("\n=== Temperature 0.9 (每次不同) ===")
for i in range(3):
    print(f"  尝试 {i+1}: {ask_with_temperature(prompt, 0.9)}")
```

| Temperature | 行为 | 什么时候用 |
|---|---|---|
| 0.0 - 0.2 | 精确、确定、可重复 | 工具调用、解析 JSON |
| 0.3 - 0.5 | 平衡、可靠 | 大多数智能体任务 |
| 0.6 - 0.9 | 创意、多样 | 写作、头脑风暴 |

#### Max Tokens（最大 Token）

限制回复长度：

```python
def ask_with_max_tokens(prompt: str, max_tokens: int) -> str:
    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=max_tokens,  # 回复最多用多少 token
    )
    return response.choices[0].message.content

print("=== 最多 20 tokens ===")
print(ask_with_max_tokens("解释什么是 AI", 20))

print("\n=== 最多 200 tokens ===")
print(ask_with_max_tokens("解释什么是 AI", 200))
```

### Step 7：构建可复用的 LLM 工具函数

```python
import openai
from typing import Optional

def call_llm(
    prompt: str,
    system_prompt: Optional[str] = None,
    model: str = "gpt-4o-mini",
    temperature: float = 0.3,
    max_tokens: Optional[int] = None,
) -> str:
    """一个通用的 LLM 调用函数。"""
    messages = []
    if system_prompt:
        messages.append({"role": "system", "content": system_prompt})
    messages.append({"role": "user", "content": prompt})

    kwargs = {
        "model": model,
        "messages": messages,
        "temperature": temperature,
    }
    if max_tokens:
        kwargs["max_tokens"] = max_tokens

    response = openai.chat.completions.create(**kwargs)
    return response.choices[0].message.content

# 用法示例
print(call_llm("法国的首都是什么？"))
print(call_llm("讲个笑话", system_prompt="你是一个幽默的助手"))
print(call_llm("写一句诗", temperature=0.9))
```

---

## 🔍 工作原理

### 引擎盖下的原理（简化版）

当你发送提示词时：
1. **Tokenization**：你的文本被切分成 token（"Hello world" → ["Hello", " world"]）
2. **Processing**：模型读取所有 token，计算每个可能的下一个 token 的概率
3. **Generation**：模型选择下一个 token（基于概率 + temperature）
4. **Repeat**：重复直到满足停止条件或达到 max_tokens

### 一个 token 是多少？

| 文本 | 大概的 tokens |
|---|---|
| "Hello" | 1 |
| "Hello world" | 2 |
| "法国的首都是巴黎" | 6-8 |
| 一篇典型网页文章 | 500-2000 |
| 一本完整小说 | 100,000+ |

检查你的提示词用了多少 tokens：

```python
import tiktoken

def count_tokens(text: str, model: str = "gpt-4o-mini") -> int:
    """统计文本的 token 数量。"""
    try:
        encoder = tiktoken.encoding_for_model(model)
    except KeyError:
        encoder = tiktoken.get_encoding("cl100k_base")
    return len(encoder.encode(text))

text = "法国的首都是巴黎"
print(f"'{text}' = {count_tokens(text)} tokens")
```

---

## 🧪 练习

1. **切换模型**：把 `model` 从 `"gpt-4o-mini"` 改成 `"gpt-4o"`。有什么不同？更快？更好？

2. **用系统提示词设规则**：写一个系统提示词 "只用三个词回答"。问一些问题，看它是否遵守。

3. **比较不同 temperature**：提出一个创意问题（"一个会飞的企鹅的故事"），用 temperature=0 和 1.0 各跑一次。哪个更有趣？

4. **检查错误**：不加 API 密钥会怎样？试试不联网。你得到什么错误信息？

5. **建造者挑战**：把 `call_llm()` 扩展成可以用列表一次发多个提示词。

---

## 📝 总结

- **LLM** 是一个读过海量文本的终极自动补全工具
- **消息** 有 system/user/assistant 三种角色
- **System prompt** 设定行为，**User prompt** 是输入
- **Temperature** 控制创造力（低 = 精确，高 = 创意）
- **Tokens** 是模型处理文本的基本单位
- GPT-4o-mini 是最好的起点——快速、便宜、能力足够

下一章，我们将用 LLM 打造你的**第一个智能体**！
