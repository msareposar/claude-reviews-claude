# 16. Deployment

> **In this chapter: Your agent works on your laptop. Now let's share it with the world. You'll build a FastAPI web server, wrap it in a Docker container, and deploy it to the cloud. By the end, you'll have a production-ready agent API.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand the deployment options for your agent (script, API, Docker, cloud)
- Build a **FastAPI web server** that serves your agent over HTTP
- **Containerize** your agent with Docker
- Deploy to cloud platforms (Render, Railway, or your own server)
- Add **health checks** and monitoring endpoints
- Have a complete, deployable agent service

---

## 📖 Explain Like I'm 10

### From Laptop to World

Right now, your agent runs on your laptop. You type `python agent.py` and it works. But what if you want:

- **Your friend to use it** without installing Python?
- **Your website to call it** via an API?
- **It to run 24/7** even when your laptop is off?
- **Multiple users** to use it at the same time?

You need **deployment** — putting your agent on a server that's always running.

### Deployment Options

```
Local script         Web API (FastAPI)     Docker container     Cloud platform
    │                      │                     │                    │
    ▼                      ▼                     ▼                    ▼
python agent.py      localhost:8000        docker run ...      https://my-agent.com

Simple,            Can be called from    Consistent env,     Managed hosting,
only for you       any app or website    easy to deploy      auto-scaling
```

We'll build **all** of these, starting from simple and progressing to production-ready.

### The Deployment Pipeline

```
[Your Code] → [Docker Image] → [Cloud Server] → [Users]
     │              │               │              │
  Git push     Build image       Pull & run     Make API
              (Dockerfile)     (docker run)    requests
```

Think of Docker as a **shipping container** for your code. Your code + all its dependencies are packed into a container. It runs the same way on your laptop, your test server, and the cloud. No more "but it works on my machine!"

---

## 🔧 Hands-On: Deploy Your Agent

### Step 1: Build the Agent API with FastAPI

FastAPI is a modern Python web framework. It's fast, easy to use, and auto-generates API documentation.

