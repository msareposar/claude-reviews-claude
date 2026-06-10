# 11. Plugin System

> **In this chapter: Your agent is powerful, but you can't predict every tool someone might need. You'll build a plugin system — a way to add new capabilities without touching the agent's core code. This is how real-world software stays extensible.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand why plugins are better than hard-coding every feature
- Design a **plugin interface** (abstract base class) that all plugins follow
- Build a **plugin manager** that discovers, loads, and runs plugins
- Create example plugins: a weather plugin, a translator plugin, and an image gen plugin
- See how plugins register themselves and expose configuration options
- Have a complete, extensible plugin system you can reuse in any agent

---

## 📖 Explain Like I'm 10

### The Problem: You Can't Predict Everything

You've built a great agent. It can search the web, do math, and read files. But what if someone wants it to:

- Check the weather?
- Translate text to Spanish?
- Generate an image?
- Control their smart home lights?

You could add each feature directly into the agent's code. But that means:

1. You edit the **core agent** every time
2. One buggy feature could break the whole agent
3. You need to redeploy the entire agent for each new feature
4. Other people can't add their own features

**This is bad software design.**

### The Solution: Plugins

A **plugin** is a self-contained piece of code that adds a specific capability. It's like a USB device — you plug it in, and it just works.

```
Agent Core (the hub)
    │
    ├── USB port 1: Weather Plugin ← Just plug in!
    ├── USB port 2: Translator Plugin ← Just plug in!
    ├── USB port 3: Image Gen Plugin ← Just plug in!
    └── USB port 4: Your Custom Plugin ← Your own!
```

**The agent doesn't need to know what each plugin does.** It just knows:

- "I have a list of plugins"
- "Each plugin has a name, description, and a `run` method"
- "When I need something, I ask the LLM which plugin to use"

This is the **plugin architecture** — one of the most important patterns in software engineering.

### The Plugin Contract

Every plugin follows a **contract** (interface). Think of it like a power outlet:

- Every outlet has the same shape (interface)
- Any device with that plug shape can connect
- The device can do anything — toast bread, charge a phone, light a lamp

In code, the contract is:

```python
class BasePlugin:
    name: str           # "weather"
    description: str    # "Get current weather for any city"
    
    def run(self, **kwargs) -> str:
        # Do the thing
        pass
```

If your code follows this contract, it's a plugin. Simple.

---

## 🔧 Hands-On: Build a Plugin System

### Step 1: The Plugin Base Class

This is the **contract** that every plugin must follow.

```python
import json
import os
from abc import ABC, abstractmethod
from typing import Any, Dict, Optional

# ─── PLUGIN BASE CLASS ────────────────────────────────

class BasePlugin(ABC):
    """
    Abstract base class for all plugins.
    
    Every plugin must implement:
    - name: A unique identifier string
    - description: What this plugin does (for the LLM to decide when to use it)
    - run(): The main execution method
    
    Optionally implement:
    - get_schema(): Returns the JSON schema for LLM function calling
    - get_config(): Returns configuration options for this plugin
    """

    @property
    @abstractmethod
    def name(self) -> str:
        """Unique plugin name (e.g., 'weather', 'translate')."""
        pass

    @property
    @abstractmethod
    def description(self) -> str:
        """Human-readable description for LLM to understand when to use this."""
        pass

    @abstractmethod
    def run(self, **kwargs) -> str:
        """Execute the plugin with given arguments. Return text result."""
        pass

    def get_parameters(self) -> dict:
        """
        Return the JSON schema for this plugin's parameters.
        Used for LLM function calling.
        Default returns empty params — override in your plugin.
        """
        return {
            "type": "object",
            "properties": {},
            "required": [],
        }

    def get_schema(self) -> dict:
        """Return the full function-calling schema for this plugin."""
        return {
            "type": "function",
            "function": {
                "name": self.name,
                "description": self.description,
                "parameters": self.get_parameters(),
            },
        }

    def get_config(self) -> dict:
        """Return configuration options for this plugin."""
        return {}

    def __repr__(self) -> str:
        return f"<Plugin: {self.name}>"
```

