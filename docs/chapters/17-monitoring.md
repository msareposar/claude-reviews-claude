# 17. Monitoring & Improvement

> **In this chapter: Your agent is live. Users are chatting. Now what? You'll build a monitoring system that tracks latency, errors, costs, and user satisfaction. Because you can't improve what you don't measure.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand what to monitor: latency, errors, usage, costs, quality
- Build a **structured logging system** for your agent
- Track **cost per conversation** and **token usage**
- Collect **user feedback** (thumbs up/down)
- Create a **dashboard** for real-time monitoring
- Establish an **iterative improvement loop** for your agent
- Have a complete monitoring system that helps you ship better agents

---

## 📖 Explain Like I'm 10

### Why Monitor?

Imagine you run a restaurant. You don't just cook food and hope for the best. You check:
- How long do customers wait for their food? (latency)
- Are there complaints about certain dishes? (errors)
- Which dishes are most popular? (usage)
- Are you spending too much on ingredients? (costs)
- Do customers enjoy the meal? (satisfaction)

**Your agent is the same.** Once it's deployed, you need to know:

```
📊 Latency:  "How fast does it respond?"
❌ Errors:   "How often does it break?"
👥 Usage:    "How many people use it?"
💰 Costs:    "How much am I spending on API calls?"
⭐ Quality:  "Are users happy with the answers?"
```

### The Improvement Loop

Monitoring isn't just about watching numbers. It's about **getting better**.

```
1. MEASURE   → Collect data on agent performance
2. ANALYZE   → Find patterns and problems
3. IMPROVE   → Update agent based on findings
4. DEPLOY    → Ship the improvement
5. REPEAT    → Go back to step 1
```

This is called the **iterative improvement loop**. Without monitoring, you're flying blind. With monitoring, every deployment makes your agent better.

### What to Monitor

| Metric | Why It Matters | Good | Bad |
|---|---|---|---|
| **Response time** | Users hate waiting | < 3 seconds | > 10 seconds |
| **Error rate** | Agent reliability | < 1% | > 5% |
| **Token usage** | Cost tracking | Under budget | Unpredictable costs |
| **Users/day** | Adoption | Growing | Flat/declining |
| **User rating** | Quality | > 4/5 stars | < 3/5 stars |

---

## 🔧 Hands-On: Build a Monitoring System

### Step 1: Structured Logging

Good logs are the foundation of monitoring. We'll use Python's `logging` module with JSON format.

```python
import json
import logging
import sys
import time
from datetime import datetime
from pathlib import Path
from typing import Optional, Dict, Any

# ─── STRUCTURED LOGGING ─────────────────────────────

class StructuredFormatter(logging.Formatter):
    """Format logs as JSON for easy processing."""

    def format(self, record: logging.LogRecord) -> str:
        log_entry = {
            "timestamp": datetime.utcfromtimestamp(record.created).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Add extra fields if present
        for key in ["session_id", "user_id", "model", "latency_ms", 
                     "tokens_used", "cost", "tool_called", "error_type"]:
            if hasattr(record, key):
                log_entry[key] = getattr(record, key)

        # Add exception info if present
        if record.exc_info and record.exc_info[0]:
            log_entry["exception"] = {
                "type": record.exc_info[0].__name__,
                "message": str(record.exc_info[1]),
            }

        return json.dumps(log_entry)


class AgentLogger:
    """
    Structured logger for agent monitoring.
    
    Usage:
        logger = AgentLogger()
        logger.info("Agent started", model="gpt-4o-mini")
        logger.warning("Rate limit approaching", tokens_used=9500)
        logger.error("Tool failed", tool_called="search", error_type="timeout")
    """

    def __init__(self, name: str = "agent", level: str = "INFO", 
                 log_file: Optional[str] = None):
        self.logger = logging.getLogger(name)
        self.logger.setLevel(getattr(logging, level.upper(), logging.INFO))

        # Console handler (JSON format)
        console_handler = logging.StreamHandler(sys.stdout)
        console_handler.setFormatter(StructuredFormatter())
        self.logger.addHandler(console_handler)

        # File handler (optional)
        if log_file:
            Path(log_file).parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(log_file)
            file_handler.setFormatter(StructuredFormatter())
            self.logger.addHandler(file_handler)

    def _log(self, level: str, message: str, **kwargs):
        """Internal logging method with extra fields."""
        log_method = getattr(self.logger, level.lower())
        extra = {}
        for key, value in kwargs.items():
            if value is not None:
                extra[key] = value
        log_method(message, extra=extra)

    def info(self, message: str, **kwargs):
        self._log("info", message, **kwargs)

    def warning(self, message: str, **kwargs):
        self._log("warning", message, **kwargs)

    def error(self, message: str, **kwargs):
        self._log("error", message, **kwargs)

    def debug(self, message: str, **kwargs):
        self._log("debug", message, **kwargs)


# Create default logger
logger = AgentLogger()

# Demo
print("📝 Structured Logging Demo")
print("=" * 50)
logger.info("Agent starting up", model="gpt-4o-mini", session_id="init")
logger.info("User message received", session_id="abc123", user_id="alice")
logger.warning("High token usage", tokens_used=8000, session_id="abc123")
logger.error("Tool execution failed", tool_called="search_web", 
             error_type="timeout", session_id="abc123")
```

