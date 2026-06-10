# 10. Multi-Agent Collaboration

> **In this chapter: One agent is good. Two agents working together are better. You'll build a team of agents — a researcher, a writer, and a reviewer — that collaborate to produce better results than any single agent could.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand why multiple agents outperform one agent on complex tasks
- Learn common agent roles: researcher, writer, reviewer, coordinator
- Implement message passing between agents
- Build an **orchestrator** that manages a team of agents
- See how agents share context and hand off work
- Have a complete multi-agent system that writes a research paper

---

## 📖 Explain Like I'm 10

### Why Multiple Agents?

Imagine you're building a house. You wouldn't ask one person to do everything — to dig the foundation, frame the walls, wire the electricity, and paint the interior. That would take forever, and one person can't be great at everything.

Instead, you hire a **team**:
- An **architect** designs the house
- A **carpenter** builds the frame
- An **electrician** wires the lights
- A **painter** finishes the walls

Each person has a specialty. They pass work to each other. The result? A better house, built faster.

**AI agents work the same way.** A single agent that tries to do everything — research, write, check facts, format output — often does each thing okay but nothing great. But a **team of specialized agents**, each focused on one job, produces much better results.

### The Agent Team

```
User Request
      │
      ▼
┌──────────────┐
│  Coordinator │  ← The boss. Decides who does what.
│ (Orchestrator)│
└──────┬───────┘
       │
       ├──→ 🔍 Researcher  → "Find information"
       ├──→ ✍️ Writer       → "Write the content"
       └──→ 👁️ Reviewer     → "Check quality"
```

