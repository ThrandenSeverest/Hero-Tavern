# Hero Tavern installer - Windows 10/11 x64
# Source projects: https://github.com/SillyTavern/SillyTavern
#                  https://nodejs.org/ and https://github.com/LostRuins/koboldcpp
# Does not require admin privileges, Git, Python, or an existing Node installation.
# Fresh install only. Does not delete or overwrite old SillyTavern conversations.
param([switch]$NoPause)
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Root = Join-Path $env:LOCALAPPDATA 'Hero-Tavern'
$ST = Join-Path $Root 'SillyTavern'
$Runtime = Join-Path $Root 'Runtime'
$Tools = Join-Path $Root 'KoboldCpp'
$Models = Join-Path $Root 'Models'
$Downloads = Join-Path $Root 'Downloads'
$startedTranscript = $false
$failed = $false

function Step([string]$Message) {
    Write-Host "`n=== $Message ===" -ForegroundColor Cyan
}
function Download([string]$Url, [string]$Output) {
    Write-Host "Downloading: $Url"
    $lastError = ''
    for ($attempt = 1; $attempt -le 3; $attempt++) {
        try {
            Invoke-WebRequest -Uri $Url -OutFile $Output -UseBasicParsing -TimeoutSec 1800
            if ((Get-Item $Output).Length -lt 1024) { throw 'Downloaded file unexpectedly small.' }
            return
        } catch {
            $lastError = $_.Exception.Message
            Write-Host "Attempt $attempt failed: $lastError" -ForegroundColor Yellow
            if ($attempt -lt 3) { Start-Sleep -Seconds 3 }
        }
    }
    throw "Download failed: $Url`n$lastError"
}
function Write-AsciiFile([string]$Path, [string]$Content) {
    [IO.File]::WriteAllText($Path, $Content.Replace("`r`n", "`n").Replace("`n", "`r`n"), [Text.Encoding]::ASCII)
}

