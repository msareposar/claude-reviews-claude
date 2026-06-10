# 14. Configuration & Environment

> **In this chapter: Your agent needs different settings for development, testing, and production. You can't hard-code API keys or model names. You'll build a configuration system that uses environment variables, config files, and dynamic overrides — the professional way.**

---

## 🎯 Goal

By the end of this chapter, you will:

- Understand why configuration management is critical for deployable software
- Use **environment variables** for secrets (API keys, passwords)
- Create **YAML/JSON config files** for structured settings
- Build a **hierarchical config system** that merges defaults, file config, and env vars
- Implement **dynamic configuration** that can change at runtime
- Have a complete, reusable configuration system for any agent

---

## 📖 Explain Like I'm 10

### The Problem: Hard-Coded Magic Numbers

Look at this code:

```python
agent = Agent(
    model="gpt-4o-mini",
    temperature=0.3,
    max_tokens=4096,
    api_key="sk-abc123...",
    data_dir="/home/alice/data/",
)
```

What's wrong with it?

1. **The API key is in the code** — if you share this code, anyone can use your key
2. **The model name is hard-coded** — to switch to "gpt-4o", you edit the code
3. **The data path is specific to Alice's machine** — it won't work on Bob's machine
4. **Can't change settings without editing code** — your non-technical teammate can't adjust the temperature

**This is bad engineering.** Configuration should be **separate from code**.

### The Configuration Trifecta

Professional applications use three configuration sources, in this order:

```
1. Environment Variables ──→ Secrets and env-specific overrides
           │
2. Config Files ───────────→ Structured settings (YAML, JSON, TOML)
           │
3. Default Values ─────────→ Sensible fallbacks if nothing else is set
```

The later a source is in the list, the **higher its priority**. Environment variables override config files, which override defaults.

```
User wants to change temperature:
    ├── Change default? → Need to edit code ❌
    ├── Change config file? → Edit YAML ✅
    └── Set env var? → TEMPERATURE=0.7 python agent.py ✅ (highest priority)
```

### Development vs Staging vs Production

```
Dev:     Your laptop. Debug mode on. Cheap model. Local database.
Staging: Test server. Almost like production. Test data.
Prod:    Real users. Fast model. Real database. Logging on.
```

Each environment needs different config:

| Setting | Dev | Staging | Production |
|---|---|---|---|
| Model | gpt-4o-mini (cheap) | gpt-4o-mini | gpt-4o (powerful) |
| Temperature | 0.7 (creative) | 0.3 (precise) | 0.2 (consistent) |
| Log level | DEBUG | INFO | WARNING |
| Database | local.db | staging-db.example.com | prod-db.example.com |
| API key | dev-key | staging-key | prod-key |

A config system lets you switch between environments by changing **one variable** (`ENVIRONMENT=production`) instead of editing code.

---

## 🔧 Hands-On: Build a Configuration System

### Step 1: The Config Class

We'll build a `Config` class that loads settings from multiple sources.

