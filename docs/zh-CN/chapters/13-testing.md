# 13. 测试你的智能体

> **不测试的智能体迟早会出问题。**

---

## 🎯 目标
- 对工具和组件做单元测试
- 模拟 LLM 响应做集成测试
- 测试边界情况

## 🔧 代码

```python
import pytest
from unittest.mock import MagicMock

# 测试计算器工具
class TestCalculator:
    def test_add(self):
        assert calculate("2 + 3") == "结果：5"

    def test_division(self):
        assert "不能除以零" in calculate("10 / 0")

    def test_invalid(self):
        assert "非法字符" in calculate("rm -rf /")

# 模拟 LLM 测试智能体循环
def test_agent_uses_tool():
    mock_response = MagicMock()
    mock_response.choices[0].message.tool_calls = [
        MagicMock(function=MagicMock(
            name="calculate",
            arguments='{"expression": "2+2"}'
        ))
    ]
    mock_response.choices[0].message.content = None

    # 模拟 openai 调用
    original = openai.chat.completions.create
    openai.chat.completions.create = MagicMock(return_value=mock_response)

    result = simple_agent("2+2等于多少？")
    assert "4" in result or "结果" in result

    openai.chat.completions.create = original  # 恢复
```

运行测试：
```bash
pip install pytest
pytest test_agent.py -v
```

## 🧪 练习
1. 测试空输入、超长输入、特殊字符
2. 模拟 LLM 返回错误格式的 JSON
3. 测试并发安全性

下一章：配置与环境管理。
