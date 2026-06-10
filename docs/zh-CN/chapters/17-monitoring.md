# 17. 监控与持续改进

> **上线只是开始。持续监控才能让你的智能体越来越好。**

---

## 🎯 目标
- 记录和监控智能体的运行指标
- 追踪成本（Token 使用量）
- 收集用户反馈
- 建立迭代改进循环

## 🔧 代码

### 监控系统
```python
import time, json
from datetime import datetime

class AgentMonitor:
    def __init__(self, log_file="agent_monitor.jsonl"):
        self.log_file = log_file

    def log(self, event: str, data: dict):
        entry = {"timestamp": datetime.now().isoformat(), "event": event, **data}
        with open(self.log_file, "a") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")

    def log_request(self, prompt: str, response: str, tokens_in: int, tokens_out: int,
                    latency_ms: float, success: bool):
        self.log("request", {
            "prompt_len": len(prompt),
            "response_len": len(response),
            "tokens_in": tokens_in,
            "tokens_out": tokens_out,
            "latency_ms": round(latency_ms, 2),
            "success": success,
            "cost": round(tokens_in * 0.00000015 + tokens_out * 0.0000006, 6)
        })

class MonitoredAgent:
    def __init__(self, agent):
        self.agent = agent
        self.monitor = AgentMonitor()

    def run(self, user_input: str) -> str:
        start = time.time()
        try:
            reply = self.agent.run(user_input)
            latency = (time.time() - start) * 1000
            self.monitor.log_request(user_input, reply, len(user_input), len(reply), latency, True)
            return reply
        except Exception as e:
            latency = (time.time() - start) * 1000
            self.monitor.log("error", {"input": user_input, "error": str(e), "latency_ms": round(latency, 2)})
            return f"出错了：{e}"
```

### 分析日志
```python
def analyze_logs(log_file="agent_monitor.jsonl"):
    costs, errors, latencies = [], 0, []
    with open(log_file) as f:
        for line in f:
            entry = json.loads(line)
            if entry["event"] == "request":
                costs.append(entry.get("cost", 0))
                latencies.append(entry.get("latency_ms", 0))
                if not entry.get("success", True):
                    errors += 1
    total_cost = sum(costs)
    avg_latency = sum(latencies) / len(latencies) if latencies else 0
    return {"total_cost": total_cost, "avg_latency_ms": round(avg_latency, 2), "errors": errors, "total_requests": len(costs)}
```

## 🧪 练习
1. 添加用户反馈按钮（👍/👎），跟踪满意度
2. 设置告警：当错误率 > 5% 时通知
3. 定期回顾日志，找出智能体的常见失败模式并修复

---

## 🎉 恭喜完成！

你从第 00 章走到了第 17 章。现在你已经掌握了构建完整 AI 智能体的所有技能：

- ✅ 理解 LLM 和函数调用
- ✅ 搭建核心循环
- ✅ 工具系统
- ✅ 记忆系统（短期 + 长期）
- ✅ 错误处理和韧性
- ✅ 规划和推理
- ✅ 多智能体协作
- ✅ 插件和安全
- ✅ 测试、部署、监控

**现在去造你的第一个智能体吧！**