```python
import os
import json
import yaml
from pathlib import Path
from typing import Any, Dict, Optional

# ─── CONFIG CLASS ────────────────────────────────────

class Config:
    """
    Hierarchical configuration system.
    
    Loads config from:
    1. Default values (lowest priority)
    2. Config file (YAML/JSON)
    3. Environment variables (highest priority)
    
    Usage:
        config = Config()
        config.load_file("config.yaml")
        config.load_env(prefix="AGENT_")
        
        model = config.get("model", "gpt-4o-mini")
        debug = config.get_bool("debug", False)
    """

    def __init__(self):
        self._data: Dict[str, Any] = {}
        self._file_path: Optional[Path] = None

    # ─── Loading Sources ─────────────────────────────

    def set_defaults(self, defaults: dict):
        """Set default values (lowest priority)."""
        self._deep_merge(self._data, defaults)

    def load_file(self, path: str):
        """
        Load config from a YAML or JSON file.
        Overrides existing values.
        """
        path_obj = Path(path)
        if not path_obj.exists():
            print(f"⚠️ Config file not found: {path}")
            return

        self._file_path = path_obj

        with open(path_obj, "r") as f:
            if path.endswith((".yaml", ".yml")):
                data = yaml.safe_load(f)
            elif path.endswith(".json"):
                data = json.load(f)
            else:
                raise ValueError(f"Unsupported config format: {path}")

        if data:
            self._deep_merge(self._data, data)
            print(f"✅ Loaded config from: {path}")

    def load_env(self, prefix: str = "AGENT_"):
        """
        Load config from environment variables with a prefix.
        
        Example: AGENT_MODEL=gpt-4o sets config["model"] = "gpt-4o"
        AGENT_TOOLS__SEARCH__TIMEOUT=30 sets config["tools"]["search"]["timeout"] = 30
        (Double underscore creates nested keys)
        """
        for env_key, env_value in os.environ.items():
            if not env_key.startswith(prefix):
                continue

            # Remove prefix and lowercase
            config_key = env_key[len(prefix):].lower()

            # Split on double underscore for nested keys
            keys = config_key.split("__")

            # Convert string value to appropriate type
            value = self._convert_value(env_value)

            # Set nested value
            current = self._data
            for key in keys[:-1]:
                if key not in current:
                    current[key] = {}
                current = current[key]
            current[keys[-1]] = value

    def load_json(self, json_str: str):
        """Load config from a JSON string (useful for testing)."""
        data = json.loads(json_str)
        if data:
            self._deep_merge(self._data, data)

    # ─── Getting Values ──────────────────────────────

    def get(self, key: str, default: Any = None) -> Any:
        """
        Get a config value by dot-separated key.
        
        config.get("model")          → "gpt-4o-mini"
        config.get("tools.search")   → {"timeout": 30}
        config.get("tools.search.timeout") → 30
        """
        keys = key.split(".")
        current = self._data

        for k in keys:
            if isinstance(current, dict):
                current = current.get(k)
                if current is None:
                    return default
            else:
                return default

        return current

    def get_bool(self, key: str, default: bool = False) -> bool:
        """Get a config value as boolean."""
        value = self.get(key, default)
        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            return value.lower() in ("true", "1", "yes", "on")
        return bool(value)

    def get_int(self, key: str, default: int = 0) -> int:
        """Get a config value as integer."""
        value = self.get(key, default)
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def get_float(self, key: str, default: float = 0.0) -> float:
        """Get a config value as float."""
        value = self.get(key, default)
        try:
            return float(value)
        except (TypeError, ValueError):
            return default

    def get_list(self, key: str, default: list = None) -> list:
        """Get a config value as list."""
        value = self.get(key, default)
        if isinstance(value, list):
            return value
        if isinstance(value, str):
            return [v.strip() for v in value.split(",")]
        return default or []

    # ─── Setting Values ──────────────────────────────

    def set(self, key: str, value: Any):
        """Set a config value by dot-separated key."""
        keys = key.split(".")
        current = self._data
        for k in keys[:-1]:
            if k not in current:
                current[k] = {}
            current = current[k]
        current[keys[-1]] = value

    # ─── Environment Detection ───────────────────────

    @property
    def environment(self) -> str:
        """Detect the current environment."""
        return self.get("environment", os.getenv("ENVIRONMENT", "development"))

    @property
    def is_development(self) -> bool:
        return self.environment == "development"

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def is_testing(self) -> bool:
        return self.environment == "testing"

    # ─── Utility ─────────────────────────────────────

    def to_dict(self) -> dict:
        """Export all config as a dictionary."""
        return self._data.copy()

    def save(self, path: str):
        """Save current config to a file."""
        path_obj = Path(path)
        path_obj.parent.mkdir(parents=True, exist_ok=True)

        with open(path_obj, "w") as f:
            if path.endswith((".yaml", ".yml")):
                yaml.dump(self._data, f, default_flow_style=False)
            elif path.endswith(".json"):
                json.dump(self._data, f, indent=2)
            else:
                raise ValueError(f"Unsupported config format: {path}")

        print(f"💾 Saved config to: {path}")

    def _deep_merge(self, base: dict, override: dict):
        """Recursively merge override into base."""
        for key, value in override.items():
            if key in base and isinstance(base[key], dict) and isinstance(value, dict):
                self._deep_merge(base[key], value)
            else:
                base[key] = value

    def _convert_value(self, value: str) -> Any:
        """Convert string to appropriate Python type."""
        # Try int
        try:
            return int(value)
        except ValueError:
            pass
        # Try float
        try:
            return float(value)
        except ValueError:
            pass
        # Try bool
        if value.lower() in ("true", "yes", "on"):
            return True
        if value.lower() in ("false", "no", "off"):
            return False
        # Try JSON array/object
        if value.startswith(("[", "{")):
            try:
                return json.loads(value)
            except json.JSONDecodeError:
                pass
        # Keep as string
        return value

    def __repr__(self) -> str:
        return f"<Config environment={self.environment} keys={len(self._data)}>"
```

