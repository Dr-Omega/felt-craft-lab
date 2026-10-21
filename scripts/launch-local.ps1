param([switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
$localRepo = Split-Path -Parent $PSScriptRoot
$starter = Join-Path $PSScriptRoot 'start-local-test.ps1'
$gatewayPython = Join-Path $localRepo 'backend/.venv/Scripts/python.exe'
$gatewayScript = Join-Path $PSScriptRoot 'local-test-gateway.py'
$demoProfile = $env:VITE_PROVIDED_PSD_DEMO -eq '1'
$env:FELT_LOCAL_DEMO_PROFILE = if ($demoProfile) { '1' } else { '0' }
$gatewayPort = if ($demoProfile) { 8789 } else { 8788 }
$gatewayUrl = "http://127.0.0.1:$gatewayPort"
$qaSourceRevision = (Get-FileHash -LiteralPath (Join-Path $localRepo 'backend/providers/qa/deepseek_provider.py') -Algorithm SHA256).Hash.ToLowerInvariant()
$storySourceRevision = (Get-FileHash -LiteralPath (Join-Path $localRepo 'backend/services/story_rewrite_service.py') -Algorithm SHA256).Hash.ToLowerInvariant()
$plazaSourceHashes = @('plaza_routes.py','plaza_db.py','plaza_posts.py','reward_system.py') | ForEach-Object { (Get-FileHash -LiteralPath (Join-Path $localRepo "backend/services/$_") -Algorithm SHA256).Hash.ToLowerInvariant() }
$plazaHasher = [System.Security.Cryptography.SHA256]::Create()
try { $plazaSourceRevision = [BitConverter]::ToString($plazaHasher.ComputeHash([Text.Encoding]::UTF8.GetBytes(($plazaSourceHashes -join ':')))).Replace('-', '').ToLowerInvariant() }
finally { $plazaHasher.Dispose() }
$ownsMutex = $false
$mutex = $null

function Get-LocalGatewayState {
  try {
    $health = Invoke-RestMethod -Uri "$gatewayUrl/api/health" -TimeoutSec 3
    if ($health.ok -and $health.service -eq 'felt-craft-lab-ai-proxy') {
      if ([bool]$health.localDemoProfile -ne $demoProfile) { return 'occupied' }
      if ($health.qaPersonaRevision -ne $qaSourceRevision -or $health.storyRewriteRevision -ne $storySourceRevision) { return 'stale' }
      if ($health.plazaUiRevision -ne $plazaSourceRevision) { return 'stale' }
      return 'ready'
    }
    return 'occupied'
  } catch {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $connection = $client.ConnectAsync('127.0.0.1', $gatewayPort)
      if ($connection.Wait(1000) -and $client.Connected) { return 'occupied' }
    } catch { }
    finally { $client.Dispose() }
    return 'stopped'
  }
}

try {
  # Keep repeat double-clicks from starting another development server.
  $hash = [System.Security.Cryptography.SHA256]::Create()
  try { $identity = [BitConverter]::ToString($hash.ComputeHash([Text.Encoding]::UTF8.GetBytes($localRepo.ToLowerInvariant() + ':' + $gatewayPort))).Replace('-', '') }
  finally { $hash.Dispose() }
  $mutex = New-Object System.Threading.Mutex($false, "Local\FeltCraftLauncher-$identity")
  try { $ownsMutex = $mutex.WaitOne(0) }
  catch [System.Threading.AbandonedMutexException] { $ownsMutex = $true }
  if (-not $ownsMutex -and -not $CheckOnly) {
    Write-Host 'Felt Craft Lab is already starting/running from this launcher.'
    if (-not $CheckOnly) {
      Add-Type -AssemblyName System.Windows.Forms
      [void][System.Windows.Forms.MessageBox]::Show('The launcher is already running. Please use the existing app or launcher window.', 'Felt Craft Lab')
    }
    exit 0
  }

  Write-Host '[1/3] Checking local configuration (no paid API requests)...'
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { throw 'Node.js / npm is missing from PATH.' }
  & $starter -Mode Check
  # This launcher is deliberately local-only. Do not silently connect to a server.
  $setting = Get-Content -LiteralPath (Join-Path $localRepo '.env.local') | Where-Object { $_ -match '^FELT_AI_GATEWAY_BASE_URL=' } | Select-Object -Last 1
  if (-not $setting -or $setting.Split('=', 2)[1].Trim().Trim([char]34).Trim([char]39).TrimEnd('/') -ne 'http://127.0.0.1:8788') {
    throw 'Expected FELT_AI_GATEWAY_BASE_URL=http://127.0.0.1:8788 in .env.local.'
  }
  $state = Get-LocalGatewayState
  if ($state -eq 'stale') {
    throw 'The running local gateway has older QA/story/share code. Restart that gateway, then launch again. No process was stopped automatically.'
  }
  if ($CheckOnly) {
    Write-Host "Launcher check complete. Gateway: $state. No application or server was started."
    exit 0
  }
  Write-Host '[2/3] Preparing the local gateway...'
  if ($state -eq 'occupied') { throw "Port $gatewayPort is occupied, but the expected gateway is not healthy. No process was stopped." }
  if ($state -eq 'stopped') {
    $logDirectory = Join-Path $localRepo 'tmp/launcher-logs'
    [void](New-Item -ItemType Directory -Path $logDirectory -Force)
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss-fff'
    $outputLog = Join-Path $logDirectory "gateway-$stamp.log"
    $errorLog = Join-Path $logDirectory "gateway-$stamp-error.log"
    $gatewayProcess = Start-Process -FilePath $gatewayPython -ArgumentList @('-u', ('"' + $gatewayScript + '"'), '--serve') -WorkingDirectory $localRepo -WindowStyle Hidden -RedirectStandardOutput $outputLog -RedirectStandardError $errorLog -PassThru
    $deadline = [DateTime]::UtcNow.AddSeconds(30)
    do {
      if ((Get-LocalGatewayState) -eq 'ready') { break }
      if ($gatewayProcess.HasExited) { throw "Gateway exited. See local log: $errorLog" }
      Start-Sleep -Milliseconds 500
    } while ([DateTime]::UtcNow -lt $deadline)
    if ((Get-LocalGatewayState) -ne 'ready') { throw "Gateway did not become ready within 30 seconds. See local log: $errorLog" }
    Write-Host 'Gateway started in the background. It stays running for reuse until stopped or Windows restarts.'
  } else { Write-Host 'Reusing the running gateway; loaded QA/story source revisions match this version. Configuration was not reloaded.' }

  Write-Host '[3/3] Opening Felt Craft Lab...'
  Write-Host 'Keep this launcher window open while testing. Save your work before using Ctrl+C to stop the desktop development server.'
  & $starter -Mode Desktop
} catch {
  Write-Host ("Startup failed: " + $_.Exception.Message) -ForegroundColor Red
  exit 1
} finally {
  if ($ownsMutex) { $mutex.ReleaseMutex() }
  if ($mutex) { $mutex.Dispose() }
}
