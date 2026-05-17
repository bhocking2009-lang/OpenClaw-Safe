# SECURITY MODEL

## Scope and Threat Assumptions

OpenClaw-Safe is intended for single-user or family home environments on trusted local machines.  
It is not a hardened enterprise security platform and does not include remote service exposure by default.

Assumptions:

- The local machine and user account are reasonably trusted.
- Users can edit local files and run local scripts.
- Physical access to the machine is not strongly adversarial.

## Default Security Posture

- **Local-only by default**
- **No open network ports by default**
- **Safe mode enabled by default**
- **Backups enabled by default**
- **Verification required before normal use**

## Configuration Validation

- Configuration is stored as JSON and must parse successfully.
- Verification script checks required fields and reports missing entries.
- Invalid or missing config is treated as a blocking issue.

## Logging Expectations

- Logging is local file-based by default.
- Log level defaults to `info`.
- Log files should avoid sensitive data where possible.
- Users should review logs during troubleshooting and after config changes.

## Backup and Restore Expectations

- Backups are local and enabled by default.
- Before major changes, users should create/retain at least one known-good backup.
- Restore procedure should be manual, explicit, and non-destructive.

## User Safety Assumptions

- Users should not enable network access unless they explicitly accept risk.
- Users should keep software and OS patched.
- Users should run verification after edits and before relying on changed settings.
- Users should keep configs private and avoid sharing machine-specific paths/logs publicly.
