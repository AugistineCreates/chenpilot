# Bot Identity Linking System

## Overview

The Bot Identity Linking System provides secure cross-platform account linking between Telegram, Discord, and Chen Pilot user accounts. This enables users to authenticate and interact with Chen Pilot services through their preferred bot platform while maintaining a unified user identity.

## Architecture

### Components

1. **BotIdentity Entity** (`src/Auth/botIdentity.entity.ts`)
   - Database entity storing linked bot identities
   - Supports Telegram and Discord platforms
   - Tracks linking status, timestamps, and metadata

2. **BotIdentityService** (`src/Auth/botIdentity.service.ts`)
   - Core business logic for identity linking
   - Secure token generation and verification
   - CRUD operations for linked identities

3. **AccountLinkingService** (`packages/bot/src/services/accountLinkingService.ts`)
   - Bot-side service for API communication
   - Handles token generation and verification requests
   - Manages identity lookups for authentication

4. **API Routes** (`src/Auth/botIdentity.routes.ts`)
   - RESTful endpoints for identity management
   - Token generation and verification
   - Identity listing and unlinking

5. **Middleware** (`src/Auth/botIdentity.middleware.ts`)
   - Authentication via bot identities
   - Optional and hybrid authentication modes
   - Integration with existing JWT authentication

6. **Bot Commands** (`packages/bot/src/commands/handlers/linkHandler.ts`)
   - `/link` - Generate link token
   - `/unlink` - Remove identity link
   - `/linked` - View linked accounts

## Database Schema

### BotIdentity Table

```sql
CREATE TABLE bot_identity (
  id UUID PRIMARY KEY,
  userId UUID NOT NULL,
  platform VARCHAR NOT NULL,
  platformUserId VARCHAR UNIQUE NOT NULL,
  platformUsername VARCHAR,
  metadata JSONB,
  isActive BOOLEAN DEFAULT true,
  lastLinkedAt TIMESTAMP,
  lastUsedAt TIMESTAMP,
  createdAt TIMESTAMP DEFAULT NOW(),
  updatedAt TIMESTAMP DEFAULT NOW(),
  FOREIGN KEY (userId) REFERENCES user(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX idx_bot_identity_userId ON bot_identity(userId);
CREATE INDEX idx_bot_identity_platform ON bot_identity(platform);
CREATE INDEX idx_bot_identity_platformUserId ON bot_identity(platformUserId);
CREATE INDEX idx_bot_identity_userId_platform ON bot_identity(userId, platform);
```

## API Endpoints

### POST /api/bot-identity/link-token
Generate a secure link token for identity linking.

**Authentication:** Required (JWT)

**Request Body:**
```json
{
  "platform": "telegram" | "discord"
}
```

**Response:**
```json
{
  "success": true,
  "token": "abc123...",
  "expiresAt": "2024-01-01T12:00:00Z"
}
```

### POST /api/bot-identity/verify-link
Verify a link token and complete identity linking.

**Authentication:** None (public endpoint for bot verification)

**Request Body:**
```json
{
  "token": "abc123...",
  "platformUserId": "123456789",
  "platformUsername": "username"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Account linked successfully",
  "userId": "user-uuid"
}
```

### GET /api/bot-identity/user-by-identity
Get user by bot identity for authentication.

**Authentication:** None

**Query Parameters:**
- `platform`: "telegram" | "discord"
- `platformUserId`: Platform-specific user ID

**Response:**
```json
{
  "exists": true,
  "userId": "user-uuid"
}
```

### GET /api/bot-identity/identities/:userId
Get all linked identities for a user.

**Authentication:** Required (JWT)

**Response:**
```json
{
  "success": true,
  "identities": [
    {
      "id": "identity-uuid",
      "platform": "telegram",
      "platformUserId": "123456789",
      "platformUsername": "username",
      "isActive": true,
      "lastLinkedAt": "2024-01-01T12:00:00Z",
      "lastUsedAt": "2024-01-01T13:00:00Z"
    }
  ]
}
```

### DELETE /api/bot-identity/unlink
Unlink a bot identity from a user account.

**Authentication:** Required (JWT)

**Request Body:**
```json
{
  "platform": "telegram" | "discord"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Identity unlinked successfully"
}
```

## Bot Commands

### /link
Generate a link token to connect your bot account to Chen Pilot.

**Usage:**
- Telegram: `/link`
- Discord: `/link`

**Response:**
```
🔗 Account Linking

To link your Telegram account to your Chen Pilot account:

1. Log in to your Chen Pilot dashboard
2. Navigate to Settings → Linked Accounts
3. Enter this link token: abc123...

⏱️ This token expires in 15 minutes.

For security, never share your link token with others.
```

