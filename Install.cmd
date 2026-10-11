@echo off
setlocal
set "SUPPORT=%TEMP%\HeroTavern-Source-%RANDOM%-%RANDOM%"
mkdir "%SUPPORT%"
copy /y "%~dp0installer\Install.ps1" "%SUPPORT%\" >nul
copy /y "%~dp0manager\*" "%SUPPORT%\" >nul
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%SUPPORT%\Install.ps1"
set "RESULT=%ERRORLEVEL%"
rmdir /s /q "%SUPPORT%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%
