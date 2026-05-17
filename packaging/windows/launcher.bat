@echo off
rem OpenClaw-Safe Windows launcher
rem Starts the app using the bundled Node.js runtime.

set "APP_DIR=%~dp0"
"%APP_DIR%node\node.exe" "%APP_DIR%dist\app.js"