### /unlink
Remove the link between your bot account and Chen Pilot.

**Usage:**
- Telegram: `/unlink`
- Discord: `/unlink`

**Response:**
```
✅ Your account has been successfully unlinked from Chen Pilot.
```

### /linked
View all your linked Chen Pilot accounts.

**Usage:**
- Telegram: `/linked`
- Discord: `/linked`

**Response:**
```
🔗 Linked Accounts

• Telegram: @username
  Linked: 01/01/2024
  Status: ✅ Active
```

## Authentication Middleware

### authenticateBotIdentity
Authenticates users via linked bot identities using headers.

**Headers:**
- `X-Platform`: "telegram" | "discord"
- `X-Platform-User-Id`: Platform-specific user ID

**Usage:**
```typescript
import { authenticateBotIdentity } from './Auth/botIdentity.middleware';

router.get('/api/some-endpoint', authenticateBotIdentity, handler);
```

### optionalBotIdentityAuth
Optional authentication that doesn't fail if headers are missing.

**Usage:**
```typescript
import { optionalBotIdentityAuth } from './Auth/botIdentity.middleware';

router.get('/api/public-endpoint', optionalBotIdentityAuth, handler);
```

### authenticateTokenOrBotIdentity
Hybrid authentication accepting either JWT token or bot identity.

**Usage:**
```typescript
import { authenticateTokenOrBotIdentity } from './Auth/botIdentity.middleware';

router.get('/api/flexible-endpoint', authenticateTokenOrBotIdentity, handler);
```

## Security Features

1. **Secure Token Generation**
   - Tokens are generated using cryptographic hashing
   - 15-minute expiration window
   - Single-use tokens (consumed after verification)

2. **Unique Identity Constraints**
   - Each bot identity can only be linked to one user
   - Platform-specific user IDs are unique
   - Prevents identity hijacking

3. **Audit Logging**
   - All identity operations are logged
   - Tracks linking, unlinking, and authentication events
   - Supports security monitoring and compliance

4. **Rate Limiting**
   - API endpoints inherit general rate limiting
   - Token generation has additional protection
   - Prevents brute force attacks

## User Flow

### Linking Process

1. User initiates linking via bot command `/link`
2. Bot generates link token via backend API
3. User receives token in bot message
4. User logs into Chen Pilot dashboard
5. User navigates to Settings → Linked Accounts
6. User enters link token
7. Backend verifies token and creates identity link
8. User receives confirmation in dashboard

### Authentication Flow

1. Bot sends request to backend with identity headers
2. Middleware validates bot identity
3. Backend retrieves linked user account
4. Request proceeds with authenticated user context
5. User can access protected resources

## Migration

Run the database migration to create the bot_identity table:

```bash
npm run migration:run
```

## Configuration

Environment variables (optional):

```env
# Backend URL for bot service
BACKEND_URL=http://localhost:2333
API_BASE_URL=http://localhost:2333
```

## Testing

### Manual Testing

1. **Link Token Generation**
   ```bash
   curl -X POST http://localhost:2333/api/bot-identity/link-token \
     -H "Authorization: Bearer YOUR_JWT_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"platform": "telegram"}'
   ```

2. **Token Verification**
   ```bash
   curl -X POST http://localhost:2333/api/bot-identity/verify-link \
     -H "Content-Type: application/json" \
     -d '{"token": "YOUR_TOKEN", "platformUserId": "123456789"}'
   ```

3. **User Lookup**
   ```bash
   curl "http://localhost:2333/api/bot-identity/user-by-identity?platform=telegram&platformUserId=123456789"
   ```

## Troubleshooting

### Common Issues

**Issue:** Token verification fails
- **Solution:** Ensure token hasn't expired (15-minute window)
- **Solution:** Check that platform and platformUserId are correct

**Issue:** Identity already linked to another user
- **Solution:** User must unlink from existing account first
- **Solution:** Contact support if identity was hijacked

**Issue:** Bot identity not found during authentication
- **Solution:** Verify identity is properly linked
- **Solution:** Check that isActive flag is true

## Future Enhancements

1. **Additional Platforms**
   - Add support for Slack, Matrix, etc.
   - Extensible platform enum

2. **Enhanced Security**
   - Implement OAuth 2.0 for platform authentication
   - Add device fingerprinting
   - Implement IP-based restrictions

3. **User Experience**
   - QR code linking
   - One-click linking via dashboard
   - Bulk identity management

4. **Analytics**
   - Track linking conversion rates
   - Monitor authentication patterns
   - Generate usage reports

## Support

For issues or questions about the Bot Identity Linking System:
- Review audit logs for detailed error information
- Check backend logs for authentication failures
- Ensure database migration has been run
- Verify environment configuration
