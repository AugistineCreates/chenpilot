#!/bin/bash

# ============================================================================
# Supply Chain Security Verification Script
# ============================================================================
# This script verifies that dependency installation is secure and compliant
# with supply chain security policies.
#
# Usage: ./scripts/verify-supply-chain.sh
# Exit Codes:
#   0 - All checks passed
#   1 - Configuration error
#   2 - Lockfile verification failed
#   3 - Unauthorized script execution detected
#   4 - Registry configuration error
#   5 - Integrity check failed
# ============================================================================

set -euo pipefail

# Color codes for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Counters
PASSED=0
FAILED=0
WARNINGS=0

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[PASS]${NC} $1"
    ((PASSED++))
}

log_error() {
    echo -e "${RED}[FAIL]${NC} $1"
    ((FAILED++))
}

log_warning() {
    echo -e "${YELLOW}[WARN]${NC} $1"
    ((WARNINGS++))
}

# Print header
echo "============================================================================"
echo "Supply Chain Security Verification"
echo "============================================================================"
echo ""

# ============================================================================
# 1. Check Configuration Files Exist
# ============================================================================
log_info "Checking configuration files..."

if [ -f ".npmrc" ]; then
    log_success ".npmrc configuration file exists"
else
    log_error ".npmrc configuration file not found"
fi

if [ -f ".pnpmrc" ]; then
    log_success ".pnpmrc configuration file exists"
else
    log_warning ".pnpmrc configuration file not found (optional if using npm)"
fi

if [ -f "INSTALL_SCRIPT_ALLOWLIST.md" ]; then
    log_success "Install script allowlist documentation exists"
else
    log_error "INSTALL_SCRIPT_ALLOWLIST.md not found"
fi

# ============================================================================
# 2. Verify Registry Configuration
# ============================================================================
log_info "Verifying registry configuration for internal packages..."

# Check if internal package scope is configured
if grep -q "@chen-pilot:registry" .npmrc 2>/dev/null; then
    INTERNAL_REGISTRY=$(grep "@chen-pilot:registry" .npmrc | cut -d'=' -f2)
    if [[ "$INTERNAL_REGISTRY" == "https://registry.npmjs.org/"* ]]; then
        log_error "Internal packages @chen-pilot are configured to use public npm registry (DEPENDENCY CONFUSION RISK)"
    else
        log_success "Internal packages @chen-pilot have dedicated registry: $INTERNAL_REGISTRY"
    fi
else
    log_error "@chen-pilot scope registry not configured in .npmrc"
fi

# ============================================================================
# 3. Verify Lockfile Exists and is Valid
# ============================================================================
log_info "Checking lockfile integrity..."

LOCKFILE_FOUND=false

if [ -f "package-lock.json" ]; then
    LOCKFILE_FOUND=true
    log_success "package-lock.json found"
    
    # Verify lockfile is not empty
    if [ -s "package-lock.json" ]; then
        log_success "package-lock.json is not empty"
    else
        log_error "package-lock.json is empty"
    fi
    
    # Check if lockfile version is recent
    LOCKFILE_VERSION=$(jq -r '.lockfileVersion' package-lock.json 2>/dev/null || echo "unknown")
    if [ "$LOCKFILE_VERSION" = "unknown" ]; then
        log_warning "Could not determine lockfile version"
    elif [ "$LOCKFILE_VERSION" -ge 2 ]; then
        log_success "Using lockfile version $LOCKFILE_VERSION (modern format)"
    else
        log_warning "Using lockfile version $LOCKFILE_VERSION (consider upgrading)"
    fi
fi

if [ -f "pnpm-lock.yaml" ]; then
    LOCKFILE_FOUND=true
    log_success "pnpm-lock.yaml found"
    
    # Verify lockfile is not empty
    if [ -s "pnpm-lock.yaml" ]; then
        log_success "pnpm-lock.yaml is not empty"
    else
        log_error "pnpm-lock.yaml is empty"
    fi
fi

if [ "$LOCKFILE_FOUND" = false ]; then
    log_error "No lockfile found (package-lock.json or pnpm-lock.yaml required)"
fi

# ============================================================================
# 4. Verify Scripts are Disabled by Default
# ============================================================================
log_info "Verifying install script protection..."

if grep -q "ignore-scripts=true" .npmrc 2>/dev/null; then
    log_success "NPM install scripts are disabled by default"
else
    log_error "NPM install scripts are NOT disabled (add ignore-scripts=true to .npmrc)"
fi

if [ -f ".pnpmrc" ]; then
    if grep -q "ignore-scripts=true" .pnpmrc 2>/dev/null; then
        log_success "PNPM install scripts are disabled by default"
    else
        log_error "PNPM install scripts are NOT disabled (add ignore-scripts=true to .pnpmrc)"
    fi
fi

# ============================================================================
# 5. Check for Packages with Install Scripts
# ============================================================================
log_info "Scanning for packages with lifecycle scripts..."

PACKAGES_WITH_SCRIPTS=()

