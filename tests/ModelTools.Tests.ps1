$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '..\manager\ModelTools.ps1')
$temp = Join-Path ([IO.Path]::GetTempPath()) ('HeroTavernTest-' + [guid]::NewGuid())
New-Item -ItemType Directory $temp | Out-Null
function Expect-Failure([scriptblock]$Action) {
    $failed = $false
    try { & $Action } catch { $failed = $true }
    if (-not $failed) { throw 'Expected validation to reject input.' }
}
try {
    $catalog = @(Read-ModelCatalog (Join-Path $PSScriptRoot '..\manager\models.json'))
    if ($catalog.Count -ne 8 -or $catalog[0].Label -isnot [string]) { throw 'Catalog must contain individual model entries, not a nested array.' }
    if ([long]$catalog[0].Size -ne 5030000000L) { throw 'Default model size conversion failed.' }
    Add-Type -AssemblyName System.Windows.Forms
    $combo = New-Object Windows.Forms.ComboBox
    foreach ($entry in $catalog) { [void]$combo.Items.Add($entry.Label) }
    if ($combo.Items.Count -ne 8 -or [string]$combo.Items[0] -notlike '*Qwen3 8B*') { throw 'Dropdown labels are incorrect.' }
    $combo.Dispose()
    $file = Join-Path $temp 'valid.gguf'
    $bytes = New-Object byte[] (1MB)
    [Text.Encoding]::ASCII.GetBytes('GGUF').CopyTo($bytes, 0)
    [BitConverter]::GetBytes([uint32]3).CopyTo($bytes, 4)
    [IO.File]::WriteAllBytes($file, $bytes)
    $hash = (Get-FileHash $file).Hash
    Test-GgufFile $file 1MB $hash
    Expect-Failure { Test-GgufFile $file 2MB $hash }
    Expect-Failure { Test-GgufFile $file 1MB ('0' * 64) }
    [IO.File]::WriteAllText((Join-Path $temp 'selected-model.txt'), $file)
    if ((Get-SelectedModel $temp) -ne $file) { throw 'Valid selection rejected.' }
    [IO.File]::WriteAllText((Join-Path $temp 'selected-model.txt'), (Join-Path $temp '..\outside.gguf'))
    Expect-Failure { Get-SelectedModel $temp }
    $bytes[0] = 0
    [IO.File]::WriteAllBytes($file, $bytes)
    Expect-Failure { Test-GgufFile $file }
    Write-Host 'PASS: valid GGUF accepted; truncation, checksum failure, non-GGUF and path escape rejected.'
} finally { Remove-Item -LiteralPath $temp -Recurse -Force }
