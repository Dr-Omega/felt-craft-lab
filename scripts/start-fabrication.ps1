param(
  [Parameter(Mandatory=$true)][string]$AlgorithmPython,
  [Parameter(Mandatory=$true)][string]$BackgroundPython,
  [Parameter(Mandatory=$true)][string]$ModelCache
)
$ErrorActionPreference = 'Stop'
foreach ($runtimePath in @($AlgorithmPython, $BackgroundPython, $ModelCache)) {
  if (-not (Test-Path -LiteralPath $runtimePath)) { throw "Runtime path does not exist: $runtimePath" }
}
$env:FELT_FABRICATION_PYTHON = (Resolve-Path -LiteralPath $AlgorithmPython).Path
$env:FELT_BACKGROUND_PYTHON = (Resolve-Path -LiteralPath $BackgroundPython).Path
$env:FELT_BIREFNET_CACHE = (Resolve-Path -LiteralPath $ModelCache).Path
$integrationRoot = Split-Path -Parent $PSScriptRoot
$env:TYPESCRIPT_TSC = Join-Path $integrationRoot 'node_modules/typescript/lib/tsc.js'
$env:NODE_PATH = Join-Path $integrationRoot 'node_modules'
$env:ELECTRON_RUN_AS_NODE = $null
Push-Location -LiteralPath $integrationRoot
try { npm run dev } finally { Pop-Location }
