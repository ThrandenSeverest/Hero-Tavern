# Deterministic shutdown tests: mock process inspection; never stop real processes.
$ErrorActionPreference='Stop'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('HeroShutdownTests-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $testRoot 'Run'),(Join-Path $testRoot 'Runtime') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $testRoot 'Runtime\node.exe'),'test fixture')
$stopScript=Join-Path (Split-Path $PSScriptRoot -Parent) 'manager\StopHeroTavern.ps1'
$script:now=[datetime]::UtcNow
function Get-Process { [CmdletBinding()]param([int]$Id) if($script:alive -contains $Id){return [pscustomobject]@{Id=$Id;StartTime=$script:now}};throw 'Process absent' }
function Get-CimInstance { [CmdletBinding()]param([string]$ClassName,[string]$Filter)
    $number=[int]($Filter -replace 'ProcessId=','')
    if($number -eq 101){return [pscustomobject]@{ExecutablePath=(Join-Path $PSHOME 'powershell.exe');CommandLine=$script:launcherCommand}}
    return [pscustomobject]@{ExecutablePath=(Join-Path $testRoot 'Runtime\node.exe');CommandLine=('node "'+(Join-Path $testRoot 'ModelBridge.cjs')+'" "'+$testRoot+'"')}
}
function Stop-Process { [CmdletBinding()]param([int]$Id) $script:killed+=,$Id;$script:alive=@($script:alive | Where-Object {$_ -ne $Id}) }
function Start-Sleep { param([int]$Milliseconds) $script:sleeps++ }
function Invoke-WebRequest { [CmdletBinding()]param($Uri,$Method,$Headers,$TimeoutSec,[switch]$UseBasicParsing) $script:directCalls++;$script:alive=@();return @{} }
function Reset-Case($alive) {
    $script:alive=@($alive);$script:killed=@();$script:sleeps=0;$script:directCalls=0
    $script:launcherCommand='powershell -File "'+(Join-Path $testRoot 'StartHeroTavern.ps1')+'"'
    $script:session=@{root=$testRoot;launchId=('a'*32);launcher=@{pid=101;startedUtc=$script:now.ToString('o')};bridge=@{pid=102;startedUtc=$script:now.ToString('o')};tavern=$null}
    $script:journal=Join-Path $testRoot 'Run\session.json'
    $script:session | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $script:journal
}
function Assert($Value,$Message){if(-not $Value){throw $Message}}
try {
    Reset-Case @()
    & $stopScript -InstallationRoot $testRoot -ForUpdate
    Assert (-not (Test-Path $script:journal)) 'Stale journal was not removed'
    Assert ($script:sleeps -eq 0 -and $script:killed.Count -eq 0) 'Stale session waited or stopped a process'
    Reset-Case @(101)
    & $stopScript -InstallationRoot $testRoot -ForUpdate
    Assert ($script:killed.Count -eq 1 -and $script:killed[0] -eq 101) 'Verified stalled launcher was not closed'
    Assert ($script:sleeps -lt 15 -and -not (Test-Path $script:journal)) 'Stalled launcher cleanup did not complete promptly'
    Reset-Case @(101,102)
    & $stopScript -InstallationRoot $testRoot -ForUpdate
    Assert ($script:directCalls -eq 1 -and $script:killed.Count -eq 0) 'Graceful direct bridge shutdown failed'
    Reset-Case @(101)
    $script:launcherCommand='powershell -File C:\OtherApp\StartHeroTavern.ps1'
    $rejected=$false;try{& $stopScript -InstallationRoot $testRoot -ForUpdate}catch{$rejected=$true}
    Assert ($rejected -and $script:killed.Count -eq 0 -and (Test-Path $script:journal)) 'Unverified launcher was stopped or journal removed'
    Reset-Case @(101)
    $script:session.launcher.startedUtc=$script:now.AddMinutes(-20).ToString('o')
    $script:session | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $script:journal
    & $stopScript -InstallationRoot $testRoot -ForUpdate
    Assert ($script:killed.Count -eq 0 -and -not (Test-Path $script:journal)) 'Recycled PID was stopped'
    Write-Host 'PASS: stale journals, blocked launcher, direct graceful shutdown, unverified launcher and recycled PID.'
}finally{Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue}
