# Supply Chain Security Verification Script (PowerShell)
# Usage: .\scripts\verify-supply-chain.ps1

$ErrorActionPreference = "Continue"

# Counters
$script:Passed = 0
$script:Failed = 0
$script:Warnings = 0

# Logging functions
function Write-Info {
    param([string]$Message)
    Write-Host "[INFO] $Message" -ForegroundColor Blue
}

function Write-Success {
    param([string]$Message)
    Write-Host "[PASS] $Message" -ForegroundColor Green
    $script:Passed++
}

function Write-Failure {
    param([string]$Message)
    Write-Host "[FAIL] $Message" -ForegroundColor Red
    $script:Failed++
}

function Write-CustomWarning {
    param([string]$Message)
    Write-Host "[WARN] $Message" -ForegroundColor Yellow
    $script:Warnings++
}

# Print header
Write-Host "============================================================================"
Write-Host "Supply Chain Security Verification"
Write-Host "============================================================================"
Write-Host ""

# 1. Check Configuration Files Exist
Write-Info "Checking configuration files..."

if (Test-Path ".npmrc") {
    Write-Success ".npmrc configuration file exists"
} else {
    Write-Failure ".npmrc configuration file not found"
}

if (Test-Path ".pnpmrc") {
    Write-Success ".pnpmrc configuration file exists"
} else {
    Write-CustomWarning ".pnpmrc configuration file not found (optional if using npm)"
}

if (Test-Path "INSTALL_SCRIPT_ALLOWLIST.md") {
    Write-Success "Install script allowlist documentation exists"
} else {
    Write-Failure "INSTALL_SCRIPT_ALLOWLIST.md not found"
}

# 2. Verify Registry Configuration
Write-Info "Verifying registry configuration for internal packages..."

if (Test-Path ".npmrc") {
    $npmrcContent = Get-Content ".npmrc" -Raw
    
    if ($npmrcContent -match '@chen-pilot:registry=(.+)') {
        $internalRegistry = $matches[1].Trim()
        if ($internalRegistry -like "https://registry.npmjs.org/*") {
            Write-Failure "Internal packages @chen-pilot are configured to use public npm registry (DEPENDENCY CONFUSION RISK)"
        } else {
            Write-Success "Internal packages @chen-pilot have dedicated registry: $internalRegistry"
        }
    } else {
        Write-Failure "@chen-pilot scope registry not configured in .npmrc"
    }
}

# 3. Verify Lockfile Exists and is Valid
Write-Info "Checking lockfile integrity..."

$lockfileFound = $false

if (Test-Path "package-lock.json") {
    $lockfileFound = $true
    Write-Success "package-lock.json found"
    
    $lockfileSize = (Get-Item "package-lock.json").Length
    if ($lockfileSize -gt 0) {
        Write-Success "package-lock.json is not empty"
    } else {
        Write-Failure "package-lock.json is empty"
    }
}

if (Test-Path "pnpm-lock.yaml") {
    $lockfileFound = $true
    Write-Success "pnpm-lock.yaml found"
    
    $lockfileSize = (Get-Item "pnpm-lock.yaml").Length
    if ($lockfileSize -gt 0) {
        Write-Success "pnpm-lock.yaml is not empty"
    } else {
        Write-Failure "pnpm-lock.yaml is empty"
    }
}

if (-not $lockfileFound) {
    Write-Failure "No lockfile found (package-lock.json or pnpm-lock.yaml required)"
}

# 4. Verify Scripts are Disabled by Default
Write-Info "Verifying install script protection..."

if (Test-Path ".npmrc") {
    $npmrcContent = Get-Content ".npmrc" -Raw
    if ($npmrcContent -match 'ignore-scripts\s*=\s*true') {
        Write-Success "NPM install scripts are disabled by default"
    } else {
        Write-Failure "NPM install scripts are NOT disabled (add ignore-scripts=true to .npmrc)"
    }
}

if (Test-Path ".pnpmrc") {
    $pnpmrcContent = Get-Content ".pnpmrc" -Raw
    if ($pnpmrcContent -match 'ignore-scripts\s*=\s*true') {
        Write-Success "PNPM install scripts are disabled by default"
    } else {
        Write-Failure "PNPM install scripts are NOT disabled (add ignore-scripts=true to .pnpmrc)"
    }
}

# 5. Check Network Security Configuration
Write-Info "Checking network security configuration..."

if (Test-Path ".npmrc") {
    $npmrcContent = Get-Content ".npmrc" -Raw
    
    if ($npmrcContent -match 'strict-ssl\s*=\s*true') {
        Write-Success "Strict SSL is enabled"
    } else {
        Write-Failure "Strict SSL is NOT enabled (add strict-ssl=true to .npmrc)"
    }
    
    if ($npmrcContent -match 'git-protocol\s*=\s*https') {
        Write-Success "Git protocol is set to HTTPS"
    } else {
        Write-CustomWarning "Git protocol not explicitly set to HTTPS"
    }
}

# 6. Verify Audit Configuration
Write-Info "Verifying audit configuration..."

if (Test-Path ".npmrc") {
    $npmrcContent = Get-Content ".npmrc" -Raw
    
    if ($npmrcContent -match 'audit-level\s*=\s*(\w+)') {
        $auditLevel = $matches[1]
        $validLevels = @('low', 'moderate', 'high', 'critical')
        
        if ($validLevels -contains $auditLevel) {
            Write-Success "Audit level set to: $auditLevel"
        } else {
            Write-CustomWarning "Unknown audit level: $auditLevel"
        }
    } else {
        Write-CustomWarning "Audit level not configured (vulnerabilities may not fail the build)"
    }
}

# 7. Check Package.json for Suspicious Scripts
Write-Info "Checking package.json for suspicious scripts..."

$suspiciousPatterns = @(
    'curl\s',
    'wget\s',
    'eval\(',
    'bash\s-c',
    'sh\s-c',
    'rm\s-rf\s/',
    'base64\s--decode'
)

$suspiciousFound = $false

if (Test-Path "package.json") {
    $packageContent = Get-Content "package.json" -Raw
    
    foreach ($pattern in $suspiciousPatterns) {
        if ($packageContent -match $pattern) {
            Write-CustomWarning "Suspicious pattern found in package.json: '$pattern'"
            $suspiciousFound = $true
        }
    }
}

if (-not $suspiciousFound) {
    Write-Success "No suspicious patterns found in package.json scripts"
}

# 8. Verify Workspace Configuration
Write-Info "Verifying workspace security..."

if (Test-Path "pnpm-workspace.yaml") {
    Write-Success "pnpm-workspace.yaml found"
}

# Summary
Write-Host ""
Write-Host "============================================================================"
Write-Host "Summary"
Write-Host "============================================================================"
Write-Host "Passed:   $script:Passed" -ForegroundColor Green
Write-Host "Warnings: $script:Warnings" -ForegroundColor Yellow
Write-Host "Failed:   $script:Failed" -ForegroundColor Red
Write-Host ""

if ($script:Failed -eq 0) {
    if ($script:Warnings -eq 0) {
        Write-Host "[OK] All supply chain security checks passed!" -ForegroundColor Green
        exit 0
    } else {
        Write-Host "[WARN] Supply chain verification completed with warnings" -ForegroundColor Yellow
        exit 0
    }
} else {
    Write-Host "[FAIL] Supply chain security verification FAILED" -ForegroundColor Red
    Write-Host ""
    Write-Host "Please fix the errors above before proceeding."
    Write-Host "See INSTALL_SCRIPT_ALLOWLIST.md for guidance."
    exit 1
}
