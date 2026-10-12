# One launcher owns both subprocesses and shuts down only those it starts.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$bridge = $null
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
    foreach ($port in @(8000, 8001)) {
        if (Test-Port $port) { throw ('Port ' + $port + ' is occupied. Close the other server first.') }
    }
    $logs = Join-Path $root 'Logs'
    New-Item -ItemType Directory -Force $logs | Out-Null
    $node = Get-ChildItem (Join-Path $root 'Runtime') -Filter node.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
    if (-not $node) { throw 'Portable Node runtime missing. Run setup again.' }
    $env:NODE_ENV = 'production'
    $env:HERO_LAUNCHER_TOKEN = [guid]::NewGuid().ToString('N')
    $tavern = Start-Process $node -ArgumentList 'server.js --port 8000 --listen false --browserLaunchEnabled false' -WorkingDirectory (Join-Path $root 'SillyTavern') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'sillytavern.log') -RedirectStandardError (Join-Path $logs 'sillytavern-error.log')
    Wait-Service 'http://127.0.0.1:8000/' $tavern 120
    $bridge = Start-Process $node -ArgumentList ('"' + (Join-Path $root 'ModelBridge.cjs') + '" "' + $root + '"') -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'models.log') -RedirectStandardError (Join-Path $logs 'models-error.log')
    Wait-Service 'http://127.0.0.1:8001/' $bridge 30
    Start-Process 'http://127.0.0.1:8000/'
    Write-Host 'Hero Tavern is open. Use its Models button to download or select AI models.' -ForegroundColor Green
    Read-Host 'Press Enter here to stop Hero Tavern'
} finally {
    # Give the bridge time to shut down its own KoboldCpp children gracefully.
    if ($bridge -and -not $bridge.HasExited) {
        try {
            Invoke-WebRequest -Uri 'http://127.0.0.1:8001/launcher/shutdown' -Method POST -Headers @{ 'x-hero-launch-token' = $env:HERO_LAUNCHER_TOKEN } -TimeoutSec 5 -UseBasicParsing | Out-Null
            if (-not $bridge.WaitForExit(42000)) { Write-Warning 'AI bridge did not exit within grace period; emergency stop follows.' }
        } catch { Write-Warning ('Graceful AI bridge shutdown unavailable: ' + $_.Exception.Message) }
    }
    foreach ($process in @($bridge, $tavern)) {
        if ($process -and -not $process.HasExited) {
            if ($process -eq $tavern) {
                try { Stop-Process -Id $process.Id -ErrorAction Stop } catch {}
                try { $process.WaitForExit(3000) | Out-Null } catch {}
            }
            if (-not $process.HasExited) { & "$env:SystemRoot\System32\taskkill.exe" /PID $process.Id /T /F | Out-Null }
        }
    }
    if ($locked) { $mutex.ReleaseMutex() }
    $mutex.Dispose()
}
