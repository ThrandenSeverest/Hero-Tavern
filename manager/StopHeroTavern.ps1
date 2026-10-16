# Emergency-safe alternative to browser Exit. Only acts on a verified session journal.
param([string]$InstallationRoot=$PSScriptRoot,[switch]$ForUpdate)
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath($InstallationRoot)
$dir=Join-Path $root 'Run'
$journal=Join-Path $dir 'session.json'
if (-not (Test-Path -LiteralPath $journal)) { Write-Host 'Hero Tavern launcher has no recorded active session.'; return }
try { $session=Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json }
catch { if($ForUpdate){throw 'Session record is invalid. Close Hero Tavern before updating.'}; Write-Host 'Session record is invalid. No process was terminated.' -ForegroundColor Yellow; return }
if (-not [string]::Equals([string]$session.root,$root,[StringComparison]::OrdinalIgnoreCase) -or
    [string]$session.launchId -notmatch '^[a-fA-F0-9]{32}$') {
    if($ForUpdate){throw 'Session journal does not match this installation. Update stopped before replacing files.'}
    Write-Host 'Session journal does not match this installation. No process was terminated.' -ForegroundColor Red
    return
}
function Test-Owned($Entry,[string]$Role) {
    if(-not $Entry -or -not $Entry.pid -or -not $Entry.startedUtc){return $false}
    try{
        $p=Get-Process -Id ([int]$Entry.pid) -ErrorAction Stop
        if([Math]::Abs(($p.StartTime.ToUniversalTime()-[datetime]::Parse([string]$Entry.startedUtc).ToUniversalTime()).TotalSeconds) -gt 3){return $false}
        $w=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$Entry.pid) -ErrorAction Stop
        if(-not $w.ExecutablePath -or -not [string]::Equals([IO.Path]::GetFullPath($w.ExecutablePath),[IO.Path]::GetFullPath($node),[StringComparison]::OrdinalIgnoreCase)){return $false}
        if($Role -eq 'tavern'){return $w.CommandLine -match '(?i)(?:^|\s)server\.js\s+--port\s+8000(?:\s|$)'}
        return $w.CommandLine -like ('*'+(Join-Path $root 'ModelBridge.cjs')+'*')
    }catch{return $false}
}

function Test-RecordedAlive($Entry) {
    if(-not $Entry -or -not $Entry.pid -or -not $Entry.startedUtc){return $false}
    try {
        $p=Get-Process -Id ([int]$Entry.pid) -ErrorAction Stop
        return [Math]::Abs(($p.StartTime.ToUniversalTime()-[datetime]::Parse([string]$Entry.startedUtc).ToUniversalTime()).TotalSeconds) -lt 3
    }catch{return $false}
}
function Test-OwnedLauncher {
    if(-not (Test-RecordedAlive $session.launcher)){return $false}
    try {
        $w=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$session.launcher.pid) -ErrorAction Stop
        $shell=Join-Path $PSHOME 'powershell.exe'
        return $w.ExecutablePath -and [string]::Equals([IO.Path]::GetFullPath($w.ExecutablePath),[IO.Path]::GetFullPath($shell),[StringComparison]::OrdinalIgnoreCase) -and $w.CommandLine -like ('*'+(Join-Path $root 'StartHeroTavern.ps1')+'*')
    }catch{return $false}
}
function Clear-ClosedSession {
    if((Test-RecordedAlive $session.launcher) -or (Test-RecordedAlive $session.bridge) -or (Test-RecordedAlive $session.tavern)){return $false}
    if(Test-Path -LiteralPath $journal){
        $current=Get-Content -LiteralPath $journal -Raw | ConvertFrom-Json
        if($current.launchId -ne $session.launchId){throw 'Another Hero Tavern session started. Update stopped before replacing files.'}
        Remove-Item -LiteralPath $journal -Force
    }
    if(Test-Path -LiteralPath $signal){Remove-Item -LiteralPath $signal -Force}
    Write-Host 'Previous Hero Tavern session is closed; continuing.' -ForegroundColor Green
    return $true
}
$signal=Join-Path $dir ('exit-'+$session.launchId+'.request')
$node=Get-ChildItem (Join-Path $root 'Runtime') -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
# A stale record needs cleanup, not a 75-second wait.
if(Clear-ClosedSession){return}
[IO.File]::WriteAllText($signal, '{"kind":"graceful-exit","source":"desktop-stop"}')
Write-Host 'Closing the previous Hero Tavern session (up to 75 seconds). Progress follows every 5 seconds.' -ForegroundColor Cyan
# The launcher may be waiting at an error prompt and cannot consume exit requests.
# Contact its bridge directly only after verifying this installation's process.
if($node -and (Test-Owned $session.bridge 'bridge')){
    try { Invoke-WebRequest -Uri 'http://127.0.0.1:8001/launcher/shutdown' -Method POST -Headers @{'x-hero-launch-token'=[string]$session.launchId} -TimeoutSec 5 -UseBasicParsing | Out-Null }
    catch { Write-Host 'Bridge shutdown request unavailable; waiting for launcher cleanup.' -ForegroundColor Yellow }
}
$shutdownPolls=if($ForUpdate){150}else{90}
for($n=0;$n -lt $shutdownPolls;$n++) {
    if(Clear-ClosedSession){return}
    if($n -gt 0 -and $n % 10 -eq 0){
        Write-Host ('Shutdown: '+[int]($n/2)+' seconds elapsed. Launcher='+ (Test-RecordedAlive $session.launcher)+'; chat='+ (Test-RecordedAlive $session.tavern)+'; AI service='+ (Test-RecordedAlive $session.bridge)) -ForegroundColor Cyan
    }
    # Once both servers are gone, a verified launcher blocked at Read-Host can
    # be closed safely: it no longer owns any running text/image model process.
    if($n -ge 10 -and -not (Test-RecordedAlive $session.bridge) -and -not (Test-RecordedAlive $session.tavern) -and (Test-OwnedLauncher)){
        Write-Host 'Closing the verified old launcher; both chat services have stopped.' -ForegroundColor Yellow
        Stop-Process -Id ([int]$session.launcher.pid) -ErrorAction SilentlyContinue
    }
    Start-Sleep -Milliseconds 500
}
# Preserve the previous ownership checks for bounded emergency server cleanup.
if (-not $node) { throw 'Portable runtime unavailable. Close the old Hero Tavern windows and rerun setup. No application files were replaced.' }
foreach($role in @('bridge','tavern')){
    $entry=$session.$role
    if(Test-Owned $entry $role){
        Write-Host ('Emergency stopping confirmed owned '+$role+' PID '+$entry.pid) -ForegroundColor Yellow
        try { & "$env:SystemRoot\System32\taskkill.exe" /PID ([string]$entry.pid) /T /F 2>$null | Out-Null } catch { }
    }
}
Start-Sleep -Milliseconds 1500
if(-not (Test-RecordedAlive $session.bridge) -and -not (Test-RecordedAlive $session.tavern) -and (Test-OwnedLauncher)){
    Stop-Process -Id ([int]$session.launcher.pid) -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}
if(Clear-ClosedSession){return}
throw 'The previous Hero Tavern session did not close. Close its launcher window and rerun setup. No application files were replaced.'
