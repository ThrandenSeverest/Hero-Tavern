# Hero Tavern - Windows model manager (PowerShell 5.1 + WinForms)
# MIT license. Downloads GGUF files only from huggingface.co.
param([string]$Root = (Join-Path $env:LOCALAPPDATA 'Hero-Tavern'))
$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[Windows.Forms.Application]::EnableVisualStyles()
$Models = Join-Path $Root 'Models'
[IO.Directory]::CreateDirectory($Models) | Out-Null
$SelectedFile = Join-Path $Models 'selected-model.txt'
$Curl = Join-Path $env:SystemRoot 'System32\curl.exe'

. (Join-Path $PSScriptRoot 'ModelTools.ps1')
$catalog = @(Read-ModelCatalog (Join-Path $PSScriptRoot 'models.json'))

$form = New-Object Windows.Forms.Form
$form.Text = 'Hero Tavern - Model Library'
$form.Size = New-Object Drawing.Size(745,640)
$form.MinimumSize = New-Object Drawing.Size(745,640)
$form.StartPosition = 'CenterScreen'
$form.Font = New-Object Drawing.Font('Segoe UI',10)
$form.BackColor = [Drawing.Color]::FromArgb(246,247,250)

function Add-Label([string]$t,[int]$x,[int]$y,[int]$w,[int]$h) {
    $c = New-Object Windows.Forms.Label
    $c.Text=$t; $c.SetBounds($x,$y,$w,$h)
    $form.Controls.Add($c)
    return $c
}
function Add-Button([string]$t,[int]$x,[int]$y,[int]$w,[int]$h) {
    $c = New-Object Windows.Forms.Button
    $c.Text=$t; $c.SetBounds($x,$y,$w,$h)
    $c.FlatStyle='System'; $form.Controls.Add($c)
    return $c
}
$heading = Add-Label 'Download and manage local AI models' 18 12 680 33
$heading.Font = New-Object Drawing.Font('Segoe UI',16,[Drawing.FontStyle]::Bold)
$note = Add-Label 'Downloads stay on your PC. Select a compatible GGUF model to use with KoboldCpp.' 20 50 690 26
$note.ForeColor = [Drawing.Color]::DimGray
Add-Label 'Recommended models' 20 86 340 26 | Out-Null
$choices = New-Object Windows.Forms.ComboBox
$choices.DropDownStyle='DropDownList'; $choices.SetBounds(20,113,686,32)
foreach($entry in $catalog) { [void]$choices.Items.Add($entry.Label) }
$choices.SelectedIndex=0
$form.Controls.Add($choices)
$licence = Add-Label 'Default: Qwen3 8B Abliterated, Apache-2.0. Models are downloaded separately.' 20 152 690 24
$licence.ForeColor=[Drawing.Color]::FromArgb(120,73,12)
Add-Label 'Or paste a public Hugging Face direct GGUF link (optional)' 20 186 680 23 | Out-Null
$custom = New-Object Windows.Forms.TextBox
$custom.SetBounds(20,210,686,29)
$form.Controls.Add($custom)
$customHint=Add-Label 'Example: https://huggingface.co/owner/repo/resolve/main/model.gguf' 20 242 686 23
$customHint.ForeColor=[Drawing.Color]::DimGray
$download = Add-Button 'Download model' 20 277 161 39
$cancel = Add-Button 'Cancel download' 193 277 161 39
$cancel.Enabled=$false
$defaultDownload = Add-Button 'Download Qwen default' 365 277 171 39
$folder = Add-Button 'Open models folder' 546 277 160 39
$progress = New-Object Windows.Forms.ProgressBar
$progress.SetBounds(20,326,686,19)
$progress.Minimum=0; $progress.Maximum=100
$form.Controls.Add($progress)
$status = Add-Label 'Ready. Select a model and click Download.' 20 354 686 32
Add-Label 'Installed models' 20 397 500 24 | Out-Null
$installed = New-Object Windows.Forms.ListBox
$installed.SetBounds(20,426,686,92)
$form.Controls.Add($installed)
$use = Add-Button 'Use selected model' 20 529 204 39
$remove = Add-Button 'Delete selected model' 235 529 204 39
$start = Add-Button 'Start chat' 546 529 160 39
$foot = Add-Label 'Active model: none' 20 576 686 24
$foot.ForeColor=[Drawing.Color]::DimGray