### Step 2: Example Plugin — Weather

The weather plugin gets current weather for a city. In our demo, it simulates weather data (in production, you'd call a real weather API).

```python
# ─── WEATHER PLUGIN ───────────────────────────────────

import random
from datetime import datetime

class WeatherPlugin(BasePlugin):
    """Get the current weather for any city."""

    @property
    def name(self) -> str:
        return "get_weather"

    @property
    def description(self) -> str:
        return "Get the current weather and forecast for a city. Use when the user asks about weather, temperature, or conditions."

    def get_parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "city": {
                    "type": "string",
                    "description": "The city name, e.g. 'Tokyo', 'London', 'New York'",
                },
                "country": {
                    "type": "string",
                    "description": "Optional country code for disambiguation, e.g. 'US', 'JP', 'UK'",
                },
            },
            "required": ["city"],
        }

    def run(self, **kwargs) -> str:
        city = kwargs.get("city", "Unknown")
        country = kwargs.get("country", "")

        # In production, you'd call: requests.get(f"https://api.weather.com/...")
        # For this demo, we simulate realistic-looking weather data
        conditions = ["☀️ Sunny", "⛅ Partly Cloudy", "☁️ Cloudy", "🌧️ Rainy", "⛈️ Thunderstorm", "🌨️ Snowy", "🌫️ Foggy"]
        condition = random.choice(conditions)
        temp_c = round(random.uniform(-5, 38), 1)
        humidity = random.randint(30, 95)
        wind_speed = round(random.uniform(0, 30), 1)

        location = f"{city}, {country}" if country else city
        return f"""📍 Weather for {location} at {datetime.now().strftime('%Y-%m-%d %H:%M')}
┌─────────────────────────────────────────┐
│ Condition:  {condition}                   
│ Temp:       {temp_c}°C ({round(temp_c * 9/5 + 32, 1)}°F)      
│ Humidity:   {humidity}%                       
│ Wind:       {wind_speed} km/h                    
└─────────────────────────────────────────┘"""


# ─── TRANSLATOR PLUGIN ────────────────────────────────

class TranslatorPlugin(BasePlugin):
    """Translate text between languages."""

    @property
    def name(self) -> str:
        return "translate_text"

    @property
    def description(self) -> str:
        return "Translate text from one language to another. Supports 50+ languages."

    def get_parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "text": {
                    "type": "string",
                    "description": "The text to translate",
                },
                "target_language": {
                    "type": "string",
                    "description": "The target language, e.g. 'Spanish', 'French', 'Japanese'",
                },
                "source_language": {
                    "type": "string",
                    "description": "Optional source language (auto-detected if not provided)",
                },
            },
            "required": ["text", "target_language"],
        }

    def run(self, **kwargs) -> str:
        text = kwargs.get("text", "")
        target = kwargs.get("target_language", "English")
        source = kwargs.get("source_language", "auto-detected")

        # In production, you'd call Google Translate API or similar.
        # For this demo, we simulate translation.
        translations = {
            "spanish": f"[Traducción simulada]: {text}",
            "french": f"[Traduction simulée]: {text}",
            "japanese": f"[疑似翻訳]: {text}",
            "german": f"[Simulierte Übersetzung]: {text}",
            "chinese": f"[模拟翻译]: {text}",
        }

        lang_key = target.lower()
        translated = translations.get(lang_key, f"[Simulated translation to {target}]: {text}")

        return f"""🌐 Translation ({source} → {target})
──────────────────────────────────────
Original: {text}
──────────────────────────────────────
Translated: {translated}
──────────────────────────────────────"""


# ─── IMAGE GENERATION PLUGIN ──────────────────────────

class ImageGenPlugin(BasePlugin):
    """Generate images from text descriptions."""

    @property
    def name(self) -> str:
        return "generate_image"

    @property
    def description(self) -> str:
        return "Generate an image from a text description (prompt). Use when the user wants to create, draw, or visualize something."

    def get_parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "prompt": {
                    "type": "string",
                    "description": "Detailed description of the image to generate",
                },
                "style": {
                    "type": "string",
                    "description": "Art style: 'realistic', 'cartoon', 'watercolor', '3d_render', 'pixel_art'",
                    "enum": ["realistic", "cartoon", "watercolor", "3d_render", "pixel_art"],
                },
                "size": {
                    "type": "string",
                    "description": "Image size",
                    "enum": ["1024x1024", "1024x1792", "1792x1024"],
                    "default": "1024x1024",
                },
            },
            "required": ["prompt"],
        }

    def run(self, **kwargs) -> str:
        prompt = kwargs.get("prompt", "")
        style = kwargs.get("style", "realistic")
        size = kwargs.get("size", "1024x1024")

        # In production, you'd call DALL-E or Stable Diffusion:
        # response = openai.images.generate(model="dall-e-3", prompt=prompt, size=size)
        # return response.data[0].url

        # For this demo, return a placeholder
        return f"""🖼️ Image generated!
──────────────────────────────────────
Prompt: {prompt}
Style:  {style}
Size:   {size}
──────────────────────────────────────
[In production, this would call DALL-E 3 or Stable Diffusion API.
 Your image would be returned as a URL or base64 data.]
──────────────────────────────────────"""
```

### Step 3: The Plugin Manager

The plugin manager discovers, registers, and provides plugins to the agent.

```python
# ─── PLUGIN MANAGER ───────────────────────────────────

class PluginManager:
    """
    Manages plugin registration, discovery, and execution.
    
    Features:
    - Register plugins manually or auto-discover from a directory
    - Generate tool schemas for LLM function calling
    - Execute a plugin by name
    - List all available plugins
    """

    def __init__(self, plugin_dir: Optional[str] = None):
        self._plugins: Dict[str, BasePlugin] = {}
        self.plugin_dir = plugin_dir

        # If a plugin directory is given, auto-discover
        if plugin_dir and os.path.isdir(plugin_dir):
            self.discover_plugins(plugin_dir)

    # ─── Registration ─────────────────────────────────

    def register(self, plugin: BasePlugin):
        """Register a single plugin by instance."""
        if plugin.name in self._plugins:
            print(f"⚠️ Warning: Overwriting plugin '{plugin.name}'")
        self._plugins[plugin.name] = plugin
        print(f"✅ Registered plugin: {plugin.name}")

    def register_many(self, *plugins: BasePlugin):
        """Register multiple plugins at once."""
        for plugin in plugins:
            self.register(plugin)

    def unregister(self, plugin_name: str):
        """Remove a plugin by name."""
        if plugin_name in self._plugins:
            del self._plugins[plugin_name]
            print(f"🗑️ Unregistered plugin: {plugin_name}")
        else:
            print(f"⚠️ Plugin '{plugin_name}' not found")

    # ─── Discovery ────────────────────────────────────

    def discover_plugins(self, directory: str):
        """
        Auto-discover plugins from a directory.
        Scans for Python files and looks for BasePlugin subclasses.
        """
        import importlib.util
        import inspect

        print(f"🔍 Discovering plugins in: {directory}")
        found = 0

        for filename in os.listdir(directory):
            if not filename.endswith(".py") or filename.startswith("_"):
                continue

            filepath = os.path.join(directory, filename)
            module_name = filename[:-3]

            try:
                # Load the module dynamically
                spec = importlib.util.spec_from_file_location(module_name, filepath)
                if spec and spec.loader:
                    module = importlib.util.module_from_spec(spec)
                    spec.loader.exec_module(module)

                    # Find all BasePlugin subclasses in the module
                    for name, obj in inspect.getmembers(module):
                        if (inspect.isclass(obj) 
                            and issubclass(obj, BasePlugin) 
                            and obj is not BasePlugin):
                            instance = obj()
                            self.register(instance)
                            found += 1

            except Exception as e:
                print(f"❌ Failed to load plugin from {filename}: {e}")

        if found == 0:
            print("   No plugins found in directory.")
        else:
            print(f"   Discovered {found} plugin(s).")

    # ─── Access ───────────────────────────────────────

    def get_plugin(self, name: str) -> Optional[BasePlugin]:
        """Get a plugin by name."""
        return self._plugins.get(name)

    def list_plugins(self) -> list:
        """List all registered plugins with their details."""
        return [
            {
                "name": p.name,
                "description": p.description,
                "config": p.get_config(),
            }
            for p in self._plugins.values()
        ]

    def get_all_schemas(self) -> list:
        """Get function-calling schemas for all plugins (for LLM tool use)."""
        return [p.get_schema() for p in self._plugins.values()]

    # ─── Execution ────────────────────────────────────

    def execute(self, plugin_name: str, **kwargs) -> str:
        """Execute a plugin by name with given arguments."""
        plugin = self.get_plugin(plugin_name)
        if not plugin:
            return f"Error: Plugin '{plugin_name}' not found. Available: {list(self._plugins.keys())}"
        
        try:
            return plugin.run(**kwargs)
        except Exception as e:
            return f"Error executing plugin '{plugin_name}': {e}"

    def __len__(self) -> int:
        return len(self._plugins)

    def __contains__(self, name: str) -> bool:
        return name in self._plugins
```

### Step 4: Plugin-Aware Agent

Now we build an agent that uses the plugin manager. The agent doesn't know what plugins exist — it just asks the plugin manager for available tools and executes them by name.

```python
# ─── PLUGIN-AWARE AGENT ──────────────────────────────

import openai

class PluginAgent:
    """An agent that can use any registered plugin."""

    def __init__(self, plugin_manager: PluginManager, model: str = "gpt-4o-mini"):
        self.plugins = plugin_manager
        self.model = model
        self.memory = []

    def run(self, user_input: str, max_steps: int = 5) -> str:
        """Run the agent with plugin support."""
        system_prompt = """You are an AI assistant with access to plugins.
Each plugin gives you a superpower. When the user asks for something:
1. Check if you have a relevant plugin
2. If yes, use it by calling the function
3. If no, answer using your own knowledge

Always use the plugin when it's relevant — that's why it exists!"""

        schemas = self.plugins.get_all_schemas()
        
        messages = [{"role": "system", "content": system_prompt}]
        messages.extend(self.memory[-6:])  # Keep recent context
        messages.append({"role": "user", "content": user_input})

        step = 0
        while step < max_steps:
            response = openai.chat.completions.create(
                model=self.model,
                messages=messages,
                tools=schemas if schemas else None,
                temperature=0.3,
            )

            msg = response.choices[0].message

            if not msg.tool_calls:
                final = msg.content
                self.memory.append({"role": "user", "content": user_input})
                self.memory.append({"role": "assistant", "content": final})
                return final

            messages.append(msg)
            for tc in msg.tool_calls:
                tool_name = tc.function.name
                try:
                    args = json.loads(tc.function.arguments)
                except json.JSONDecodeError:
                    args = {}

                print(f"🔧 Using plugin: {tool_name}({args})")
                result = self.plugins.execute(tool_name, **args)
                print(f"   Result: {result[:100]}...")

                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.id,
                    "content": str(result),
                })

            step += 1

        return "Agent reached maximum steps without completing."


# ─── DEMO ─────────────────────────────────────────────

if __name__ == "__main__":
    print("🧩 Plugin System Demo")
    print("=" * 50)

    # Create plugin manager and register plugins
    manager = PluginManager()
    manager.register_many(
        WeatherPlugin(),
        TranslatorPlugin(),
        ImageGenPlugin(),
    )

    print(f"\n📋 Registered plugins: {len(manager)}")
    for p in manager.list_plugins():
        print(f"  • {p['name']}: {p['description'][:60]}...")

    # Create the agent
    agent = PluginAgent(manager)

    # Test queries
    test_queries = [
        "What's the weather like in Tokyo?",
        "Translate 'Good morning' to Spanish",
        "Generate an image of a cat wearing a hat",
    ]

    for query in test_queries:
        print(f"\n{'─' * 50}")
        print(f"👤 User: {query}")
        print(f"{'─' * 50}")
        response = agent.run(query)
        print(f"🤖 Agent: {response}")
```

### Step 5: Auto-Discovery from Disk

In a real project, you'd want plugins to live in separate files and be auto-discovered. Here's the folder structure:

```
project/
├── agent.py              # Main agent
├── plugins/
│   ├── __init__.py
│   ├── weather.py        # WeatherPlugin
│   ├── translator.py     # TranslatorPlugin
│   └── image_gen.py      # ImageGenPlugin
└── plugin_manager.py     # PluginManager
```

Let's create a standalone plugin file to demonstrate auto-discovery:

```python
# ─── plugins/hello.py (example plugin file for auto-discovery) ───

"""
A simple demo plugin saved to disk.
Place this in a 'plugins/' folder and the PluginManager
will discover it automatically.
"""

from plugin_system import BasePlugin  # Would import from your module

class HelloPlugin(BasePlugin):
    """A simple greeting plugin for demo purposes."""

    @property
    def name(self) -> str:
        return "say_hello"

    @property
    def description(self) -> str:
        return "Say hello to someone in a friendly way."

    def get_parameters(self) -> dict:
        return {
            "type": "object",
            "properties": {
                "name": {
                    "type": "string",
                    "description": "The name of the person to greet",
                },
                "language": {
                    "type": "string",
                    "description": "Language to greet in",
                    "enum": ["english", "spanish", "french", "japanese"],
                },
            },
            "required": ["name"],
        }

    def run(self, **kwargs) -> str:
        name = kwargs.get("name", "World")
        language = kwargs.get("language", "english")
        
        greetings = {
            "english": f"Hello, {name}! Nice to meet you!",
            "spanish": f"¡Hola, {name}! ¡Mucho gusto!",
            "french": f"Bonjour, {name}! Enchanté!",
            "japanese": f"こんにちは、{name}さん！はじめまして！",
        }
        
        return greetings.get(language, f"Hello, {name}!")
```

---

## 🔍 How It Works

### Plugin Architecture

```
┌──────────────────────────────────────────────────┐
│                  Agent Core                       │
│  Knows: "I have plugins"                         │
│  Knows: "Each plugin has run()"                  │
│  Does NOT know plugin internals                  │
└──────────────────┬───────────────────────────────┘
                   │  "What tools do I have?"
                   ▼
┌──────────────────────────────────────────────────┐
│               Plugin Manager                      │
│  - Holds all plugins in a dict                    │
│  - Generates schemas for LLM                      │
│  - Routes execution to the right plugin           │
│  - Handles discovery and registration             │
└──┬───────────┬───────────┬───────────────────────┘
   │           │           │
   ▼           ▼           ▼
┌──────┐ ┌──────────┐ ┌──────────┐
│Weather│ │Translate │ │Image Gen │
│Plugin │ │Plugin    │ │Plugin    │
└──────┘ └──────────┘ └──────────┘
```

### Why This Pattern Matters

**Without plugins**, adding "translate to Spanish" means:
1. Open the agent's main code
2. Add a `translate_to_spanish()` function
3. Add it to the tool list
4. Test the entire agent
5. Redeploy
6. Hope you didn't break anything

**With plugins**, adding "translate to Spanish" means:
1. Create `translator.py` with the `TranslatorPlugin` class
2. Drop it in the `plugins/` folder
3. Done. The plugin manager discovers it automatically.

### Plugin vs Hard-Coded Tool

| Feature | Hard-Coded Tool | Plugin |
|---|---|---|
| Adding new capability | Edit core agent code | Create a new file |
| Removing a capability | Edit core agent code | Delete the file |
| Third-party contributions | Not possible | Just create a plugin |
| Testing | Test entire agent | Test plugin in isolation |
| Configuration | Environment variables | Plugin-level config |
| Reusability | Specific to one agent | Drop into any agent |

### The Function Calling Schema

Each plugin exposes a JSON schema that tells the LLM:

1. **What** the plugin does (description)
2. **What arguments** it needs (parameters)
3. **What values** are valid (enums, types)

The LLM reads these schemas and decides: "The user wants weather — I have a `get_weather` plugin with a `city` parameter. Let me call it."

This is pure discovery. The agent doesn't need to know about weather at the code level — it just reads the schema and figures it out.

---

## 🧪 Exercises

### Exercise 1: Build a Calculator Plugin

Create a `CalculatorPlugin` that evaluates math expressions. It should accept an `expression` string and return the result. Use Python's `eval()` (with safety restrictions) or the `numexpr` library.

```python
class CalculatorPlugin(BasePlugin):
    @property
    def name(self) -> str:
        return "calculate"
    
    # ... implement the rest
```

### Exercise 2: Plugin Configuration

Add a `configure()` method to your plugins. For example, the WeatherPlugin could accept an `api_key` parameter, and the ImageGenPlugin could accept a `default_size`. Store these in a `config.json` file that the plugin manager loads.

```python
# Example config.json
{
    "weather": {"api_key": "abc123", "units": "metric"},
    "image_gen": {"default_size": "1024x1024", "model": "dall-e-3"}
}
```

### Exercise 3: Plugin Dependencies

Some plugins depend on other plugins. Add a `requires` property to `BasePlugin` that lists required plugins. The plugin manager should check dependencies and warn if any are missing.

```python
class ReportPlugin(BasePlugin):
    @property
    def requires(self) -> list:
        return ["weather", "calculator"]  # Needs these to work
```

### Exercise 4: Plugin Priority

Add a `priority` property to plugins. If two plugins can handle the same task, the one with higher priority wins. For example, a `PremiumTranslatorPlugin` might have priority 10, while a `BasicTranslatorPlugin` has priority 1.

### Exercise 5: Plugin Hot-Reload

Implement a `watch` mode for the plugin manager. Use `watchdog` (a Python library) to monitor the plugins folder for file changes. When a file is added, removed, or modified, reload the affected plugins without restarting the agent.

### Challenge: Build a Plugin Marketplace

Create a simple system where plugins can be downloaded and installed from a URL:

```python
manager.install_from_url("https://plugins.example.com/weather.py")
```

The manager should:
- Download the file
- Save it to the plugins directory
- Validate it's a proper plugin (is it a BasePlugin subclass?)
- Register it
- Handle errors gracefully

---

## 📝 Summary

### Key Concepts

| Concept | What It Means |
|---|---|
| **Plugin** | A self-contained module that adds a capability to the agent |
| **Plugin Interface** | The contract (BasePlugin) every plugin must follow |
| **Plugin Manager** | The system that registers, discovers, and executes plugins |
| **Schema** | JSON description of a plugin's parameters, used by the LLM |
| **Discovery** | Finding and loading plugins automatically from a directory |
| **Registration** | Adding a plugin to the manager so it's available to the agent |
| **Auto-Discovery** | Scanning a folder for plugin files and loading them automatically |

### The Plugin Pattern

```
BasePlugin (abstract) → WeatherPlugin, TranslatorPlugin, etc.
                              ↓
                        PluginManager
                              ↓
                    Agent uses schemas to decide
                              ↓
                    LLM says "call get_weather()"
                              ↓
                    PluginManager.execute("get_weather", city="Tokyo")
                              ↓
                    WeatherPlugin.run(city="Tokyo") → "☀️ 25°C"
```

### The Key Insight

> **A plugin system separates WHAT the agent can do from HOW it does it. The agent focuses on deciding; plugins focus on executing. This is the foundation of extensible software.**

### What's Next?

In **[Chapter 12: Security & Permissions](./12-security.md)**, you'll learn how to protect your agent from attacks, limit what tools can do, and build a permission system that keeps your users safe.

---

*"Good fences make good neighbors." — Robert Frost*