### Step 2: Create Config Files

Let's create configuration files for different environments.

```yaml
# ─── config/default.yaml ────────────────────────────
# Default config — applies to all environments

# Agent settings
agent:
  model: "gpt-4o-mini"
  temperature: 0.3
  max_tokens: 4096
  max_steps: 10

# Tools
tools:
  search:
    provider: "mock"
    timeout: 30
    max_results: 5
  weather:
    provider: "mock"
    units: "metric"
  calculator:
    enabled: true

# Memory
memory:
  max_messages: 50
  storage: "in_memory"

# Logging
logging:
  level: "INFO"
  format: "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
  file: null  # null = log to console only

# Features
features:
  debug_mode: false
  enable_web_search: true
  enable_image_gen: false
```

```yaml
# ─── config/development.yaml ─────────────────────────
# Development overrides

environment: "development"

agent:
  model: "gpt-4o-mini"  # Cheap model for dev
  temperature: 0.7       # More creative for testing

logging:
  level: "DEBUG"         # Verbose logging in dev

features:
  debug_mode: true
  enable_image_gen: true  # Test image gen in dev
```

```yaml
# ─── config/production.yaml ──────────────────────────
# Production overrides

environment: "production"

agent:
  model: "gpt-4o"        # Powerful model for prod
  temperature: 0.2        # Consistent outputs for users
  max_steps: 15

tools:
  search:
    provider: "real_api"  # Use real API in prod
    timeout: 10

logging:
  level: "WARNING"        # Less noise in prod
  file: "/var/log/agent.log"

features:
  debug_mode: false
  enable_web_search: true
  enable_image_gen: true
```

### Step 3: Build the Config Manager

The `ConfigManager` orchestrates loading config from all sources.