```python
# ─── agent_api.py ────────────────────────────────────
# Your agent served as a web API

import os
import json
import openai
import uuid
from datetime import datetime
from typing import Optional

from fastapi import FastAPI, HTTPException, Request, Depends
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# ─── FastAPI App ─────────────────────────────────────

app = FastAPI(
    title="Agent API",
    description="A deployable AI agent with tools and memory",
    version="1.0.0",
)

# Allow CORS (so websites can call your API)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─── Data Models ─────────────────────────────────────

class ChatRequest(BaseModel):
    message: str = Field(..., description="The user's message")
    session_id: Optional[str] = Field(None, description="Optional session ID for conversation continuity")
    user_id: Optional[str] = Field("default", description="User identifier")
    temperature: Optional[float] = Field(None, description="Override temperature (0.0-2.0)")


class ChatResponse(BaseModel):
    response: str
    session_id: str
    model_used: str
    tokens_used: Optional[int] = None
    timestamp: str


class HealthResponse(BaseModel):
    status: str
    version: str
    uptime: float
    model: str
    active_sessions: int


# ─── Agent Logic ─────────────────────────────────────

class DeployableAgent:
    """
    The agent that powers our API.
    In production, this would use the full agent loop from chapters 2-9.
    """

    def __init__(self, model: str = None):
        self.model = model or os.getenv("AGENT_MODEL", "gpt-4o-mini")
        self.api_key = os.getenv("OPENAI_API_KEY")
        self.sessions: dict = {}  # session_id → message history
        self.start_time = datetime.now()

        if not self.api_key:
            print("⚠️  OPENAI_API_KEY not set. Agent will use mock responses.")

    def get_tools_schema(self) -> list:
        """Define tools available to the agent."""
        return [
            {
                "type": "function",
                "function": {
                    "name": "get_current_time",
                    "description": "Get the current date and time",
                    "parameters": {
                        "type": "object",
                        "properties": {},
                        "required": [],
                    },
                },
            },
            {
                "type": "function",
                "function": {
                    "name": "calculate",
                    "description": "Evaluate a mathematical expression",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "expression": {
                                "type": "string",
                                "description": "Math expression like '2+2' or '15 * 3.5'",
                            }
                        },
                        "required": ["expression"],
                    },
                },
            },
        ]

    def execute_tool(self, tool_name: str, args: dict) -> str:
        """Execute a tool and return the result."""
        if tool_name == "get_current_time":
            return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        elif tool_name == "calculate":
            try:
                expr = args.get("expression", "")
                # Safe eval — only allow math
                import math
                result = eval(expr, {"__builtins__": {}}, {"math": math})
                return str(result)
            except Exception as e:
                return f"Error: {str(e)}"
        return f"Unknown tool: {tool_name}"

    def chat(self, message: str, session_id: str = None,
             user_id: str = "default", temperature: float = None) -> dict:
        """Process a chat message and return the response."""

        # Create or retrieve session
        if not session_id:
            session_id = str(uuid.uuid4())[:8]

        if session_id not in self.sessions:
            self.sessions[session_id] = []

        # System prompt
        system_prompt = """You are a helpful AI assistant. You can:
1. Answer questions directly
2. Use tools for calculations and time lookups
3. Maintain conversation context

When you need to use a tool, respond with a tool call.
Otherwise, answer directly and conversationally."""

        messages = [{"role": "system", "content": system_prompt}]
        # Add session history (last 10 messages for context)
        messages.extend(self.sessions[session_id][-10:])
        messages.append({"role": "user", "content": message})

        # Check if we have a real API key
        if self.api_key:
            try:
                openai.api_key = self.api_key
                response = openai.chat.completions.create(
                    model=self.model,
                    messages=messages,
                    tools=self.get_tools_schema(),
                    temperature=temperature or 0.3,
                )

                msg = response.choices[0].message
                tokens_used = response.usage.total_tokens if response.usage else None

                # Handle tool calls
                if msg.tool_calls:
                    # Add the assistant's message with tool calls
                    self.sessions[session_id].append({
                        "role": "assistant",
                        "content": msg.content or "",
                        "tool_calls": [
                            {"name": tc.function.name, "args": tc.function.arguments}
                            for tc in msg.tool_calls
                        ],
                    })

                    # Execute each tool
                    for tc in msg.tool_calls:
                        try:
                            args = json.loads(tc.function.arguments)
                        except json.JSONDecodeError:
                            args = {}
                        result = self.execute_tool(tc.function.name, args)
                        self.sessions[session_id].append({
                            "role": "tool",
                            "tool_call_id": tc.id,
                            "content": result,
                        })

                    # Get final response after tool use
                    final_response = openai.chat.completions.create(
                        model=self.model,
                        messages=[{"role": "system", "content": system_prompt}] + 
                                self.sessions[session_id],
                        temperature=temperature or 0.3,
                    )
                    final_msg = final_response.choices[0].message
                    reply = final_msg.content or ""
                    tokens_used = (tokens_used or 0) + (final_response.usage.total_tokens if final_response.usage else 0)
                else:
                    reply = msg.content or ""

                # Store in session history
                self.sessions[session_id].append({"role": "user", "content": message})
                self.sessions[session_id].append({"role": "assistant", "content": reply})

                # Limit session size to prevent memory leaks
                if len(self.sessions[session_id]) > 50:
                    self.sessions[session_id] = self.sessions[session_id][-50:]

                return {
                    "response": reply,
                    "session_id": session_id,
                    "model_used": self.model,
                    "tokens_used": tokens_used,
                    "timestamp": datetime.now().isoformat(),
                }

            except Exception as e:
                # Fall back to mock mode on error
                print(f"⚠️  LLM error: {e}. Using mock mode.")

        # ── Mock mode (no API key or API error) ──
        reply = self._mock_response(message)
        self.sessions[session_id].append({"role": "user", "content": message})
        self.sessions[session_id].append({"role": "assistant", "content": reply})

        return {
            "response": reply,
            "session_id": session_id,
            "model_used": "mock",
            "tokens_used": 0,
            "timestamp": datetime.now().isoformat(),
        }

    def _mock_response(self, message: str) -> str:
        """Generate a mock response when no API key is available."""
        message_lower = message.lower()

        if "time" in message_lower:
            return f"The current time is {datetime.now().strftime('%I:%M %p')}."
        elif "calculate" in message_lower or any(op in message for op in ["+", "-", "*", "/"]):
            return f"I can calculate that! (Mock mode — connect an LLM for real calculations.)"
        elif "hello" in message_lower or "hi" in message_lower:
            return f"Hello! I'm your agent API. I'm running in mock mode. Set OPENAI_API_KEY to enable the real agent."
        elif "weather" in message_lower:
            return "I'd check the weather for you, but I'm in mock mode. Set up my API keys!"
        else:
            return f"You said: '{message}'. I'm a simulated agent response. Connect me to an LLM for real answers!"

    @property
    def active_sessions(self) -> int:
        return len(self.sessions)


# Create the agent instance
agent = DeployableAgent()


# ─── API Endpoints ───────────────────────────────────

@app.get("/")
def root():
    """Root endpoint — API information."""
    return {
        "name": "Agent API",
        "version": "1.0.0",
        "docs": "/docs",
        "health": "/health",
    }


@app.get("/health", response_model=HealthResponse)
def health_check():
    """Health check endpoint for monitoring."""
    uptime_seconds = (datetime.now() - agent.start_time).total_seconds()
    return HealthResponse(
        status="healthy",
        version="1.0.0",
        uptime=uptime_seconds,
        model=agent.model,
        active_sessions=agent.active_sessions,
    )


@app.post("/chat", response_model=ChatResponse)
async def chat_endpoint(request: ChatRequest):
    """
    Chat with the agent.
    
    Send a message and get a response. The agent maintains
    conversation context using session_id.
    """
    result = agent.chat(
        message=request.message,
        session_id=request.session_id,
        user_id=request.user_id,
        temperature=request.temperature,
    )
    return ChatResponse(**result)


@app.post("/reset")
def reset_session(session_id: str):
    """Reset/clear a conversation session."""
    if session_id in agent.sessions:
        agent.sessions[session_id] = []
        return {"status": "reset", "session_id": session_id}
    raise HTTPException(status_code=404, detail="Session not found")


@app.get("/sessions")
def list_sessions():
    """List active sessions (admin use)."""
    return {
        "active_sessions": agent.active_sessions,
        "session_ids": list(agent.sessions.keys()),
    }


# ─── Run with: uvicorn agent_api:app ─────────────────
if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"🚀 Agent API starting on port {port}...")
    print(f"   Model: {agent.model}")
    print(f"   API Key: {'✅ Set' if agent.api_key else '❌ Not set (mock mode)'}")
    print(f"   Docs: http://localhost:{port}/docs")
    uvicorn.run("agent_api:app", host="0.0.0.0", port=port, reload=True)
```

