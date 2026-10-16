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
$signal=Join-Path $dir ('exit-'+$session.launchId+'.request')
[IO.File]::WriteAllText($signal, '{"kind":"graceful-exit","source":"desktop-stop"}')
Write-Host 'Hero Tavern shutdown requested. Waiting for text/image/voice models and chat servers to close...' -ForegroundColor Cyan
$shutdownPolls=if($ForUpdate){150}else{90}
for($n=0;$n -lt $shutdownPolls;$n++) {
    if (-not (Test-Path -LiteralPath $journal)) { Write-Host 'Hero Tavern closed.' -ForegroundColor Green; return }
    Start-Sleep -Milliseconds 500
}
# Fallback is never based on a port or process name alone. Verify PID identity,
# original creation time, executable path and the role-specific command line.
$node=Get-ChildItem (Join-Path $root 'Runtime') -Filter node.exe -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty FullName
if (-not $node) { Write-Host 'Portable runtime unavailable; refusing emergency termination.' -ForegroundColor Yellow; return }
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
foreach($role in @('bridge','tavern')){
    $entry=$session.$role
    if(Test-Owned $entry $role){
        Write-Host ('Emergency stopping confirmed owned '+$role+' PID '+$entry.pid) -ForegroundColor Yellow
        try { & "$env:SystemRoot\System32\taskkill.exe" /PID ([string]$entry.pid) /T /F 2>$null | Out-Null } catch { }
    }
}
Write-Host 'Shutdown attempt complete. If another application owns ports 8000/8001, it was left untouched.'

if($ForUpdate){
    # A timed-out graceful shutdown is not a successful upgrade handoff.
    # Never replace code while a launcher still owns the old service.
    throw 'The previous Hero Tavern session did not close in time. Close its launcher, then rerun setup. No application files were replaced.'
}