Each agent is a separate LLM-powered loop with its own:
- **System prompt** (role description)
- **Tools** (what they can do)
- **Memory** (what they've discovered)

### The Magic of Handoff

The key idea is **handoff** — one agent passes its work to the next:

1. **Coordinator** receives: "Write a report on solar panels"
2. **Coordinator** tells **Researcher**: "Find recent solar panel efficiency data"
3. **Researcher** searches, reads, returns: "Here are the latest numbers..."
4. **Coordinator** passes research to **Writer**: "Write a 500-word report using this data"
5. **Writer** drafts the report, returns it
6. **Coordinator** passes draft to **Reviewer**: "Check for accuracy, clarity, and completeness"
7. **Reviewer** checks, suggests fixes
8. **Coordinator** sends fixes back to **Writer** or returns the final result

This is called the **orchestrator pattern** — one agent (the coordinator) doesn't do the work itself, but directs others who are experts at their jobs.

---

## 🔧 Hands-On: Build a Multi-Agent Research Team

### Step 1: The Base Agent Class

Each agent in our system will be an instance of a general `Agent` class. The agent has a role, a system prompt, tools, and memory.

```python
import json
import openai
from datetime import datetime

# ─── BASE AGENT CLASS ─────────────────────────────────

class Agent:
    """A single agent with a role, tools, and memory."""

    def __init__(self, name: str, system_prompt: str, tools: list = None, model: str = "gpt-4o-mini"):
        self.name = name
        self.system_prompt = system_prompt
        self.tools = tools or []
        self.model = model
        self.memory = []  # Conversation history for this agent

    def add_message(self, role: str, content: str):
        """Add a message to this agent's memory."""
        self.memory.append({"role": role, "content": content})

    def run(self, user_input: str, max_steps: int = 5) -> str:
        """
        Run the agent with a user input.
        Returns the final text response.
        """
        messages = [{"role": "system", "content": self.system_prompt}]
        # Add memory of previous conversations
        messages.extend(self.memory[-10:])  # Keep last 10 messages for context
        messages.append({"role": "user", "content": user_input})

        step = 0
        while step < max_steps:
            response = openai.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=self.tools if self.tools else None,
                temperature=0.3,
            )

            msg = response.choices[0].message

            # Check if the agent wants to use tools
            if not msg.tool_calls:
                # Agent is done — return the text response
                final = msg.content
                self.add_message("user", user_input)
                self.add_message("assistant", final)
                return final

            # Handle tool calls
            messages.append(msg)
            for tc in msg.tool_calls:
                tool_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                # Find and run the tool
                result = "Error: Tool not found"
                for tool in self.tools:
                    if tool["function"]["name"] == tool_name:
                        # Simulate calling the function
                        result = self._execute_tool(tool_name, args)
                        break

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": str(result),
                })

            step += 1

        return "Agent reached maximum steps without completing."

    def _execute_tool(self, name: str, args: dict) -> str:
        """Execute a known tool by name. Extend this for custom tools."""
        if name == "search_web":
            query = args.get("query", "")
            return f"[Simulated search results for '{query}': Found 3 relevant articles about {query}]"
        elif name == "read_url":
            url = args.get("url", "")
            return f"[Simulated content from {url}: This is placeholder article text with useful information.]"
        elif name == "write_draft":
            topic = args.get("topic", "")
            return f"[Draft written for '{topic}': 500 words covering key points.]"
        else:
            return f"Tool '{name}' executed with args: {args}"

    def clear_memory(self):
        """Reset the agent's memory."""
        self.memory = []


# ─── SIMULATED TOOLS (so the demo runs without real APIs) ────────

# In real usage, you'd connect to actual search/read APIs.
# For this demo, we define tool schemas that the LLM can call.

search_tool = {
    "type": "function",
    "function": {
        "name": "search_web",
        "description": "Search the web for information on a topic",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {"type": "string", "description": "The search query"}
            },
            "required": ["query"],
        },
    },
}

read_tool = {
    "type": "function",
    "function": {
        "name": "read_url",
        "description": "Read the content of a URL",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "The URL to read"}
            },
            "required": ["url"],
        },
    },
}

write_tool = {
    "type": "function",
    "function": {
        "name": "write_draft",
        "description": "Write a draft of content for a topic",
        "parameters": {
            "type": "object",
            "properties": {
                "topic": {"type": "string", "description": "The topic to write about"},
                "word_count": {"type": "number", "description": "Target word count"},
            },
            "required": ["topic"],
        },
    },
}
```

### Step 2: Define Agent Roles

Now we create our specialized agents with role-specific instructions.

```python
# ─── RESEARCHER AGENT ─────────────────────────────────

RESEARCHER_PROMPT = """You are a Research Specialist. Your job is to:
1. Search for information on the given topic
2. Read and summarize relevant sources
3. Extract key facts, statistics, and quotes
4. Organize findings in a clear, structured format

You are thorough and cite your sources. When you find good information,
present it in a well-organized research brief.

Be specific — prefer facts and data over general statements."""

researcher = Agent(
    name="Researcher",
    system_prompt=RESEARCHER_PROMPT,
    tools=[search_tool, read_tool],
)


# ─── WRITER AGENT ─────────────────────────────────────

WRITER_PROMPT = """You are a Professional Writer. Your job is to:
1. Take research findings and turn them into clear, engaging content
2. Write in a structured format with headings, paragraphs, and bullet points
3. Adapt your tone to the audience (general readers, technical, executive)
4. Keep your writing concise and avoid fluff

You receive research as input and produce polished content.
Always respect the requested word count and format.

When given research, use it thoroughly — don't just repeat it, synthesize it."""

writer = Agent(
    name="Writer",
    system_prompt=WRITER_PROMPT,
    tools=[write_tool],
)


# ─── REVIEWER AGENT ───────────────────────────────────

REVIEWER_PROMPT = """You are a Quality Reviewer. Your job is to:
1. Check content for accuracy, clarity, and completeness
2. Verify that facts and claims are supported by the research
3. Suggest specific improvements (word choice, structure, missing information)
4. Rate the content on: Accuracy (1-10), Clarity (1-10), Completeness (1-10)
5. Decide: Is this ready for publication, or does it need revision?

Be constructive. Your goal is to improve the work, not tear it down.
If revisions are needed, list exactly what changes to make."""

reviewer = Agent(
    name="Reviewer",
    system_prompt=REVIEWER_PROMPT,
)
```

### Step 3: The Orchestrator

The orchestrator (coordinator) manages the workflow. It doesn't do the work itself — it assigns tasks to the team.

```python
# ─── ORCHESTRATOR ─────────────────────────────────────

class Orchestrator:
    """Coordinates a team of agents to complete a complex task."""

    def __init__(self, agents: dict):
        """
        agents: dict of {role_name: Agent}
        Example: {"researcher": researcher_agent, "writer": writer_agent}
        """
        self.agents = agents
        self.workflow_log = []

    def log(self, step: str, detail: str):
        """Record a workflow step."""
        entry = f"[{datetime.now().strftime('%H:%M:%S')}] {step}: {detail}"
        self.workflow_log.append(entry)
        print(f"  {entry}")

    def research_phase(self, topic: str) -> str:
        """Phase 1: Research the topic."""
        print("\n🔍 Phase 1: Research")
        self.log("Researcher", f"Researching: {topic}")

        research_prompt = f"""Research the following topic thoroughly:

Topic: {topic}

Find the latest information, key facts, statistics, and expert opinions.
Organize your findings in a research brief with sections:
1. Overview
2. Key Facts & Data
3. Current Trends
4. Expert Opinions
5. Sources

Be specific and detailed."""

        research = self.agents["researcher"].run(research_prompt)
        self.log("Researcher", "Research complete")
        return research

    def writing_phase(self, topic: str, research: str, audience: str = "general") -> str:
        """Phase 2: Write the content based on research."""
        print("\n✍️ Phase 2: Writing")
        self.log("Writer", "Starting draft")

        writing_prompt = f"""Write a comprehensive article on the following topic.

Topic: {topic}
Target Audience: {audience}
Format: Article with headings, ~500 words

Here is the research to use:
{research}

Write a well-structured, engaging article that covers all key points from the research.
Make it accessible to {audience} readers."""

        draft = self.agents["writer"].run(writing_prompt)
        self.log("Writer", "Draft complete")
        return draft

    def review_phase(self, topic: str, draft: str, research: str) -> dict:
        """Phase 3: Review the draft."""
        print("\n👁️ Phase 3: Review")
        self.log("Reviewer", "Reviewing draft")

        review_prompt = f"""Review the following article draft for quality.

Topic: {topic}

DRAFT:
{draft}

RESEARCH USED:
{research}

Evaluate:
1. ACCURACY: Does the draft correctly use the research? (1-10)
2. CLARITY: Is the writing clear and well-structured? (1-10)
3. COMPLETENESS: Does it cover all key points? (1-10)
4. ISSUES: List specific issues or errors
5. VERDICT: "Approved" or "Needs Revision"
6. If "Needs Revision", list exactly what to change"""

        review = self.agents["reviewer"].run(review_prompt)
        self.log("Reviewer", "Review complete")

        return {
            "review": review,
            "approved": "Approved" in review and "Needs Revision" not in review,
        }

    def run(self, topic: str, audience: str = "general", max_revisions: int = 2) -> dict:
        """
        Run the full multi-agent workflow.
        
        Returns dict with: topic, research, final_draft, reviews, log.
        """
        print(f"\n{'='*60}")
        print(f"📋 MULTI-AGENT WORKFLOW: {topic}")
        print(f"{'='*60}")

        # Phase 1: Research
        research = self.research_phase(topic)

        # Phase 2: Write
        draft = self.writing_phase(topic, research, audience)

        # Phase 3: Review & Revise
        revisions = 0
        reviews = []

        while revisions <= max_revisions:
            result = self.review_phase(topic, draft, research)
            reviews.append(result)

            if result["approved"]:
                print(f"\n✅ Article approved after {revisions} revision(s)!")
                break
            else:
                revisions += 1
                print(f"\n🔄 Revision {revisions} needed...")
                # Pass the review feedback back to the writer
                revision_prompt = f"""Revise the article based on this review feedback.

ORIGINAL DRAFT:
{draft}

REVIEW FEEDBACK:
{result['review']}

Please revise the article addressing all feedback points.
Return the complete revised article."""

                draft = self.agents["writer"].run(revision_prompt)
                self.log("Writer", f"Revision {revisions} complete")

        return {
            "topic": topic,
            "research": research,
            "final_draft": draft,
            "reviews": reviews,
            "revisions": revisions,
            "workflow_log": self.workflow_log,
        }


# ─── DEMO ─────────────────────────────────────────────

if __name__ == "__main__":
    print("🧠 Multi-Agent Research Team Demo")
    print("=" * 40)

    # Create the team
    team = {
        "researcher": researcher,
        "writer": writer,
        "reviewer": reviewer,
    }

    orchestrator = Orchestrator(team)

    # Run a project
    result = orchestrator.run(
        topic="The impact of artificial intelligence on healthcare in 2025",
        audience="general readers",
    )

    print(f"\n{'='*60}")
    print(f"📄 FINAL OUTPUT")
    print(f"{'='*60}")
    print(result["final_draft"])

    print(f"\n📊 WORKFLOW SUMMARY")
    print(f"{'='*60}")
    print(f"Topic: {result['topic']}")
    print(f"Revisions needed: {result['revisions']}")
    print(f"Reviews completed: {len(result['reviews'])}")
    print(f"Research length: {len(result['research'])} chars")
    print(f"Final draft length: {len(result['final_draft'])} chars")
```

### Step 4: Shared Context — How Agents Communicate

The secret sauce of multi-agent systems is **shared context**. Each agent needs enough context to do its job, but not so much that it gets overwhelmed.

Our orchestrator uses a **context pipeline**:

```
User Request
    │
    ▼
┌──────────────────────────────┐
│  ORCHESTRATOR builds context │
│  for each phase              │
│                              │
│  Phase 1 → Research prompt   │
│            (topic only)      │
│                              │
│  Phase 2 → Write prompt      │
│            (topic + research) │
│                              │
│  Phase 3 → Review prompt     │
│            (topic + research │
│             + draft)         │
└──────────────────────────────┘
```

Each subsequent phase gets **more context** because it builds on previous work. This is called **progressive context enrichment**.

```python
# ─── CONTEXT ENRICHMENT DEMO ──────────────────────────

class ContextPipeline:
    """Demonstrates how context grows through the workflow."""

    def __init__(self):
        self.context = {"topic": "", "research": "", "draft": "", "review": ""}

    def add_research(self, research: str):
        self.context["research"] = research
        print(f"📚 Context size after research: {len(research)} chars")

    def add_draft(self, draft: str):
        self.context["draft"] = draft
        total = sum(len(v) for v in self.context.values() if isinstance(v, str))
        print(f"📚 Context size after drafting: {total} chars")

    def add_review(self, review: str):
        self.context["review"] = review
        total = sum(len(v) for v in self.context.values() if isinstance(v, str))
        print(f"📚 Context size after review: {total} chars")

    def show_pipeline(self):
        """Show what each agent sees."""
        print("\n🔍 What each agent sees:")
        print(f"  Researcher sees: topic only")
        print(f"  Writer sees: topic + research ({len(self.context['research'])} chars)")
        print(f"  Reviewer sees: topic + research + draft ({len(self.context['draft'])} chars)")


# Run the context demo
print("\n📦 Shared Context Demo")
pipeline = ContextPipeline()
pipeline.context["topic"] = "AI in Healthcare"
pipeline.add_research("AI diagnostics improve accuracy by 20%... (1000 chars of research)")
pipeline.add_draft("Article draft content... (800 chars of draft)")
pipeline.add_review("Review feedback... (200 chars of feedback)")
pipeline.show_pipeline()
```

---

## 🔍 How It Works

### The Orchestrator Pattern

The orchestrator is the **brain of the team**. It decides:

1. **What to do next** — which phase comes next
2. **Who should do it** — which agent gets the task
3. **What context to give** — what information the agent needs
4. **What to do with the result** — pass it forward, loop back, or finish

```
Orchestrator Logic Flow:

    Receive task
        │
    Decide: Is research needed?
        ├── Yes → Assign Researcher → Collect results
        ├── No  → Skip to writing
        │
    Decide: Is writing needed?
        ├── Yes → Assign Writer → Collect draft
        ├── No  → Error (no output)
        │
    Decide: Review quality?
        ├── Needs revision → Send back to Writer with feedback
        ├── Approved → Return final result
        │
    Done
```

### Why Separate Agents Instead of One Agent With All Instructions?

| Approach | Pros | Cons |
|---|---|---|
| **Single agent with many instructions** | Simple to build | Confused by competing goals; context window wasted on role switching |
| **Multiple specialized agents** | Each agent focuses on one job; better quality; easier to debug | More complex to coordinate; more LLM calls (higher cost) |

### Message Passing Architecture

In our system, message passing happens through the orchestrator:

```
Researcher ──→ research brief ──→ Orchestrator ──→ research + topic ──→ Writer
                                                                              │
Writer ──→ draft ──→ Orchestrator ──→ draft + research ──→ Reviewer
                                                                      │
Reviewer ──→ feedback ──→ Orchestrator ──→ feedback ──→ Writer (if revision needed)
                                                                      │
                                                              ──→ Final output (if approved)
```

Each agent is **stateless between tasks** — it only knows what the orchestrator tells it in the current prompt. This keeps each agent focused and prevents memory pollution.

### Cost Considerations

Each LLM call costs money. A multi-agent workflow multiplies calls:

```
Single agent: 1 call (direct answer)
                
Multi-agent workflow:
  ┌─ Researcher: 2-3 calls (search, read, summarize)
  ├─ Writer: 1-2 calls (draft + maybe revision)
  └─ Reviewer: 1 call
  Total: 4-6 calls × cost per call
```

But the quality improvement is often worth the extra cost. A common pattern is to use a **cheaper model** (like GPT-4o-mini) for researchers and reviewers, and a **more expensive model** (like GPT-4o) for the writer.

---

## 🧪 Exercises

### Exercise 1: Add a Fact-Checker Agent

Create a new `fact_checker` agent that runs after the reviewer. It should verify specific claims in the draft against the research, and flag any unsupported statements.

```python
FACT_CHECKER_PROMPT = """You are a Fact-Checking Specialist. 
Compare the draft against the research. For each factual claim:
- ✅ SUPPORTED: The research backs this up
- ⚠️ UNSUPPORTED: The research doesn't mention this
- ❌ CONTRADICTED: The draft says something different from research

Return a fact-check report."""
```

Add this as a Phase 4 in the orchestrator.

### Exercise 2: Parallel Research

Modify the orchestrator to run **multiple researchers in parallel** (simulated). Have researcher-1 search for statistics, researcher-2 search for expert opinions, and researcher-3 search for recent news. Combine all three briefs before passing to the writer.

### Exercise 3: Topic Validation

Add an initial **validation phase** where a "validator" agent checks if the topic is appropriate and clear. If the topic is too vague ("tell me about stuff"), the validator asks the user to be more specific.

### Exercise 4: Token Budget Tracking

Add token counting to each agent call. Track how many tokens each phase uses and print a cost estimate at the end. This helps understand the economics of multi-agent systems.

```python
# Hint: response.usage.total_tokens gives you the count
# At ~$0.15 per 1M input tokens for GPT-4o-mini
```

### Exercise 5: Agent Timeouts

What happens if the researcher's task takes too many steps? Add a `max_steps_per_agent` parameter and a timeout mechanism that forces the agent to return whatever it has after a certain number of steps or seconds.

### Challenge: Build a "Debate Club"

Create three agents with opposing viewpoints:

1. **Proponent** — argues FOR the topic
2. **Opponent** — argues AGAINST the topic
3. **Moderator** — runs the debate, summarizes both sides, declares a winner

The moderator should:
- Start with a topic statement
- Ask Proponent to make their case (1 paragraph)
- Ask Opponent to respond
- Allow 2 rounds of rebuttal
- Summarize the strongest arguments from each side
- Declare which side made the stronger case (or call it a tie)

---

## 📝 Summary

### Key Concepts

| Concept | What It Means |
|---|---|
| **Multi-Agent System** | Multiple AI agents working together on a shared task |
| **Orchestrator** | The coordinator that assigns tasks to specialized agents |
| **Agent Role** | A specific job for an agent (researcher, writer, reviewer) |
| **Message Passing** | Agents communicate by passing structured messages through the orchestrator |
| **Handoff** | One agent finishes its work and passes results to the next agent |
| **Progressive Context** | Each phase gets more context because it builds on previous phases |
| **Specialization** | Each agent focuses on one job rather than trying to do everything |

### The Multi-Agent Pattern

```
Task → Orchestrator → [Agent 1 → Agent 2 → Agent 3 → ...] → Final Result
                          ↑____________feedback loop____________↓
```

### When to Use Multi-Agent

| Scenario | Single Agent | Multi-Agent |
|---|---|---|
| Simple Q&A | ✅ Best | ❌ Overkill |
| Research report | ⚠️ Okay | ✅ Better quality |
| Fact-checking needed | ⚠️ Misses errors | ✅ Catches mistakes |
| Creative writing | ⚠️ Okay | ✅ Polished output |
| Complex analysis | ❌ Gets confused | ✅ Structured thinking |

### The Key Insight

> **One agent can do many things okay. A team of specialized agents can do one thing great. The orchestrator is the glue that makes the team work together.**

### What's Next?

In **[Chapter 11: Plugin System](./11-plugin-system.md)**, you'll learn how to make your agent extensible without modifying core code. Instead of hard-coding every tool, you'll build a plugin system that lets anyone add new capabilities.

---

*"Alone we can do so little; together we can do so much." — Helen Keller*
