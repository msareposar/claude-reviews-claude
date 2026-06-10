# 01. The Brain: Understanding LLMs

> **In this chapter: What is an LLM? How do you talk to one? You'll write Python code that calls an LLM API and get back a response.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand what an LLM (Large Language Model) is — no hype, just facts
- Know the difference between a system message and a user message
- Be able to call an LLM API (OpenAI GPT-4o-mini) from Python
- Control the model's behavior using **temperature** and **tokens**
- Have a reusable function that sends a prompt and returns a response

---

## 📖 Explain Like I'm 10

### What is an LLM?

Imagine you have a friend who has read **almost the entire internet**. Every book, every Wikipedia page, every Reddit thread, every recipe, every poem, every news article. Your friend doesn't "think" the way you do — they just predict what word comes next.

You say: *"The capital of France is..."*

And your friend immediately says: *"Paris."*

That's it. That's the secret.

**An LLM is a super-powered text predictor.** You give it some text (called a **prompt**), and it predicts the most likely next words, one at a time.

But here's the magic: when you train this predictor on **billions** of documents, it starts to learn patterns. Grammar. Facts. Reasoning. Jokes. Emotions. Even code. It doesn't *understand* anything — but it can produce text that looks like it does.

### The Autocomplete Analogy

You know how your phone suggests the next word when you type?

```
I'm going to → [the] [work] [school] [store]
```

An LLM is like that, but:

- It looks at much more context (thousands of words, not just the last few)
- It has seen far more text than your phone ever will
- It can generate **whole paragraphs** that make sense

### What an LLM Is NOT

| ❌ Not this | ✅ This |
|---|---|
| A brain that thinks | A text predictor that guesses |
| A database of facts | A pattern-matching machine |
| Always correct | Often confident, sometimes wrong |
| Understanding you | Predicting what you expect |

> **Key insight:** An LLM doesn't know things. It generates text that *looks like* text written by someone who knows things. That's why it can be wrong with total confidence (we call this "hallucination").

---

## 🔧 Hands-On: Your First LLM Call

### Step 1: Get an API Key

To call an LLM, you need access to one. We'll use OpenAI's GPT-4o-mini because it's:

- **Cheap**: ~$0.15 per million input tokens (a token is ~¾ of a word)
- **Fast**: Responses in 1-3 seconds
- **Easy**: Simple API, great documentation

