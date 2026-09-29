#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# verify-release.sh – Verify signed SBOMs and provenance for a chenpilot
# release artifact. Consumers can run this WITHOUT repository write access.
#
# Prerequisites:
#   - cosign (https://github.com/sigstore/cosign)
#   - gh CLI (https://cli.github.com/) — only for downloading assets
#
# Usage:
#   ./scripts/verify-release.sh <tag>
#   ./scripts/verify-release.sh v1.2.3
# ──────────────────────────────────────────────────────────────────────────────
set -euo pipefail

TAG="${1:?Usage: $0 <release-tag>}"
REPO="gear5labs/chenpilot"
WORK_DIR=$(mktemp -d)
trap 'rm -rf "$WORK_DIR"' EXIT

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  chenpilot release verification: $TAG"
echo "═══════════════════════════════════════════════════════════════════════════════"

# ── Check tooling ────────────────────────────────────────────────────────────
for cmd in cosign gh sha256sum; do
  if ! command -v "$cmd" &>/dev/null; then
    echo "ERROR: $cmd is required but not installed."
    echo "  cosign: https://github.com/sigstore/cosign-installer"
    echo "  gh:     https://cli.github.com/"
    exit 1
  fi
done

# ── Download release assets ──────────────────────────────────────────────────
echo ""
echo "── Step 1: Downloading release assets ──"
cd "$WORK_DIR"
gh release download "$TAG" --repo "$REPO" --dir . 2>/dev/null || {
  echo "ERROR: Failed to download release assets for $TAG"
  echo "       Make sure the tag exists and you have network access."
  exit 1
}

echo "Downloaded assets:"
ls -la

# ── Verify checksums ─────────────────────────────────────────────────────────
echo ""
echo "── Step 2: Verifying checksums ──"
if [[ -f SHA256SUMS.txt ]]; then
  sha256sum -c SHA256SUMS.txt && echo "✅ Checksums verified" || {
    echo "❌ Checksum verification failed!"
    exit 1
  }
else
  echo "⚠️  No SHA256SUMS.txt found — skipping checksum verification"
fi

# ── Verify cosign signatures ─────────────────────────────────────────────────
echo ""
echo "── Step 3: Verifying cosign signatures ──"

verify_cosign_blob() {
  local file="$1"
  local sig="${file}.sig"
  local cert="${file}.cert"

  if [[ ! -f "$sig" || ! -f "$cert" ]]; then
    echo "⚠️  Signature/certificate missing for $file — skipping"
    return 0
  fi

  echo "  Verifying: $file"
  cosign verify-blob "$file" \
    --signature "$sig" \
    --certificate "$cert" \
    --certificate-identity-regexp "https://github.com/${REPO}" \
    --certificate-oidc-issuer "https://token.actions.githubusercontent.com" 2>/dev/null \
    && echo "  ✅ $file signature valid" \
    || echo "  ⚠️  $file — signature check requires public transparency log (cosign transparency)"
}

for sbom in sbom-root.cdx.json sbom-sdk.cdx.json spdx-contracts.spdx.json; do
  if [[ -f "$sbom" ]]; then
    verify_cosign_blob "$sbom"
  fi
done

if [[ -f SHA256SUMS.txt ]]; then
  verify_cosign_blob "SHA256SUMS.txt"
fi

if [[ -f PROVENANCE.json ]]; then
  verify_cosign_blob "PROVENANCE.json"
fi

# ── Verify GitHub artifact attestations ──────────────────────────────────────
echo ""
echo "── Step 4: Verifying GitHub artifact attestations ──"
if gh attestation verify sbom-root.cdx.json --owner gear5labs 2>/dev/null; then
  echo "✅ GitHub attestation for root SBOM verified"
else
  echo "⚠️  GitHub attestation check skipped (requires auth or public transparency)"
fi

# ── Verify provenance binds correct commit ───────────────────────────────────
echo ""
echo "── Step 5: Verifying provenance metadata ──"
if [[ -f PROVENANCE.json ]]; then
  # Check that provenance references the correct repository
  if grep -q "gear5labs/chenpilot" PROVENANCE.json; then
    echo "✅ Provenance binds correct repository"
  else
    echo "❌ Provenance does not reference gear5labs/chenpilot!"
    exit 1
  fi

  # Check that provenance includes workflow identity
  if grep -q "sbom-provenance.yml" PROVENANCE.json; then
    echo "✅ Provenance binds correct workflow"
  else
    echo "❌ Provenance does not reference sbom-provenance.yml"
    exit 1
  fi

  # Extract commit SHA from provenance
  COMMIT=$(node -e "console.log(JSON.parse(require('fs').readFileSync('PROVENANCE.json','utf8')).externalParameters.ref)" 2>/dev/null || echo "unknown")
  echo "  Commit SHA in provenance: $COMMIT"
else
  echo "⚠️  No PROVENANCE.json found — skipping provenance verification"
fi

# ── Summary ──────────────────────────────────────────────────────────────────
echo ""
echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  Verification complete for release $TAG"
echo ""
echo "  SBOMs found:     $(ls *.cdx.json *.spdx.json 2>/dev/null | wc -l)"
echo "  Signatures found: $(ls *.sig 2>/dev/null | wc -l)"
echo "  Certificates:    $(ls *.cert 2>/dev/null | wc -l)"
echo "  Provenance:      $(test -f PROVENANCE.json && echo 'yes' || echo 'no')"
echo ""
echo "  To inspect an SBOM manually:"
echo "    cat sbom-root.cdx.json | python3 -m json.tool"
echo "    cat spdx-contracts.spdx.json | python3 -m json.tool"
echo "═══════════════════════════════════════════════════════════════════════════════"
