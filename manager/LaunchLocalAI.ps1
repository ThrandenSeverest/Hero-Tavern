# Starts the selected GGUF with a loopback-only KoboldCpp API.
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'ModelTools.ps1')
$root = $PSScriptRoot
$kobold = Join-Path $root 'KoboldCpp\koboldcpp.exe'
if (-not (Test-Path -LiteralPath $kobold)) { throw 'KoboldCpp missing. Run setup again.' }
$model = Get-SelectedModel (Join-Path $root 'Models')
$config = Get-Content -LiteralPath (Join-Path $root 'backend.json') -Raw | ConvertFrom-Json
if ($config.mode -notin @('cpu', 'cuda', 'vulkan')) { throw 'backend.json mode must be cpu, cuda or vulkan.' }
if ($config.contextSize -lt 512 -or $config.contextSize -gt 32768) { throw 'Context size must be 512-32768.' }
if ($config.gpuLayers -lt -1 -or $config.gpuLayers -gt 999) { throw 'Invalid GPU layer count.' }
$backendArgs = @('--model', $model, '--contextsize', [string][int]$config.contextSize, '--host', '127.0.0.1', '--port', '5001', '--skiplauncher')
if ($config.mode -eq 'cpu') { $backendArgs += @('--gpulayers', '0') }
else {
    if ($config.mode -eq 'cuda') { $backendArgs += '--usecuda' } else { $backendArgs += '--usevulkan' }
    $backendArgs += @('--gpulayers', [string][int]$config.gpuLayers)
}
Write-Host ('Model: ' + [IO.Path]::GetFileName($model) + ' | Mode: ' + $config.mode)
& $kobold @backendArgs
if ($LASTEXITCODE -ne 0) { throw ('KoboldCpp exited with code ' + $LASTEXITCODE) }