### Step 2: Metrics Collector

Collects numeric metrics for analysis.

```python
# ─── METRICS COLLECTOR ──────────────────────────────

class MetricsCollector:
    """
    Collects and aggregates agent metrics.
    
    Tracks:
    - Request counts and latency
    - Token usage and cost
    - Error counts by type
    - Tool usage frequency
    - User ratings
    """

    def __init__(self):
        self.reset()

    def reset(self):
        """Reset all metrics (e.g., for a new day)."""
        self.metrics = {
            "requests": {
                "total": 0,
                "success": 0,
                "error": 0,
            },
            "latency": {
                "total_ms": 0,
                "min_ms": float("inf"),
                "max_ms": 0,
                "count": 0,
            },
            "tokens": {
                "prompt": 0,
                "completion": 0,
                "total": 0,
            },
            "costs": {
                "total_usd": 0.0,
            },
            "tools": {},  # tool_name → call_count
            "errors": {},  # error_type → count
            "ratings": {
                "count": 0,
                "total_score": 0,
            },
            "users": set(),
            "sessions": set(),
        }

    def record_request(self, success: bool, latency_ms: float):
        """Record a request."""
        self.metrics["requests"]["total"] += 1
        if success:
            self.metrics["requests"]["success"] += 1
        else:
            self.metrics["requests"]["error"] += 1

        self.metrics["latency"]["total_ms"] += latency_ms
        self.metrics["latency"]["min_ms"] = min(
            self.metrics["latency"]["min_ms"], latency_ms
        )
        self.metrics["latency"]["max_ms"] = max(
            self.metrics["latency"]["max_ms"], latency_ms
        )
        self.metrics["latency"]["count"] += 1

    def record_tokens(self, prompt_tokens: int, completion_tokens: int):
        """Record token usage."""
        self.metrics["tokens"]["prompt"] += prompt_tokens
        self.metrics["tokens"]["completion"] += completion_tokens
        self.metrics["tokens"]["total"] += prompt_tokens + completion_tokens

        # Calculate cost (GPT-4o-mini pricing)
        # $0.15 per 1M input tokens, $0.60 per 1M output tokens
        cost = (prompt_tokens * 0.15 + completion_tokens * 0.60) / 1_000_000
        self.metrics["costs"]["total_usd"] += cost

    def record_tool_call(self, tool_name: str):
        """Record a tool call."""
        if tool_name not in self.metrics["tools"]:
            self.metrics["tools"][tool_name] = 0
        self.metrics["tools"][tool_name] += 1

    def record_error(self, error_type: str):
        """Record an error."""
        if error_type not in self.metrics["errors"]:
            self.metrics["errors"][error_type] = 0
        self.metrics["errors"][error_type] += 1

    def record_rating(self, score: int):
        """Record a user rating (1-5)."""
        self.metrics["ratings"]["count"] += 1
        self.metrics["ratings"]["total_score"] += score

    def record_user(self, user_id: str):
        """Track unique user."""
        self.metrics["users"].add(user_id)

    def record_session(self, session_id: str):
        """Track unique session."""
        self.metrics["sessions"].add(session_id)

    def get_average_latency(self) -> float:
        """Get average latency in ms."""
        if self.metrics["latency"]["count"] == 0:
            return 0.0
        return self.metrics["latency"]["total_ms"] / self.metrics["latency"]["count"]

    def get_error_rate(self) -> float:
        """Get error rate as percentage."""
        total = self.metrics["requests"]["total"]
        if total == 0:
            return 0.0
        return (self.metrics["requests"]["error"] / total) * 100

    def get_average_rating(self) -> float:
        """Get average user rating (1-5)."""
        if self.metrics["ratings"]["count"] == 0:
            return 0.0
        return self.metrics["ratings"]["total_score"] / self.metrics["ratings"]["count"]

    def get_summary(self) -> dict:
        """Get a summary of all metrics."""
        return {
            "requests": {
                "total": self.metrics["requests"]["total"],
                "success": self.metrics["requests"]["success"],
                "error": self.metrics["requests"]["error"],
                "error_rate": f"{self.get_error_rate():.1f}%",
            },
            "latency": {
                "average_ms": f"{self.get_average_latency():.1f}",
                "min_ms": self.metrics["latency"]["min_ms"] if self.metrics["latency"]["min_ms"] != float("inf") else 0,
                "max_ms": self.metrics["latency"]["max_ms"],
            },
            "tokens": self.metrics["tokens"],
            "costs": {
                "total_usd": f"${self.metrics['costs']['total_usd']:.4f}",
            },
            "tools": self.metrics["tools"],
            "errors": self.metrics["errors"],
            "ratings": {
                "count": self.metrics["ratings"]["count"],
                "average": f"{self.get_average_rating():.2f}",
            },
            "unique_users": len(self.metrics["users"]),
            "unique_sessions": len(self.metrics["sessions"]),
        }


# ─── DEMO: Metrics Collector ─────────────────────────

print("\n📊 Metrics Collector Demo")
print("=" * 50)

metrics = MetricsCollector()

# Simulate some activity
for i in range(100):
    success = i % 10 != 0  # 10% error rate
    latency = 500 + (i * 10) % 3000  # varying latency
    metrics.record_request(success, latency)
    metrics.record_tokens(
        prompt_tokens=200 + i * 5,
        completion_tokens=50 + i * 2,
    )
    if not success:
        metrics.record_error("timeout")

metrics.record_tool_call("search_web")
metrics.record_tool_call("calculate")
metrics.record_tool_call("search_web")
metrics.record_tool_call("get_weather")

metrics.record_rating(5)
metrics.record_rating(4)
metrics.record_rating(3)
metrics.record_rating(5)
metrics.record_rating(2)

metrics.record_user("alice")
metrics.record_user("bob")
metrics.record_user("charlie")

summary = metrics.get_summary()
print(f"\n📈 Metrics Summary:")
print(json.dumps(summary, indent=2))
```

