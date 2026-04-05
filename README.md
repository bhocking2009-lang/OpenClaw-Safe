# OpenClaw-Safe

A secure version of OpenClaw with proper security protocols for home use.

## Architecture

OpenClaw-Safe is a Python package implementing a **Secure Gateway Kernel** for
AI agent deployments.  It connects operators, family members, and trusted team
members through multiple channels to a policy-enforced, audited execution
environment.

### System Overview

```
Operator / Family / Trusted Team Member
    │
    ├── Channels (Telegram, Slack, Discord, WhatsApp, WebChat)
    ├── Desktop Node
    ├── Mobile Node
    └── Web UI / CLI
                │
                ▼
        OpenClaw Secure Gateway Kernel
```

### Kernel Components (Plugin Flow)

```
Gateway → PluginManager → CapabilityManifest → PolicyEngine
       → ScopedCapabilityToken → PluginProcess
                                      ├── PluginSDKAPI
                                      └── AuditLog
```

### Data Model

```
Principal + AgentProfile → Session
Session → Task → TaskStep → ToolInvocation → Artifact
                                           → ApprovalRequest
Session → MemoryItem
```

### Action / Tool Execution Flow

```
Model proposes action → PolicyEngine
    ├── deny           → PermissionError + AuditLog
    ├── allow low risk → ToolBroker → SandboxWorker → AuditLog
    └── require approval → UserApproval
                              └── approved → ToolBroker
                                   ├── default        → SandboxWorker     → AuditLog
                                   └── break-glass    → HostElevationPath → AuditLog
```

## Package Structure

```
openclaw_safe/
    kernel/
        gateway.py            # Entry point – wires all components together
        plugin_manager.py     # Plugin registration and lifecycle
        capability_manifest.py# Declares plugin capabilities with risk levels
        policy_engine.py      # Routes tool calls: allow / require-approval / deny
        scoped_token.py       # Short-lived token limiting plugin API surface
        plugin_process.py     # A running plugin with its scoped token
        tool_broker.py        # Dispatches approved invocations to sandbox/elevation
        sandbox_worker.py     # Isolated default execution environment
        host_elevation.py     # Break-glass elevated execution path
        audit_log.py          # Append-only event log
    models/
        principal.py          # Human operator / family / trusted team member
        agent_profile.py      # AI agent identity and declared capabilities
        session.py            # Binds a Principal to an AgentProfile
        task.py               # Goal-oriented work unit with ordered steps
        memory_item.py        # Persisted session knowledge
        tool_invocation.py    # Record of a single tool call
        artifact.py           # Output produced by a tool execution
        approval_request.py   # Human-in-the-loop approval gate
    channels/
        telegram.py           # Telegram Bot API adapter
        slack.py              # Slack Events / Web API adapter
        discord.py            # Discord Bot API adapter
        whatsapp.py           # WhatsApp Business Cloud API adapter
        webchat.py            # Generic WebSocket / SSE chat adapter
    nodes/
        desktop_node.py       # Native desktop application node
        mobile_node.py        # Native mobile application node
        web_ui.py             # Browser-based web UI node
        cli.py                # Command-line interface node
    sdk/
        plugin_sdk_api.py     # Restricted API surface exposed to plugins
```

## Quick Start

```python
from openclaw_safe.kernel.audit_log import AuditLog
from openclaw_safe.kernel.policy_engine import PolicyEngine
from openclaw_safe.kernel.plugin_manager import PluginManager
from openclaw_safe.kernel.sandbox_worker import SandboxWorker
from openclaw_safe.kernel.host_elevation import HostElevationPath
from openclaw_safe.kernel.tool_broker import ToolBroker
from openclaw_safe.kernel.gateway import Gateway
from openclaw_safe.kernel.capability_manifest import CapabilityManifest, Capability, RiskLevel
from openclaw_safe.models.principal import Principal, PrincipalRole
from openclaw_safe.models.agent_profile import AgentProfile
from openclaw_safe.models.task import TaskStep

# 1. Wire up the kernel
audit   = AuditLog()
policy  = PolicyEngine(audit_log=audit)
sandbox = SandboxWorker(audit_log=audit)
sandbox.register_tool("echo", lambda msg: msg)
elev    = HostElevationPath(audit_log=audit)
broker  = ToolBroker(sandbox=sandbox, host_elevation=elev, audit_log=audit)
manager = PluginManager(policy_engine=policy, audit_log=audit)
gateway = Gateway(policy_engine=policy, plugin_manager=manager,
                  tool_broker=broker, audit_log=audit)

# 2. Open a session
principal = Principal(name="Alice", role=PrincipalRole.OPERATOR)
agent     = AgentProfile(name="helper", model="gpt-4")
session   = gateway.open_session(principal, agent)

# 3. Declare a capability manifest and invoke a tool
manifest = CapabilityManifest(plugin_name="demo", version="1.0")
manifest.add_capability(Capability("echo", "echo text back", RiskLevel.LOW))

task   = gateway.create_task(session, goal="Echo a greeting")
step   = TaskStep(description="run echo")
task.add_step(step)

artifact = gateway.invoke_tool(
    session=session,
    task_step=step,
    tool_name="echo",
    arguments={"msg": "Hello, OpenClaw!"},
    manifest=manifest,
)
print(artifact.content)   # Hello, OpenClaw!
print(len(audit))         # 5  (session_created, task_created, tool_invoked, tool_allowed, sandbox_execution)
```

## Risk Levels and Policy

| Risk Level | Default Decision   |
|------------|--------------------|
| LOW        | Allow              |
| MEDIUM     | Require Approval   |
| HIGH       | Require Approval   |
| CRITICAL   | Deny               |

Rules are fully configurable via `PolicyRule` objects passed to `PolicyEngine`.

## Development

```bash
pip install -e ".[dev]"
pytest
```
