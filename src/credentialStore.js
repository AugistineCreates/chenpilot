class CredentialStore {
  constructor() {
    this.credentials = new Map();
    this.challenges = new Map();
    this.auditLog = [];
  }

  reset() {
    this.credentials.clear();
    this.challenges.clear();
    this.auditLog = [];
  }

  getCredentialByUserId(userId) {
    return this.credentials.get(userId) || null;
  }

  addCredential(userId, credential) {
    this.credentials.set(userId, credential);
  }

  removeCredential(userId) {
    const cred = this.credentials.get(userId);
    if (cred) {
      this.audit('remove', { userId, credentialId: cred.id });
    }
    this.credentials.delete(userId);
  }

  setChallenge(userId, challenge, purpose) {
    const key = `${userId}:${purpose}`;
    this.challenges.set(key, { challenge, expiresAt: Date.now() + 5 * 60 * 1000 });
  }

  getChallenge(userId, purpose) {
    const key = `${userId}:${purpose}`;
    const entry = this.challenges.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.challenges.delete(key);
      return null;
    }
    this.challenges.delete(key); // single-use
    return entry.challenge;
  }

  deleteChallenge(userId, purpose) {
    const key = `${userId}:${purpose}`;
    this.challenges.delete(key);
  }

  audit(action, data) {
    this.auditLog.push({ action, data, timestamp: new Date().toISOString() });
  }

  listAuditLog() {
    return this.auditLog;
  }

  getAllUsers() {
    return Array.from(this.credentials.keys());
  }
}

module.exports = new CredentialStore();