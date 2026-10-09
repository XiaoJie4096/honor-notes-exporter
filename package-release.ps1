$ErrorActionPreference = "Stop"
$releaseRoot = Join-Path $PSScriptRoot "release"
$releaseDir = Join-Path $releaseRoot "honor-notes-exporter"
$manifestPath = Join-Path $PSScriptRoot "manifest.json"
$version = ([System.IO.File]::ReadAllText($manifestPath, [System.Text.Encoding]::UTF8) | ConvertFrom-Json).version
$zipPath = Join-Path $releaseRoot "honor-notes-exporter-$version.zip"

if (Test-Path -LiteralPath $releaseDir) { Remove-Item -LiteralPath $releaseDir -Recurse -Force }
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

Copy-Item -LiteralPath (Join-Path $PSScriptRoot "manifest.json"), (Join-Path $PSScriptRoot "popup.html"), (Join-Path $PSScriptRoot "popup.css"), (Join-Path $PSScriptRoot "popup.js"), (Join-Path $PSScriptRoot "background.js"), (Join-Path $PSScriptRoot "README.txt"), (Join-Path $PSScriptRoot "LICENSE") -Destination $releaseDir -Force
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "icons") -Destination $releaseDir -Recurse -Force
$distDir = Join-Path $releaseDir "dist"
New-Item -ItemType Directory -Force -Path $distDir | Out-Null
Copy-Item -LiteralPath (Join-Path $PSScriptRoot "dist\content.js") -Destination (Join-Path $distDir "content.js") -Force

if (Test-Path -LiteralPath $zipPath) { Remove-Item -LiteralPath $zipPath -Force }

# Build the ZIP by hand: Compress-Archive writes Windows backslash entry names, which extract as
# literal "folder\file" names on macOS and Linux. The ZIP spec requires forward slashes.
Add-Type -AssemblyName System.IO.Compression.FileSystem
Add-Type -AssemblyName System.IO.Compression
$rootFull = [System.IO.Path]::GetFullPath($releaseRoot)
$archive = [System.IO.Compression.ZipFile]::Open($zipPath, [System.IO.Compression.ZipArchiveMode]::Create)
try {
  $files = Get-ChildItem -LiteralPath $releaseDir -Recurse -File | Sort-Object FullName
  foreach ($file in $files) {
    $full = [System.IO.Path]::GetFullPath($file.FullName)
    $relative = $full.Substring($rootFull.Length).TrimStart('\', '/').Replace('\', '/')
    $entry = $archive.CreateEntry($relative, [System.IO.Compression.CompressionLevel]::Optimal)
    $entry.LastWriteTime = $file.LastWriteTime
    $stream = $entry.Open()
    try {
      $bytes = [System.IO.File]::ReadAllBytes($full)
      $stream.Write($bytes, 0, $bytes.Length)
    } finally { $stream.Dispose() }
  }
} finally { $archive.Dispose() }

# Load unpacked needs manifest.json inside the extracted folder, so keep exactly one top-level dir.
$archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
try {
  $names = $archive.Entries | ForEach-Object { $_.FullName }
  if ($names -notcontains "honor-notes-exporter/manifest.json") { throw "manifest.json is not inside honor-notes-exporter/ in the ZIP" }
  if ($names | Where-Object { $_ -notlike "honor-notes-exporter/*" }) { throw "ZIP has entries outside the top-level folder" }
  Write-Host "ZIP layout OK; $($names.Count) entries"
} finally { $archive.Dispose() }

Get-Item -LiteralPath $zipPath | Select-Object FullName, Length
