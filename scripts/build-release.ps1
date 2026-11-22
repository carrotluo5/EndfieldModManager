[CmdletBinding()]
param(
    [string]$OutputDirectory = 'D:\MOD\EndfieldModManager',
    [string]$Repo = 'carrotluo5/EndfieldModManager',
    [string]$Notes = '',
    [string]$NotesFile = '',
    [switch]$PortableOnly,
    [switch]$PublishOnly
)

$buildScript = Join-Path $PSScriptRoot 'build-release.mjs'
$buildArgs = @('--output-directory', $OutputDirectory, '--repo', $Repo)
if ($Notes) { $buildArgs += @('--notes', $Notes) }
if ($NotesFile) { $buildArgs += @('--notes-file', $NotesFile) }
if ($PortableOnly) { $buildArgs += '--portable-only' }
if ($PublishOnly) { $buildArgs += '--publish-only' }
& node.exe $buildScript @buildArgs
exit $LASTEXITCODE