$script:process = $null
$script:pending = $null
$script:total = 0L
$script:expectedHash = $null
$script:isDownloading = $false

function Get-ActiveModel {
    if(Test-Path -LiteralPath $SelectedFile) {
        return ([IO.File]::ReadAllText($SelectedFile).Trim())
    }
    return ''
}
function Refresh-Installed {
    $installed.Items.Clear()
    foreach($f in @(Get-ChildItem -LiteralPath $Models -Filter '*.gguf' -File | Sort-Object Name)) { [void]$installed.Items.Add($f.Name) }
    $active = Get-ActiveModel
    if($active) {
        $foot.Text = 'Active model: ' + [IO.Path]::GetFileName($active)
        for($i=0; $i -lt $installed.Items.Count; $i++) {
            if((Join-Path -Path $Models -ChildPath ([string]$installed.Items[$i])) -eq $active) { $installed.SelectedIndex=$i; break }
        }
    } else { $foot.Text = 'Active model: none' }
}
function Select-Model([string]$path) {
    [IO.File]::WriteAllText($SelectedFile,$path,[Text.Encoding]::UTF8)
    Refresh-Installed
}
function Show-Error([string]$message) {
    [void][Windows.Forms.MessageBox]::Show($message,'Hero Tavern',[Windows.Forms.MessageBoxButtons]::OK,[Windows.Forms.MessageBoxIcon]::Warning)
}
function Get-InfoForModel([string]$repo,[string]$filename) {
    $result = [pscustomobject]@{Size=0L;Hash=$null}
    try {
        $api = 'https://huggingface.co/api/models/' + $repo + '/tree/main?recursive=true'
        $response = Invoke-RestMethod -Uri $api -TimeoutSec 18 -Headers @{'User-Agent'='HeroTavern-ModelManager/1.2'}
        $file = $response | Where-Object { $_.path -eq $filename } | Select-Object -First 1
        if($file) {
            if($file.size) { $result.Size=[long]$file.size }
            if($file.lfs -and $file.lfs.oid -match '^[a-fA-F0-9]{64}$') { $result.Hash=$file.lfs.oid.ToLowerInvariant() }
        }
    } catch { } # Public repository metadata is optional; GGUF magic is always checked.
    return $result
}
function Parse-Selection {
    if(-not [string]::IsNullOrWhiteSpace($custom.Text)) {
        $inputUrl = $custom.Text.Trim()
        $uri = $null
        if(-not [Uri]::TryCreate($inputUrl,[UriKind]::Absolute,[ref]$uri) -or
           $uri.Scheme -ne 'https' -or $uri.Host -ne 'huggingface.co' -or $uri.UserInfo -or
           $uri.Query -or $uri.Fragment) { throw 'Use an HTTPS direct file link on huggingface.co (not an arbitrary website).' }
        $decodedPath = [Uri]::UnescapeDataString($uri.AbsolutePath)
        if($decodedPath -notmatch '^/([a-zA-Z0-9_.-]+)/([a-zA-Z0-9_.-]+)/resolve/main/([a-zA-Z0-9_./-]+\.gguf)$' -or
           $decodedPath.Contains('..')) { throw 'Expected: https://huggingface.co/owner/repo/resolve/main/file.gguf' }
        $repo = $matches[1] + '/' + $matches[2]
        $remoteFile = $matches[3]
        $safePrefix = ($repo -replace '[^a-zA-Z0-9_.-]','_') + '__'
        $localName = $safePrefix + [IO.Path]::GetFileName($remoteFile)
        return [pscustomobject]@{Repo=$repo;File=$remoteFile;LocalName=$localName;Url=$inputUrl;Size=0L;License='User-supplied; check model card';Hash=$null}
    }
    $m = $catalog[$choices.SelectedIndex]
    return [pscustomobject]@{Repo=$m.Repo;File=$m.File;LocalName=$m.File;Url=('https://huggingface.co/'+$m.Repo+'/resolve/main/'+$m.File);Size=[long]$m.Size;License=$m.License;Hash=$m.Hash}
}
function Set-Busy([bool]$busy) {
    $script:isDownloading=$busy
    $download.Enabled= -not $busy
    $defaultDownload.Enabled= -not $busy
    $start.Enabled= -not $busy
    $cancel.Enabled=$busy
    $use.Enabled= -not $busy
    $remove.Enabled= -not $busy
    $custom.Enabled= -not $busy
    $choices.Enabled= -not $busy
}