### Step 3: Cost Tracker

Track costs per conversation with fine detail.

```python
# ─── COST TRACKER ────────────────────────────────────

class CostTracker:
    """
    Tracks costs per conversation and over time.
    
    Pricing (GPT-4o-mini as of 2025):
    - Input: $0.15 per 1M tokens
    - Output: $0.60 per 1M tokens
    
    Pricing (GPT-4o):
    - Input: $2.50 per 1M tokens
    - Output: $10.00 per 1M tokens
    """

    PRICING = {
        "gpt-4o-mini": {"input": 0.15, "output": 0.60},
        "gpt-4o": {"input": 2.50, "output": 10.00},
        "gpt-4-turbo": {"input": 10.00, "output": 30.00},
    }

    def __init__(self, model: str = "gpt-4o-mini"):
        self.model = model
        self.pricing = self.PRICING.get(model, self.PRICING["gpt-4o-mini"])
        self.conversations: Dict[str, dict] = {}  # session_id → cost data

    def calculate_cost(self, prompt_tokens: int, completion_tokens: int) -> float:
        """Calculate the cost in USD for a request."""
        input_cost = (prompt_tokens * self.pricing["input"]) / 1_000_000
        output_cost = (completion_tokens * self.pricing["output"]) / 1_000_000
        return round(input_cost + output_cost, 6)

    def record_usage(self, session_id: str, prompt_tokens: int, 
                      completion_tokens: int):
        """Record token usage for a conversation."""
        cost = self.calculate_cost(prompt_tokens, completion_tokens)

        if session_id not in self.conversations:
            self.conversations[session_id] = {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
                "total_cost": 0.0,
                "turn_count": 0,
                "start_time": datetime.now().isoformat(),
            }

        conv = self.conversations[session_id]
        conv["prompt_tokens"] += prompt_tokens
        conv["completion_tokens"] += completion_tokens
        conv["total_tokens"] += prompt_tokens + completion_tokens
        conv["total_cost"] = round(conv["total_cost"] + cost, 6)
        conv["turn_count"] += 1

        logger.info(
            "Token usage recorded",
            session_id=session_id,
            tokens_used=prompt_tokens + completion_tokens,
            cost=cost,
        )

        return cost

    def get_conversation_cost(self, session_id: str) -> dict:
        """Get cost breakdown for a conversation."""
        return self.conversations.get(session_id, {
            "total_cost": 0.0,
            "total_tokens": 0,
            "turn_count": 0,
        })

    def get_total_cost(self) -> float:
        """Get total cost across all conversations."""
        return round(sum(
            c["total_cost"] for c in self.conversations.values()
        ), 6)

    def get_expensive_conversations(self, top_n: int = 5) -> list:
        """Get the most expensive conversations."""
        sorted_convs = sorted(
            self.conversations.items(),
            key=lambda x: x[1]["total_cost"],
            reverse=True,
        )
        return [
            {
                "session_id": sid,
                "total_cost": data["total_cost"],
                "total_tokens": data["total_tokens"],
                "turns": data["turn_count"],
            }
            for sid, data in sorted_convs[:top_n]
        ]

    def estimated_monthly_cost(self) -> float:
        """Estimate monthly cost based on current usage."""
        total = self.get_total_cost()
        # If we have data, extrapolate to 30 days
        if not self.conversations:
            return 0.0
        # Simple estimate: assume 30 days of similar usage
        return round(total * 30, 2)

    def switch_model(self, new_model: str):
        """Switch to a different model and update pricing."""
        if new_model in self.PRICING:
            self.model = new_model
            self.pricing = self.PRICING[new_model]
            logger.info("Switched model", model=new_model)


# ─── DEMO: Cost Tracker ─────────────────────────────

print("\n💰 Cost Tracker Demo")
print("=" * 50)

tracker = CostTracker("gpt-4o-mini")

# Simulate conversation costs
tracker.record_usage("session_1", prompt_tokens=500, completion_tokens=150)
tracker.record_usage("session_1", prompt_tokens=300, completion_tokens=200)
tracker.record_usage("session_2", prompt_tokens=1000, completion_tokens=400)
tracker.record_usage("session_3", prompt_tokens=2000, completion_tokens=800)

print(f"\n  Session 1 cost: ${tracker.get_conversation_cost('session_1')['total_cost']}")
print(f"  Total cost: ${tracker.get_total_cost()}")
print(f"  Estimated monthly: ${tracker.estimated_monthly_cost()}")

print(f"\n  Top expensive conversations:")
for conv in tracker.get_expensive_conversations(3):
    print(f"    {conv['session_id']}: ${conv['total_cost']} ({conv['total_tokens']} tokens)")

# Compare costs across models
print(f"\n  Cost comparison for session_1:")
data = tracker.get_conversation_cost("session_1")
for model, prices in CostTracker.PRICING.items():
    input_cost = (data["prompt_tokens"] * prices["input"]) / 1_000_000
    output_cost = (data["completion_tokens"] * prices["output"]) / 1_000_000
    print(f"    {model}: ${input_cost + output_cost:.6f}")
```

