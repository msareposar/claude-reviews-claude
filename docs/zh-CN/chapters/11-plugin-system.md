# 11. 插件系统

> **不用改核心代码就能无限扩展智能体的能力。**

---

## 🎯 目标
- 设计插件接口
- 实现插件注册和发现
- 构建热插拔的智能体

## 🔧 代码

```python
from abc import ABC, abstractmethod

class Plugin(ABC):
    @abstractmethod
    def execute(self, input_data: str) -> str: pass

class PluginManager:
    def __init__(self):
        self.plugins = {}

    def register(self, name: str, plugin: Plugin, description: str = ""):
        self.plugins[name] = {"instance": plugin, "description": description}

    def run(self, name: str, input_data: str) -> str:
        if name not in self.plugins:
            return f"找不到插件：{name}"
        return self.plugins[name]["instance"].execute(input_data)

    def list_plugins(self) -> str:
        return "\n".join(f"- {n}: {p['description']}" for n, p in self.plugins.items())

# 示例插件
class TranslatePlugin(Plugin):
    def execute(self, input_data: str) -> str:
        text, lang = input_data.split("|") if "|" in input_data else (input_data, "中文")
        r = openai.chat.completions.create(model="gpt-4o-mini",
            messages=[{"role": "user", "content": f"翻译成{lang}：{text}"}])
        return r.choices[0].message.content

pm = PluginManager()
pm.register("translate", TranslatePlugin(), "将文本翻译成指定语言")
```

## 🧪 练习
1. 实现天气查询插件
2. 实现文件保存插件
3. 让 LLM 能自动发现和调用插件

下一章：安全与权限。
