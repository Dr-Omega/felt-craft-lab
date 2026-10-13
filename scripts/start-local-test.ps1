param([ValidateSet('Check','Gateway','Desktop')][string]$Mode = 'Check')
$ErrorActionPreference = 'Stop'
$localRepo = Split-Path -Parent $PSScriptRoot
$gatewayPython = Join-Path $localRepo 'backend/.venv/Scripts/python.exe'
if (-not (Test-Path -LiteralPath $gatewayPython)) { throw 'Local gateway venv is missing. Follow docs/LOCAL_TEST_SETUP.md (first-time setup).' }
Push-Location -LiteralPath $localRepo
try {
  if ($Mode -eq 'Gateway') {
    & $gatewayPython scripts/local-test-gateway.py --serve
    if ($LASTEXITCODE -ne 0) { throw 'Gateway exited with an error.' }
    return
  }
  $allowed = @('FELT_AI_GATEWAY_BASE_URL','FELT_FABRICATION_PYTHON','FELT_BACKGROUND_PYTHON','FELT_BIREFNET_CACHE')
  $settings = @{}
  if (-not (Test-Path -LiteralPath '.env.local')) { throw 'Missing .env.local. Follow docs/LOCAL_TEST_SETUP.md; never put API keys in desktop settings.' }
  foreach ($line in Get-Content -LiteralPath '.env.local') {
    if ($line -match '^([A-Z_]+)=(.*)$' -and $allowed -contains $Matches[1]) {
      $settingName = $Matches[1]
      $settingValue = $Matches[2].Trim()
      if ($settingValue.Length -ge 2 -and (($settingValue.StartsWith('"') -and $settingValue.EndsWith('"')) -or ($settingValue.StartsWith("'") -and $settingValue.EndsWith("'")))) {
        $settingValue = $settingValue.Substring(1, $settingValue.Length - 2)
      }
      $settings[$settingName] = $settingValue
    }
  }
  foreach ($key in $allowed) {
    if (-not $settings[$key]) { throw "Missing desktop setting: $key" }
  }
  foreach ($key in @('FELT_FABRICATION_PYTHON','FELT_BACKGROUND_PYTHON','FELT_BIREFNET_CACHE')) {
    if (-not (Test-Path -LiteralPath $settings[$key])) { throw "Missing local runtime: $key" }
  }
  if (-not (Test-Path -LiteralPath 'node_modules/electron/dist/electron.exe') -or -not (Test-Path -LiteralPath 'node_modules/.bin/electron-vite.cmd')) {
    throw 'Desktop dependencies are missing. Run npm ci in the project directory (allow Electron download).'
  }
  if ($Mode -eq 'Check') {
    & $gatewayPython scripts/local-test-gateway.py --check
    if ($LASTEXITCODE -ne 0) { throw 'Configuration check failed.' }
    Write-Output 'Desktop runtime paths exist; this is not an inference or cloud acceptance test.'
    return
  }
  $health = Invoke-RestMethod -Uri ($settings['FELT_AI_GATEWAY_BASE_URL'] + '/api/health') -TimeoutSec 5
  if (-not $health.ok -or $health.service -ne 'felt-craft-lab-ai-proxy') { throw 'Expected local gateway is not ready.' }
  # Only public settings are inherited by Electron; backend/.env is never loaded here.
  foreach ($key in $allowed) { [Environment]::SetEnvironmentVariable($key, $settings[$key], 'Process') }
  $env:AI_GATEWAY_BASE_URL = $settings['FELT_AI_GATEWAY_BASE_URL']
  $env:TYPESCRIPT_TSC = Join-Path $localRepo 'node_modules/typescript/lib/tsc.js'
  $env:NODE_PATH = Join-Path $localRepo 'node_modules'
  $env:ELECTRON_RUN_AS_NODE = $null
  foreach ($secretName in @('OPENAI_API_KEY','QWEN_ASR_API_KEY','DASHSCOPE_API_KEY','QWEN_STORY_API_KEY',
    'DEEPSEEK_API_KEY','MINIMAX_API_KEY','ARK_API_KEY','PLAZA_JWT_SECRET','AI_SESSION_HMAC_SECRET')) {
    [Environment]::SetEnvironmentVariable($secretName, $null, 'Process')
  }
  # Do not inherit acceptance unlock switches into a real local user session.
  $env:VITE_ACCEPTANCE_UNLOCK_ALL_ASSETS = $null
  $env:VITE_ACCEPTANCE_ALL_THEMES_IN_EDITOR = $null
  & npm.cmd run dev
  if ($LASTEXITCODE -ne 0) { throw 'Desktop exited with an error.' }
} finally { Pop-Location }