### Step 4: Feedback Collection

Let users rate responses so you can measure quality.

```python
# ─── FEEDBACK COLLECTOR ─────────────────────────────

class FeedbackCollector:
    """
    Collects user feedback on agent responses.
    
    Simple thumbs up/down with optional comment.
    """

    def __init__(self, storage_path: str = "feedback.json"):
        self.storage_path = storage_path
        self.feedback: list = []
        self._load()

    def _load(self):
        """Load existing feedback from disk."""
        try:
            with open(self.storage_path, "r") as f:
                self.feedback = json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            self.feedback = []

    def _save(self):
        """Save feedback to disk."""
        with open(self.storage_path, "w") as f:
            json.dump(self.feedback, f, indent=2)

    def record_feedback(self, session_id: str, message_index: int, 
                         rating: int, comment: str = None):
        """
        Record user feedback.
        
        rating: 1 (thumbs down) to 5 (thumbs up)
        """
        entry = {
            "session_id": session_id,
            "message_index": message_index,
            "rating": rating,
            "comment": comment,
            "timestamp": datetime.now().isoformat(),
        }
        self.feedback.append(entry)
        self._save()

        logger.info(
            "Feedback recorded",
            session_id=session_id,
            rating=rating,
        )

        return entry

    def get_average_rating(self) -> float:
        """Get the average rating across all feedback."""
        if not self.feedback:
            return 0.0
        scores = [f["rating"] for f in self.feedback]
        return sum(scores) / len(scores)

    def get_rating_distribution(self) -> dict:
        """Get distribution of ratings (1-5)."""
        distribution = {1: 0, 2: 0, 3: 0, 4: 0, 5: 0}
        for f in self.feedback:
            distribution[f["rating"]] = distribution.get(f["rating"], 0) + 1
        return distribution

    def get_recent_feedback(self, limit: int = 10) -> list:
        """Get the most recent feedback entries."""
        return self.feedback[-limit:]

    def get_low_rated(self, threshold: int = 2) -> list:
        """Get feedback with low ratings (for improvement)."""
        return [f for f in self.feedback if f["rating"] <= threshold]

    def get_session_feedback(self, session_id: str) -> list:
        """Get all feedback for a specific session."""
        return [f for f in self.feedback if f["session_id"] == session_id]


# ─── DEMO: Feedback Collector ───────────────────────

print("\n⭐ Feedback Collector Demo")
print("=" * 50)

import tempfile
feedback_file = os.path.join(tempfile.gettempdir(), "feedback_demo.json")
collector = FeedbackCollector(feedback_file)

# Simulate feedback
collector.record_feedback("session_1", 0, 5, "Great answer! Very helpful.")
collector.record_feedback("session_1", 1, 4, "Good, but could be more detailed.")
collector.record_feedback("session_2", 0, 2, "Wrong information.")
collector.record_feedback("session_3", 0, 5, "Perfect!")
collector.record_feedback("session_4", 0, 1, "Didn't understand my question.")

print(f"  Average rating: {collector.get_average_rating():.2f} / 5.0")
print(f"  Rating distribution: {collector.get_rating_distribution()}")

low = collector.get_low_rated(2)
print(f"  Low-rated responses: {len(low)}")
for entry in low:
    print(f"    [{entry['session_id']}] Rating {entry['rating']}: {entry.get('comment', 'No comment')}")

# Cleanup
os.remove(feedback_file)
```

