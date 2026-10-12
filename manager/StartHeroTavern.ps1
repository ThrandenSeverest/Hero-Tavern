# One launcher owns both subprocesses and shuts down only those it starts.
$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
$bridge = $null
$tavern = $null
$mutex = New-Object Threading.Mutex($false, 'Local\HeroTavernLauncher')
$locked = $false
$exitCode = 0
$logs = Join-Path $root 'Logs'
$startError = $null
New-Item -ItemType Directory -Path $logs -Force -ErrorAction SilentlyContinue | Out-Null
function Show-LogTail([string]$Name, [int]$Count = 65) {
    $file = Join-Path $logs $Name
    if (Test-Path -LiteralPath $file) {
        Write-Host ('--- ' + $file + ' ---') -ForegroundColor Yellow
        try { Get-Content -LiteralPath $file -Tail $Count -ErrorAction Stop | ForEach-Object { Write-Host $_ } }
        catch { Write-Host ('Unable to read log: ' + $_.Exception.Message) }
    } else { Write-Host ('No ' + $Name + ' has been created.') -ForegroundColor DarkYellow }
}
function Write-LaunchError([string]$Message) {
    $report = Join-Path $logs 'launcher-error.log'
    $text = '==== ' + (Get-Date).ToString('yyyy-MM-dd HH:mm:ss zzz') + ' ====' + [Environment]::NewLine + $Message + [Environment]::NewLine
    try { [IO.File]::AppendAllText($report, $text, [Text.Encoding]::UTF8) } catch {}
}

function Test-Port([int]$Port) {
    $client = New-Object Net.Sockets.TcpClient
    try { $client.Connect('127.0.0.1', $Port); return $true } catch { return $false } finally { $client.Dispose() }
}
function Wait-Service([string]$Url, $Process, [int]$Seconds) {
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
        if ($Process.HasExited) { throw ('Server process exited with code ' + $Process.ExitCode + ' before ' + $Url + ' became ready. Review its error log below.') }
        try {
            $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 2
            if ($response.StatusCode -eq 200) { return }
        } catch {}
        Start-Sleep -Milliseconds 800
    }
    throw ('Server startup timed out: ' + $Url + '. Review server error log below. Context size is not relevant when SillyTavern fails.')
}
try {
    $locked = $mutex.WaitOne(0)
    if (-not $locked) { throw 'Hero Tavern is already running. Use its existing window.' }
    foreach ($port in @(8000, 8001)) {
        if (Test-Port $port) { throw ('Port ' + $port + ' is occupied. Close the other server first.') }
    }
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
} catch {
    $exitCode = 1
    $startError = $_
    $message = 'Launcher failed: ' + $_.Exception.Message + [Environment]::NewLine + $_.ScriptStackTrace
    Write-LaunchError $message
    Write-Host ''
    Write-Host 'HERO TAVERN FAILED TO START' -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ''
    Write-Host 'Recent SillyTavern output:' -ForegroundColor Cyan
    Show-LogTail 'sillytavern-error.log'
    Show-LogTail 'sillytavern.log' 25
    Write-Host ''
    Write-Host 'Recent ModelBridge output:' -ForegroundColor Cyan
    Show-LogTail 'models-error.log'
    Show-LogTail 'models.log' 25
    Write-Host ''
    Write-Host ('Persistent report: ' + (Join-Path $logs 'launcher-error.log')) -ForegroundColor Yellow
    Write-Host ('Installation log: ' + (Join-Path $root 'install.log')) -ForegroundColor Yellow
    Write-Host 'Do not delete Models, Images, SillyTavern/data or your user files.' -ForegroundColor Yellow
    try { Read-Host 'Press Enter AFTER copying the error above. The window will remain open until then' | Out-Null }
    catch { Start-Sleep -Seconds 30 }
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
if ($exitCode -ne 0) { exit $exitCode }