```python
# ─── CONFIG MANAGER ──────────────────────────────────

class ConfigManager:
    """
    High-level config manager that loads all sources.
    
    Load order:
    1. Default config (hard-coded)
    2. Base config file (config/default.yaml)
    3. Environment-specific config (config/{env}.yaml)
    4. Local overrides (config/local.yaml — gitignored)
    5. Environment variables (highest priority)
    """

    def __init__(self, config_dir: str = "config", env: str = None):
        self.config_dir = Path(config_dir)
        self.env = env or os.getenv("ENVIRONMENT", "development")
        self.config = Config()

    def load(self):
        """Load all configuration sources in order."""
        print(f"🔧 Loading configuration (environment: {self.env})")

        # 1. Default values
        self.config.set_defaults({
            "environment": self.env,
            "agent": {
                "model": "gpt-4o-mini",
                "temperature": 0.3,
                "max_tokens": 4096,
                "max_steps": 10,
            },
            "logging": {
                "level": "INFO",
                "format": "%(asctime)s - %(levelname)s - %(message)s",
            },
            "features": {
                "debug_mode": False,
                "enable_web_search": True,
                "enable_image_gen": False,
            },
        })

        # 2. Base config file
        default_file = self.config_dir / "default.yaml"
        if default_file.exists():
            self.config.load_file(str(default_file))

        # 3. Environment-specific config
        env_file = self.config_dir / f"{self.env}.yaml"
        if env_file.exists():
            self.config.load_file(str(env_file))

        # 4. Local overrides (not committed to git)
        local_file = self.config_dir / "local.yaml"
        if local_file.exists():
            self.config.load_file(str(local_file))

        # 5. Environment variables (highest priority)
        self.config.load_env(prefix="AGENT_")

        # 6. Override env from env var if set
        env_override = os.getenv("ENVIRONMENT")
        if env_override:
            self.env = env_override
            self.config.set("environment", env_override)

        return self.config

    def reload(self):
        """Reload configuration from all sources."""
        print("🔄 Reloading configuration...")
        self.config = Config()
        self.load()

    def get_agent_config(self) -> dict:
        """Get all agent-related settings."""
        return self.config.get("agent", {})

    def get_tool_config(self, tool_name: str = None) -> dict:
        """Get tool configuration."""
        tools = self.config.get("tools", {})
        if tool_name:
            return tools.get(tool_name, {})
        return tools

    def is_feature_enabled(self, feature: str) -> bool:
        """Check if a feature flag is enabled."""
        features = self.config.get("features", {})
        return self.config.get_bool(f"features.{feature}", False)


# ─── AGENT USING CONFIG ─────────────────────────────

class ConfigAwareAgent:
    """An agent that uses the configuration system."""

    def __init__(self, config: Config):
        self.config = config
        self.model = config.get("agent.model", "gpt-4o-mini")
        self.temperature = config.get_float("agent.temperature", 0.3)
        self.max_steps = config.get_int("agent.max_steps", 10)
        self.debug_mode = config.get_bool("features.debug_mode", False)

    def run(self, user_input: str) -> str:
        """Run the agent with config-aware behavior."""
        if self.debug_mode:
            print(f"🐛 [DEBUG] Model: {self.model}")
            print(f"🐛 [DEBUG] Temp: {self.temperature}")
            print(f"🐛 [DEBUG] Max steps: {self.max_steps}")

        # In production, this would call the LLM
        return f"[{self.model}] Response to: {user_input[:50]}..."

    def get_status(self) -> dict:
        """Return agent configuration status."""
        return {
            "environment": self.config.environment,
            "model": self.model,
            "temperature": self.temperature,
            "max_steps": self.max_steps,
            "debug_mode": self.debug_mode,
            "feature_flags": self.config.get("features", {}),
        }


# ─── DEMO ─────────────────────────────────────────────

if __name__ == "__main__":
    print("🔧 Configuration System Demo")
    print("=" * 60)

    # Create config directory and sample files
    import tempfile
    import os

    with tempfile.TemporaryDirectory() as tmp_dir:
        config_dir = Path(tmp_dir) / "config"
        config_dir.mkdir()

        # Write default config
        default_config = {
            "agent": {"model": "gpt-4o-mini", "temperature": 0.3},
            "logging": {"level": "INFO"},
            "features": {"debug_mode": False, "enable_web_search": True},
            "tools": {"search": {"timeout": 30}},
        }
        with open(config_dir / "default.yaml", "w") as f:
            yaml.dump(default_config, f)

        # Write development config
        dev_config = {
            "environment": "development",
            "agent": {"temperature": 0.7},
            "logging": {"level": "DEBUG"},
            "features": {"debug_mode": True},
        }
        with open(config_dir / "development.yaml", "w") as f:
            yaml.dump(dev_config, f)

        # Load config
        manager = ConfigManager(str(config_dir), env="development")
        config = manager.load()

        print(f"\n📋 Current config:")
        print(f"  Environment: {config.environment}")
        print(f"  Model: {config.get('agent.model')}")
        print(f"  Temperature: {config.get('agent.temperature')}")
        print(f"  Log level: {config.get('logging.level')}")
        print(f"  Debug mode: {config.get('features.debug_mode')}")
        print(f"  Web search enabled: {config.get('features.enable_web_search')}")
        print(f"  Search timeout: {config.get('tools.search.timeout')}")

        # Create agent with config
        agent = ConfigAwareAgent(config)
        print(f"\n🤖 Agent status:")
        status = agent.get_status()
        for key, value in status.items():
            print(f"  {key}: {value}")

        # Demonstrate environment variable override
        print(f"\n🌐 Environment variable override demo:")
        print(f"  Run: AGENT_AGENT__MODEL=gpt-4o AGENT_AGENT__TEMPERATURE=0.1 python this_script.py")
        print(f"  This would override model to gpt-4o and temperature to 0.1")
```

### Step 4: Dynamic Configuration

Sometimes you need to change config **while the agent is running** (no restart).

