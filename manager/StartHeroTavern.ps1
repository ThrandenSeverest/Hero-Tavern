# One launcher owns both subprocesses and shuts down only those it starts.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$backend = $null
$tavern = $null
$mutex = New-Object Threading.Mutex($false, 'Local\HeroTavernLauncher')
$locked = $false
function Test-Port([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $Port); return $true } catch { return $false } finally { $client.Dispose() }
}
function Wait-Service([string]$Url, $Process, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) { throw ('Server exited. Check logs in ' + (Join-Path $root 'Logs')) }
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch {}
        Start-Sleep -Milliseconds 800
    }
    throw ('Server startup timed out: ' + $Url + '. Check Logs or lower context size.')
}
try {
    $locked = $mutex.WaitOne(0)
    if (-not $locked) { throw 'Hero Tavern is already running. Use its existing window.' }
    . (Join-Path $root 'ModelTools.ps1')
    if (-not (Test-Path (Join-Path $root 'Models\selected-model.txt'))) {
        Start-Process powershell.exe -ArgumentList ('-NoProfile -STA -ExecutionPolicy Bypass -File "' + (Join-Path $root 'ModelManager.ps1') + '"')
        return
    }
    $null = Get-SelectedModel (Join-Path $root 'Models')
    foreach ($port in @(5001, 8000)) {
        if (Test-Port $port) { throw ('Port ' + $port + ' is occupied. Close the other server first.') }
    }
    $logs = Join-Path $root 'Logs'
    New-Item -ItemType Directory -Force $logs | Out-Null
    $node = Get-ChildItem (Join-Path $root 'Runtime') -Filter node.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
    if (-not $node) { throw 'Portable Node runtime missing. Run setup again.' }
    Write-Host 'Hero Tavern: loading local AI. CPU loading may take several minutes.' -ForegroundColor Cyan
    $backend = Start-Process powershell.exe -ArgumentList ('-NoProfile -ExecutionPolicy Bypass -File "' + (Join-Path $root 'LaunchLocalAI.ps1') + '"') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'koboldcpp.log') -RedirectStandardError (Join-Path $logs 'koboldcpp-error.log')
    Wait-Service 'http://127.0.0.1:5001/api/v1/model' $backend 600
    $env:NODE_ENV = 'production'
    $tavern = Start-Process $node -ArgumentList 'server.js --port 8000 --listen false --browserLaunchEnabled false' -WorkingDirectory (Join-Path $root 'SillyTavern') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'sillytavern.log') -RedirectStandardError (Join-Path $logs 'sillytavern-error.log')
    Wait-Service 'http://127.0.0.1:8000/' $tavern 120
    Start-Process 'http://127.0.0.1:8000/'
    Write-Host 'Ready. If SillyTavern requests it, click Connect in API Connections.' -ForegroundColor Green
    Read-Host 'Press Enter here to stop Hero Tavern'
} finally {
    foreach ($process in @($tavern, $backend)) {
        if ($process -and -not $process.HasExited) { & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null }
    }
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