### Step 5: Monitoring Dashboard (CLI)

A simple terminal dashboard to see real-time metrics.

```python
# ─── MONITORING DASHBOARD ───────────────────────────

class MonitoringDashboard:
    """
    Command-line monitoring dashboard.
    
    Shows key metrics in a readable format.
    In production, you'd use Grafana or a web dashboard.
    """

    def __init__(self, metrics: MetricsCollector, cost_tracker: CostTracker, 
                 feedback: FeedbackCollector):
        self.metrics = metrics
        self.costs = cost_tracker
        self.feedback = feedback
        self.start_time = datetime.now()

    def display(self):
        """Print the current dashboard to the terminal."""
        uptime = datetime.now() - self.start_time
        summary = self.metrics.get_summary()
        total_cost = self.costs.get_total_cost()
        avg_rating = self.feedback.get_average_rating()
        rating_dist = self.feedback.get_rating_distribution()

        print("\n" + "=" * 60)
        print("🤖 AGENT MONITORING DASHBOARD")
        print("=" * 60)
        print(f"  Uptime: {uptime}")
        print(f"  Environment: {os.getenv('ENVIRONMENT', 'development')}")
        print(f"  Model: {self.costs.model}")
        print("-" * 60)

        # Requests
        print(f"\n📊 REQUESTS")
        print(f"  Total:     {summary['requests']['total']}")
        print(f"  Success:   {summary['requests']['success']}")
        print(f"  Errors:    {summary['requests']['error']} ({summary['requests']['error_rate']})")

        # Latency
        print(f"\n⏱️  LATENCY")
        print(f"  Average:   {summary['latency']['average_ms']} ms")
        print(f"  Min:       {summary['latency']['min_ms']} ms")
        print(f"  Max:       {summary['latency']['max_ms']} ms")

        # Tokens & Cost
        print(f"\n💰 COSTS")
        print(f"  Tokens:    {summary['tokens']['total']:,}")
        print(f"  Cost:      {summary['costs']['total_usd']}")
        print(f"  Est. Month: ${self.costs.estimated_monthly_cost()}")

        # Tools
        print(f"\n🔧 TOOLS")
        if summary['tools']:
            for tool, count in sorted(summary['tools'].items(), key=lambda x: -x[1]):
                print(f"  {tool}: {count}")
        else:
            print(f"  No tools used yet")

        # Errors
        print(f"\n❌ ERRORS")
        if summary['errors']:
            for error_type, count in sorted(summary['errors'].items(), key=lambda x: -x[1]):
                print(f"  {error_type}: {count}")
        else:
            print(f"  No errors")

        # Ratings
        print(f"\n⭐ USER SATISFACTION")
        print(f"  Average:   {summary['ratings']['average']} / 5.0")
        print(f"  Responses: {summary['ratings']['count']}")
        if rating_dist:
            for rating in sorted(rating_dist.keys(), reverse=True):
                bar = "█" * rating_dist[rating]
                print(f"  {rating}★: {bar} ({rating_dist[rating]})")

        # Users
        print(f"\n👥 USERS")
        print(f"  Unique users:    {summary['unique_users']}")
        print(f"  Unique sessions: {summary['unique_sessions']}")
        print("=" * 60)


# ─── DEMO: Dashboard ────────────────────────────────

print("\n📋 Dashboard Demo")
dashboard = MonitoringDashboard(metrics, tracker, collector)
dashboard.display()
```

