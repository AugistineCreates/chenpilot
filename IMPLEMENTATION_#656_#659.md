# Clock Skew Detection (#656) & Token Family Binding (#659) Implementation

## Overview

This document describes the implementation of two critical security features for Chen Pilot's backend:

1. **#656: Clock Skew Detection** - Detects and contains system clock drift in deadline-sensitive workflows
2. **#659: Token Family Binding** - Binds refresh tokens to device + session with reuse detection

## #656: Clock Skew Detection

### Problem Solved

System clock skew causes failures in:
- JWT expiry validation (tokens rejected as expired when they're valid)
- Quote expiry checks (quotes rejected despite being within validity window)
- Distributed lock leases (leases considered expired when still valid)
- Cross-node coordination (clock differences cause race conditions)

### Architecture

```
ClockSkewService
├─ recordSample()      → Record time offset from external source
├─ getStats()          → Get current health status (HEALTHY/DEGRADED/CRITICAL)
├─ getTrustedNow()     → Get adjusted current time accounting for skew
└─ isSkewCritical()    → Check if system should be considered unhealthy

TrustedTimeManager
├─ hasExpired()        → Check if timestamp expired (with safety margin)
├─ isLeaseSafe()       → Check if lease hasn't expired (extra buffer)
├─ getFutureDeadline() → Create deadline accounting for clock drift
└─ getNow()            → Get trusted current time

HealthService Integration
└─ checkClockSkew()    → Reports skew as dependency in readiness probe
```

### Key Features

#### 1. Offset Tracking
- Records clock samples from multiple sources (Horizon, Soroban RPC, NTP)
- Computes median, min, max offsets across sources
- Calculates standard deviation for consistency metrics

#### 2. Health Status Calculation
```
HEALTHY:   max offset < 5 seconds
DEGRADED:  5 seconds ≤ max offset < 30 seconds
CRITICAL:  max offset ≥ 30 seconds
```

#### 3. Automatic Readiness Reporting
- Clock skew is now a critical dependency
- Excessive skew makes `/ready` endpoint return 503
- Includes detailed metrics in health report

#### 4. Safety Margins
All time-critical checks apply conservative safety margins:
- JWT expiry: ±5 seconds
- Quote expiry: ±2 seconds (configurable per use case)
- Lease renewal: ±5 seconds + 2-5 second buffer

### Usage Examples

```typescript
// In Horizon polling handler
const horizonLedger = server.ledgers().limit(1).call();
const ledgerTime = new Date(horizonLedger.records[0].closed_at);
clockSkewService.recordSample({
  localTime: new Date(),
  remoteTime: ledgerTime,
  source: 'horizon'
});

// In JWT validation
const isExpired = trustedTimeManager.hasExpired(token.expiresAt);

// In quote validation
const isValidQuote = trustedTimeManager.isValid(quote.expiresAt);

// In lease renewal
const shouldRenew = !trustedTimeManager.isLeaseSafe(leaseExpiry);
const renewDeadline = trustedTimeManager.getLeaseRenewalDeadline(leaseExpiry);
```

### Tests

Located in `src/services/clock/__tests__/`:
- **clockSkew.service.test.ts** (335 lines)
  - Forward/backward/cross-node skew scenarios
  - Health status transitions
  - Consensus detection across multiple sources
- **trustedTime.manager.test.ts** (282 lines)
  - JWT expiry with safety margins
  - Quote expiry scenarios
  - Lease safety checks
  - Integration with device binding

## #659: Token Family Binding

### Problem Solved

Stolen refresh tokens can be:
- Replayed from new device until rotation detects reuse
- Used to spawn new sessions without user knowledge
- Difficult to revoke atomically across all sessions

Device-based attacks include:
- Cross-device token portability
- Undetected session takeover
- Unclear which devices have active access

### Architecture

```
RefreshTokenFamilyService
├─ createTokenFamily()    → Create root token with device binding
├─ rotateToken()          → Rotate token, detect reuse, assess risk
├─ revokeFamilyAtomic()   → Atomically revoke all tokens in family
├─ getUserSessions()      → Get all active sessions/devices
├─ revokeSession()        → Logout from specific device
├─ revokeAllSessions()    → Full logout from all devices
└─ getFamilyLineage()     → Get complete history of token chain

DeviceBindingPolicy
├─ evaluateDevicePolicy() → Check if device meets security policy
├─ getRecommendedRefreshInterval() → How often to force refresh
└─ getStepUpMessage()     → User-friendly step-up explanations

SessionRoutes
├─ GET  /sessions         → List active sessions
├─ GET  /sessions/:fam... → Get session details
├─ DELETE /sessions/:fam..→ Logout from device
├─ DELETE /sessions       → Full logout
└─ POST /sessions/verify  → Check if device change needs step-up
```

### Data Model

Enhanced `RefreshToken` entity with:

**Token Family Binding**:
- `familyId` (UUID): All tokens in rotation chain
- `rootTokenId`: First token in family
- `parentTokenId`: Previous token in chain

**Device Binding**:
- `deviceId`: SHA256(userAgent + IP)
- `deviceName`: Human-readable (e.g., "Chrome on Windows")
- `ipAddressHash`: SHA256(IP) - privacy-preserving

**Risk Signals**:
- `riskSignal`: NONE, LOW, MEDIUM, HIGH, CRITICAL
- `riskReason`: Explanation of risk (e.g., "New device", "Replay attempt")
- `lastUsedAt`: Timestamp of last refresh
- `rotationReason`: NORMAL, RISK_DETECTED, MANUAL_LOGOUT, etc.

**Reuse Detection**:
- `reuseDetected`: Boolean flag
- `replacedByToken`: Which token replaced this one
- `isRevoked`: Revocation status

### Key Features

#### 1. Atomic Reuse Detection
When a token is refreshed after already being replaced:
```
1. Mark as reuseDetected = true
2. Find family by familyId
3. Revoke ALL tokens in family in single transaction
4. Log CRITICAL audit event
5. Return clear error to user
```

#### 2. Device Change Detection
```
Token1: Chrome, macOS, IP 192.168.1.100, Risk=NONE
  ↓ (user switches device)
Token2: Safari, iPhone, IP 192.168.1.50, Risk=MEDIUM
  → rotationReason = "DEVICE_CHANGE"
  → Risk assessed as MEDIUM due to device change
  → May trigger step-up authentication
```

#### 3. Session Inventory & Targeted Revocation
Users can:
- View all active devices/sessions
- See device name, last used time, risk level
- Logout from specific device (revoke single session)
- Logout from all devices (revoke entire user)

#### 4. Risk-Based Step-Up Policy
Configurable policies determine when step-up auth is required:

```typescript
// Default policy
{
  requireStepUpOnNewDevice: true,
  requireStepUpIfRiskLevelExceeds: "MEDIUM",
  allowRefreshWithinDaysOnSameDevice: 7,
  maxActiveDevicesPerUser: 5
}

// Strict policy (financial apps)
{
  requireStepUpOnNewDevice: true,
  requireStepUpIfRiskLevelExceeds: "LOW",
  allowRefreshWithinDaysOnSameDevice: 1,
  maxActiveDevicesPerUser: 1
}
```

### Usage Examples

```typescript
// During login - create family with device binding
const context: RefreshContext = {
  deviceFingerprint: {
    userAgent: req.get('user-agent'),
    ipAddress: getClientIp(req)
  },
  userAgent: req.get('user-agent'),
  ipAddress: getClientIp(req)
};
const token = await tokenFamilyService.createTokenFamily(
  userId, expiresAt, context, sessionId
);

// During token refresh - detect device changes and reuse
const newToken = await tokenFamilyService.rotateToken(
  oldToken, context, sessionId
);
// If reuse detected: throws UnauthorizedError + family revoked

// Session management
const sessions = await tokenFamilyService.getUserSessions(userId);
sessions.forEach(session => {
  console.log(`${session.deviceName}: last used ${session.lastUsedAt}`);
});

await tokenFamilyService.revokeSession(userId, familyId, "Logout");

// Policy evaluation
const policyResult = evaluateDevicePolicy({
  currentDeviceId: newDeviceId,
  lastKnownDeviceId: oldDeviceId,
  daysSinceLastSeen: 0,
  riskLevel: 'MEDIUM',
  isKnownDevice: false,
  activeDeviceCount: 2
});

if (policyResult.requiresStepUp) {
  // Show MFA screen
  console.log(getStepUpMessage(policyResult));
}
```

### Session Endpoints

#### `GET /sessions`
Lists all active sessions for the authenticated user.

```json
{
  "count": 2,
  "sessions": [
    {
      "familyId": "550e8400-e29b-41d4-a716-446655440000",
      "deviceName": "Chrome",
      "lastUsedAt": "2026-08-28T13:00:00Z",
      "createdAt": "2026-08-20T10:30:00Z",
      "riskLevel": "NONE",
      "isCompromised": false
    },
    {
      "familyId": "6ba7b810-9dad-11d1-80b4-00c04fd430c8",
      "deviceName": "Safari",
      "lastUsedAt": "2026-08-27T15:45:00Z",
      "createdAt": "2026-08-27T15:40:00Z",
      "riskLevel": "MEDIUM",
      "isCompromised": false
    }
  ]
}
```

#### `DELETE /sessions/:familyId`
Logout from specific device (revoke single session).

#### `DELETE /sessions?confirm=yes`
Logout from all devices (full logout).

#### `POST /sessions/verify-device`
Check if device change requires step-up authentication.

```json
{
  "requiresStepUp": true,
  "reason": "New device detected",
  "riskLevel": "MEDIUM"
}
```

### Tests

Located in `src/Auth/__tests__/`:
- **refreshTokenFamily.service.test.ts** (263 lines)
  - Reuse detection
  - Atomic family revocation
  - Device binding
  - Risk assessment
  - Concurrent scenarios
  - Session management
  - Audit trail

## Integration Testing

### Scenario: Token Reuse Detection

```
1. User logs in from Chrome (192.168.1.100)
   → Token family created with Chrome device binding
   → familyId = F1, token = T1

2. User refreshes token normally (same device)
   → T1 marked as replaced by T2
   → T2 created with same deviceId (Chrome)
   → rotationReason = "NORMAL"

3. Attacker intercepts old T1, tries to use it
   → rotateToken(T1, ...) is called
   → T1.replacedByToken is not null → REUSE DETECTED
   → Mark T1.reuseDetected = true
   → Atomically revoke family F1 (both T1 and T2)
   → Log CRITICAL audit event
   → Return: "Token reuse detected. All sessions revoked."

4. User tries to continue with T2
   → T2 is revoked → "Token has been revoked"
   → User must login again

5. Audit trail shows:
   - LOGIN: Initial token creation
   - TOKEN_REFRESH: Normal rotation
   - SECURITY_EVENT (CRITICAL): Reuse detected, family revoked
```

### Scenario: Device Change Requiring Step-Up

```
1. User logs in from Chrome Windows (192.168.1.100)
   → T1 created, riskSignal = NONE

2. 12 hours later, same user logs in from Safari iPhone (4G)
   → Different deviceId detected
   → New location detected (different IP)
   → Risk assessed as MEDIUM ("New device")
   
3. Policy evaluation:
   {
     requireStepUpOnNewDevice: true,
     currentDeviceId: <safari-id>,
     isKnownDevice: false,
     riskLevel: "MEDIUM"
   }
   → requiresStepUp = true

4. API returns 401 with:
   {
     "error": "step_up_required",
     "message": "We detected a new device. Please verify your identity.",
     "challenge": <MFA-challenge>
   }

5. User completes MFA
   → System calls rotateToken() with step-up flag
   → T1 marked as replaced by T2
   → T2 has new device binding, risk = MEDIUM
   → rotationReason = "DEVICE_CHANGE"

6. Session inventory shows two sessions:
   - Chrome Windows (last used 12 hours ago)
   - Safari iPhone (just now, MEDIUM risk)
```

### Scenario: Clock Skew Handling

```
1. Horizon ledger indicates time 2026-08-28T13:09:35Z
2. Local system time is 2026-08-28T13:09:30Z
3. Offset recorded: +5 seconds

4. Quote expires at 2026-08-28T13:15:00Z
5. Current time: 2026-08-28T13:14:56Z (real), 2026-08-28T13:15:01Z (trusted)

6. Check: trustedTimeManager.isValid(quoteExpiry)
   → trustedTime = 13:15:01 (adjusted for +5s skew)
   → expiryTime = 13:15:00
   → Applied safety margin: 2 seconds
   → Safe expiry time = 13:14:58
   → 13:15:01 > 13:14:58 → EXPIRED (safe decision)

7. Quote is conservatively rejected to prevent acceptance of stale quotes
```

## Migration & Deployment

### Database Migration
Run: `npm run migration:run`

Migration `1777000000000-EnhanceRefreshTokenWithFamilyBinding.ts`:
- Adds all new columns (familyId, deviceId, riskSignal, etc.)
- Creates 5 new indexes for efficient lookups
- Reversible with `down()` method
- No data loss - all columns are nullable with sensible defaults

### Required Integration
1. Update JWT service to use `RefreshTokenFamilyService`
2. Inject clock skew service in token refresh flow
3. Mount session routes in auth router
4. Update device fingerprinting in login/refresh handlers
5. Configure device binding policies per application needs

### Configuration

```env
# Clock Skew Thresholds (milliseconds)
CLOCK_SKEW_DEGRADED_MS=5000      # 5 seconds
CLOCK_SKEW_CRITICAL_MS=30000     # 30 seconds
CLOCK_SKEW_MAX_SAMPLES=100

# Token Family Settings
TOKEN_FAMILY_TTL_DAYS=7
MAX_ACTIVE_FAMILIES_PER_USER=5

# Device Binding
DEVICE_POLICY=default  # or 'strict' or 'permissive'
```

## Security Guarantees

### #656: Clock Skew Detection
✓ No false rejections of valid tokens due to clock drift
✓ Conservative safety margins prevent abuse
✓ Visible in readiness probe for monitoring
✓ Graceful degradation when skew exceeds limits

### #659: Token Family Binding
✓ Atomic family revocation on reuse detection
✓ Device binding prevents cross-device portability
✓ Complete audit trail of all token operations
✓ Session inventory enables threat detection
✓ Risk assessment drives conditional access

## Monitoring & Observability

### Metrics to Track
- Clock skew (max/median offset, status)
- Token reuse attempts (per family, per user)
- Device changes (frequency, risk levels)
- Session inventory (active sessions per user, devices per session)
- Step-up authentication rate (by reason)
- Full logout rate (by reason)

### Audit Events
- `LOGIN`: Initial token family creation
- `TOKEN_REFRESH`: Normal token rotation
- `SECURITY_EVENT`: Reuse detection, critical
- `LOGOUT`: User-initiated logout

### Health Endpoints
- `GET /health` - Quick liveness check
- `GET /ready` - Includes clock skew as critical dependency

## Future Enhancements

1. **Machine Learning Risk Scoring**
   - Learn user's normal access patterns
   - Flag unusual locations/times/devices
   - Adaptive risk thresholds

2. **Passwordless Step-Up**
   - WebAuthn/biometric instead of MFA
   - Smoother user experience for compliant devices

3. **Geo-IP Risk Integration**
   - Impossible travel detection
   - Country-based policies

4. **Token Binding**
   - Bind tokens to public key sent in request
   - Prevent replay even if token leaked

5. **Session Confidence Scoring**
   - Multi-factor scoring of session legitimacy
   - Real-time adaptive policies
