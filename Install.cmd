@echo off
setlocal
set "SUPPORT=%TEMP%\HeroTavern-Source-%RANDOM%-%RANDOM%"
mkdir "%SUPPORT%"
copy /y "%~dp0installer\Install.ps1" "%SUPPORT%\" >nul
copy /y "%~dp0manager\*" "%SUPPORT%\" >nul
copy /y "%~dp0extension\index.js" "%SUPPORT%\HeroExtension.js" >nul
copy /y "%~dp0extension\story.js" "%SUPPORT%\HeroStory.js" >nul
copy /y "%~dp0extension\manifest.json" "%SUPPORT%\HeroExtension.json" >nul
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%SUPPORT%\Install.ps1"
set "RESULT=%ERRORLEVEL%"
rmdir /s /q "%SUPPORT%"
if not "%RESULT%"=="0" pause
exit /b %RESULT%
