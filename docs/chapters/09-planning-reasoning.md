# 09. Planning & Reasoning

> **In this chapter: How does your agent think through complex tasks? You'll build planning strategies — from simple step-by-step to advanced tree-of-thought reasoning.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand why agents need to plan beyond one step
- Implement the ReAct pattern (Reasoning + Acting)
- Build a task decomposition system
- Create a multi-step planner with progress tracking
- Understand chain-of-thought and tree-of-thought reasoning

---

## 📖 Explain Like I'm 10

### The Difference Between Reacting and Planning

**Reacting**: User asks something → Agent responds immediately (what we've built so far)

**Planning**: User asks something → Agent thinks "what steps do I need?" → Executes step by step

Example:

```
User: "Research the top 3 AI frameworks and compare them."

Reacting Agent:  "Here are some AI frameworks: TensorFlow, PyTorch..."
                 (just lists what it already knows)

Planning Agent:  "Step 1: Search for current top AI frameworks"
                 "Step 2: For each framework, get key features"
                 "Step 3: Create a comparison table"
                 "Step 4: Summarize findings"
```

The planning agent does **research** — it doesn't just rely on what it already knows.

---

## 🔧 Hands-On: Building a Planning Agent

### Step 1: The ReAct Pattern

ReAct = **Rea**soning + **Act**ion. The pattern:

1. **Thought**: What should I do next?
2. **Action**: Do something (use a tool, search, calculate)
3. **Observation**: What happened?
4. Repeat until done

```python
import openai
import json
import time

class ReActAgent:
    """Agent using the ReAct (Reasoning + Acting) pattern."""

    def __init__(self, tools: dict = None):
        self.tools = tools or {}
        self.max_steps = 10

    def run(self, task: str) -> str:
        """Execute a task using ReAct loop."""
        system_prompt = """You are a planning agent. Work through tasks step by step.

For each step, respond in this format:
THOUGHT: <your reasoning about what to do next>
ACTION: {"tool": "tool_name", "args": {...}}

When you have the final answer:
FINAL: <your complete response to the user>

Available tools: {tools}"""

        tool_descriptions = "\n".join(
            f"- {name}: {tool.__doc__ or 'No description'}"
            for name, tool in self.tools.items()
        )
        system_prompt = system_prompt.format(tools=tool_descriptions)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"Task: {task}"},
        ]

        step_count = 0
        while step_count < self.max_steps:
            step_count += 1

            # Get LLM's next step
            response = openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=messages,
                temperature=0.3,
            )
            response_text = response.choices[0].message.content

            # Check if we have a final answer
            if "FINAL:" in response_text:
                final = response_text.split("FINAL:")[-1].strip()
                return final

            # Parse thought and action
            parts = response_text.split("\n")
            thought = ""
            action_json = ""

            for line in parts:
                if line.startswith("THOUGHT:"):
                    thought = line[8:].strip()
                elif line.startswith("ACTION:"):
                    action_json = line[7:].strip()

            if not action_json:
                # LLM didn't produce a valid action, try again
                messages.append({"role": "assistant", "content": response_text})
                messages.append({"role": "user",
                    "content": "Please respond with THOUGHT: and ACTION: or FINAL:"})
                continue

            # Parse and execute action
            try:
                action = json.loads(action_json)
                tool_name = action.get("tool")
                tool_args = action.get("args", {})

                if tool_name in self.tools:
                    print(f"  [Step {step_count}] {thought}")
                    result = self.tools[tool_name](**tool_args)
                else:
                    result = f"Tool '{tool_name}' not found. Available: {list(self.tools.keys())}"

            except json.JSONDecodeError:
                result = f"Could not parse action JSON: {action_json[:100]}"
            except Exception as e:
                result = f"Tool error: {e}"

            # Add to conversation
            messages.append({"role": "assistant", "content": response_text})
            messages.append({"role": "user", "content": f"OBSERVATION: {result}"})

        return "I couldn't complete this task in the available steps. Here's my progress so far."


# Simple tools for demo
def search_web(query: str) -> str:
    """Search the web for information."""
    # Simulated search
    results = {
        "best AI frameworks": "TensorFlow, PyTorch, JAX, LangChain, LlamaIndex",
        "python machine learning": "scikit-learn, TensorFlow, PyTorch, Keras",
        "langchain vs llamaindex": "LangChain for agent chains, LlamaIndex for RAG",
    }
    for key, value in results.items():
        if key.lower() in query.lower():
            return value
    return f"Search results for '{query}': (simulated)"

def calculator(expression: str) -> str:
    """Calculate a mathematical expression."""
    try:
        allowed = set("0123456789+-*/.() ")
        if not all(c in allowed for c in expression):
            return "Error: invalid characters"
        return str(eval(expression, {"__builtins__": {}}, {}))
    except Exception as e:
        return f"Error: {e}"

# Demo
agent = ReActAgent(tools={"search": search_web, "calculate": calculator})

print("=== ReAct Agent in Action ===")
result = agent.run("What are the top 3 Python AI frameworks and how many letters in each name?")
print(f"\nFinal Answer:\n{result}")
```

### Step 2: Chain of Thought Prompting

You don't need special code for chain-of-thought — just tell the LLM to think step by step:

```python
def chain_of_thought_agent(task: str) -> str:
    """Simple agent with built-in chain-of-thought reasoning."""
    prompt = f"""Work through this step by step:

Task: {task}

Let's think through this carefully, one step at a time.
Think step by step, then give your final answer."""

    response = openai.chat.completions.create(
        model="gpt-4o-mini",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
    )
    return response.choices[0].message.content

# Demo
print("=== Chain of Thought ===")
print(chain_of_thought_agent("""
Alice has 3 apples. Bob gives her 5 more.
Then she gives half to Charlie. How many does Charlie get?
"""))
```

### Step 3: Task Decomposition

Break a big task into smaller subtasks:

```python
class TaskPlanner:
    """Plan and execute complex tasks by decomposing them."""

    def plan(self, task: str) -> list:
        """Break a task into sub-steps."""
        prompt = f"""Break this task into 3-5 simple, concrete steps.
Return ONLY a JSON array of step objects:
[{{"step": 1, "action": "what to do", "tool": "tool_name", "depends_on": []}}]

Task: {task}

Steps:"""

        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.2,
        )

        try:
            text = response.choices[0].message.content
            # Find JSON in response
            import re
            json_match = re.search(r'\[.*\]', text, re.DOTALL)
            if json_match:
                return json.loads(json_match.group(0))
            return json.loads(text)
        except:
            # Fallback: create simple steps
            return [
                {"step": 1, "action": f"Understand requirement: {task}", "tool": "", "depends_on": []},
                {"step": 2, "action": "Gather information", "tool": "search", "depends_on": [1]},
                {"step": 3, "action": "Process and summarize", "tool": "", "depends_on": [2]},
                {"step": 4, "action": "Format final answer", "tool": "", "depends_on": [3]},
            ]

    def execute_plan(self, task: str, tools: dict) -> str:
        """Execute a planned set of steps."""
        steps = self.plan(task)
        results = {}

        print(f"📋 Plan for: {task}")
        for step in steps:
            print(f"  Step {step['step']}: {step['action']}")

            # Check dependencies
            deps_met = all(d in results for d in step.get("depends_on", []))
            context = ""
            if not deps_met:
                context = "Previous steps completed. Continue."

            # Execute the step
            step_prompt = f"""Task: {task}
Current step ({step['step']}): {step['action']}
Previous results: {results}

Complete this step and return the result."""

            response = openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": step_prompt}],
                temperature=0.3,
            )

            step_result = response.choices[0].message.content
            results[step["step"]] = step_result
            print(f"  ✅ Done")

        # Final synthesis
        final_prompt = f"""Task: {task}

Step results:
{json.dumps(results, indent=2)}

Synthesize all step results into a complete, coherent final answer."""

        final = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": final_prompt}],
            temperature=0.3,
        )
        return final.choices[0].message.content


# Demo
planner = TaskPlanner()
result = planner.execute_plan(
    "Compare Python and JavaScript for AI development. Which is better and why?",
    {}
)
print(f"\n=== Final Answer ===\n{result}")
```

### Step 4: Tree of Thought

Instead of following one chain, explore multiple possibilities:

```python
class TreeOfThought:
    """Explore multiple reasoning paths."""

    def __init__(self, branches: int = 3, depth: int = 2):
        self.branches = branches
        self.depth = depth

    def solve(self, problem: str) -> str:
        """Solve using tree-of-thought exploration."""
        # Step 1: Generate initial approaches
        prompt = f"""Problem: {problem}

Suggest {self.branches} different approaches to solve this.
For each, explain the approach and expected outcome.

Return as JSON:
[{{"approach": "name", "reasoning": "...", "expected": "..."}}]"""

        response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": prompt}],
            temperature=0.7,
        )

        print("🌳 Initial approaches generated")
        approaches_text = response.choices[0].message.content

        # Step 2: Evaluate each approach
        eval_prompt = f"""Problem: {problem}

Approaches considered:
{approaches_text}

Evaluate each approach. Which is most promising? Why?
Consider: feasibility, accuracy, completeness.

Return your recommended approach and why."""

        eval_response = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": eval_prompt}],
            temperature=0.3,
        )

        # Step 3: Execute best approach
        recommendation = eval_response.choices[0].message.content

        final_prompt = f"""Problem: {problem}

Recommended approach:
{recommendation}

Execute the recommended approach and provide the complete solution."""

        final = openai.chat.completions.create(
            model="gpt-4o-mini",
            messages=[{"role": "user", "content": final_prompt}],
            temperature=0.3,
        )

        return final.choices[0].message.content

# Demo
print("=== Tree of Thought ===")
solver = TreeOfThought(branches=2, depth=1)
result = solver.solve("A farmer has 17 chickens, 12 ducks, and 5 sheep. How many legs total?")
print(f"\nResult: {result}")
```

### Step 5: Complete Planning Agent

```python
class CompletePlanningAgent:
    """Full-featured agent with planning, ReAct, and fallback."""

    def __init__(self, tools: dict = None):
        self.tools = tools or {}
        self.planner = TaskPlanner()
        self.memory = []  # Keep track of what we've done

    def run(self, task: str) -> str:
        """Execute a task with full planning pipeline."""
        # Quick check: can we answer directly?
        if len(task) < 50 and not any(t in task for t in ["search", "research", "find", "compare"]):
            response = openai.chat.completions.create(
                model="gpt-4o-mini",
                messages=[{"role": "user", "content": task}],
            )
            return response.choices[0].message.content

        # Complex task: use planning
        print(f"🔍 Analyzing task: {task}")
        result = self.planner.execute_plan(task, self.tools)
        self.memory.append({"task": task, "result": result[:100]})
        return result

# Demo
agent = CompletePlanningAgent(tools={"search": search_web, "calculate": calculator})

result = agent.run("What is 15 * 7?")
print(f"Simple: {result}\n")

result = agent.run("Research what Python AI libraries are popular in 2024 and compare top 3")
print(f"\nComplex: {result}")
```

---

## 🔍 How It Works

### Planning Strategies Compared

| Strategy | How it works | Best for | Cost |
|---|---|---|---|
| **Direct** | One-shot answer | Simple questions | Lowest |
| **Chain-of-Thought** | "Let's think step by step" | Logic, math problems | Low |
| **ReAct** | Thought → Action → Observation → Repeat | Tool-using agents | Medium |
| **Task Decomposition** | Break into sub-steps, execute each | Complex multi-step tasks | Medium-High |
| **Tree-of-Thought** | Explore multiple paths, pick best | Creative, open-ended | Highest |

### When to Plan vs When to React

```
Simple question ──→ Answer directly
                       │
Need a tool ──────────→ ReAct loop
                       │
Complex task ─────────→ Decompose → ReAct each step
                       │
Need creativity ──────→ Tree of Thought
```

---

## 🧪 Exercises

1. **Add step tracking**: Each step should report progress to the user ("Step 2/5 done...").

2. **Timeout per step**: If a step takes too many tries, skip it and continue.

3. **Replanning**: If a step fails, ask the LLM to create a new plan for remaining steps.

4. **Visual plan**: Have the agent output its plan as a checklist before starting.

5. **Parallel execution**: Identify steps that don't depend on each other and run them in parallel.

---

## 📝 Summary

- **ReAct pattern** = Think → Act → Observe → Repeat
- **Chain of thought** makes the LLM reason step by step
- **Task decomposition** breaks complex tasks into manageable pieces
- **Tree of thought** explores multiple approaches
- Choose the right strategy based on task complexity

> **Next up: Chapter 10 — Multi-Agent Collaboration. What if one agent isn't enough?**