```python
# ─── DYNAMIC CONFIGURATION ───────────────────────────

class DynamicConfig:
    """
    Configuration that can be changed at runtime.
    
    Useful for:
    - A/B testing different model parameters
    - Adjusting temperature based on user feedback
    - Enabling/disabling features without restart
    - Per-user configuration overrides
    """

    def __init__(self, base_config: Config):
        self.base = base_config
        self._overrides: Dict[str, Any] = {}

    def set_override(self, key: str, value: Any):
        """Set a runtime override for a config key."""
        self._overrides[key] = value
        print(f"⚡ Dynamic override: {key} = {value}")

    def remove_override(self, key: str):
        """Remove a runtime override."""
        self._overrides.pop(key, None)
        print(f"⚡ Removed override: {key}")

    def get(self, key: str, default: Any = None) -> Any:
        """Get config value, checking overrides first."""
        # Check overrides first (highest priority)
        if key in self._overrides:
            return self._overrides[key]
        # Fall back to base config
        return self.base.get(key, default)

    def get_all_overrides(self) -> dict:
        """Get all active overrides."""
        return self._overrides.copy()

    def clear_overrides(self):
        """Remove all overrides."""
        self._overrides.clear()
        print("⚡ Cleared all overrides")


# ─── DYNAMIC CONFIG DEMO ─────────────────────────────

print("\n⚡ Dynamic Configuration Demo")
print("=" * 60)

# Create a base config
base = Config()
base.set_defaults({
    "agent": {"model": "gpt-4o-mini", "temperature": 0.3},
    "features": {"debug_mode": False},
})

# Wrap with dynamic config
dynamic = DynamicConfig(base)

# Normal access
print(f"  Normal temperature: {dynamic.get('agent.temperature')}")

# Override at runtime
dynamic.set_override("agent.temperature", 0.9)
print(f"  Overridden temperature: {dynamic.get('agent.temperature')}")

# Another override
dynamic.set_override("features.debug_mode", True)
print(f"  Debug mode: {dynamic.get('features.debug_mode')}")

# Remove override — falls back to base
dynamic.remove_override("agent.temperature")
print(f"  After removal: {dynamic.get('agent.temperature')}")

# Clear all
dynamic.clear_overrides()
```

### Step 5: The .env File for Secrets

For API keys and secrets, use a `.env` file (never commit it to git!).

```python
# ─── .env FILE LOADER ────────────────────────────────

def load_dotenv(path: str = ".env"):
    """
    Load a .env file into environment variables.
    
    Format: KEY=VALUE (one per line)
    - Lines starting with # are comments
    - Empty lines are ignored
    - No spaces around = in most formats
    """
    path_obj = Path(path)
    if not path_obj.exists():
        print(f"⚠️  .env file not found: {path}")
        return

    loaded = 0
    with open(path_obj, "r") as f:
        for line in f:
            line = line.strip()
            # Skip empty lines and comments
            if not line or line.startswith("#"):
                continue

            if "=" not in line:
                continue

            key, _, value = line.partition("=")
            key = key.strip()
            value = value.strip()

            # Remove quotes if present
            if value.startswith(('"', "'")) and value.endswith(('"', "'")):
                value = value[1:-1]

            # Set environment variable (don't override existing)
            if key not in os.environ:
                os.environ[key] = value
                loaded += 1

    print(f"✅ Loaded {loaded} variables from {path}")


# Sample .env file
SAMPLE_DOTENV = """
# ─── Agent Configuration ───
OPENAI_API_KEY=sk-your-key-here
ANTHROPIC_API_KEY=sk-ant-your-key-here

# ─── Environment ───
ENVIRONMENT=development

# ─── Tools ───
WEATHER_API_KEY=your-weather-key
SEARCH_API_KEY=your-search-key

# ─── Feature Flags ───
ENABLE_IMAGE_GEN=true
ENABLE_WEB_SEARCH=true
"""

# Write sample .env and load it
print("\n📝 .env File Demo")
print("=" * 60)
with open("/tmp/sample.env", "w") as f:
    f.write(SAMPLE_DOTENV)

load_dotenv("/tmp/sample.env")
print(f"  OPENAI_API_KEY set: {'OPENAI_API_KEY' in os.environ}")
print(f"  ENVIRONMENT: {os.getenv('ENVIRONMENT')}")
```

---

## 🔍 How It Works

### Configuration Priority

```
Highest Priority
       ↑
  ┌─────────────────────┐
  │ Environment Vars    │  AGENT_MODEL=gpt-4o
  ├─────────────────────┤
  │ Local overrides     │  config/local.yaml (gitignored)
  ├─────────────────────┤
  │ Environment config  │  config/production.yaml
  ├─────────────────────┤
  │ Base config file    │  config/default.yaml
  ├─────────────────────┤
  │ Hard-coded defaults │  Config class defaults
  └─────────────────────┘
Lowest Priority
       ↓
```

Each level **overrides** the levels below it. This way:
- Safe defaults are in code
- Standard overrides are in config files
- Local machine overrides are in local.yaml (not in git)
- Secrets and urgent overrides are in environment variables

### The Merge Strategy

When merging configurations, we use **deep merge**:

