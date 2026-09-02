# Supply Chain Security - Quick Start Guide

## 🔒 Overview

This project implements comprehensive supply chain security measures to protect against:

- **Dependency Confusion Attacks** - Internal packages only resolve from private registry
- **Malicious Install Scripts** - All install scripts disabled by default
- **Package Tampering** - Lockfile integrity enforcement
- **Unvetted Dependencies** - Automated vulnerability scanning

## ✅ Quick Verification

Run the verification script to check your local environment:

**Windows (PowerShell)**:
```powershell
.\scripts\verify-supply-chain.ps1
```

**Linux/Mac (Bash)**:
```bash
./scripts/verify-supply-chain.sh
```

**Via npm/pnpm**:
```bash
pnpm run verify:supply-chain
```

## 📋 What's Protected

### 1. Internal Packages
All `@chen-pilot/*` packages are configured to only resolve from our private registry, preventing attackers from publishing malicious packages with the same name to npmjs.org.

**Configuration**: `.npmrc` and `.pnpmrc`
```ini
@chen-pilot:registry=https://npm.pkg.github.com/chen-pilot
```

### 2. Install Scripts
All package install/postinstall scripts are disabled by default. Only approved packages in the allowlist can execute scripts.

**Configuration**: `.npmrc` and `.pnpmrc`
```ini
ignore-scripts=true
```

**Allowlist**: `INSTALL_SCRIPT_ALLOWLIST.md`

### 3. Lockfile Integrity
Package checksums are verified against the lockfile. Any mismatch fails the build.

**Files**:
- `pnpm-lock.yaml` (preferred)
- `package-lock.json` (fallback)

**CI Enforcement**: `--frozen-lockfile` mode

### 4. Vulnerability Scanning
Automated scanning for known vulnerabilities runs on:
- Every push to main branches
- Every pull request
- Daily at 2 AM UTC
- Manual workflow dispatch

**Configuration**: `.github/workflows/supply-chain-security.yml`

## 🚀 Developer Workflow

### Installing Dependencies

```bash
# Standard installation - scripts are blocked
pnpm install

# If you see warnings about blocked scripts, check the allowlist
cat INSTALL_SCRIPT_ALLOWLIST.md

# Run verification
pnpm run verify:supply-chain
```

### Adding New Dependencies

1. **Add the package**:
   ```bash
   pnpm add <package-name>
   ```

2. **Verify security**:
   ```bash
   pnpm run verify:supply-chain
   ```

3. **If install scripts are detected**:
   - Review what the script does
   - Check for alternatives without scripts
   - If necessary, document in `INSTALL_SCRIPT_ALLOWLIST.md` with security approval

4. **Commit lockfile**:
   ```bash
   git add pnpm-lock.yaml package.json
   git commit -m "feat: add <package-name>"
   ```

### Creating Internal Packages

1. **Use the `@chen-pilot` scope**:
   ```json
   {
     "name": "@chen-pilot/my-new-package",
     "version": "0.1.0"
   }
   ```

2. **Add to workspace** (already configured):
   - Packages under `packages/*` are automatically included

3. **Use in another package**:
   ```bash
   pnpm add @chen-pilot/my-new-package --workspace
   ```

### Updating Dependencies

```bash
# Check for outdated packages
pnpm outdated

# Update specific package
pnpm update <package-name>

# Update all (carefully!)
pnpm update

# Always verify after updates
pnpm run verify:supply-chain
pnpm test
```

## ⚠️ Common Issues

### Issue: "Install scripts are blocked"

**Cause**: A package is trying to run an install script, but they're disabled by default.

**Solution**:
1. Check `INSTALL_SCRIPT_ALLOWLIST.md` - is this package approved?
2. If yes, the package may need manual setup
3. If no, either:
   - Find an alternative package without install scripts
   - Request security review to add to allowlist

### Issue: "Lockfile out of sync"

**Cause**: `package.json` was modified but `pnpm-lock.yaml` wasn't updated.

**Solution**:
```bash
# Update lockfile
pnpm install

# Commit both files
git add package.json pnpm-lock.yaml
git commit -m "chore: update lockfile"
```

### Issue: "Internal package resolved from public registry"

**Cause**: Registry configuration is incorrect or overridden.

**Solution**:
```bash
# Check configuration
grep "@chen-pilot:registry" .npmrc .pnpmrc

# Should show: @chen-pilot:registry=https://npm.pkg.github.com/chen-pilot
# NOT: https://registry.npmjs.org/

# Fix if needed
# Edit .npmrc or .pnpmrc to correct the registry
```

### Issue: "Vulnerability detected"

**Cause**: A dependency has a known security vulnerability.

**Solution**:
```bash
# Check details
pnpm audit

# Try auto-fix
pnpm audit --fix

# If no fix available:
# 1. Check if there's a newer version
# 2. Check if there's an alternative package
# 3. Assess risk and create exception if necessary
```

## 🔍 CI/CD Checks

The following checks run automatically in CI:

- ✅ Configuration files present (`.npmrc`, `.pnpmrc`, allowlist)
- ✅ Internal packages use private registry
- ✅ Install scripts disabled by default
- ✅ Lockfile exists and is in sync
- ✅ Package integrity hashes present
- ✅ No moderate+ vulnerabilities
- ✅ No unapproved install scripts
- ✅ No expired allowlist entries
- ✅ SSL verification enabled

**View Results**: Check GitHub Actions workflow results or PR comments

## 📚 Documentation

- **[SUPPLY_CHAIN_SECURITY.md](./SUPPLY_CHAIN_SECURITY.md)** - Complete security policy
- **[INSTALL_SCRIPT_ALLOWLIST.md](./INSTALL_SCRIPT_ALLOWLIST.md)** - Approved exceptions
- **[CONTRIBUTING.md](./CONTRIBUTING.md)** - Contribution guidelines
- **[SECURITY.md](./SECURITY.md)** - Security reporting

## 🆘 Getting Help

- **Slack**: #security or #devops
- **Email**: security@chen-pilot.io
- **Issues**: Create a GitHub issue with the `security` label

## 📊 Verification Script Output

When you run the verification script, you'll see output like:

```
============================================================================
Supply Chain Security Verification
============================================================================

[INFO] Checking configuration files...
[PASS] .npmrc configuration file exists
[PASS] .pnpmrc configuration file exists
[PASS] Install script allowlist documentation exists

[INFO] Verifying registry configuration for internal packages...
[PASS] Internal packages @chen-pilot have dedicated registry: https://npm.pkg.github.com/chen-pilot

[INFO] Checking lockfile integrity...
[PASS] pnpm-lock.yaml found
[PASS] pnpm-lock.yaml is not empty

[INFO] Verifying install script protection...
[PASS] NPM install scripts are disabled by default
[PASS] PNPM install scripts are disabled by default

... (more checks) ...

============================================================================
Summary
============================================================================
Passed:   15
Warnings: 0
Failed:   0

✓ All supply chain security checks passed!
```

## 🎯 Quick Reference

| Task | Command |
|------|---------|
| Verify security | `pnpm run verify:supply-chain` |
| Install deps | `pnpm install` |
| Add dependency | `pnpm add <package>` |
| Update deps | `pnpm update` |
| Check vulnerabilities | `pnpm audit` |
| View allowlist | `cat INSTALL_SCRIPT_ALLOWLIST.md` |

---

**For complete details**, see [SUPPLY_CHAIN_SECURITY.md](./SUPPLY_CHAIN_SECURITY.md)

**Last Updated**: 2026-08-31  
**Version**: 1.0.0
