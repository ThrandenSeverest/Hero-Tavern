# Deterministic shutdown tests: mock process inspection; never stop real processes.
$ErrorActionPreference='Stop'
$testRoot=Join-Path ([IO.Path]::GetTempPath()) ('HeroShutdownTests-'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path (Join-Path $testRoot 'Run'),(Join-Path $testRoot 'Runtime') -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $testRoot 'Runtime\node.exe'),'test fixture')
$stopScript=Join-Path (Split-Path $PSScriptRoot -Parent) 'manager\StopHeroTavern.ps1'
$global:HeroShutdownTestNow=[datetime]::UtcNow
function Get-Process { [CmdletBinding()]param([int]$Id) if($global:HeroShutdownTestAlive -contains $Id){return [pscustomobject]@{Id=$Id;StartTime=$global:HeroShutdownTestNow}};throw 'Process absent' }
function Get-CimInstance { [CmdletBinding()]param([string]$ClassName,[string]$Filter)
    $number=[int]($Filter -replace 'ProcessId=','')
    if($number -eq 101){return [pscustomobject]@{ExecutablePath=(Join-Path $PSHOME 'powershell.exe');CommandLine=$global:HeroShutdownTestLauncherCommand}}
    return [pscustomobject]@{ExecutablePath=(Join-Path $testRoot 'Runtime\node.exe');CommandLine=('node "'+(Join-Path $testRoot 'ModelBridge.cjs')+'" "'+$testRoot+'"')}
}
function Stop-Process { [CmdletBinding()]param([int]$Id) $global:HeroShutdownTestKilled+=,$Id;$global:HeroShutdownTestAlive=@($global:HeroShutdownTestAlive | Where-Object {$_ -ne $Id}) }
function Start-Sleep { param([int]$Milliseconds) $global:HeroShutdownTestSleeps++ }
function Invoke-WebRequest { [CmdletBinding()]param($Uri,$Method,$Headers,$TimeoutSec,[switch]$UseBasicParsing) $global:HeroShutdownTestDirectCalls++;$global:HeroShutdownTestAlive=@();return @{} }
function Reset-Case($alive) {
    $global:HeroShutdownTestAlive=@($alive);$global:HeroShutdownTestKilled=@();$global:HeroShutdownTestSleeps=0;$global:HeroShutdownTestDirectCalls=0
    $global:HeroShutdownTestLauncherCommand='powershell -File "'+(Join-Path $testRoot 'StartHeroTavern.ps1')+'"'
    $global:HeroShutdownTestSession=@{root=$testRoot;launchId=('a'*32);launcher=@{pid=101;startedUtc=$global:HeroShutdownTestNow.ToString('o')};bridge=@{pid=102;startedUtc=$global:HeroShutdownTestNow.ToString('o')};tavern=$null}
    $global:HeroShutdownTestJournal=Join-Path $testRoot 'Run\session.json'
    $global:HeroShutdownTestSession | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $global:HeroShutdownTestJournal
}
function Assert($Value,$Message){if(-not $Value){throw $Message}}
try {
    Reset-Case @()
    & $stopScript -InstallationRoot $testRoot -ForUpdate
    Assert (-not (Test-Path $global:HeroShutdownTestJournal)) 'Stale journal was not removed'
    Assert ($global:HeroShutdownTestSleeps -eq 0 -and $global:HeroShutdownTestKilled.Count -eq 0) 'Stale session waited or stopped a process'
    Reset-Case @(101)
    & $stopScript -InstallationRoot $testRoot -ForUpdate
    Assert ($global:HeroShutdownTestKilled.Count -eq 1 -and $global:HeroShutdownTestKilled[0] -eq 101) 'Verified stalled launcher was not closed'
    Assert ($global:HeroShutdownTestSleeps -lt 15 -and -not (Test-Path $global:HeroShutdownTestJournal)) 'Stalled launcher cleanup did not complete promptly'
    Reset-Case @(101,102)
    & $stopScript -InstallationRoot $testRoot -ForUpdate
    Assert ($global:HeroShutdownTestDirectCalls -eq 1 -and $global:HeroShutdownTestKilled.Count -eq 0) 'Graceful direct bridge shutdown failed'
    Reset-Case @(101)
    $global:HeroShutdownTestLauncherCommand='powershell -File C:\OtherApp\StartHeroTavern.ps1'
    $rejected=$false;try{& $stopScript -InstallationRoot $testRoot -ForUpdate}catch{$rejected=$true}
    Assert ($rejected -and $global:HeroShutdownTestKilled.Count -eq 0 -and (Test-Path $global:HeroShutdownTestJournal)) 'Unverified launcher was stopped or journal removed'
    Reset-Case @(101)
    $global:HeroShutdownTestSession.launcher.startedUtc=$global:HeroShutdownTestNow.AddMinutes(-20).ToString('o')
    $global:HeroShutdownTestSession | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $global:HeroShutdownTestJournal
    & $stopScript -InstallationRoot $testRoot -ForUpdate
    Assert ($global:HeroShutdownTestKilled.Count -eq 0 -and -not (Test-Path $global:HeroShutdownTestJournal)) 'Recycled PID was stopped'
    Write-Host 'PASS: stale journals, blocked launcher, direct graceful shutdown, unverified launcher and recycled PID.'
}finally{Remove-Item -LiteralPath $testRoot -Recurse -Force -ErrorAction SilentlyContinue}
