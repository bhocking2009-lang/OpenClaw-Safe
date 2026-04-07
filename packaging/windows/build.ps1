# Windows Installer Build Script
# Requires: Node.js 20+, 7-Zip (7z) in PATH, optionally NSIS (makensis)
#
# Usage (from repo root):
#   pwsh packaging/windows/build.ps1

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

$RepoRoot = Resolve-Path (Join-Path $PSScriptRoot '..\..')

Push-Location $RepoRoot

try {
    Write-Host "==> Compiling TypeScript..."
    npm run build

    Write-Host "==> Installing production dependencies..."
    npm ci --omit=dev

    Write-Host "==> Creating distribution bundle..."
    $DistPkg = Join-Path $RepoRoot 'dist-pkg'
    if (Test-Path $DistPkg) { Remove-Item $DistPkg -Recurse -Force }
    New-Item -ItemType Directory -Path $DistPkg | Out-Null

    Copy-Item -Path (Join-Path $RepoRoot 'dist')         -Destination (Join-Path $DistPkg 'dist')         -Recurse
    Copy-Item -Path (Join-Path $RepoRoot 'node_modules') -Destination (Join-Path $DistPkg 'node_modules') -Recurse
    Copy-Item -Path (Join-Path $PSScriptRoot 'launcher.bat') -Destination (Join-Path $DistPkg 'launcher.bat')

    Write-Host "==> Creating zip archive (OpenClaw-Safe-win32.zip)..."
    $ZipOut = Join-Path $RepoRoot 'OpenClaw-Safe-win32.zip'
    if (Test-Path $ZipOut) { Remove-Item $ZipOut -Force }

    if (Get-Command 7z -ErrorAction SilentlyContinue) {
        & 7z a -tzip $ZipOut "$DistPkg\*" | Out-Null
        Write-Host "  Created $ZipOut"
    } else {
        Compress-Archive -Path "$DistPkg\*" -DestinationPath $ZipOut
        Write-Host "  Created $ZipOut (via PowerShell Compress-Archive)"
    }

    if (Get-Command makensis -ErrorAction SilentlyContinue) {
        Write-Host "==> Building NSIS installer..."
        & makensis (Join-Path $PSScriptRoot 'installer.nsi')
        Write-Host "  Created OpenClaw-Safe-Setup.exe"
    } else {
        Write-Host "  makensis not found — skipping NSIS installer build."
        Write-Host "  Install NSIS from https://nsis.sourceforge.io/ to build the .exe installer."
    }

    Write-Host ""
    Write-Host "==> Build complete."
    Write-Host "    Distribution bundle : dist-pkg\"
    Write-Host "    Zip archive         : OpenClaw-Safe-win32.zip"
} finally {
    Pop-Location
}
