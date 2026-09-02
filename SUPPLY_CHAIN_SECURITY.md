# Supply Chain Security – SBOMs & Signed Provenance

This document describes the supply chain security measures implemented in the
chenpilot project to ensure every release artifact is verifiable, reproducible,
and traceable back to its source.

## Overview

Every release produces:

| Artifact | Format | Signed | Attested |
|----------|--------|--------|----------|
| Root npm SBOM | CycloneDX JSON | ✅ cosign | ✅ GitHub Attestation |
| SDK SBOM | CycloneDX JSON | ✅ cosign | ✅ GitHub Attestation |
| Contract SBOM | SPDX JSON | ✅ cosign | ✅ GitHub Attestation |
| WASM binaries | `.wasm` | ✅ via SBOM | ✅ via SBOM |
| Release tarballs | `.tgz` | ✅ cosign | ✅ GitHub Attestation |
| SHA256 checksums | `SHA256SUMS.txt` | ✅ cosign | — |
| Provenance manifest | `PROVENANCE.json` | ✅ cosign | ✅ GitHub Attestation |

## How It Works

### 1. SBOM Generation (`.github/workflows/sbom-provenance.yml`)

On every GitHub release, the `sbom-provenance.yml` workflow:

1. **npm packages**: Uses `@cyclonedx/cyclonedx-npm` to generate CycloneDX SBOMs
   for both the root package and `packages/sdk`.
2. **Soroban contracts**: Builds all workspace crates, then generates an SPDX
   SBOM listing every dependency crate and its license.
3. **WASM artifacts**: Collects all `.wasm` binaries and includes them in the
   SPDX SBOM with SHA-256 checksums.

### 2. Signing

All SBOMs, checksums, and provenance manifests are signed using **cosign
keyless signing** (Fulcio + Rekor):

- Uses OIDC identity from GitHub Actions (no long-lived keys needed)
- Signing certificate identifies `https://github.com/gear5labs/chenpilot`
- Signature and certificate are uploaded alongside each artifact (`.sig`, `.cert`)

### 3. Provenance

The `PROVENANCE.json` manifest binds:

- **Repository**: `gear5labs/chenpilot`
- **Commit SHA**: The exact git commit that produced the artifacts
- **Workflow**: `.github/workflows/sbom-provenance.yml`
- **Builder**: GitHub Actions runner
- **Materials**: Git repository source

### 4. Artifact Attestation

GitHub Artifact Attestations (`actions/attest-build-provenance@v2`) create
SLSA-compliant provenance for each artifact, stored in the GitHub transparency
log.

## Release Gates

The `release-gates.yml` workflow includes a `supply-chain-gate` job that
verifies:

- CycloneDX SBOM generation tooling works
- The `sbom-provenance.yml` workflow exists and is correctly configured
- Cosign signing is configured
- Artifact attestation is configured
- Provenance binds repository commit and workflow identity

**Unsigned or non-reproducible artifacts are rejected by these gates.**

## Verification (No Repository Write Access Required)

Consumers can verify release artifacts without any repository permissions:

### Prerequisites

```bash
# Install cosign
go install github.com/sigstore/cosign/v2/cmd/cosign@latest
# Or use the installer
curl -sSfL https://raw.githubusercontent.com/sigstore/cosign/main/install.sh | sh -s

# Install GitHub CLI (optional, for downloading)
brew install gh  # macOS
# or https://cli.github.com/
```

### Automated Verification

```bash
./scripts/verify-release.sh v1.2.3
```

### Manual Verification

```bash
# 1. Download the release assets
gh release download v1.2.3 --repo gear5labs/chenpilot

# 2. Verify checksums
sha256sum -c SHA256SUMS.txt

# 3. Verify SBOM signature
cosign verify-blob sbom-root.cdx.json \
  --signature sbom-root.cdx.json.sig \
  --certificate sbom-root.cdx.json.cert \
  --certificate-identity-regexp "https://github.com/gear5labs/chenpilot" \
  --certificate-oidc-issuer "https://token.actions.githubusercontent.com"

# 4. Verify GitHub attestation
gh attestation verify sbom-root.cdx.json --owner gear5labs

# 5. Inspect the SBOM
cat sbom-root.cdx.json | python3 -m json.tool
```

### Verifying WASM Contracts

```bash
# Download WASM and SPDX SBOM
gh release download v1.2.3 --repo gear5labs/chenpilot

# Verify WASM SHA-256 matches SBOM
sha256sum wasm-artifacts/*.wasm

# Check SPDX SBOM for dependency details
cat spdx-contracts.spdx.json | python3 -m json.tool
```

## Acceptance Criteria Mapping

| Criterion | Implementation |
|-----------|---------------|
| Artifacts, SBOMs, and provenance published together | All uploaded via `gh release upload` in same workflow |
| Provenance binds repository commit | `PROVENANCE.json` → `materials[0].digest.sha1` |
| Provenance binds workflow | `PROVENANCE.json` → `externalParameters.workflow` |
| Provenance binds builder | `PROVENANCE.json` → `builder.id` |
| Provenance binds dependencies | SBOMs list all transitive dependencies |
| Verification without write access | `scripts/verify-release.sh` + cosign keyless verification |
| Release gates reject unsigned artifacts | `supply-chain-gate` job in `release-gates.yml` |

## Architecture

```
GitHub Release
├── chenpilot-experimental-x.y.z.tgz        (npm tarball)
├── @chenpilot-experimental-sdk-x.y.z.tgz   (SDK tarball)
├── sbom-root.cdx.json                       (CycloneDX SBOM)
├── sbom-root.cdx.json.sig                   (cosign signature)
├── sbom-root.cdx.json.cert                  (cosign certificate)
├── sbom-sdk.cdx.json                        (CycloneDX SBOM)
├── sbom-sdk.cdx.json.sig                    (cosign signature)
├── sbom-sdk.cdx.json.cert                   (cosign certificate)
├── spdx-contracts.spdx.json                 (SPDX SBOM)
├── spdx-contracts.spdx.json.sig             (cosign signature)
├── spdx-contracts.spdx.json.cert            (cosign certificate)
├── wasm-artifacts/*.wasm                    (Soroban WASM binaries)
├── SHA256SUMS.txt                           (checksums)
├── SHA256SUMS.txt.sig                       (cosign signature)
├── SHA256SUMS.txt.cert                      (cosign certificate)
├── PROVENANCE.json                          (provenance manifest)
├── PROVENANCE.json.sig                      (cosign signature)
└── PROVENANCE.json.cert                     (cosign certificate)
```
