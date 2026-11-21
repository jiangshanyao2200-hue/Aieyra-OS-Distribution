@echo off
setlocal DisableDelayedExpansion
if "%~1"=="" (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-launchers.ps1" -Root "%~dp0." -ProductSuite
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\create-launchers.ps1" -Root "%~dp0." -Destination "%~1" -ProductSuite
)
if errorlevel 1 exit /b 1
echo Aieyra shortcuts are ready.
exit /b 0
