@echo off
REM Use the canonical build pipeline and host.Version for every Windows entry.
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0build.ps1" %*
exit /b %ERRORLEVEL%
