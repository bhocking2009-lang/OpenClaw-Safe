[CmdletBinding()]
param(
    [string]$BasePath = (Join-Path $env:USERPROFILE "OpenClaw-Safe")
)

$ErrorActionPreference = "Stop"

function Write-Info($Message) { Write-Host "[INFO] $Message" -ForegroundColor Cyan }
function Write-Ok($Message) { Write-Host "[OK]   $Message" -ForegroundColor Green }
function Write-Warn($Message) { Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Err($Message) { Write-Host "[ERR]  $Message" -ForegroundColor Red }

try {
    $scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
    $repoRoot = Split-Path -Parent $scriptRoot
    $exampleConfig = Join-Path $repoRoot "config\openclaw-safe.example.json"

    $configDir = Join-Path $BasePath "config"
    $profileDir = Join-Path $BasePath "profile"
    $logsDir = Join-Path $BasePath "logs"
    $backupsDir = Join-Path $BasePath "backups"
    $targetConfig = Join-Path $configDir "openclaw-safe.json"

    Write-Info "Preparing OpenClaw-Safe profile at: $BasePath"

    foreach ($dir in @($BasePath, $configDir, $profileDir, $logsDir, $backupsDir)) {
        if (-not (Test-Path -LiteralPath $dir)) {
            New-Item -ItemType Directory -Path $dir | Out-Null
            Write-Ok "Created directory: $dir"
        }
        else {
            Write-Info "Directory already exists: $dir"
        }
    }

    if (-not (Test-Path -LiteralPath $exampleConfig)) {
        throw "Example config not found at $exampleConfig"
    }

    if (Test-Path -LiteralPath $targetConfig) {
        Write-Warn "Existing config found: $targetConfig"
        $response = Read-Host "Overwrite existing config? (y/N)"
        if ($response -match '^(y|yes)$') {
            Copy-Item -LiteralPath $exampleConfig -Destination $targetConfig -Force
            Write-Ok "Config overwritten: $targetConfig"
        }
        else {
            Write-Info "Keeping existing config unchanged."
        }
    }
    else {
        Copy-Item -LiteralPath $exampleConfig -Destination $targetConfig
        Write-Ok "Config created: $targetConfig"
    }

    Write-Ok "Setup complete."
    Write-Host "Next step: run .\scripts\verify_install.ps1" -ForegroundColor Cyan
    exit 0
}
catch {
    Write-Err $_.Exception.Message
    Write-Host "Setup failed." -ForegroundColor Red
    exit 1
}