try {
    Write-Host 'Hero Tavern | Windows 10/11 x64' -ForegroundColor Green
    Write-Host 'No admin rights, Git, or preinstalled Node.js needed.'
    Write-Host 'This installs or repairs your Hero Tavern installation.'
    Write-Host 'Old SillyTavern directories and data are NOT deleted.'
    Write-Host "Destination: $Root"
    Write-Host ''
    if (-not [Environment]::Is64BitOperatingSystem) { throw '64-bit Windows is required.' }
    [IO.Directory]::CreateDirectory($Root) | Out-Null
    [IO.Directory]::CreateDirectory($Downloads) | Out-Null
    [IO.Directory]::CreateDirectory($Models) | Out-Null
    try { Start-Transcript -Path (Join-Path $Root 'install.log') -Append | Out-Null; $startedTranscript = $true } catch {}

    Step '1/5 - Downloading portable Node.js LTS (official nodejs.org)'
    $nodeExe = Get-ChildItem -Path $Runtime -Filter 'node.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
    if (-not $nodeExe -or -not (Test-Path $nodeExe)) {
        $versions = Invoke-RestMethod -Uri 'https://nodejs.org/dist/index.json' -TimeoutSec 90
        $current = $versions | Where-Object { $_.lts -and ($_.files -contains 'win-x64-zip') } | Select-Object -First 1
        if (-not $current) { throw 'Could not find a portable Node.js LTS Windows build.' }
        $name = 'node-' + $current.version + '-win-x64.zip'
        $base = 'https://nodejs.org/dist/' + $current.version + '/'
        $archive = Join-Path $Downloads $name
        Download ($base + $name) $archive
        Write-Host 'Checking Node.js SHA-256...'
        $shasums = (Invoke-WebRequest -Uri ($base + 'SHASUMS256.txt') -UseBasicParsing -TimeoutSec 90).Content
        $entry = ($shasums -split "`n" | Where-Object { $_ -match ('\s' + [regex]::Escape($name) + '\s*$') } | Select-Object -First 1)
        if (-not $entry) { throw 'Node.js checksum manifest is missing the downloaded archive.' }
        $expectedHash = ($entry -split '\s+')[0].ToLowerInvariant()
        $actualHash = (Get-FileHash -Path $archive -Algorithm SHA256).Hash.ToLowerInvariant()
        if ($expectedHash -ne $actualHash) { throw 'Node.js checksum mismatch. Installation stopped.' }
        if (Test-Path $Runtime) { Remove-Item -LiteralPath $Runtime -Recurse -Force }
        Expand-Archive -LiteralPath $archive -DestinationPath $Runtime -Force
        $nodeExe = Get-ChildItem -Path $Runtime -Filter 'node.exe' -Recurse | Select-Object -First 1 -ExpandProperty FullName
    }
    if (-not $nodeExe) { throw 'Node.js executable was not found after extraction.' }
    $NodeHome = Split-Path $nodeExe -Parent
    $npm = Join-Path $NodeHome 'npm.cmd'
    if (-not (Test-Path $npm)) { throw 'npm.cmd was not found in the Node.js portable runtime.' }
    $env:PATH = $NodeHome + ';' + $env:PATH
    Write-Host "Node: $(& $nodeExe --version)"

    Step '2/5 - Downloading stable SillyTavern (official release branch)'
    # Re-runs repair dependencies and launchers without replacing chats/settings.
    if (-not (Test-Path (Join-Path $ST 'server.js'))) {
        if (Test-Path $ST) { throw 'Incomplete SillyTavern folder found. Rename it after backing up any data, then retry.' }
        $upstreamCommit = '06bde939fb1e9c4c8d8641d810f0a916b5bce127'
        $stArchive = Join-Path $Downloads 'SillyTavern-release.zip'
        $unzipPath = Join-Path $Downloads 'ST-extracted'
        if (Test-Path $unzipPath) { Remove-Item -LiteralPath $unzipPath -Recurse -Force }
        Download ('https://api.github.com/repos/SillyTavern/SillyTavern/zipball/' + $upstreamCommit) $stArchive
        Expand-Archive -LiteralPath $stArchive -DestinationPath $unzipPath -Force
        $stExtract = Get-ChildItem -LiteralPath $unzipPath -Directory | Select-Object -First 1
        if (-not $stExtract -or -not (Test-Path (Join-Path $stExtract.FullName 'package.json'))) { throw 'Invalid SillyTavern archive.' }
        Move-Item -LiteralPath $stExtract.FullName -Destination $ST
        $upstreamCommit | Set-Content (Join-Path $Root 'sillytavern-version.txt')
    } else { Write-Host 'Reusing SillyTavern; chats and settings stay in place.' }

    Step '3/5 - Installing SillyTavern Node dependencies'
    Push-Location $ST
    try {
        $env:NODE_ENV = 'production'
        & $npm ci --omit=dev --no-audit --no-fund
        if ($LASTEXITCODE -ne 0) {
            Write-Host 'npm ci failed; retrying npm install.' -ForegroundColor Yellow
            & $npm install --omit=dev --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) { throw "npm failed with code $LASTEXITCODE" }
        }
        & $npm run init
        if ($LASTEXITCODE -ne 0) { throw 'SillyTavern configuration initialization failed.' }
    } finally { Pop-Location }

    Step '4/5 - Installing model management and start scripts'
    $supportDirectory = Split-Path $MyInvocation.MyCommand.Path -Parent
    foreach ($filename in @('ModelManager.ps1', 'LaunchLocalAI.ps1', 'StartHeroTavern.ps1', 'ModelTools.ps1', 'models.json', 'ConfigureTavern.cjs', 'ModelBridge.cjs', 'ModelPanel.html', 'ReplyPipeline.cjs', 'ReplyFilters.cjs', 'ContextMemory.cjs', 'ImageService.cjs', 'Adventure.html', 'AdventureAdapter.js', 'spells.json', 'ModelProfiles.cjs', 'StoryState.cjs', 'StoryStore.cjs', 'StoryAPI.cjs', 'ThinkingWorker.cjs', 'StoryPanel.js', 'CreatorPanel.js')) {
        $source = Join-Path $supportDirectory $filename
        if (-not (Test-Path -LiteralPath $source)) { throw ('Installer resource missing: ' + $filename) }
        Copy-Item -LiteralPath $source -Destination (Join-Path $Root $filename) -Force
    }
    $launchManager = @'
@echo off
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0ModelManager.ps1"
if errorlevel 1 pause
'@
    Write-AsciiFile (Join-Path $Root 'Manage-Models.cmd') $launchManager
    $launchAI = @'
@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0LaunchLocalAI.ps1"
if errorlevel 1 pause
'@
    Write-AsciiFile (Join-Path $Root 'Start-Local-AI.cmd') $launchAI
    if (-not (Test-Path (Join-Path $Models 'selected-model.txt'))) {
        $existingModel = Get-ChildItem -LiteralPath $Models -Filter '*.gguf' -File -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($existingModel) {
            [IO.File]::WriteAllText((Join-Path $Models 'selected-model.txt'), $existingModel.FullName, [Text.Encoding]::UTF8)
        }
    }

    Step 'Creating fresh-start launchers' 
    $launchST = @'
