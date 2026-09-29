# #683 Financial Formatting Security Audit

**Date**: 2026-08-29  
**Status**: AUDIT COMPLETE  
**Severity**: CRITICAL - Security/UX Issue

---

## Executive Summary

Chen Pilot displays critical financial data (amounts, addresses, issuer IDs, transaction hashes) to users across multiple surfaces without locale-aware formatting. This creates risks:

- **Locale confusion**: Users in RTL locales (Arabic, Hebrew) or using different digit/decimal separators can misread amounts
- **Address misidentification**: Blockchain addresses lack directional isolation and can be misread
- **Truncation**: No protection against critical values being hidden on narrow screens
- **Homoglyph attacks**: No Unicode homoglyph detection or prevention

---

## Identified Financial Confirmation Surfaces

### 1. **Swap Confirmation** (HIGH PRIORITY)
**File**: `src/Agents/tools/swap.ts`  
**Risk Level**: CRITICAL

**Display Points**:
- Swap amount (source token)
- Estimated output amount
- Price quote
- Transaction hash
- Risk analysis warnings

**Current Code** (line 365-390):
```typescript
return this.createSuccessResult("swap", {
  from: payload.from,
  to: payload.to,
  amount: payload.amount,                    // ⚠️ NO FORMATTING
  estimatedOutput: priceQuote.estimatedOutput, // ⚠️ NO FORMATTING
  price: priceQuote.price,                   // ⚠️ NO FORMATTING
  txHash: result.hash,                       // ⚠️ NO ISOLATION
  timestamp: new Date().toISOString(),
  ledger: result.ledger,
  successful: result.successful,
  lifecycleId: lifecycleId,
  riskAnalysis: {
    level: riskAnalysis.riskLevel,
    sandwichAttackRisk: riskAnalysis.sandwichAttackRisk,
    warnings: riskAnalysis.warnings,
    recommendations: riskAnalysis.recommendations,
  },
});
```

**Issues**:
- Numeric amounts lack locale safety
- No thousand separator control
- tx hash displayed without RTL isolation

---

### 2. **Wallet Balance Display** (HIGH PRIORITY)
**File**: `src/Agents/tools/wallet.ts` (line 176)  
**Risk Level**: CRITICAL

**Display Code**:
```typescript
balance: `${(Number(balance.balance.toString()) / 10 ** 18).toFixed(
  2
)} ${payload.token}`,
```

**Issues**:
- Uses `.toFixed(2)` - hardcoded US formatting
- No thousand separators
- Could display `1,234.56` or `1.234,56` depending on locale
- Users in comma-decimal locales might misread `123.45` as cents, not full amount

---

### 3. **Wallet Transfer Confirmation** (MEDIUM PRIORITY)
**File**: `src/Agents/tools/wallet.ts` (line 232)  
**Risk Level**: HIGH

**Display Code**:
```typescript
return this.createSuccessResult("transfer", {
  from: starkAccount.address,  // ⚠️ NO RTL ISOLATION
  to: payload.to,              // ⚠️ NO RTL ISOLATION
  amount: payload.amount,      // ⚠️ NO FORMATTING
  txHash: tx.transaction_hash, // ⚠️ NO ISOLATION
});
```

**Issues**:
- Recipient address susceptible to RTL confusion
- Amount lacks formatting
- No verification that address wasn't corrupted in RTL rendering

---

### 4. **Price Quote Display** (MEDIUM PRIORITY)
**File**: `src/services/stellarPrice.service.ts`  
**Risk Level**: HIGH

**Issue**: Price quotes return raw numbers without formatting:
```typescript
price: priceQuote.price,        // Could be 0.123456789
estimatedOutput: ...           // Could be 12345.6789012
```

---

### 5. **Transaction Notification Messages** (MEDIUM PRIORITY)
**File**: `src/services/transactionNotification.service.ts`  
**Risk Level**: MEDIUM

**Issue**: Sends messages via Telegram/Discord with unformatted amounts:
- Amount fields lack currency symbol and decimal clarity
- Addresses not isolated for RTL safety
- Notification templates may not handle locale

---

### 6. **Asset Amount Display** (MEDIUM PRIORITY)
**File**: `src/domain/assets/assetAmount.ts` (line 72)  
**Risk Level**: MEDIUM

**Current Code**:
```typescript
toString(): string {
  return `${this.amount} ${this.asset.code}`;
}
```

**Issue**:
- Amount is raw string, no formatting applied
- Relies on caller to format, creating inconsistency

---

### 7. **Audit Log Financial Records** (MEDIUM PRIORITY)
**File**: `src/AuditLog/auditLog.service.ts`  
**Risk Level**: MEDIUM

**Issue**: Financial amounts logged without normalization:
- Makes audit records hard to compare across locales
- Difficult to detect anomalies (e.g., `1.234` vs `1,234`)

