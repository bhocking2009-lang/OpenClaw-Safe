# INSTALL

## Prerequisites

- Windows with PowerShell 5.1+ (or PowerShell 7+)
- Existing local OpenClaw installation
- Permission to read/write inside your user profile folders

## Standard Installation

1. Clone or extract this repository to a local folder.
2. Open PowerShell in the repository root.
3. Run:
   - `.\scripts\setup_safe_profile.ps1`
4. Review the generated config in:
   - `$env:USERPROFILE\OpenClaw-Safe\config\openclaw-safe.json`
5. Update `openClaw.installPath` to your local OpenClaw location if needed.
6. Run:
   - `.\scripts\verify_install.ps1`
7. Resolve any reported issues before use.

## Manual Fallback (No Script)

If script execution is restricted, do this manually:

1. Create folders:
   - `%USERPROFILE%\OpenClaw-Safe\config`
   - `%USERPROFILE%\OpenClaw-Safe\profile`
   - `%USERPROFILE%\OpenClaw-Safe\logs`
   - `%USERPROFILE%\OpenClaw-Safe\backups`
2. Copy:
   - `config\openclaw-safe.example.json`  
     to  
     `%USERPROFILE%\OpenClaw-Safe\config\openclaw-safe.json`
3. Edit config values to match your local install.
4. Validate JSON with:
   - `Get-Content "$env:USERPROFILE\OpenClaw-Safe\config\openclaw-safe.json" -Raw | ConvertFrom-Json`
5. Run verification script when possible:
   - `.\scripts\verify_install.ps1`

## Notes

- Scripts are non-destructive by design.
- Existing config is not overwritten unless explicitly confirmed.
- Admin privileges are not required for default local setup.
