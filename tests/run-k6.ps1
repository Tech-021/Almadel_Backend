param(
  [ValidateSet("get", "post", "patch", "delete")]
  [string]$Suite = "get"
)

$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $projectRoot ".env"
$k6Script = Join-Path $PSScriptRoot "k6-$($Suite.ToLowerInvariant()).js"

if (-not (Test-Path -LiteralPath $envFile)) {
  throw "Missing .env file at $envFile"
}

$envText = Get-Content -LiteralPath $envFile
$emailMatch = $envText | Where-Object { $_ -match '^\s*ADMIN_EMAIL\s*=' } | Select-Object -Last 1
$passwordMatch = $envText | Where-Object { $_ -match '^\s*ADMIN_PASSWORD\s*=' } | Select-Object -Last 1

if (-not $emailMatch -or -not $passwordMatch) {
  throw "Set ADMIN_EMAIL and ADMIN_PASSWORD in .env before running this test."
}

$email = ($emailMatch -replace '^\s*ADMIN_EMAIL\s*=\s*', '').Trim().Trim('"').Trim("'")
$password = ($passwordMatch -replace '^\s*ADMIN_PASSWORD\s*=\s*', '').Trim().Trim('"').Trim("'")

if (-not $email -or -not $password) {
  throw "ADMIN_EMAIL and ADMIN_PASSWORD in .env must not be empty."
}

$previousEmail = $env:API_TEST_EMAIL
$previousPassword = $env:API_TEST_PASSWORD
$apiTestEnv = @{}
$previousApiTestEnv = @{}
$k6ExitCode = 0
$postSuiteFailed = $false

foreach ($line in $envText) {
  if ($line -match '^\s*(API_TEST_[A-Z0-9_]+)\s*=\s*(.*?)\s*$') {
    $apiKey = $Matches[1]
    $apiValue = $Matches[2].Trim().Trim('"').Trim("'")
    $apiTestEnv[$apiKey] = $apiValue
  }
}

try {
  $env:API_TEST_EMAIL = $email
  $env:API_TEST_PASSWORD = $password
  foreach ($apiKey in $apiTestEnv.Keys) {
    $previousApiTestEnv[$apiKey] = [Environment]::GetEnvironmentVariable($apiKey, "Process")
    if (-not [Environment]::GetEnvironmentVariable($apiKey, "Process")) {
      Set-Item -Path "Env:$apiKey" -Value $apiTestEnv[$apiKey]
    }
  }
  Push-Location $projectRoot

  $postSelection = $env:API_TEST_POST_ENDPOINTS
  if ($Suite -eq "post" -and $postSelection) {
    if ($postSelection.Trim().ToLowerInvariant() -eq "all") {
      $postEndpointIds = @(
        "auth-sign-in",
        "auth-staff-sign-up",
        "auth-sign-up-alias",
        "auth-owner-sign-up-alias",
        "auth-forgot-password",
        "products-create",
        "products-upload-image",
        "products-import",
        "stock-receive-one",
        "stock-add",
        "sales-checkout",
        "customers-create",
        "admin-staff-create",
        "business-setup",
        "logs-create",
        "admin-logs-create",
        "auth-reset-password"
      )
    } else {
      $postEndpointIds = @($postSelection.Split(",") | ForEach-Object { $_.Trim() } | Where-Object { $_ })
    }

    foreach ($endpointId in $postEndpointIds) {
      if (($endpointId -in @("stock-receive-one", "stock-add", "sales-checkout")) -and -not $env:API_TEST_PRODUCT_BARCODE) {
        Write-Warning "Skipping ${endpointId}: set API_TEST_PRODUCT_BARCODE to a product with suitable stock."
        continue
      }
      if ($endpointId -eq "auth-reset-password" -and -not $env:API_TEST_RESET_TOKEN) {
        Write-Warning "Skipping auth-reset-password: set API_TEST_RESET_TOKEN to a valid, unused token."
        continue
      }

      Write-Host "`nRunning POST endpoint scenario: $endpointId"
      $env:API_TEST_POST_ENDPOINTS = $endpointId
      & k6 run $k6Script
      $k6ExitCode = $LASTEXITCODE
      if ($k6ExitCode -ne 0) {
        $postSuiteFailed = $true
        $healthBaseUrl = if ($env:API_BASE_URL) { $env:API_BASE_URL.TrimEnd('/') } else { "http://localhost:4000" }
        try {
          $healthResponse = Invoke-WebRequest -Uri "$healthBaseUrl/health" -TimeoutSec 5 -UseBasicParsing
          if ($healthResponse.StatusCode -ne 200) {
            throw "Health endpoint returned HTTP $($healthResponse.StatusCode)."
          }
          Write-Warning "$endpointId failed a k6 threshold, but the API is healthy; continuing after a short pause."
          Start-Sleep -Seconds 2
        } catch {
          Write-Warning "Stopping the sequential POST suite after $endpointId failed; health check failed: $($_.Exception.Message)"
          break
        }
      }
    }
  } else {
    & k6 run $k6Script
    $k6ExitCode = $LASTEXITCODE
  }
}
finally {
  if ((Get-Location).Path -eq $projectRoot) {
    Pop-Location
  }
  $env:API_TEST_EMAIL = $previousEmail
  $env:API_TEST_PASSWORD = $previousPassword
  foreach ($apiKey in $apiTestEnv.Keys) {
    if ($null -eq $previousApiTestEnv[$apiKey]) {
      Remove-Item -Path "Env:$apiKey" -ErrorAction SilentlyContinue
    } else {
      Set-Item -Path "Env:$apiKey" -Value $previousApiTestEnv[$apiKey]
    }
  }
}

if ($postSuiteFailed) {
  $k6ExitCode = 1
}

exit $k6ExitCode