### Step 2: Run the API

```bash
# Install dependencies
pip install fastapi uvicorn openai

# Run (mock mode — no API key needed)
python agent_api.py

# Or with API key
OPENAI_API_KEY=sk-your-key python agent_api.py

# Or specify a model
AGENT_MODEL=gpt-4o OPENAI_API_KEY=sk-your-key python agent_api.py
```

Test the API:

```bash
# Health check
curl http://localhost:8000/health

# Chat
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What time is it?"}'

# Chat with session
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Remember my name is Alice", "session_id": "abc123"}'

curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "What is my name?", "session_id": "abc123"}'
```

### Step 3: Dockerize the Agent

Docker packages your agent so it runs the same everywhere.

```dockerfile
# ─── Dockerfile ──────────────────────────────────────

# Use official Python image
FROM python:3.12-slim

# Set environment variables
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8000

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first (for Docker layer caching)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the application code
COPY agent_api.py .
COPY .env .env 2>/dev/null || true

# Create a non-root user for security
RUN adduser --disabled-password --gecos '' appuser
RUN chown -R appuser:appuser /app
USER appuser

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:$PORT/health')" || exit 1

# Expose the port
EXPOSE $PORT

# Run the application
CMD uvicorn agent_api:app --host 0.0.0.0 --port $PORT
```

