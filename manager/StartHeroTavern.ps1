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
$runDir = Join-Path $root 'Run'
$journal = Join-Path $runDir 'session.json'
$launchId = [guid]::NewGuid().ToString('N')
$shutdownRequest = Join-Path $runDir ('exit-' + $launchId + '.request')
$node = $null
New-Item -ItemType Directory -Path $runDir -Force -ErrorAction SilentlyContinue | Out-Null

function Get-ProcessRecord($Process, [string]$Role) {
    if (-not $Process) { return $null }
    try {
        $p = Get-Process -Id $Process.Id -ErrorAction Stop
        return @{ pid = [int]$p.Id; role = $Role; startedUtc = $p.StartTime.ToUniversalTime().ToString('o') }
    } catch { return $null }
}
function Write-SessionJournal {
    $record = @{
        schemaVersion = 1
        root = $root
        launchId = $launchId
        launcher = Get-ProcessRecord (Get-Process -Id $PID) 'launcher'
        tavern = Get-ProcessRecord $tavern 'tavern'
        bridge = Get-ProcessRecord $bridge 'bridge'
    }
    $tmp = $journal + '.' + $launchId + '.tmp'
    [IO.File]::WriteAllText($tmp, ($record | ConvertTo-Json -Depth 5), [Text.Encoding]::UTF8)
    Move-Item -LiteralPath $tmp -Destination $journal -Force
}
function Test-ManagedProcess($Entry, [string]$Role, [string]$ExpectedNode) {
    if (-not $Entry -or -not $Entry.pid -or -not $Entry.startedUtc) { return $false }
    try {
        $running = Get-Process -Id ([int]$Entry.pid) -ErrorAction Stop
        if ([Math]::Abs(($running.StartTime.ToUniversalTime() - [datetime]::Parse([string]$Entry.startedUtc).ToUniversalTime()).TotalSeconds) -gt 3) { return $false }
        $cim = Get-CimInstance Win32_Process -Filter ('ProcessId=' + [int]$Entry.pid) -ErrorAction Stop
        if (-not $cim -or -not $cim.ExecutablePath -or -not [string]::Equals([IO.Path]::GetFullPath($cim.ExecutablePath), [IO.Path]::GetFullPath($ExpectedNode), [StringComparison]::OrdinalIgnoreCase)) { return $false }
        if ($Role -eq 'tavern') { return $cim.CommandLine -match '(?i)(?:^|\s)server\.js\s+--port\s+8000(?:\s|$)' }
        if ($Role -eq 'bridge') { return $cim.CommandLine -like ('*' + (Join-Path $root 'ModelBridge.cjs') + '*') }
    } catch { return $false }
    return $false
}
function Stop-VerifiedProcess($Entry, [string]$Role, [string]$ExpectedNode) {
    if (-not (Test-ManagedProcess $Entry $Role $ExpectedNode)) { return $false }
    Write-Host ('Stopping leftover Hero Tavern ' + $Role + ' PID ' + $Entry.pid) -ForegroundColor Yellow
    & "$env:SystemRoot\System32\taskkill.exe" /PID ([string]$Entry.pid) /T /F 2>$null | Out-Null
    return $true
}
function Find-PortOwner([int]$Port) {
    try {
        $listener = Get-NetTCPConnection -State Listen -LocalPort $Port -ErrorAction Stop | Where-Object { $_.LocalAddress -in @('127.0.0.1','0.0.0.0','::1','::') } | Select-Object -First 1
        if ($listener) { return [int]$listener.OwningProcess }
    } catch { }
    return 0
}
function Verify-OrphanListener([int]$Port, [string]$Role, [string]$ExpectedNode) {
    $ownerPid = Find-PortOwner $Port
    if ($ownerPid -le 0) { return $null }
    try {
        $p = Get-Process -Id $ownerPid -ErrorAction Stop
        $entry = Get-ProcessRecord $p $Role
        if (Test-ManagedProcess $entry $Role $ExpectedNode) { return $entry }
    } catch { }
    return $null
}

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
    try { $locked = $mutex.WaitOne(0) }
    catch [System.Threading.AbandonedMutexException] { $locked = $true }
    if (-not $locked) {
        # Do not open a random service on port 8000; verify the active session
        # belongs to this exact installation before reusing its browser tab.
        $portable = Get-ChildItem (Join-Path $root 'Runtime') -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
        $owned = $false
        if ($portable -and (Test-Path -LiteralPath $journal) -and (Test-Port 8000)) {
            try {
                $session = Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json -ErrorAction Stop
                $owned = [string]::Equals([string]$session.root,$root,[StringComparison]::OrdinalIgnoreCase) -and (Test-ManagedProcess $session.tavern 'tavern' $portable)
            } catch { }
        }
        if ($owned) {
            Start-Process 'http://127.0.0.1:8000/'
            Write-Host 'Existing verified Hero Tavern window opened.' -ForegroundColor Green
            return
        }
        throw 'Hero Tavern launcher is busy or another service owns port 8000; refusing to reuse an unverified server.'
    }
    New-Item -ItemType Directory -Force $logs | Out-Null
    $node = Get-ChildItem (Join-Path $root 'Runtime') -Filter node.exe -Recurse | Select-Object -First 1 -ExpandProperty FullName
    if (-not $node) { throw 'Portable Node runtime missing. Run setup again.' }
    # PID + start time + installed executable path + command line must all match.
    if (Test-Path -LiteralPath $journal) {
        try {
            $previous = Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json -ErrorAction Stop
            if ([string]::Equals([string]$previous.root, $root, [StringComparison]::OrdinalIgnoreCase)) {
                $oldLauncherStillRunning = $false
                if ($previous.launcher) {
                    try {
                        $owner = Get-Process -Id ([int]$previous.launcher.pid) -ErrorAction Stop
                        $oldLauncherStillRunning = [Math]::Abs(($owner.StartTime.ToUniversalTime() - [datetime]::Parse([string]$previous.launcher.startedUtc).ToUniversalTime()).TotalSeconds) -lt 3
                    } catch { }
                }
                if ($oldLauncherStillRunning) { throw 'A previous Hero Tavern launcher is still running; refusing to terminate its session.' }
                [void](Stop-VerifiedProcess $previous.bridge 'bridge' $node)
                [void](Stop-VerifiedProcess $previous.tavern 'tavern' $node)
            } else { throw 'Previous session journal belongs to a different installation; refusing cleanup.' }
            Remove-Item -LiteralPath $journal -Force -ErrorAction SilentlyContinue
        } catch {
            throw ('Previous session recovery needs attention: ' + $_.Exception.Message)
        }
    }
    # Pre-journal installations may still own 8000/8001. Only offer to kill a verified
    # instance using our portable Node runtime; never terminate an arbitrary port owner.
    $orphanTavern = if (Test-Port 8000) { Verify-OrphanListener 8000 'tavern' $node } else { $null }
    $orphanBridge = if (Test-Port 8001) { Verify-OrphanListener 8001 'bridge' $node } else { $null }
    if ($orphanTavern -or $orphanBridge) {
        Write-Host 'A previous Hero Tavern instance left managed servers running.' -ForegroundColor Yellow
        $answer = Read-Host 'Stop verified leftovers and restart? [Y]es / [N]o'
        if ($answer -notmatch '^(?i:y|yes)$') { throw 'Restart cancelled; no running processes were stopped.' }
        if ($orphanBridge) { [void](Stop-VerifiedProcess $orphanBridge 'bridge' $node) }
        if ($orphanTavern) { [void](Stop-VerifiedProcess $orphanTavern 'tavern' $node) }
        Start-Sleep -Milliseconds 1300
    }
    foreach ($port in @(8000,8001)) {
        if (Test-Port $port) { throw ('Port ' + $port + ' is occupied by an unverified process; other software will not be terminated.') }
    }
    $env:NODE_ENV = 'production'
    $env:HERO_LAUNCHER_TOKEN = $launchId
    $tavern = Start-Process $node -ArgumentList 'server.js --port 8000 --listen false --browserLaunchEnabled false' -WorkingDirectory (Join-Path $root 'SillyTavern') -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'sillytavern.log') -RedirectStandardError (Join-Path $logs 'sillytavern-error.log')
    Write-SessionJournal
    Wait-Service 'http://127.0.0.1:8000/' $tavern 120
    $bridge = Start-Process $node -ArgumentList ('"' + (Join-Path $root 'ModelBridge.cjs') + '" "' + $root + '"') -WorkingDirectory $root -PassThru -WindowStyle Hidden -RedirectStandardOutput (Join-Path $logs 'models.log') -RedirectStandardError (Join-Path $logs 'models-error.log')
    Write-SessionJournal
    Wait-Service 'http://127.0.0.1:8001/' $bridge 30
    Start-Process 'http://127.0.0.1:8000/'
    Write-Host 'Hero Tavern is open. Use its Models button to download or select AI models.' -ForegroundColor Green
    Write-Host 'Use Exit Hero Tavern in the app sidebar, or press Enter in this launcher window.' -ForegroundColor Cyan
    while ($true) {
        if (Test-Path -LiteralPath $shutdownRequest) {
            Remove-Item -LiteralPath $shutdownRequest -Force -ErrorAction SilentlyContinue
            Write-Host 'App Exit requested; stopping owned servers safely...' -ForegroundColor Yellow
            break
        }
        if ($bridge.HasExited -or $tavern.HasExited) {
            throw 'Managed server exited unexpectedly; stopping the remaining processes.'
        }
        try {
            if ([Console]::KeyAvailable -and [Console]::ReadKey($true).Key -eq [ConsoleKey]::Enter) {
                Write-Host 'Launcher exit requested.' -ForegroundColor Yellow
                break
            }
        } catch [InvalidOperationException] { }
        Start-Sleep -Milliseconds 500
    }
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
    if ($locked) {
        try {
            if (Test-Path -LiteralPath $journal) {
                $active = Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json
                if ($active.launchId -eq $launchId) { Remove-Item -LiteralPath $journal -Force -ErrorAction SilentlyContinue }
            }
            if (Test-Path -LiteralPath $shutdownRequest) { Remove-Item -LiteralPath $shutdownRequest -Force -ErrorAction SilentlyContinue }
        } catch { }
        $mutex.ReleaseMutex()
    }
    $mutex.Dispose()
}
if ($exitCode -ne 0) { exit $exitCode }
