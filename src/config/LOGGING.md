# Structured Logging Configuration

## Redaction

The logger performs key-name-based redaction on all structured metadata passed to `logger.info()`, `logger.error()`, etc. If an object key matches an entry in the denylist, its value is replaced with `[REDACTED]` before the log entry is written.

### Redacted fields

**Authentication secrets:**
- `pk`, `privateKey`, `password`, `token`, `secret`

**KYC PII fields:**
- `fullName` — Full legal name
- `dateOfBirth` — Date of birth
- `email` — Email address
- `phoneNumber` — Phone number
- `addressLine1`, `addressLine2` — Street address lines
- `postalCode` — Postal / ZIP code
- `countryCode` — Country code

**KYC document fields:**
- `documentId` — Government-issued document number (passport, national ID, etc.)
- `fileUrl` — Uploaded document file URL

### Mechanism

The redaction is applied recursively via `redactSensitiveData()` — nested objects and arrays are traversed and any key matching the denylist is replaced. The denylist is defined in `src/config/logger.ts` as the `SENSITIVE_FIELDS` array.

### Extending the list

Add new field names to the `SENSITIVE_FIELDS` array in `src/config/logger.ts`. Both camelCase and snake_case variants should be added if the field is expected in either form.