```nginx
# ─── requirements.txt ────────────────────────────────
fastapi>=0.104.0
uvicorn[standard]>=0.24.0
openai>=1.6.0
pydantic>=2.5.0
python-dotenv>=1.0.0
```

```makefile
# ─── Makefile ────────────────────────────────────────

.PHONY: build run stop clean

# Build the Docker image
build:
	docker build -t agent-api .

# Run the container
run:
	docker run -d --name agent-api \
		-p 8000:8000 \
		-e OPENAI_API_KEY=${OPENAI_API_KEY} \
		--restart unless-stopped \
		agent-api

# View logs
logs:
	docker logs -f agent-api

# Stop the container
stop:
	docker stop agent-api
	docker rm agent-api

# Rebuild and restart
restart: stop build run

# Clean up
clean:
	docker system prune -f
```

### Step 4: Build and Run with Docker

```bash
# Build the image
docker build -t agent-api .

# Run with environment variables
docker run -d --name agent-api \
  -p 8000:8000 \
  -e OPENAI_API_KEY=sk-your-key \
  -e AGENT_MODEL=gpt-4o-mini \
  --restart unless-stopped \
  agent-api

# Check logs
docker logs -f agent-api

# Test it
curl http://localhost:8000/health
curl -X POST http://localhost:8000/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello!"}'

# Stop
docker stop agent-api
docker rm agent-api
```

### Step 5: Docker Compose (Multi-Service)

For a more complete setup with a database:

```yaml
# ─── docker-compose.yml ─────────────────────────────

version: "3.8"

services:
  agent:
    build: .
    container_name: agent-api
    ports:
      - "8000:8000"
    environment:
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - AGENT_MODEL=gpt-4o-mini
      - DATABASE_PATH=/data/agent.db
      - LOG_LEVEL=INFO
    volumes:
      - agent_data:/data
      - ./config:/app/config:ro
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "python", "-c", "import urllib.request; urllib.request.urlopen('http://localhost:8000/health')"]
      interval: 30s
      timeout: 5s
      retries: 3
      start_period: 10s

  # Optional: monitoring with Prometheus (for Chapter 17)
  # prometheus:
  #   image: prom/prometheus
  #   volumes:
  #     - ./prometheus.yml:/etc/prometheus/prometheus.yml
  #   ports:
  #     - "9090:9090"

volumes:
  agent_data:
```

### Step 6: Deploy to the Cloud

#### Option A: Render

