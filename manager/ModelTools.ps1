# Pure validation helpers; no UI or network side effects.
function Test-GgufFile([string]$Path, [long]$ExpectedSize = 0, [string]$ExpectedHash = '') {
    $file = Get-Item -LiteralPath $Path -ErrorAction Stop
    if ($file.Length -lt 1MB) { throw 'Model file is unexpectedly small.' }
    if ($ExpectedSize -gt 0 -and $file.Length -ne $ExpectedSize) { throw 'Model download is incomplete (size mismatch).' }
    $stream = [IO.File]::OpenRead($Path)
    try {
        $header = New-Object byte[] 8
        if ($stream.Read($header, 0, 8) -ne 8 -or [Text.Encoding]::ASCII.GetString($header, 0, 4) -ne 'GGUF') { throw 'Downloaded file is not GGUF.' }
        $version = [BitConverter]::ToUInt32($header, 4)
        if ($version -lt 2 -or $version -gt 3) { throw 'Unsupported GGUF version.' }
    } finally { $stream.Dispose() }
    if ($ExpectedHash) {
        if ($ExpectedHash -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid SHA-256 metadata.' }
        if ((Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $ExpectedHash) { throw 'SHA-256 mismatch. The model was not installed.' }
    }
}
function Get-SelectedModel([string]$Models) {
    $selection = Join-Path $Models 'selected-model.txt'
    if (-not (Test-Path -LiteralPath $selection)) { throw 'No model selected. Open Manage-Models.cmd.' }
    $chosen = [IO.File]::ReadAllText($selection).Trim().TrimStart([char]0xFEFF)
    $folder = [IO.Path]::GetFullPath($Models).TrimEnd('\') + '\'
    $path = [IO.Path]::GetFullPath($chosen)
    if (-not $path.StartsWith($folder, [StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetExtension($path) -ne '.gguf') { throw 'Selected model must be a GGUF inside the Models folder.' }
    Test-GgufFile $path
    return $path
}

function Read-ModelCatalog([string]$Path) {
    # PS 5.1 emits a JSON array as one pipeline value. Enumerate explicitly.
    $parsed = Get-Content -LiteralPath $Path -Raw | ConvertFrom-Json
    foreach ($entry in $parsed) {
        if ($entry.Label -isnot [string] -or $entry.Size -is [array]) { throw 'Invalid model catalog entry.' }
        [long]$entry.Size | Out-Null
        $entry
    }
}