# Check in package-lock.json
if [ -f "package-lock.json" ] && command -v jq &> /dev/null; then
    SCRIPT_PACKAGES=$(jq -r '
        .. | 
        select(type == "object" and has("scripts")) | 
        select(.scripts | has("preinstall", "install", "postinstall")) | 
        .name // empty
    ' package-lock.json 2>/dev/null | sort -u)
    
    if [ -n "$SCRIPT_PACKAGES" ]; then
        while IFS= read -r pkg; do
            PACKAGES_WITH_SCRIPTS+=("$pkg")
        done <<< "$SCRIPT_PACKAGES"
    fi
fi

if [ ${#PACKAGES_WITH_SCRIPTS[@]} -gt 0 ]; then
    log_warning "Found ${#PACKAGES_WITH_SCRIPTS[@]} package(s) with install scripts:"
    for pkg in "${PACKAGES_WITH_SCRIPTS[@]}"; do
        echo "    - $pkg"
        
        # Check if it's in the allowlist
        if grep -q "$pkg" INSTALL_SCRIPT_ALLOWLIST.md 2>/dev/null; then
            log_info "  ✓ Listed in INSTALL_SCRIPT_ALLOWLIST.md"
        else
            log_error "  ✗ NOT in INSTALL_SCRIPT_ALLOWLIST.md - needs review!"
        fi
    done
else
    log_success "No packages with install scripts detected in lockfile"
fi

# ============================================================================
# 6. Verify Integrity Fields Exist
# ============================================================================
log_info "Verifying package integrity fields..."

if [ -f "package-lock.json" ] && command -v jq &> /dev/null; then
    # Count packages with integrity field
    PACKAGES_WITH_INTEGRITY=$(jq -r '[.. | select(type == "object" and has("integrity"))] | length' package-lock.json 2>/dev/null || echo "0")
    TOTAL_PACKAGES=$(jq -r '[.. | select(type == "object" and has("resolved"))] | length' package-lock.json 2>/dev/null || echo "0")
    
    if [ "$PACKAGES_WITH_INTEGRITY" -gt 0 ]; then
        PERCENTAGE=$((PACKAGES_WITH_INTEGRITY * 100 / TOTAL_PACKAGES))
        if [ "$PERCENTAGE" -ge 95 ]; then
            log_success "$PACKAGES_WITH_INTEGRITY/$TOTAL_PACKAGES packages have integrity hashes ($PERCENTAGE%)"
        else
            log_warning "$PACKAGES_WITH_INTEGRITY/$TOTAL_PACKAGES packages have integrity hashes ($PERCENTAGE%) - should be >95%"
        fi
    else
        log_error "No packages have integrity hashes in lockfile"
    fi
fi

# ============================================================================
# 7. Check for Suspicious Network Activity Configuration
# ============================================================================
log_info "Checking network security configuration..."

if grep -q "strict-ssl=true" .npmrc 2>/dev/null; then
    log_success "Strict SSL is enabled"
else
    log_error "Strict SSL is NOT enabled (add strict-ssl=true to .npmrc)"
fi

if grep -q "git-protocol=https" .npmrc 2>/dev/null; then
    log_success "Git protocol is set to HTTPS"
else
    log_warning "Git protocol not explicitly set to HTTPS"
fi

# ============================================================================
# 8. Verify Audit Configuration
# ============================================================================
log_info "Verifying audit configuration..."

if grep -q "audit-level" .npmrc 2>/dev/null; then
    AUDIT_LEVEL=$(grep "audit-level" .npmrc | cut -d'=' -f2)
    case "$AUDIT_LEVEL" in
        low|moderate|high|critical)
            log_success "Audit level set to: $AUDIT_LEVEL"
            ;;
        *)
            log_warning "Unknown audit level: $AUDIT_LEVEL"
            ;;
    esac
else
    log_warning "Audit level not configured (vulnerabilities may not fail the build)"
fi

# ============================================================================
# 9. Check Package.json for Suspicious Scripts
# ============================================================================
log_info "Checking package.json for suspicious scripts..."

SUSPICIOUS_PATTERNS=(
    "curl"
    "wget"
    "eval"
    "bash -c"
    "sh -c"
    "rm -rf /"
    "> /dev/null"
    "base64"
)

SUSPICIOUS_FOUND=false

for pattern in "${SUSPICIOUS_PATTERNS[@]}"; do
    if grep -i "$pattern" package.json 2>/dev/null | grep -v "^[[:space:]]*#" | grep -v "^[[:space:]]*//" > /dev/null; then
        log_warning "Suspicious pattern found in package.json: '$pattern'"
        SUSPICIOUS_FOUND=true
    fi
done

if [ "$SUSPICIOUS_FOUND" = false ]; then
    log_success "No suspicious patterns found in package.json scripts"
fi

# ============================================================================
# 10. Verify Workspace Configuration
# ============================================================================
log_info "Verifying workspace security..."

if [ -f "pnpm-workspace.yaml" ]; then
    log_success "pnpm-workspace.yaml found"
    
    # Check for internal package references
    if grep -q "@chen-pilot" pnpm-workspace.yaml 2>/dev/null; then
        log_info "Internal package scope @chen-pilot configured in workspace"
    fi
fi

# Check for workspace packages
if [ -f "package.json" ] && command -v jq &> /dev/null; then
    WORKSPACES=$(jq -r '.workspaces[]? // empty' package.json 2>/dev/null)
    if [ -n "$WORKSPACES" ]; then
        log_success "Workspaces configured in package.json"
    fi
fi

# ============================================================================
# Summary
# ============================================================================
echo ""
echo "============================================================================"
echo "Summary"
echo "============================================================================"
echo -e "${GREEN}Passed:${NC} $PASSED"
echo -e "${YELLOW}Warnings:${NC} $WARNINGS"
echo -e "${RED}Failed:${NC} $FAILED"
echo ""

if [ $FAILED -eq 0 ]; then
    if [ $WARNINGS -eq 0 ]; then
        echo -e "${GREEN}✓ All supply chain security checks passed!${NC}"
        exit 0
    else
        echo -e "${YELLOW}⚠ Supply chain verification completed with warnings${NC}"
        exit 0
    fi
else
    echo -e "${RED}✗ Supply chain security verification FAILED${NC}"
    echo ""
    echo "Please fix the errors above before proceeding."
    echo "See INSTALL_SCRIPT_ALLOWLIST.md for guidance."
    exit 1
fi