### Step 6: The Complete Monitoring Integration

Now let's build a monitored agent that combines everything.

```python
# ─── MONITORED AGENT ─────────────────────────────────

class MonitoredAgent:
    """
    An agent wrapped with full monitoring: logging, metrics, cost tracking, feedback.
    """

    def __init__(self, model: str = "gpt-4o-mini"):
        self.model = model
        self.logger = AgentLogger("monitored_agent")
        self.metrics = MetricsCollector()
        self.costs = CostTracker(model)
        self.feedback = FeedbackCollector()
        self.dashboard = MonitoringDashboard(self.metrics, self.costs, self.feedback)

    def process_message(self, session_id: str, user_id: str, message: str) -> dict:
        """
        Process a message with full monitoring.
        
        Returns the response and monitoring data.
        """
        start_time = time.time()

        self.logger.info(
            "Processing message",
            session_id=session_id,
            user_id=user_id,
            message_length=len(message),
        )

        self.metrics.record_user(user_id)
        self.metrics.record_session(session_id)

        try:
            # Simulate agent processing (in production, call LLM + tools)
            # This simulates latency and token usage
            import random
            latency = random.uniform(0.5, 3.0)
            time.sleep(latency * 0.01)  # Don't actually sleep long in demo
            
            prompt_tokens = random.randint(100, 1000)
            completion_tokens = random.randint(50, 500)

            # Simulate errors sometimes
            if random.random() < 0.05:  # 5% error rate
                raise RuntimeError("Simulated API error")

            response = f"I processed your message: '{message[:50]}...' using {self.model}."

            # Record success metrics
            elapsed_ms = (time.time() - start_time) * 1000
            self.metrics.record_request(success=True, latency_ms=elapsed_ms)
            self.metrics.record_tokens(prompt_tokens, completion_tokens)
            cost = self.costs.record_usage(session_id, prompt_tokens, completion_tokens)

            self.logger.info(
                "Message processed successfully",
                session_id=session_id,
                latency_ms=f"{elapsed_ms:.0f}",
                tokens_used=prompt_tokens + completion_tokens,
                cost=cost,
            )

            return {
                "response": response,
                "monitoring": {
                    "latency_ms": round(elapsed_ms, 1),
                    "tokens_used": prompt_tokens + completion_tokens,
                    "cost": round(cost, 6),
                },
            }

        except Exception as e:
            elapsed_ms = (time.time() - start_time) * 1000
            error_type = type(e).__name__

            self.metrics.record_request(success=False, latency_ms=elapsed_ms)
            self.metrics.record_error(error_type)

            self.logger.error(
                "Message processing failed",
                session_id=session_id,
                error_type=error_type,
                latency_ms=f"{elapsed_ms:.0f}",
            )

            return {
                "response": f"I'm sorry, I encountered an error: {str(e)}",
                "monitoring": {
                    "latency_ms": round(elapsed_ms, 1),
                    "error": error_type,
                },
            }

    def record_feedback(self, session_id: str, message_index: int, 
                        rating: int, comment: str = None):
        """Record user feedback on a response."""
        return self.feedback.record_feedback(session_id, message_index, rating, comment)

    def show_dashboard(self):
        """Display the monitoring dashboard."""
        self.dashboard.display()

    def get_report(self) -> dict:
        """Get a full monitoring report."""
        return {
            "summary": self.metrics.get_summary(),
            "total_cost": self.costs.get_total_cost(),
            "estimated_monthly": self.costs.estimated_monthly_cost(),
            "average_rating": self.feedback.get_average_rating(),
            "feedback_count": len(self.feedback.feedback),
            "expensive_conversations": self.costs.get_expensive_conversations(3),
        }


# ─── DEMO: Monitored Agent ──────────────────────────

print("\n🤖 Monitored Agent Demo")
print("=" * 60)

agent = MonitoredAgent()

# Simulate some activity
for i in range(20):
    session_id = f"session_{i % 5}"
    user_id = f"user_{i % 3}"
    result = agent.process_message(session_id, user_id, f"This is message number {i}")

# Record some feedback
for session in ["session_0", "session_1", "session_2"]:
    agent.record_feedback(session, 0, random.randint(3, 5), "Good response!")

# Show the dashboard
agent.show_dashboard()

# Show the full report
print("\n📋 Full Monitoring Report:")
print(json.dumps(agent.get_report(), indent=2))
```

