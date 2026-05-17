[CmdletBinding()]
param(
    [string]$BasePath = (Join-Path $env:USERPROFILE "OpenClaw-Safe")
)

$ErrorActionPreference = "Stop"
$hadError = $false

function Write-Info($Message) { Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Ok($Message) { Write-Host "[OK]   $Message" -ForegroundColor Green }
function Write-Warn($Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Err($Message) {
    Write-Host "[ERR]  $Message" -ForegroundColor Red
    $script:hadError = $true
}

function Test-RequiredPath {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if (Test-Path -LiteralPath $Path) {
        Write-Ok "$Label found: $Path"
    }
    else {
        Write-Err "$Label missing: $Path"
    }
}

try {
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repoRoot = Split-Path -Parent $scriptRoot
    $exampleConfig = Join-Path $repoRoot "config\openclaw-safe.example.json"

    $configDir = Join-Path $BasePath "config"
    $profileDir = Join-Path $BasePath "profile"
    $logsDir = Join-Path $BasePath "logs"
    $backupsDir = Join-Path $BasePath "backups"
    $localConfig = Join-Path $configDir "openclaw-safe.json"

    Write-Info "Verifying OpenClaw-Safe installation at: $BasePath"

    Test-RequiredPath -Path $BasePath -Label "Base folder"
    Test-RequiredPath -Path $configDir -Label "Config folder"
    Test-RequiredPath -Path $profileDir -Label "Profile folder"
    Test-RequiredPath -Path $logsDir -Label "Logs folder"
    Test-RequiredPath -Path $backupsDir -Label "Backups folder"
    Test-RequiredPath -Path $exampleConfig -Label "Example config"

    if (Test-Path -LiteralPath $localConfig) {
        Write-Ok "Local config found: $localConfig"
        try {
            $config = Get-Content -LiteralPath $localConfig -Raw | ConvertFrom-Json
            Write-Ok "Local config JSON syntax is valid."

            foreach ($required in @(
                "openClaw.installPath",
                "profile.profilePath",
                "logging.logPath",
                "backups.backupPath",
                "network.enabled",
                "safeMode.enabled"
            )) {
                $parts = $required.Split(".")
                $node = $config
                $missing = $false
                foreach ($part in $parts) {
                    if ($null -eq $node -or -not ($node.PSObject.Properties.Name -contains $part)) {
                        $missing = $true
                        break
                    }
                    $node = $node.$part
                }

                if ($missing) {
                    Write-Err "Missing required config field: $required"
                }
                else {
                    Write-Ok "Config field present: $required"
                }
            }
        }
        catch {
            Write-Err "Local config JSON is invalid: $($_.Exception.Message)"
        }
    }
    else {
        Write-Err "Local config missing: $localConfig"
        Write-Warn "Run .\scripts\setup_safe_profile.ps1 to create it."
    }

    if ($hadError) {
        Write-Host "Verification completed with errors." -ForegroundColor Red
        exit 1
    }
    else {
        Write-Host "Verification successful." -ForegroundColor Green
        exit 0
    }
}
catch {
    Write-Err $_.Exception.Message
    Write-Host "Verification failed unexpectedly." -ForegroundColor Red
    exit 1
}
