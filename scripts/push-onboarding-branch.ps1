# Push feature/onboarding-guided-tour-v1 to GitHub (run when github.com:443 is reachable).
$ErrorActionPreference = "Stop"
$Root = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$RepoRoot = if (Test-Path "$Root\felt-craft-lab\.git") { "$Root\felt-craft-lab" } else { Split-Path $PSScriptRoot -Parent }
$Source = Split-Path $PSScriptRoot -Parent

if (-not (Test-Path "$RepoRoot\.git")) {
  Write-Host "Cloning integration/creation-flow-v1..."
  git clone --depth 1 --branch integration/creation-flow-v1 --single-branch `
    "https://github.com/Dr-Omega/felt-craft-lab.git" "$Root\felt-craft-lab"
  $RepoRoot = "$Root\felt-craft-lab"
}

$files = @(
  "backend/services/plaza_db.py",
  "backend/services/plaza_auth.py",
  "backend/services/plaza_routes.py",
  "backend/tests/test_plaza_routes_integration.py",
  "src/shared/contracts/plaza.ts",
  "src/shared/constants/app.ts",
  "src/main/plaza/gateway-plaza.ts",
  "src/main/plaza/ipc.ts",
  "src/preload/index.ts",
  "src/renderer/src/services/onboarding-steps.ts",
  "src/renderer/src/services/onboarding-service.ts",
  "src/renderer/src/services/plaza-api.ts",
  "src/renderer/src/services/plaza-session.ts",
  "src/renderer/src/components/onboarding/OnboardingOverlay.vue",
  "src/renderer/src/assets/onboarding/guide-mascot.png",
  "src/renderer/src/App.vue",
  "src/renderer/src/pages/LoginPage.vue",
  "src/renderer/src/pages/LobbyPage.vue",
  "src/renderer/src/pages/LibraryPage.vue",
  "src/renderer/src/pages/EditorPage.vue",
  "src/renderer/src/pages/PlazaPage.vue",
  "src/renderer/src/pages/LearningZonePage.vue",
  "src/renderer/src/pages/RewardCenterPage.vue",
  "src/renderer/src/pages/PersonalCenterPage.vue"
)

foreach ($rel in $files) {
  $src = Join-Path $Source $rel
  $dst = Join-Path $RepoRoot $rel
  if (-not (Test-Path $src)) { throw "Missing source file: $src" }
  New-Item -ItemType Directory -Force -Path (Split-Path $dst -Parent) | Out-Null
  Copy-Item -Force $src $dst
}

Set-Location $RepoRoot
git checkout -B feature/onboarding-guided-tour-v1
git add @files
git status
if (-not (git diff --cached --quiet)) {
  git commit -m @"
Add first-login guided tour with spotlight overlay and plaza onboarding persistence.

Account-level onboardingCompletedVersion, 13-step kid-friendly tour, mascot asset, and replay from personal center.
"@
}
git push -u origin feature/onboarding-guided-tour-v1
Write-Host "Done: https://github.com/Dr-Omega/felt-craft-lab/tree/feature/onboarding-guided-tour-v1"
