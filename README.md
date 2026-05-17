# OpenClaw-Safe

OpenClaw-Safe is a secure, home-use wrapper/profile for OpenClaw.  
This project focuses on local safety defaults, simple setup, and easy verification for non-commercial use.

## Status

- Current phase: Phase 1 foundation complete (v1 baseline scaffolding)
- Implementation path: **Option C** (documentation + security wrapper around an existing OpenClaw install)
- Scope: home/local use only

## Goals

- Provide a conservative default configuration
- Keep OpenClaw local by default (no open network ports)
- Provide setup and verification scripts with clear output
- Make manual installation and troubleshooting straightforward
- Deliver a finishable v1.0 checklist

## Install Overview

1. Ensure OpenClaw is already installed locally.
2. Clone this repository.
3. Run `scripts/setup_safe_profile.ps1`.
4. Review and adjust your local config as needed.
5. Run `scripts/verify_install.ps1`.

Full instructions: `docs/INSTALL.md`

## Usage Overview

- Use the generated local profile/config created by setup script.
- Keep `network.enabled` set to `false` unless you explicitly accept the risk.
- Use verification script after any config change.
- Keep backups enabled for rollback safety.

Configuration details: `docs/CONFIGURATION.md`  
Security model: `SECURITY_MODEL.md`

## v1.0 Completion Checklist

- [x] Repository has baseline documentation
- [x] Safe default config exists
- [x] Setup script exists
- [x] Verification script exists
- [x] Security model is documented
- [x] Manual install path is documented
- [x] Release checklist exists
- [ ] Tag `v1.0.0` exists