$choices.Add_SelectedIndexChanged({
    $model=$catalog[$choices.SelectedIndex]
    $licence.Text='License: ' + $model.License + ' | Source: huggingface.co/' + $model.Repo
})
$download.Add_Click({
    try {
        if(-not (Test-Path -LiteralPath $Curl)) { throw 'Windows curl.exe is required (included with Windows 10/11).' }
        $model=Parse-Selection
        $path=Join-Path $Models $model.LocalName
        if(Test-Path -LiteralPath $path) {
            Test-GgufFile $path 0 $model.Hash
            if([Windows.Forms.MessageBox]::Show('This model is already downloaded. Set it as active?','Already installed','YesNo','Question') -eq 'Yes') { Select-Model $path }
            return
        }
        $meta = Get-InfoForModel $model.Repo $model.File
        $size=[long]$model.Size
        if($meta.Size -gt 0) { $size=$meta.Size }
        if($size -gt 0) {
            $drive=[IO.DriveInfo]::new([IO.Path]::GetPathRoot($Models))
            $already = 0L
            if(Test-Path -LiteralPath ($path+'.part')) { $already=(Get-Item -LiteralPath ($path+'.part')).Length }
            if($drive.AvailableFreeSpace -lt ($size-$already+150MB)) { throw 'Not enough free disk space to download this model.' }
        }
        $part = $path + '.part'
        $psi = New-Object Diagnostics.ProcessStartInfo
        $psi.FileName = $Curl
        $psi.Arguments = '--proto =https --proto-redir =https --connect-timeout 30 --fail --location --retry 3 --retry-delay 4 --continue-at - --silent --show-error --output "'+$part+'" "'+$model.Url+'"'
        $psi.UseShellExecute=$false; $psi.CreateNoWindow=$true
        $script:process=[Diagnostics.Process]::Start($psi)
        if(-not $script:process) {throw 'Could not start curl.exe'}
        $script:pending=[pscustomobject]@{Part=$part;Final=$path;Name=$model.LocalName}
        $script:total=$meta.Size
        $script:expectedHash=$meta.Hash
        if ($model.Hash) { $script:expectedHash=$model.Hash }
        $progress.Style='Blocks'
        $progress.Value=0
        $status.Text='Downloading '+$model.LocalName+' ...'
        Set-Busy $true
    } catch { Show-Error $_.Exception.Message; Set-Busy $false }
})
$defaultDownload.Add_Click({
    $custom.Clear()
    $choices.SelectedIndex=0
    $download.PerformClick()
})
$cancel.Add_Click({
    if($script:process -and -not $script:process.HasExited) { try{$script:process.Kill()}catch{} }
    $status.Text='Cancelled. Partial file is kept for resume.'
    $progress.Style='Blocks'
    Set-Busy $false
    if($script:process) {$script:process.Dispose();$script:process=$null}
    $script:pending=$null
})
$timer = New-Object Windows.Forms.Timer
$timer.Interval=450
$timer.Add_Tick({
    if(-not $script:isDownloading -or -not $script:pending) {return}
    $bytes=0L
    if(Test-Path -LiteralPath $script:pending.Part) { $bytes=(Get-Item -LiteralPath $script:pending.Part).Length }
    if($script:total -gt 0) {
        $progress.Value=[math]::Min(99,[int][math]::Floor(100.0*$bytes/$script:total))
        $status.Text=('{0:N2} / ~{1:N2} GB downloaded' -f ($bytes/1GB),($script:total/1GB))
    } else { $progress.Style='Marquee'; $status.Text=('{0:N2} GB downloaded' -f ($bytes/1GB)) }
    if(-not $script:process.HasExited) {return}
    $code=$script:process.ExitCode
    $script:process.Dispose(); $script:process=$null
    Set-Busy $false
    $progress.Style='Blocks'
    if($code -ne 0) { $status.Text='Download stopped (curl exit '+$code+'). Click Download to resume.'; $script:pending=$null;return }
    try {
        if(-not (Test-Path -LiteralPath $script:pending.Part)) {throw 'Download did not create a file.'}
        $path=$script:pending.Part
        $status.Text='Verifying model checksum...'
        $form.Refresh()
        try { Test-GgufFile $path $script:total $script:expectedHash } catch {
            # A completed but corrupt partial file must not be resumed forever.
            Move-Item -LiteralPath $path -Destination ($path+'.corrupt-'+(Get-Date -Format 'yyyyMMddHHmmss'))
            throw
        }
        Move-Item -LiteralPath $path -Destination $script:pending.Final -Force
        Select-Model $script:pending.Final
        $progress.Value=100
        $status.Text='Downloaded and selected: '+$script:pending.Name
    } catch { $status.Text='Download verification failed.'; Show-Error $_.Exception.Message }
    $script:pending=$null
})
$timer.Start()
$use.Add_Click({
    if(-not $installed.SelectedItem) {Show-Error 'Choose an installed model first.'; return}
    $path=Join-Path $Models ([string]$installed.SelectedItem)
    try { Test-GgufFile $path 0 $null; Select-Model $path } catch { Show-Error $_.Exception.Message; return }
    $status.Text='Selected model: '+[IO.Path]::GetFileName($path)
})
$remove.Add_Click({
    if(-not $installed.SelectedItem) {return}
    $path=Join-Path $Models ([string]$installed.SelectedItem)
    if([Windows.Forms.MessageBox]::Show('Permanently delete '+[IO.Path]::GetFileName($path)+'?','Delete model','YesNo','Warning') -ne 'Yes') {return}
    try {
        Remove-Item -LiteralPath $path -Force
        if((Get-ActiveModel) -eq $path) { Remove-Item -LiteralPath $SelectedFile -ErrorAction SilentlyContinue }
        Refresh-Installed
        $status.Text='Model deleted.'
    } catch {Show-Error $_.Exception.Message}
})
$folder.Add_Click({Start-Process explorer.exe -ArgumentList ('"'+$Models+'"')})
$start.Add_Click({
    $chat=Join-Path $Root 'Start-Chat.cmd'
    try {
        Invoke-WebRequest 'http://127.0.0.1:8000/' -UseBasicParsing -TimeoutSec 2 | Out-Null
        Start-Process 'http://127.0.0.1:8000/'
        return
    } catch {}
    if(Test-Path -LiteralPath $chat) {Start-Process -FilePath $chat} else {Show-Error 'Start-Chat.cmd not found. Run the installer first.'}
})
$form.Add_FormClosing({
    if($script:isDownloading) {
        $confirm=[Windows.Forms.MessageBox]::Show('Stop the download? The partial file will be kept for resume.','Exit','YesNo','Question')
        if($confirm -ne 'Yes') { $_.Cancel=$true; return }
        if($script:process -and -not $script:process.HasExited) {try{$script:process.Kill()}catch{}}
    }
})
Refresh-Installed
[void]$form.ShowDialog()
$timer.Stop()
$form.Dispose()