---

## 🔍 How It Works

### The Monitoring Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Monitored Agent                          │
│                                                              │
│  User Message → Agent Logic → Response                      │
│                      │                                       │
│         ┌────────────┼────────────┐                          │
│         ▼            ▼            ▼                          │
│     Logger      Metrics       Cost Tracker                   │
│  (structured  (counts,     (tokens → $)                     │
│   JSON logs)   averages)                                     │
│         │            │            │                          │
│         ▼            ▼            ▼                          │
│     feedback.json  dashboard    conversations.json           │
│     (ratings)      (display)    (cost per session)           │
└─────────────────────────────────────────────────────────────┘
```

### What Each Component Does

| Component | Purpose | Example Output |
|---|---|---|
| **Logger** | Record events with context | `{"level": "ERROR", "error_type": "timeout", "latency_ms": 15000}` |
| **Metrics** | Aggregate counts and averages | `{"requests.total": 1000, "latency.avg": 1200}` |
| **Cost Tracker** | Track spending per conversation | `session_1: $0.0023 total` |
| **Feedback** | Collect user satisfaction | `session_1: rating 5/5` |
| **Dashboard** | Display everything in one place | Terminal UI with key numbers |

### The Improvement Loop in Practice

```
Monday:
  Deploy agent → Users chat → Collect logs + metrics + feedback
      │
      ▼
Tuesday:
  Analyze: "Users are asking about weather but agent can't answer"
      │
      ▼
Wednesday:
  Improve: Add weather plugin to agent
      │
      ▼
Thursday:
  Deploy v2 → Users chat → Metrics show: weather questions up 50%, satisfaction up
      │
      ▼