@echo off
setlocal
cd /d "%~dp0SillyTavern"
set "PATH=%~dp0__NODE_REL__;%PATH%"
set "NODE_ENV=production"
node server.js
if errorlevel 1 pause
'@
    $nodeRel = $NodeHome.Substring($Root.Length).TrimStart('\')
    $launchST = $launchST.Replace('__NODE_REL__', $nodeRel)
    Write-AsciiFile (Join-Path $Root 'Start-SillyTavern.cmd') $launchST

    # Browser data is isolated to prevent broken UI settings/cache from old browser profiles.
    $launchFreshUI = @'
@echo off
setlocal
set "EDGE=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
if not exist "%EDGE%" set "EDGE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%EDGE%" (
  start "" "%EDGE%" --user-data-dir="__BROWSER__" "http://127.0.0.1:8000/"
) else (
  start "" "http://127.0.0.1:8000/"
)
'@
    $launchFreshUI = $launchFreshUI.Replace('__BROWSER__', '%~dp0CleanBrowserProfile')
    Write-AsciiFile (Join-Path $Root 'Open-Fresh-UI.cmd') $launchFreshUI

    $launchChat = @'
@echo off
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%~dp0StartHeroTavern.ps1"
if errorlevel 1 pause
'@
    Write-AsciiFile (Join-Path $Root 'Start-Chat.cmd') $launchChat
    if (-not (Test-Path (Join-Path $Root 'backend.json'))) {
        '{"mode":"cpu","gpuLayers":0,"contextSize":8192}' | Set-Content (Join-Path $Root 'backend.json')
    }
    $extensionPath = Join-Path $ST 'public\scripts\extensions\hero-tavern'
    New-Item -ItemType Directory -Force $extensionPath | Out-Null
    Copy-Item -LiteralPath (Join-Path $supportDirectory 'HeroStory.js') -Destination (Join-Path $extensionPath 'story.js') -Force
    Copy-Item -LiteralPath (Join-Path $supportDirectory 'HeroExtension.js') -Destination (Join-Path $extensionPath 'index.js') -Force
    Copy-Item -LiteralPath (Join-Path $supportDirectory 'HeroExtension.json') -Destination (Join-Path $extensionPath 'manifest.json') -Force
    Copy-Item -LiteralPath (Join-Path $supportDirectory 'ReplyFilters.cjs') -Destination (Join-Path $extensionPath 'reply-filters.js') -Force
    # Seed only a new default profile, never rewrite an existing profile.
    & $nodeExe (Join-Path $Root 'ConfigureTavern.cjs') $ST
    if ($LASTEXITCODE -ne 0) { throw 'Could not configure the local KoboldCpp connection.' }
    $shell = New-Object -ComObject WScript.Shell
    $shortcut = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Hero Tavern.lnk'))
    $shortcut.TargetPath = Join-Path $Root 'Start-Chat.cmd'
    $shortcut.WorkingDirectory = $Root
    $shortcut.Save()

    $help = @'
HERO TAVERN
===========
Installation: __ROOT__

Open Hero Tavern first, then click Models to download Qwen in the chat UI.
Manage-Models.cmd remains available for advanced/custom downloads.
Start-Chat.cmd: open SillyTavern immediately; AI loads separately.
Hero Tavern desktop shortcut starts the same launcher.
Keep the launcher window open; press Enter there to stop both servers.

Fresh profiles use Text Completion / KoboldCpp at http://127.0.0.1:5001.
Click Connect in SillyTavern if requested.

backend.json: cpu/cuda/vulkan mode, GPU layers and context size.
CPU mode is the initial default. It can be slow.
Logs: install.log and the Logs folder.
Re-running setup preserves chats, settings, characters and models.
'@
    Write-AsciiFile (Join-Path $Root 'README.txt') $help.Replace('__ROOT__', $Root)

    Step '5/5 - Installing KoboldCpp backend'
    [IO.Directory]::CreateDirectory($Tools) | Out-Null
    $kcpp = Join-Path $Tools 'koboldcpp.exe'
    if (-not (Test-Path -LiteralPath $kcpp)) {
        $latest = Invoke-RestMethod -Uri 'https://api.github.com/repos/LostRuins/koboldcpp/releases/latest' -Headers @{'User-Agent'='HeroTavern'} -TimeoutSec 120
        $asset = $latest.assets | Where-Object { $_.name -eq 'koboldcpp.exe' } | Select-Object -First 1
        if (-not $asset) { throw 'Official KoboldCpp Windows asset not found.' }
        $temporaryBackend = Join-Path $Downloads 'koboldcpp.exe.part'
        Download $asset.browser_download_url $temporaryBackend
        if ($asset.digest -match '^sha256:([a-fA-F0-9]{64})$') {
            $expected = $matches[1]
            if ((Get-FileHash $temporaryBackend -Algorithm SHA256).Hash -ne $expected) { throw 'KoboldCpp checksum mismatch.' }
        } else { Write-Host 'Upstream did not publish a binary checksum for this release.' -ForegroundColor Yellow }
        Move-Item -LiteralPath $temporaryBackend -Destination $kcpp
        $latest.tag_name | Set-Content (Join-Path $Root 'koboldcpp-version.txt')
    }
    Write-Host 'Hero Tavern installed. Opening the chat UI; use Models to download Qwen.' -ForegroundColor Green
    Start-Process -FilePath 'powershell.exe' -ArgumentList ('-NoProfile -STA -ExecutionPolicy Bypass -File "' + (Join-Path $Root 'StartHeroTavern.ps1') + '"')
} catch {
    $failed = $true
    Write-Host ''
    Write-Host 'INSTALLATION DID NOT COMPLETE' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ('Detailed failure: ' + $_.ScriptStackTrace) -ForegroundColor DarkYellow
    Write-Host ('Log: ' + (Join-Path $Root 'install.log'))
} finally {
    if ($startedTranscript) { try { Stop-Transcript | Out-Null } catch {} }
    Write-Host ''
    if (-not $NoPause -and $failed) { Read-Host 'Press Enter to close' }
    if ($failed) { exit 1 }
}
