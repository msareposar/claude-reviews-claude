# 16. 部署上线

> **让你的智能体跑在服务器上，随时可用。**

---

## 🎯 目标
- 用 FastAPI 搭建智能体 Web 服务
- Docker 容器化
- 部署到云端
- 实现健康检查

## 🔧 代码

### FastAPI 服务
```python
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

app = FastAPI(title="Agent API")

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default"

class ChatResponse(BaseModel):
    reply: str
    session_id: str

agent = ToolAgent(registry)

@app.post("/chat", response_model=ChatResponse)
def chat(req: ChatRequest):
    try:
        reply = agent.run(req.message)
        return ChatResponse(reply=reply, session_id=req.session_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/health")
def health():
    return {"status": "ok", "tools": list(registry._tools.keys())}
```

### Dockerfile
```dockerfile
FROM python:3.11-slim

WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt
COPY . .

EXPOSE 8000
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
```

### 启动
```bash
# 本地测试
uvicorn main:app --reload

# Docker
docker build -t agent-api .
docker run -p 8000:8000 agent-api
```

## 🧪 练习
1. 添加请求日志中间件
2. 实现 API 密钥验证
3. 部署到 Railway / Fly.io / 自己的服务器

下一章：监控与持续改进。
