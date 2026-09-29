# Install Script Allowlist

This document tracks all packages approved to run lifecycle scripts (install, preinstall, postinstall) during dependency installation.

## Review Process

All install script exceptions must include:
1. **Package Name** - Exact package name and version range
2. **Owner** - Team or individual responsible for the exception
3. **Reason** - Business/technical justification for the script
4. **Security Review** - Date and reviewer of security assessment
5. **Expiry Date** - When this exception must be re-reviewed
6. **Alternative Considered** - Why alternative without scripts was rejected

## Current Allowlist

### bcrypt
- **Version Range**: ^6.0.0
- **Owner**: Backend Security Team (@security-team)
- **Reason**: Native C++ module compilation required for cryptographic operations. Pre-built binaries not available for all target platforms.
- **Security Review**: 2026-08-31 by @security-lead
- **Script Actions**: 
  - Compiles native bcrypt binding using node-gyp
  - Downloads and verifies source from official repository
  - No network requests during script execution
- **Mitigation**: 
  - Package integrity verified via SHA-512 checksum
  - Source code audited for malicious behavior
  - Runs in isolated environment with no network access
- **Expiry Date**: 2027-08-31
- **Review Cadence**: Annual
- **Alternative Considered**: Pure JavaScript implementations are 10x slower and unsuitable for production authentication workloads

---

### @stellar/stellar-sdk (future consideration)
- **Status**: Under Review
- **Version Range**: ^14.4.3
- **Owner**: Blockchain Integration Team (@blockchain-team)
- **Reason**: May require native crypto bindings
- **Security Review**: Pending
- **Expiry Date**: N/A
- **Notes**: Currently no install scripts, monitoring for future versions

---

## Denied Packages

### protobufjs
- **Denied Date**: 2026-08-31
- **Reason**: Postinstall script executes arbitrary code generation
- **Alternative**: Use pre-compiled protocol buffers or compile during build phase, not install
- **Decision**: Use `protobufjs-cli` during build step instead

---

## Review Process

### For Adding New Exceptions

1. Create a pull request modifying this file
2. Include security audit results from:
   - Static analysis of install script code
   - Runtime sandbox testing
   - Network activity monitoring
   - File system access audit
3. Get approval from:
   - Security team lead
   - DevOps team lead
   - Engineering manager
4. Add package to `.npmrc` or `.pnpmrc` configuration
5. Document in CI/CD pipeline

### For Reviewing Existing Exceptions

1. Review scheduled via calendar reminder 30 days before expiry
2. Re-audit package for:
   - New vulnerabilities reported
   - Changes to install script behavior
   - Availability of alternatives
3. Update this document with:
   - New expiry date
   - Updated security review information
   - Any changes to mitigation strategy

### For Emergency Revocation

If a security issue is discovered in an allowed package:

1. Immediately remove from allowlist
2. Set `ignore-scripts=true` in configuration
3. Notify all teams via Slack #security-alerts
4. Create incident report
5. Evaluate alternatives within 24 hours

---

## Configuration Files

This allowlist is enforced by:

- `.npmrc` - NPM configuration
- `.pnpmrc` - PNPM configuration  
- `.github/workflows/*.yml` - CI/CD pipeline validation

To enable a package's install scripts:

**For NPM (not recommended - use PNPM):**
```bash
# NOT IMPLEMENTED - Use PNPM's granular controls instead
```

**For PNPM:**
Edit `.pnpmrc` and add under the approved section:
```ini
# Package: [name]
# Owner: [team]
# Reason: [justification]
# Approved: [date]
# Expires: [date]
```

---

## Audit Log

| Date | Action | Package | Approver | Reason |
|------|--------|---------|----------|--------|
| 2026-08-31 | ADDED | bcrypt@^6.0.0 | @security-lead | Initial allowlist - native crypto compilation |

---

## Related Documentation

- [SECURITY.md](./SECURITY.md) - Overall security policy
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
- [Supply Chain Security Policy](#) - Enterprise security standards

---

## Emergency Contacts

- Security Team: security@chen-pilot.io
- DevOps Team: devops@chen-pilot.io
- On-Call: Use PagerDuty escalation policy
