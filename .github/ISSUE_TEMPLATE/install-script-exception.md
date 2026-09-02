---
name: Install Script Exception Request
about: Request approval for a package to run install scripts
title: '[SECURITY] Install Script Exception: [PACKAGE NAME]'
labels: security, supply-chain, needs-review
assignees: ''
---

## Package Information

**Package Name**: 
**Version Range**: 
**NPM Link**: https://www.npmjs.com/package/[PACKAGE-NAME]

## Requestor Information

**Owner/Team**: @
**Date**: YYYY-MM-DD

## Justification

### Why is this package needed?
<!-- Describe the business or technical requirement -->

### Why does it require install scripts?
<!-- Explain what the install script does and why it's necessary -->

### What alternatives were considered?
<!-- List alternative packages or approaches that were evaluated -->

| Alternative | Reason for Rejection |
|-------------|---------------------|
| Example pkg | Reason |

## Security Review

### Install Script Analysis

**Script Location**: 
<!-- e.g., package.json "scripts.install" -->

**Script Actions**: 
<!-- What does the script do? Be specific -->
- [ ] Compiles native code
- [ ] Downloads external files
- [ ] Modifies filesystem
- [ ] Makes network requests
- [ ] Other: ___

**Source Code Review**:
<!-- Link to the install script source code -->
- Script source: https://github.com/[repo]/blob/[version]/[file]
- Reviewed by: @
- Review date: YYYY-MM-DD

### Network Activity

**Does the script make network requests?**
- [ ] No
- [ ] Yes - details:

If yes:
- **Destination**: 
- **Purpose**: 
- **Can be disabled**: [ ] Yes [ ] No

### Filesystem Access

**What files/directories does the script access?**
- 

**Can cause damage?**
- [ ] No - limited to package directory
- [ ] Potentially - describe:

### Risk Assessment

**Security Risk Level**:
- [ ] Low - Well-known package, minimal script actions
- [ ] Medium - Some script complexity, needs monitoring
- [ ] High - Complex scripts, extensive filesystem/network access

**Mitigation Measures**:
1. 
2. 
3. 

## Testing

### Sandbox Testing

**Testing Environment**: 
<!-- Isolated VM, container, etc. -->

**Tests Performed**:
- [ ] Monitored network activity - no unexpected connections
- [ ] Monitored filesystem access - limited to package directory
- [ ] Monitored process execution - no suspicious child processes
- [ ] Static analysis completed - no malicious patterns detected

**Testing Results**:
<!-- Attach logs or screenshots -->

### Alternative Testing

**Can the package function without scripts?**
- [ ] Yes - scripts only optimize/compile
- [ ] No - scripts are essential
- [ ] Partially - describe:

**Pre-compiled binaries available?**
- [ ] Yes - link:
- [ ] No

## Approval

### Security Team Review

- [ ] Source code reviewed
- [ ] Network activity acceptable
- [ ] Filesystem access acceptable  
- [ ] Risk assessment completed
- [ ] Mitigation measures adequate
- [ ] Testing results satisfactory

**Security Reviewer**: @
**Approval Date**: YYYY-MM-DD

### DevOps Team Review

- [ ] CI/CD impact assessed
- [ ] Build time impact acceptable
- [ ] Rollback plan documented
- [ ] Monitoring configured

**DevOps Reviewer**: @
**Approval Date**: YYYY-MM-DD

### Engineering Manager Review

- [ ] Business justification valid
- [ ] Alternatives adequately explored
- [ ] Risk acceptable for business value
- [ ] Team capacity for maintenance

**Manager**: @
**Approval Date**: YYYY-MM-DD

## Maintenance

**Review Cadence**: 
- [ ] Quarterly
- [ ] Semi-annually  
- [ ] Annually

**Next Review Date**: YYYY-MM-DD

**Expiry Date**: YYYY-MM-DD
<!-- Must be reviewed before this date -->

**Monitoring**:
<!-- How will this exception be monitored? -->
- 

## Implementation Checklist

Once approved:

- [ ] Add entry to `INSTALL_SCRIPT_ALLOWLIST.md` with all required fields
- [ ] Update `.pnpmrc` or `.npmrc` if needed for selective enablement
- [ ] Update `pnpm-workspace.yaml` allowBuilds if applicable
- [ ] Add calendar reminder for review date
- [ ] Document in team wiki/runbook
- [ ] Update CI/CD configuration if needed
- [ ] Communicate to development team

## Additional Notes

<!-- Any other relevant information -->

---

## Checklist for Requestor

Before submitting:
- [ ] All required fields completed
- [ ] Source code links provided
- [ ] Testing evidence attached
- [ ] Alternative analysis included
- [ ] Security reviewer identified
- [ ] DevOps reviewer identified
- [ ] Manager reviewer identified

---

**Related Documentation**:
- [SUPPLY_CHAIN_SECURITY.md](../../SUPPLY_CHAIN_SECURITY.md)
- [INSTALL_SCRIPT_ALLOWLIST.md](../../INSTALL_SCRIPT_ALLOWLIST.md)
- [SUPPLY_CHAIN_QUICK_START.md](../../SUPPLY_CHAIN_QUICK_START.md)
