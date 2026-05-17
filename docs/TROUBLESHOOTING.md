# TROUBLESHOOTING

## Script execution is blocked

**Symptom:** PowerShell refuses to run scripts.  
**Fix:** Run with process-scoped policy:

`Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass`

Then re-run the script.

## Config file not found

**Symptom:** Verification reports missing config file.  
**Fix:** Run setup script:

`.\scripts\setup_safe_profile.ps1`

Or manually copy `config/openclaw-safe.example.json` to:

`$env:USERPROFILE\OpenClaw-Safe\config\openclaw-safe.json`

## JSON parsing fails

**Symptom:** Verification reports invalid JSON syntax.  
**Fix:** Validate and correct syntax:

`Get-Content "$env:USERPROFILE\OpenClaw-Safe\config\openclaw-safe.json" -Raw | ConvertFrom-Json`

Check commas, quotes, and braces.

## OpenClaw install path is wrong

**Symptom:** Verification reports missing install path.  
**Fix:** Edit `openClaw.installPath` in local config to a valid existing folder.

## Existing config was not overwritten

**Symptom:** Setup script leaves old config unchanged.  
**Fix:** This is expected safety behavior. Re-run setup and confirm overwrite when prompted, or edit manually.
