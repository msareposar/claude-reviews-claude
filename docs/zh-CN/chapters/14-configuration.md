# 14. 配置与环境管理

> **不要硬编码。配置应该像衣服一样——可以换。**

---

## 🎯 目标
- 用环境变量管理敏感信息
- 用配置文件管理非敏感设置
- 支持开发/测试/生产不同环境

## 🔧 代码

```python
import os
from dotenv import load_dotenv

load_dotenv()

class AgentConfig:
    def __init__(self):
        self.openai_api_key = os.getenv("OPENAI_API_KEY")
        self.model = os.getenv("AGENT_MODEL", "gpt-4o-mini")
        self.max_tokens = int(os.getenv("AGENT_MAX_TOKENS", "8000"))
        self.temperature = float(os.getenv("AGENT_TEMPERATURE", "0.3"))
        self.memory_db = os.getenv("AGENT_MEMORY_DB", "agent.db")
        self.log_level = os.getenv("AGENT_LOG_LEVEL", "INFO")
        self.environment = os.getenv("AGENT_ENV", "development")
        self.debug = os.getenv("AGENT_DEBUG", "false").lower() == "true"

    def validate(self):
        if not self.openai_api_key:
            raise ValueError("OPENAI_API_KEY 未设置")

config = AgentConfig()
config.validate()

# 环境特定配置
if config.environment == "production":
    config.temperature = 0.2  # 生产环境更保守
elif config.environment == "test":
    config.max_tokens = 500  # 测试更快
```

### .env 示例
```bash
# .env
OPENAI_API_KEY=sk-your-key
AGENT_MODEL=gpt-4o-mini
AGENT_MAX_TOKENS=8000
AGENT_ENV=development
```

## 🧪 练习
1. 添加 `AGENT_TOOL_TIMEOUT` 配置工具超时
2. 支持 YAML/TOML 配置文件
3. 运行时热重载配置

下一章：持久化存储。
