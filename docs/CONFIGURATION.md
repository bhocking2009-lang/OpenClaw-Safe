# CONFIGURATION

OpenClaw-Safe uses a conservative JSON config as a local safety profile.

Reference example: `config/openclaw-safe.example.json`

## Safe Defaults

- `safeMode.enabled = true`
- `network.enabled = false`
- `logging.level = "info"`
- `backups.enabled = true`

## Example Fields

- `openClaw.installPath`  
  Local path to existing OpenClaw install.

- `profile.profilePath`  
  Local path for OpenClaw-Safe profile data.

- `logging.enabled`  
  Enable/disable local file logging.

- `logging.logPath`  
  Local log directory path.

- `logging.level`  
  Logging level, default `info`.

- `backups.enabled`  
  Enable local backups.

- `backups.backupPath`  
  Local backup directory.

- `backups.maxBackups`  
  Retained backup count.

- `network.enabled`  
  Must remain `false` by default for local-only operation.

- `network.bindAddress`  
  Default loopback (`127.0.0.1`) if ever enabled.

- `network.port`  
  Default placeholder port; not used while network is disabled.

## Validation Guidance

- Keep valid JSON syntax (no trailing commas).
- Use absolute local paths.
- Re-run `scripts/verify_install.ps1` after changes.