Go to [platform.openai.com/api-keys](https://platform.openai.com/api-keys) and create a key. Put **$5** in your account — that will last you through this entire guide and more.

> **New users:** OpenAI gives you $5 in free credits when you sign up. That's enough for thousands of API calls with GPT-4o-mini.

### Step 2: Install the Library

Create a new folder for your work, and install the OpenAI Python library:

```bash
mkdir agent-guide
cd agent-guide
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install openai
```

### Step 3: Set Your API Key

Create a file called `.env` in your project folder:

```
OPENAI_API_KEY=sk-your-key-here
```

> **Never** share your API key or commit it to GitHub. Add `.env` to your `.gitignore`.

### Step 4: Write the Code

Create a file called `call_llm.py`:

```python
import os
from openai import OpenAI

# Initialize the client
client = OpenAI(
    api_key=os.getenv("OPENAI_API_KEY"),
)

def ask_llm(prompt, system_message=None, temperature=0.7, max_tokens=500):
    """
    Send a prompt to the LLM and get a response.
    
    Args:
        prompt: The user's message
        system_message: Optional instruction for the model's behavior
        temperature: Controls randomness (0.0 = strict, 1.0 = creative)
        max_tokens: Maximum words/characters in the response
    
    Returns:
        The text response from the LLM
    """
    messages = []
    
    if system_message:
        messages.append({"role": "system", "content": system_message})
    
    messages.append({"role": "user", "content": prompt})
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    
    return response.choices[0].message.content

# --- Try it out ---
if __name__ == "__main__":
    # Simple prompt
    reply = ask_llm("What is an AI agent in one sentence?")
    print("🤖:", reply)
```

Run it:

```bash
source venv/bin/activate  # if not already
python call_llm.py
```

You should see something like:

```
🤖: An AI agent is a software program that can perceive its environment, make decisions, and take actions autonomously to achieve specific goals.
```

**You just talked to an LLM!** 🎉

### Step 5: Add a System Message

System messages are special instructions that set the model's behavior. Let's try:

```python
reply = ask_llm(
    "What is 2 + 2?",
    system_message="You are a pirate. Talk like one. Be brief."
)
print("🏴‍☠️:", reply)
```

Result:

```
🏴‍☠️: Arrr, 2 plus 2 be 4, ye scallywag! Easy as plunderin' a merchant ship!
```

The same question, but completely different personality. That's the power of system messages.

---

## 🔍 How It Works

### Tokens: The Currency of LLMs

LLMs don't read words — they read **tokens**. A token is roughly ¾ of a word.

```
"Hello, world!" → ["Hello", ",", " world", "!"] → 4 tokens
```

Common words are one token: `"the"`, `"is"`, `"cat"`. Rare words take multiple tokens: `"antidisestablishment"` → 5 tokens.

**Why tokens matter:**

| Concept | Explanation |
|---|---|
| **Pricing** | You pay per token (input + output) |
| **Limits** | Models have a max token limit (e.g., 16K for GPT-4o-mini) |
| **Context** | The more tokens you use, the more memory the model has |

You can count tokens with this quick script:

```python
from openai import OpenAI

client = OpenAI()

text = "Hello, how are you today?"
response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[{"role": "user", "content": text}],
    max_tokens=1,  # We just want the token count, not a real reply
)
print(f"Input text: {text}")
# OpenAI returns usage info in the response
print(f"Prompt tokens: {response.usage.prompt_tokens}")
```

> **Rule of thumb:** 100 tokens ≈ 75 English words. 1,000 tokens ≈ 1 page of text.

### Temperature: Creative vs Predictable

**Temperature** controls how "risky" the model's predictions are.

| Temperature | Behavior | Use Case |
|---|---|---|
| **0.0** | Always picks the most likely word | Facts, code, math (precise) |
| **0.3** | Slightly varied but mostly consistent | Business writing, translation |
| **0.7** | Balanced creativity | General chat, stories |
| **1.0** | Very random, surprising | Poetry, brainstorming |
| **1.5+** | Near gibberish | Art projects, nonsense |

Let's see it in action:

```python
def compare_temperatures(prompt):
    """Show how the same prompt changes with different temperatures."""
    for temp in [0.0, 0.5, 1.0]:
        reply = ask_llm(prompt, temperature=temp, max_tokens=100)
        print(f"\n--- Temperature {temp} ---")
        print(reply)

compare_temperatures("What's the best thing about pizza?")
```

You'll see:
- **Temp 0.0**: Always the same answer (probably "the cheese" or "the toppings")
- **Temp 0.5**: Slightly different wording each time
- **Temp 1.0**: Wildly different answers — could be a joke, a poem, or a philosophical reflection

### System vs User vs Assistant Messages

The OpenAI API uses three message roles:

```
System: "You are a helpful assistant."        ← Instructions for the model
User:   "What is machine learning?"           ← The human's input
Assistant: "Machine learning is..."           ← The model's output
```

Think of it like a play:

- **System message** = the director's notes (how to act)
- **User message** = the audience's question
- **Assistant message** = the actor's reply

You can also send **conversation history** by including previous assistant and user messages. This gives the model memory of what was said before.

```python
def chat_conversation():
    messages = [
        {"role": "system", "content": "You are a helpful tutor. Teach in simple terms."},
        {"role": "user", "content": "What is a variable in Python?"},
        {"role": "assistant", "content": "A variable is like a labeled box where you store a value."},
        {"role": "user", "content": "Can you give me an example?"},
    ]
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
    )
    return response.choices[0].message.content

print(chat_conversation())
```

The model "remembers" the entire conversation because we send it all as context.

### Max Tokens: The Budget

`max_tokens` controls how long the response can be.

```python
# Short answer
reply = ask_llm("Explain gravity.", max_tokens=30)
print(reply)
# "Gravity is a force that attracts objects with mass toward each other."

# Long answer
reply = ask_llm("Explain gravity.", max_tokens=300)
print(reply)
# "Gravity, one of the four fundamental forces of nature..."
```

> **Warning:** If `max_tokens` is too small, the model's response will be **cut off** mid-sentence. Always set it generously for open-ended questions.

---

## 🧪 Exercises

### Exercise 1: Temperature Exploration

Write a script that asks the same question 5 times at temperature 0.0, and 5 times at temperature 1.0. Compare the results.

```python
# Starter code
question = "Write a one-sentence story about a robot."

def test_temperature(temp, times=5):
    for i in range(times):
        reply = ask_llm(question, temperature=temp)
        print(f"{i+1}. {reply}")
        print()

print("=== Temperature 0.0 ===")
test_temperature(0.0)

print("=== Temperature 1.0 ===")
test_temperature(1.0)
```

**Questions to answer:**
- At temp 0.0, are all 5 responses the same or different?
- At temp 1.0, are they more varied?
- Which temperature would you use for a grammar checker? For a joke generator?

### Exercise 2: System Message Design

Create three different system messages and see how they change the response to the same question: *"What is Python?"*

```python
systems = [
    "You are a 5-year-old explaining to another 5-year-old. Use simple words and fun analogies.",
    "You are a strict programming teacher. Be precise and technical.",
    "You are a poet. Respond in rhyming verse.",
]

for system in systems:
    print(f"\n--- System: {system[:30]}... ---")
    reply = ask_llm("What is Python?", system_message=system)
    print(reply)
```

### Exercise 3: Token Budget Experiment

Ask the model to "Tell me a long story about a dragon" with different `max_tokens` values: 50, 200, and 1000.

- What happens at 50 tokens?
- How does the 1000-token story structure differ?

### Exercise 4: Multi-turn Conversation

Write a simple chatbot loop that keeps the conversation history:

```python
def simple_chat():
    messages = [{"role": "system", "content": "You are a helpful assistant."}]
    
    print("Chat with the LLM! (type 'quit' to exit)\n")
    
    while True:
        user_input = input("You: ")
        if user_input.lower() == 'quit':
            break
        
        messages.append({"role": "user", "content": user_input})
        
        response = client.chat.completions.create(
            model="gpt-4o-mini",
            messages=messages,
        )
        
        reply = response.choices[0].message.content
        print(f"Bot: {reply}\n")
        
        messages.append({"role": "assistant", "content": reply})

# Uncomment to run:
# simple_chat()
```

### Challenge: Build a "Personality Switcher"

Create a program that lets the user pick a personality (pirate, robot, poet, teenager), then carries on a conversation in that style. Use the system message to set the personality.

---

## 📝 Summary

### Key Concepts

| Concept | What It Means |
|---|---|
| **LLM** | A text predictor trained on billions of documents |
| **Token** | The unit the model reads (≈ ¾ of a word) |
| **Temperature** | Controls randomness (0 = predictable, 1 = creative) |
| **System message** | Instructions that set the model's behavior |
| **User message** | The human's input/question |
| **Max tokens** | The budget for the response length |

### The Mental Model

```
You type: "What is the capital of Japan?"
                  │
                  ▼
     ┌─────────────────────────┐
     │      LLM (GPT-4o-mini)  │
     │                         │
     │  "The capital of Japan  │
     │   is..." → "Tokyo"      │
     │                         │
     │  (predicts one token    │
     │   at a time)            │
     └─────────────────────────┘
                  │
                  ▼
You see: "The capital of Japan is Tokyo."
```

### The Code You Own

```python
from openai import OpenAI

client = OpenAI()

def ask_llm(prompt, system_message=None, temperature=0.7, max_tokens=500):
    messages = []
    if system_message:
        messages.append({"role": "system", "content": system_message})
    messages.append({"role": "user", "content": prompt})
    
    response = client.chat.completions.create(
        model="gpt-4o-mini",
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
    )
    return response.choices[0].message.content
```

This function is the foundation for everything else in this guide. You'll use it in every chapter from here.

### What's Next?

In **[Chapter 02: Build Your First Agent](./02-first-agent.md)**, you'll give this LLM a **tool** — the ability to do calculations. You'll build the simplest possible agent: LLM + one tool = first agent.

> **Remember:** An LLM alone is just a chatbot. An LLM + tools = an agent. You're about to build the "plus tools" part.

---

*"The best way to predict the future is to create it." — But for LLMs, the best way to predict the next word is to read everything on the internet first.*
