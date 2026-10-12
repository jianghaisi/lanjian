[CmdletBinding()]
param([ValidatePattern('^[a-z0-9][a-z0-9._-]{1,79}$')][string]$Version = ('v0.1.0-' + (Get-Date -Format 'yyyyMMdd-HHmmss')))
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
Set-Location -LiteralPath $repo
$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
    $dockerPath = Join-Path $env:ProgramFiles 'Docker\Docker\resources\bin\docker.exe'
    if (-not (Test-Path -LiteralPath $dockerPath)) { throw 'Install Docker Desktop and enable Linux containers first.' }
} else { $dockerPath = $docker.Source }
function Checked([string]$Program, [string[]]$Arguments) {
    & $Program @Arguments
    if ($LASTEXITCODE -ne 0) { throw "Command failed: $Program. Existing data has not been changed." }
}
Checked $dockerPath @('info','--format','{{.OSType}}')
$nodeVersion = & node -p 'process.versions.node'
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^24\.') { throw 'Node.js 24 is required on the build computer.' }
foreach ($package in @('packages/hosted-contracts','services/hosted-app','web')) {
    if (-not (Test-Path -LiteralPath (Join-Path $repo "$package/node_modules"))) { Checked 'npm.cmd' @('--prefix',$package,'ci','--legacy-peer-deps','--no-audit','--no-fund') }
    Checked 'npm.cmd' @('--prefix',$package,'run','build')
}
$context = Join-Path $repo "deploy/hosted/build/$Version"
$output = Join-Path $repo "deploy/hosted/output/$Version"
if ((Test-Path -LiteralPath $context) -or (Test-Path -LiteralPath $output)) { throw 'Version output already exists. Use a new -Version; existing files will not be replaced.' }
Checked 'python' @('-X','utf8','scripts/hosted-package.py',$repo,$context,$output)
$image = "lanjian-hosted:$Version"
$proxy = "lanjian-proxy:$Version"
Checked $dockerPath @('build','--platform','linux/amd64','--tag',$image,$context)
Checked $dockerPath @('pull','--platform','linux/amd64','registry-1.docker.io/library/caddy:2-alpine')
Checked $dockerPath @('tag','registry-1.docker.io/library/caddy:2-alpine',$proxy)
Checked $dockerPath @('save','--output',(Join-Path $output 'image.tar'),$image,$proxy)
$imageId = & $dockerPath image inspect --format '{{.Id}}' $image
if ($LASTEXITCODE -ne 0) { throw 'Cannot read built image ID.' }
$proxyId = & $dockerPath image inspect --format '{{.Id}}' $proxy
if ($LASTEXITCODE -ne 0) { throw 'Cannot read proxy image ID.' }
$files = [ordered]@{}
foreach ($file in (Get-ChildItem -LiteralPath $output -File | Sort-Object Name)) { $files[$file.Name] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
$schemaSource = [IO.File]::ReadAllText((Join-Path $repo 'desktop/src/main/core/ports/workspace-database.ts'))
$schemaMatch = [regex]::Match($schemaSource, 'WORKSPACE_DATABASE_SCHEMA_VERSION = (\d+)')
if (-not $schemaMatch.Success) { throw 'Cannot read the book database schema.' }
$manifest = [ordered]@{version=$Version;platform='linux/amd64';schema=3;authSchema=1;minSchema=0;bookSchema=[int]$schemaMatch.Groups[1].Value;image=$image;imageId=$imageId.Trim();proxyImage=$proxy;proxyImageId=$proxyId.Trim();createdAt=[DateTime]::UtcNow.ToString('o');files=$files}
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText((Join-Path $output 'manifest.json'), ($manifest | ConvertTo-Json -Depth 5) + "`n", $utf8)
$sums = @(Get-ChildItem -LiteralPath $output -File | Sort-Object Name | ForEach-Object { (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + $_.Name })
[IO.File]::WriteAllText((Join-Path $output 'SHA256SUMS'), ($sums -join "`n") + "`n", $utf8)
$archive = $output + '.tar.gz'
Checked 'tar.exe' @('-czf',$archive,'-C',(Split-Path -Parent $output),$Version)
[IO.File]::WriteAllText(($archive + '.sha256'), (Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash.ToLowerInvariant() + '  ' + [IO.Path]::GetFileName($archive) + "`n", $utf8)
Write-Host "`nPackage ready: $archive`nUpload the archive and .sha256 to your Linux amd64 server. See README.md."
