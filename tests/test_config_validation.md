# Test: Config Validation (Manual)

## Objective

Confirm `scripts/verify_install.ps1` detects valid and invalid configuration states.

## Test Cases

1. **Valid config**
   - Run setup script.
   - Run verify script.
   - Expected: success with no error messages.

2. **Missing config file**
   - Rename/remove `openclaw-safe.json`.
   - Run verify script.
   - Expected: clear missing config error.

3. **Invalid JSON**
   - Introduce JSON syntax error.
   - Run verify script.
   - Expected: JSON parse error.

4. **Missing required fields**
   - Remove one required field (for example `network.enabled`).
   - Run verify script.
   - Expected: missing required field error.

## Notes

- Verification must remain non-destructive.
- Restore valid config after test completion.