```python
# Base config
{"agent": {"model": "gpt-4o-mini", "temperature": 0.3}}

# Environment overrides
{"agent": {"temperature": 0.7}, "logging": {"level": "DEBUG"}}

# Result (deep merge)
{"agent": {"model": "gpt-4o-mini", "temperature": 0.7},  # model preserved, temp overridden
 "logging": {"level": "DEBUG"}}
```

This is different from a **shallow merge** which would replace the entire `agent` key. Deep merge goes key by key, preserving what's not overridden.

### Environment Variables for Nested Config

Flat environment variables can't represent nested structures like:
```yaml
tools:
  search:
    timeout: 30
    max_results: 5
```

Our solution: use `__` (double underscore) as a separator.

```
AGENT_TOOLS__SEARCH__TIMEOUT=30
AGENT_TOOLS__SEARCH__MAX_RESULTS=5
```

This sets `config["tools"]["search"]["timeout"] = 30` and `config["tools"]["search"]["max_results"] = 5`.

### The Git Workflow

```
# In .gitignore:
config/local.yaml
.env

# Committed to git:
config/default.yaml
config/development.yaml
config/production.yaml
config/staging.yaml
config/example.yaml  # Template showing all possible settings
```

This way:
- Everyone gets the shared config files
- Each developer can have their own `local.yaml` (gitignored)
- Secrets are in `.env` (gitignored) or environment variables

---

## 🧪 Exercises

### Exercise 1: Add TOML Support

TOML is another popular config format (used by Python's `pyproject.toml`). Extend the `Config.load_file` method to support `.toml` files using the `tomllib` library (Python 3.11+) or `toml` package.

### Exercise 2: Config Validation

Add a validation method that checks:
- Required keys exist (e.g., `agent.model`)
- Values are the right type (e.g., `temperature` must be a float between 0 and 2)
- Warn about unknown keys

```python
def validate(self, schema: dict) -> list:
    """Validate config against a schema. Return list of errors."""
    errors = []
    # ... check each key against schema
    return errors
```

### Exercise 3: Per-User Configuration

Extend the config system to support per-user overrides. Store user config in a `users/` directory, keyed by user ID:

```python
# config/users/alice.yaml
agent:
  temperature: 0.5  # Alice prefers more creative responses
features:
  enable_image_gen: true  # Alice has image gen access
```

### Exercise 4: Config Encryption

Add encryption support for sensitive values. Use `cryptography` library to encrypt/decrypt API keys stored in config files.

```python
config.set_encrypted("tools.weather.api_key", "my-secret-key")
# Stores as: "!encrypted:gAAAAAB..."
```

### Exercise 5: Config as a Pydantic Model

Rewrite the config system using Pydantic for type safety and automatic validation:

```python
from pydantic import BaseSettings

class AgentConfig(BaseSettings):
    model: str = "gpt-4o-mini"
    temperature: float = 0.3
    max_tokens: int = 4096
    
    class Config:
        env_prefix = "AGENT_"
```

### Challenge: Build a Config UI

Create a simple web interface (using Flask or FastAPI) that:
1. Shows the current configuration
2. Allows changing settings at runtime
3. Saves changes back to the config file
4. Shows which values came from which source (env, file, default)

---

## 📝 Summary

### Key Concepts

| Concept | What It Means |
|---|---|
| **Environment Variable** | OS-level key-value pair for secrets and env-specific settings |
| **Config File** | YAML/JSON file with structured settings |
| **Hierarchical Config** | Multiple config sources with priority ordering |
| **Deep Merge** | Merging dictionaries recursively, preserving unset keys |
| **Environment** | A named set of settings (development, staging, production) |
| **Feature Flag** | A toggle that turns features on/off without code changes |
| **Dynamic Config** | Changes that take effect at runtime without restart |

### The Config Load Order

```
1. Hard-coded defaults (in code)
2. default.yaml (base settings)
3. {environment}.yaml (env-specific overrides)
4. local.yaml (local overrides, gitignored)
5. .env file (secrets, gitignored)
6. Environment variables (highest priority, prefix AGENT_)
```

### The Key Insight

> **Hard-coding configuration is technical debt. A proper config system separates code from settings, enabling different environments, user-specific overrides, and runtime changes — all without editing a single line of Python.**

### What's Next?

In **[Chapter 15: Persistence & Storage](./15-persistence.md)**, you'll learn how to make your agent remember things permanently. You'll build a SQLite-based storage system for conversation history, user data, and files.

---

*"Configuration is not a feature. It's a discipline."*