Friday:
  Analyze: "Costs are higher due to weather API calls"
      │
      ▼
Next week:
  Improve: Cache weather results, reduce API calls
      │
      ▼
  Repeat...
```

### Cost Optimization Strategies

Based on monitoring data, you can optimize costs:

```
Problem: Token costs are too high
         ↓
Check metrics: Which sessions cost the most?
         ↓
Find: Long conversations with many back-and-forth turns
         ↓
Solution: 
  - Reduce max_steps from 15 to 10
  - Summarize old conversation history
  - Switch to cheaper model for simple tasks
  - Cache common responses
         ↓
Result: 30% cost reduction, no quality loss
```

---

## 🧪 Exercises

### Exercise 1: Add a Daily Report

Create a function that generates a daily summary report and sends it via email or saves it to a file. Include:
- Total requests
- Average latency
- Total cost
- Error rate
- Top 3 errors
- Average user rating

### Exercise 2: Alert on Anomalies

Add alerting when metrics cross thresholds:

```python
class AlertManager:
    def __init__(self):
        self.thresholds = {
            "error_rate": 5.0,       # Alert if > 5%
            "avg_latency_ms": 5000,  # Alert if > 5 seconds
            "daily_cost": 5.0,       # Alert if > $5/day
        }
    
    def check_alerts(self, metrics: dict) -> list:
        # Return list of triggered alerts
        pass
```

### Exercise 3: Add A/B Testing

Create a system that routes some users to model A (gpt-4o-mini) and others to model B (gpt-4o). Compare costs and satisfaction ratings to decide which model to use.

### Exercise 4: Visualize with Matplotlib

Create a simple chart that plots latency or cost over time:

```python
import matplotlib.pyplot as plt

def plot_latency_trend(latency_data: list):
    plt.plot(latency_data)
    plt.title("Agent Response Time Over Time")
    plt.ylabel("Latency (ms)")
    plt.xlabel("Request #")
    plt.savefig("latency_trend.png")
```

### Exercise 5: Export to Prometheus

Format your metrics for Prometheus (a popular monitoring system). Prometheus scrapes metrics from HTTP endpoints:

```python
@app.get("/metrics")
def prometheus_metrics():
    """Expose metrics in Prometheus format."""
    lines = []
    lines.append('# HELP agent_requests_total Total requests')
    lines.append('# TYPE agent_requests_total counter')
    lines.append(f'agent_requests_total {metrics.metrics["requests"]["total"]}')
    # ... more metrics
    return Response("\n".join(lines), media_type="text/plain")
```

### Challenge: Build a Web Dashboard

Create a simple web dashboard using FastAPI + Chart.js that:
1. Shows real-time metrics
2. Has a chart of latency over time
3. Shows cost breakdown by conversation
4. Lists recent feedback
5. Auto-refreshes every 30 seconds

---

## 📝 Summary

### Key Concepts

| Concept | What It Means |
|---|---|
| **Monitoring** | Tracking what your agent does in production |
| **Metrics** | Numeric measurements (counts, latencies, rates) |
| **Logging** | Recording events with context for debugging |
| **Cost Tracking** | Measuring API spending per conversation and overall |
| **User Feedback** | Ratings and comments on agent responses |
| **Dashboard** | A display showing key metrics at a glance |
| **Improvement Loop** | Measure → Analyze → Improve → Deploy → Repeat |

### The Monitoring Stack

```
Structured Logs  →  JSON output to stdout/file
     +
Metrics Collector  →  Aggregated counts and averages
     +
Cost Tracker      →  Spending analysis
     +
User Feedback     →  Quality measurement
     +
Dashboard         →  Visual display
     =
A complete picture of your agent's health and performance
```

### The Key Insight

> **You can't improve what you don't measure. Monitoring turns your agent from a black box into a transparent, improvable system. Every metric tells you what to fix next.**

### What's Next?

Congratulations! You've completed the Agent Development Guide. You started with "what is an LLM?" and ended with a production-ready, monitored, multi-agent system.

**Your journey continues by building.** Take these patterns and apply them to your own projects. Every agent you build will be better than the last.

---

*"What gets measured gets managed." — Peter Drucker*