---

### 8. **Portfolio Service Display** (MEDIUM PRIORITY)
**File**: `src/services/portfolioService.ts`  
**Risk Level**: MEDIUM

**Issue**: Returns portfolio balances without currency/locale formatting

---

### 9. **Risk Analysis Display** (LOW-MEDIUM PRIORITY)
**File**: `src/Agents/tools/riskAnalysis.ts`  
**Risk Level**: MEDIUM

**Issue**: Risk percentages displayed without formatting:
- `sandwichAttackRisk: 0.234567` (6 decimal places could confuse users)
- Should be consistently formatted: `23.46%` or `0.2346`

---

### 10. **Horizon Proxy Responses** (MEDIUM PRIORITY)
**File**: `src/Gateway/horizonProxy.service.ts`  
**Risk Level**: MEDIUM

**Issue**: Proxies raw Horizon responses which may contain unformatted amounts

---

## Critical Gaps

| Category | Current State | Required State | Gap |
|----------|---------------|-----------------|-----|
| **Decimal Separator** | Implicit (`.toFixed()`) | Explicit (non-breaking space or explicit mark) | 🔴 CRITICAL |
| **Grouping Separator** | None | User-safe (not locale-dependent) | 🔴 CRITICAL |
| **RTL Isolation** | None | BiDi marks + copyable format | 🔴 CRITICAL |
| **Address Display** | Raw strings | RLM/LRM marks + code point validation | 🔴 CRITICAL |
| **Truncation Protection** | No safeguards | Always full display, no ellipsis | 🔴 CRITICAL |
| **Unicode Homoglyph Detection** | None | Glyph detection in addresses/issuers | 🟡 HIGH |
| **Snapshot Tests** | None | RTL, homoglyphs, narrow screens | 🔴 CRITICAL |

---

## Recommended Solution Architecture

1. **Create `SecuritySensitiveFormatter` utility** with:
   - Locale-safe decimal formatting
   - Non-locale-dependent grouping
   - BiDi character injection for addresses
   - Homoglyph detection
   - Truncation prevention

2. **Create separate format for each data type**:
   - `formatAmount()` - For financial amounts
   - `formatAddress()` - For blockchain addresses (RTL-safe)
   - `formatIssuer()` - For asset issuers (RTL-safe)
   - `formatPercentage()` - For risk/fees
   - `formatTransactionHash()` - For tx hashes (hyphenation + RTL)

3. **Integrate into all confirmation surfaces**:
   - SwapTool result messages
   - WalletTool balance & transfer confirmations
   - TransactionNotification messages
   - AuditLog financial records
   - Portfolio displays

4. **Add comprehensive snapshot tests** for:
   - RTL locales (Arabic, Hebrew)
   - Unicode homoglyphs
   - Narrow screen rendering (< 320px)
   - Various grouping separator locales

---

## Files Requiring Changes

| Priority | File | Change Type | Risk |
|----------|------|-------------|------|
| 🔴 P0 | `src/utils/SecuritySensitiveFormatter.ts` | CREATE | New |
| 🔴 P0 | `src/Agents/tools/swap.ts` | MODIFY | Medium |
| 🔴 P0 | `src/Agents/tools/wallet.ts` | MODIFY | Medium |
| 🟡 P1 | `src/services/stellarPrice.service.ts` | MODIFY | Low |
| 🟡 P1 | `src/services/transactionNotification.service.ts` | MODIFY | Medium |
| 🟡 P1 | `src/domain/assets/assetAmount.ts` | MODIFY | Low |
| 🟡 P1 | `src/AuditLog/auditLog.service.ts` | MODIFY | Low |
| 🟡 P1 | `src/services/portfolioService.ts` | MODIFY | Low |
| 🟠 P2 | `tests/**/*.snap` | CREATE | New (snapshots) |

---

## Acceptance Criteria Mapping

| Criterion | Covered By |
|-----------|-----------|
| ✅ Decimal and grouping separators cannot be confused | SecuritySensitiveFormatter.formatAmount() |
| ✅ Addresses remain directionally isolated and copyable | SecuritySensitiveFormatter.formatAddress() + snapshot tests |
| ✅ Critical values never hidden by truncation | formatAmount() with no-ellipsis flag |
| ✅ Snapshot tests for RTL/homoglyphs/narrow screens | `SecuritySensitiveFormatter.test.ts` with 3 test suites |

---

## Next Steps

1. ✅ **COMPLETE**: Task #1 - Audit complete
2. **NEXT**: Task #2 - Create SecuritySensitiveFormatter utility
3. Task #3 - Implement locale-safe decimal/grouping rules
4. Task #4 - Implement RTL-safe address/issuer formatting
5. Task #5 - Add truncation prevention
6. Task #6 - Create comprehensive snapshot tests
7. Task #7-9 - Integration and verification