[Render](https://render.com) has a free tier perfect for agent APIs.

1. Push your code to GitHub
2. In Render Dashboard → New Web Service
3. Connect your GitHub repo
4. Settings:
   - **Runtime**: Docker
   - **Port**: 8000
   - **Environment Variables**: Add `OPENAI_API_KEY`
5. Deploy!

Render auto-deploys when you push to GitHub.

#### Option B: Railway

[Railway](https://railway.app) is similar to Render with a generous free tier.

```bash
# Install Railway CLI
# npm i -g @railway/cli

# Login
railway login

# Deploy
railway up

# Set secrets
railway variables set OPENAI_API_KEY=sk-your-key
```

#### Option C: Your Own VPS

If you have a Linux server:

```bash
# Copy files to server
scp -r . user@your-server.com:/opt/agent-api

# SSH into server
ssh user@your-server.com

# Build and run
cd /opt/agent-api
docker compose up -d

# Set up nginx reverse proxy (optional)
# /etc/nginx/sites-enabled/agent
# server {
#     server_name agent.yourdomain.com;
#     location / {
#         proxy_pass http://localhost:8000;
#         proxy_set_header Host $host;
#     }
# }
```

### Step 7: Production Checklist

```python
# ─── production_config.py ──────────────────────────
# Settings to review before deploying

PRODUCTION_CHECKLIST = {
    "security": [
        "✅ API keys set via environment variables, not in code",
        "✅ CORS configured for specific origins, not '*'",
        "✅ Rate limiting enabled (see Chapter 12)",
        "✅ Input sanitization active",
        "✅ HTTPS enabled (via reverse proxy or platform)",
    ],
    "reliability": [
        "✅ Health check endpoint configured",
        "✅ Auto-restart on crash (Docker restart policy)",
        "✅ Database backups scheduled",
        "✅ Graceful shutdown handling",
    ],
    "monitoring": [
        "✅ Request logging to stdout",
        "✅ Error tracking (Sentry or similar)",
        "✅ Resource usage monitoring (CPU, RAM)",
        "✅ Uptime monitoring (Pingdom, UptimeRobot)",
    ],
    "performance": [
        "✅ Connection pooling for database",
        "✅ Session size limits enforced",
        "✅ Request timeout configured",
        "✅ Static files served via CDN (if applicable)",
    ],
    "operations": [
        "✅ Deployment script ready (docker compose up -d)",
        "✅ Rollback plan documented",
        "✅ .env template committed (without secrets)",
        "✅ README with setup instructions",
    ],
}


def print_checklist():
    """Print the production readiness checklist."""
    print("📋 Production Readiness Checklist")
    print("=" * 50)
    for category, items in PRODUCTION_CHECKLIST.items():
        print(f"\n{category.upper()}:")
        for item in items:
            print(f"  {item}")


if __name__ == "__main__":
    print_checklist()
```

---

## 🔍 How It Works

### FastAPI Architecture

```
Client (Web browser, mobile app, curl)
    │
    ▼
┌──────────────────────────────────────┐
│  Internet                            │
│  HTTPS                               │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  Reverse Proxy (Nginx / Cloud LB)    │
│  - TLS termination                   │
│  - Rate limiting                     │
│  - Static file serving              │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  Uvicorn (ASGI Server)               │
│  - HTTP/WebSocket handling           │
│  - Worker processes                  │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  FastAPI Application                 │
│  - Route handlers                    │
│  - Input validation (Pydantic)       │
│  - Dependency injection              │
│  - OpenAPI docs (auto-generated)     │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  Agent Logic                         │
│  - LLM calls                         │
│  - Tool execution                   │
│  - Session management               │
└────────┬─────────────────────────────┘
         │
         ▼
┌──────────────────────────────────────┐
│  External Services                   │
│  - OpenAI API                        │
│  - Database (SQLite/PostgreSQL)     │
│  - Monitoring (Prometheus/Sentry)   │
└──────────────────────────────────────┘
```

### Why Docker?

Without Docker:
```
Your laptop:   Python 3.12, openai v1.6, macOS
Your server:   Python 3.9, openai v0.28, Ubuntu 20.04
                     ↑ Different versions → bugs!
```

With Docker:
```
Docker image:  Python 3.12 + openai v1.6 + all deps
                     ↑ Same everywhere!
Your laptop:   docker run agent-api → works
Your server:   docker run agent-api → works
The cloud:     docker run agent-api → works
```

### Session Management

The API maintains conversation state using `session_id`:

```
Request 1: POST /chat {"message": "Hi!", "session_id": "abc"}
    → Agent stores response in sessions["abc"]
    
Request 2: POST /chat {"message": "What's my name?", "session_id": "abc"}
    → Agent loads sessions["abc"], sees the history, knows the context
```

Sessions are **in-memory** in this example. In production, you'd persist sessions to the database (Chapter 15).

### Health Checks

Health checks let monitoring systems know if your agent is alive:

```json
GET /health
{
    "status": "healthy",
    "version": "1.0.0",
    "uptime": 12345.6,
    "model": "gpt-4o-mini",
    "active_sessions": 42
}
```

Docker runs this check every 30 seconds. If it fails 3 times, Docker restarts the container automatically.

---

## 🧪 Exercises

### Exercise 1: Add a WebSocket Endpoint

WebSocket allows real-time streaming of responses. Add a WebSocket endpoint that streams the agent's response token by token:

```python
@app.websocket("/chat/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    while True:
        data = await websocket.receive_text()
        # Stream response token by token
        for token in generate_tokens(data):
            await websocket.send_text(token)
```

### Exercise 2: Add API Key Authentication

Protect your API with a simple API key check:

```python
@app.middleware("http")
async def api_key_middleware(request: Request, call_next):
    api_key = request.headers.get("X-API-Key")
    if api_key != os.getenv("API_KEY"):
        return JSONResponse(status_code=401, content={"error": "Invalid API key"})
    return await call_next(request)
```

### Exercise 3: Multi-Worker Scaling

Run multiple workers to handle more concurrent requests:

```bash
# 4 workers = handle 4x the traffic
uvicorn agent_api:app --host 0.0.0.0 --port 8000 --workers 4
```

Add a `gunicorn` configuration for production:

```python
# gunicorn_conf.py
workers = 4
worker_class = "uvicorn.workers.UvicornWorker"
bind = "0.0.0.0:8000"
```

### Exercise 4: Environment-Specific Config

Make your API load different config for dev vs production:

```python
# Using the Config system from Chapter 14
if config.environment == "production":
    model = "gpt-4o"
    log_level = "WARNING"
elif config.environment == "development":
    model = "gpt-4o-mini"
    log_level = "DEBUG"
```

### Exercise 5: Database-Backed Sessions

Instead of storing sessions in memory (lost on restart), store them in the SQLite database from Chapter 15. Load session history from the database when a request comes in.

### Challenge: Deploy with GitHub Actions

Create a CI/CD pipeline that:
1. Runs your tests
2. Builds the Docker image
3. Pushes it to Docker Hub or GitHub Container Registry
4. Deploys to your server automatically

```yaml
# .github/workflows/deploy.yml
name: Deploy Agent API
on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Build Docker image
        run: docker build -t agent-api .
      - name: Deploy to server
        run: |
          # SSH into server, pull new image, restart
          ssh user@server 'cd /opt/agent-api && docker compose pull && docker compose up -d'
```

---

## 📝 Summary

### Key Concepts

| Concept | What It Means |
|---|---|
| **FastAPI** | Python web framework for building APIs quickly |
| **Uvicorn** | ASGI server that runs FastAPI applications |
| **Docker** | Container platform — package code + dependencies |
| **Dockerfile** | Recipe for building a Docker image |
| **Container** | A running instance of a Docker image |
| **Health Check** | Endpoint that tells monitoring if the app is alive |
| **Session** | A conversation context identified by a unique ID |
| **Reverse Proxy** | Nginx or cloud LB that handles TLS, routing, rate limiting |

### Deployment Options

```
                    Simple                     Production
                    ──────                     ──────────
Local script:      python agent.py            N/A

Web API:           uvicorn agent_api:app      uvicorn + gunicorn + workers

Docker:            docker run agent-api       docker compose + restart policy

Cloud:             Render free tier           Kubernetes / AWS ECS

Database:          In-memory                  SQLite (persistent) → PostgreSQL
```

### The Key Insight

> **Your agent on your laptop helps you. Your agent on the internet helps everyone. Deployment turns a personal project into a service. Docker makes it reproducible. FastAPI makes it accessible.**

### What's Next?

In **[Chapter 17: Monitoring & Improvement](./17-monitoring.md)**, you'll learn how to track your agent's performance in production — latency, errors, costs, and user satisfaction. You'll build a monitoring dashboard and create a feedback loop for continuous improvement.

---

*"Deploy early, deploy often." — Continuous Delivery mantra*
