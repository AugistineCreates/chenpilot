# Supply Chain Security Policy

## Overview

This document defines the supply chain security controls implemented in this project to prevent:

1. **Dependency Confusion Attacks** - Preventing internal package names from resolving to malicious public packages
2. **Unreviewed Lifecycle Scripts** - Controlling which packages can execute install/post-install scripts
3. **Integrity Violations** - Ensuring all packages match their expected checksums
4. **Network Exfiltration** - Preventing undeclared network access during builds

## Table of Contents

- [Threat Model](#threat-model)
- [Security Controls](#security-controls)
- [Configuration Files](#configuration-files)
- [Acceptance Criteria](#acceptance-criteria)
- [Developer Workflow](#developer-workflow)
- [CI/CD Integration](#cicd-integration)
- [Incident Response](#incident-response)
- [Maintenance](#maintenance)

## Threat Model

### Attack Vectors

1. **Dependency Confusion**
   - **Attack**: Attacker publishes malicious package with same name as internal package to public registry
   - **Impact**: Application installs malicious code instead of legitimate internal package
   - **Mitigation**: Scoped registry configuration enforces internal packages only resolve from private registry

2. **Malicious Install Scripts**
   - **Attack**: Dependency runs arbitrary code during `npm install` or `pnpm install`
   - **Impact**: Code execution, credential theft, backdoor installation
   - **Mitigation**: All install scripts disabled by default; exceptions require security review

3. **Package Integrity Tampering**
   - **Attack**: Man-in-the-middle or registry compromise modifies package contents
   - **Impact**: Installation of trojanized packages
   - **Mitigation**: Lockfile integrity checksums verified; mismatches fail the build

4. **Transitive Dependency Attacks**
   - **Attack**: Malicious code introduced through nested dependencies
   - **Impact**: Unreviewed malicious code in production
   - **Mitigation**: Automated vulnerability scanning; lockfile prevents unexpected updates

5. **Build-Time Data Exfiltration**
   - **Attack**: Install script or build script sends sensitive data to external server
   - **Impact**: Credential theft, source code exfiltration
   - **Mitigation**: Network activity monitoring; documented exceptions only

## Security Controls

### 1. Registry Configuration

**Control**: Internal package scope resolution

**Implementation**:
```ini
# .npmrc / .pnpmrc
@chen-pilot:registry=https://npm.pkg.github.com/chen-pilot
registry=https://registry.npmjs.org/
```

**Purpose**: Ensures all `@chen-pilot/*` packages can only resolve from the internal registry, preventing dependency confusion attacks where an attacker publishes a malicious package with the same name to npmjs.org.

**Verification**:
```bash
# Check configuration
grep "@chen-pilot:registry" .npmrc

# Verify not pointing to public registry
! grep "@chen-pilot:registry=https://registry.npmjs.org" .npmrc
```

### 2. Lifecycle Script Lockdown

**Control**: Disable all install scripts by default

**Implementation**:
```ini
# .npmrc / .pnpmrc
ignore-scripts=true
```

**Purpose**: Prevents arbitrary code execution during dependency installation. Packages requiring install scripts must be explicitly reviewed and documented.

**Exceptions**: See [INSTALL_SCRIPT_ALLOWLIST.md](./INSTALL_SCRIPT_ALLOWLIST.md)

**Verification**:
```bash
# Installation should complete without running scripts
pnpm install

# To allow a specific package's scripts (after review):
# Add to INSTALL_SCRIPT_ALLOWLIST.md with full documentation
```

### 3. Lockfile Integrity Enforcement

**Control**: Package checksums and resolution integrity

**Implementation**:
- Committed lockfile (`pnpm-lock.yaml` or `package-lock.json`)
- CI enforces frozen lockfile mode
- All packages have SHA-512 integrity hashes

**Purpose**: Ensures installed packages match reviewed versions; prevents package substitution attacks.

**Verification**:
```bash
# CI mode - fails if lockfile out of sync
pnpm install --frozen-lockfile

# Verify integrity
pnpm audit --audit-level=moderate
```

### 4. Dependency Provenance

**Control**: Package signature verification

**Implementation**:
```ini
# .npmrc
verify-signatures=true
```

**Purpose**: When available, verifies npm package signatures to ensure authenticity.

### 5. Network Security

**Control**: HTTPS enforcement and SSL verification

**Implementation**:
```ini
# .npmrc / .pnpmrc
strict-ssl=true
git-protocol=https
```

**Purpose**: Prevents downgrade attacks and ensures encrypted transport.

### 6. Audit Enforcement

**Control**: Automated vulnerability scanning

**Implementation**:
```ini
# .npmrc
audit-level=moderate
```

**CI Pipeline**: Runs `pnpm audit` on every build; fails on moderate+ vulnerabilities

**Purpose**: Detects known vulnerabilities in dependencies before production deployment.

## Configuration Files

### .npmrc

Primary npm configuration enforcing security policies.

**Location**: `c:\Users\PC\chenpilot\.npmrc`

**Key Settings**:
- `@chen-pilot:registry` - Internal package registry
- `ignore-scripts=true` - Disable install scripts
- `strict-ssl=true` - Enforce SSL verification
- `save-exact=true` - Pin exact versions

### .pnpmrc

PNPM-specific security configuration (recommended over npm).

**Location**: `c:\Users\PC\chenpilot\.pnpmrc`

**Additional Settings**:
- `frozen-lockfile=false` - Allow updates locally, frozen in CI
- `verify-store-integrity=true` - Verify package store
- `shamefully-hoist=false` - Prevent dependency confusion through hoisting

### INSTALL_SCRIPT_ALLOWLIST.md

Documented exceptions for packages requiring install scripts.

**Location**: `c:\Users\PC\chenpilot\INSTALL_SCRIPT_ALLOWLIST.md`

**Required Information**:
- Package name and version
- Owner and security reviewer
- Justification for script requirement
- Security audit summary
- Expiry date for re-review

### pnpm-workspace.yaml

Workspace configuration for monorepo packages.

**Location**: `c:\Users\PC\chenpilot\pnpm-workspace.yaml`

**Purpose**: Defines internal workspace packages that should prefer local resolution.

## Acceptance Criteria

All acceptance criteria from the requirement are met:

### ✅ 1. Internal package names cannot resolve from public registries

**Control**: `@chen-pilot:registry=https://npm.pkg.github.com/chen-pilot`

**Verification**:
```bash
# This command should fail or use private registry
pnpm view @chen-pilot/sdk-core

# Check configuration
./scripts/verify-supply-chain.ps1
```

**Test**: Try installing `@chen-pilot/sdk-core` - it should only resolve from the configured private registry, not npmjs.org.

### ✅ 2. Lockfile and integrity fields are enforced in CI

**Control**: CI workflow enforces `--frozen-lockfile` and verifies integrity hashes

**Verification**:
- Check `.github/workflows/supply-chain-security.yml`
- Pipeline fails if lockfile out of sync
- Pipeline fails if integrity checksums missing or mismatched

**Test**: 
```bash
# Modify package.json and push without updating lockfile
# CI should fail with "Lockfile is out of sync"
```

### ✅ 3. Install-script exceptions identify owner, reason, and expiry

**Control**: `INSTALL_SCRIPT_ALLOWLIST.md` template enforces documentation

**Verification**:
- Each exception has Owner, Reason, Security Review, and Expiry fields
- CI checks for expired exceptions and fails build
- Unapproved packages with scripts block installation

**Example**: See `bcrypt` entry in INSTALL_SCRIPT_ALLOWLIST.md

### ✅ 4. A clean build performs no undeclared network or script execution

**Control**: `ignore-scripts=true` + verification script checks for network patterns

**Verification**:
```bash
# Run clean build
rm -rf node_modules
pnpm install

# Verify no network access (excluding registry)
# Verify no scripts executed (except explicitly allowed)

# Automated check
./scripts/verify-supply-chain.ps1
```

**Test**: Monitor network traffic during `pnpm install` - should only contact configured registries, no other HTTP/HTTPS requests.

## Developer Workflow

### Initial Setup

1. **Clone repository**
   ```bash
   git clone <repo-url>
   cd chenpilot
   ```

2. **Verify configuration**
   ```bash
   # Windows
   .\scripts\verify-supply-chain.ps1
   
   # Linux/Mac
   ./scripts/verify-supply-chain.sh
   ```

3. **Install dependencies**
   ```bash
   pnpm install
   ```
   
   All install scripts are blocked by default. If a package requires scripts, you'll see a warning.

### Adding New Dependencies

1. **Add dependency**
   ```bash
   pnpm add <package-name>
   ```

2. **Check for install scripts**
   ```bash
   .\scripts\verify-supply-chain.ps1
   ```

3. **If package has install scripts**:
   - Research the package: What does the script do?
   - Security review: Examine script source code
   - Check alternatives: Is there a version without scripts?
   - If required: Document in `INSTALL_SCRIPT_ALLOWLIST.md`
   - Get security team approval
   - Configure allowlist

4. **Commit lockfile**
   ```bash
   git add pnpm-lock.yaml package.json
   git commit -m "feat: add dependency <package-name>"
   ```

### Adding Internal Package

1. **Create package** under `packages/`
   ```bash
   mkdir packages/my-package
   cd packages/my-package
   pnpm init
   ```

2. **Set scoped name**
   ```json
   {
     "name": "@chen-pilot/my-package",
     "version": "0.1.0"
   }
   ```

3. **Add to workspace**
   - Already configured in `pnpm-workspace.yaml` via `packages/*`

4. **Use in another package**
   ```bash
   pnpm add @chen-pilot/my-package --workspace
   ```

### Updating Dependencies

1. **Check for updates**
   ```bash
   pnpm outdated
   ```

2. **Update specific package**
   ```bash
   pnpm update <package-name>
   ```

3. **Run security checks**
   ```bash
   pnpm audit
   .\scripts\verify-supply-chain.ps1
   ```

4. **Test thoroughly**
   ```bash
   pnpm test
   pnpm run build
   ```

5. **Commit updated lockfile**

## CI/CD Integration

### GitHub Actions Workflow

**File**: `.github/workflows/supply-chain-security.yml`

**Triggers**:
- Every push to main branches
- Every pull request
- Daily scheduled scan (2 AM UTC)
- Manual workflow dispatch

**Checks**:
1. Configuration file presence
2. Registry configuration correctness
3. Install scripts disabled
4. Lockfile presence and sync
5. Package integrity verification
6. Vulnerability audit
7. Unapproved install scripts detection
8. Expired allowlist entries
9. SSL and security settings

**Outputs**:
- Supply chain security report (artifact)
- PR comment with status
- Build failure on any check failure

### Local Pre-Commit Checks

**Husky Hook**: `.husky/pre-commit`

Add supply chain verification:
```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

# Run supply chain verification
npm run verify:supply-chain
```

**Package.json script**:
```json
{
  "scripts": {
    "verify:supply-chain": "powershell -File scripts/verify-supply-chain.ps1"
  }
}
```

## Incident Response

### Scenario 1: Compromised Dependency Detected

1. **Immediate Actions**:
   ```bash
   # Remove compromised package
   pnpm remove <compromised-package>
   
   # Audit for alternatives
   pnpm search <alternative-package>
   
   # Install alternative
   pnpm add <safe-alternative>
   ```

2. **Investigation**:
   - Review git history: When was it added?
   - Check deployed versions: Is production affected?
   - Scan logs: Any suspicious activity?

3. **Communication**:
   - Notify security team immediately
   - Create incident report
   - Notify affected teams

4. **Recovery**:
   - Deploy fixed version
   - Rotate any exposed credentials
   - Monitor for exploitation attempts

### Scenario 2: Dependency Confusion Attempt Detected

1. **Confirmation**:
   ```bash
   # Check where package resolved from
   pnpm why <package-name>
   
   # Verify registry configuration
   grep "<scope>:registry" .npmrc
   ```

2. **Mitigation**:
   - Already protected by scoped registry configuration
   - Verify no manual overrides in developer environments
   - Check if malicious package was actually installed

3. **Prevention Enhancement**:
   - Add additional scope prefixes if needed
   - Consider private registry for all packages

### Scenario 3: Unauthorized Install Script Detected

1. **Block Installation**:
   ```bash
   # Scripts already blocked by ignore-scripts=true
   # Identify which package
   pnpm list --depth=Infinity | grep "<package>"
   ```

2. **Review**:
   - Examine script source code
   - Sandbox testing in isolated environment
   - Static analysis for malicious patterns

3. **Decision**:
   - Approve and document in allowlist
   - Find alternative without scripts
   - Remove dependency

## Maintenance

### Regular Reviews

**Weekly**:
- Review CI supply chain scan results
- Check for new security advisories

**Monthly**:
- Audit installed packages for updates
- Review and update dependencies
- Check for expired allowlist entries

**Quarterly**:
- Full security audit of all dependencies
- Review and update supply chain policies
- Test incident response procedures

**Annually**:
- Review all allowlist exceptions
- Update security tooling
- Conduct supply chain security training

### Updating This Policy

1. Create pull request with changes
2. Get approval from:
   - Security team lead
   - DevOps lead
   - At least one senior engineer
3. Update implementation:
   - Configuration files
   - Scripts
   - CI workflows
4. Communicate changes to all teams
5. Update training materials

### Metrics and Monitoring

**Track**:
- Number of dependencies with install scripts
- Number of allowlist exceptions
- Time to patch vulnerabilities
- False positive rate in scanning
- Build failure rate due to security checks

**Dashboard**: <link-to-dashboard>

## Related Documentation

- [INSTALL_SCRIPT_ALLOWLIST.md](./INSTALL_SCRIPT_ALLOWLIST.md) - Approved exceptions
- [SECURITY.md](./SECURITY.md) - General security policy
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
- [AUDIT_README.md](./contracts/AUDIT_README.md) - Smart contract auditing

## Support and Contact

- **Security Team**: security@chen-pilot.io
- **DevOps Team**: devops@chen-pilot.io
- **Slack Channel**: #security
- **Security Advisory**: Report via GitHub Security Advisories

## References

- [npm Security Best Practices](https://docs.npmjs.com/security-best-practices)
- [PNPM Security](https://pnpm.io/security)
- [Dependency Confusion Attacks](https://medium.com/@alex.birsan/dependency-confusion-4a5d60fec610)
- [OWASP Dependency-Check](https://owasp.org/www-project-dependency-check/)
- [Supply Chain Levels for Software Artifacts (SLSA)](https://slsa.dev/)

---

**Last Updated**: 2026-08-31  
**Version**: 1.0.0  
**Owner**: Security Team (@security-team)
