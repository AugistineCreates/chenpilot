const credentialStore = require('./credentialStore');
const webauthn = require('./webauthn');

class RecoveryManager {
  constructor() {
    this.requests = new Map();
    this.requestCounter = 0;
  }

  reset() {
    this.requests = new Map();
    this.requestCounter = 0;
  }

  initiateRecovery(policy) {
    this.requestCounter += 1;
    const request = {
      id: String(this.requestCounter),
      policy,
      approvals: new Map(),
      status: 'pending',
    };
    this.requests.set(request.id, request);
    return request;
  }

  async approve(requestId, userId, credential) {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'pending') {
      throw new Error('Recovery request not found or not pending');
    }
    if (!request.policy.admins.includes(userId)) {
      throw new Error('User is not an approved recovery admin');
    }
    if (request.approvals.has(userId)) {
      throw new Error('Admin already approved');
    }
    await webauthn.verifyAuthentication(credential, userId);
    request.approvals.set(userId, { timestamp: new Date().toISOString() });
    if (request.approvals.size >= request.policy.threshold) {
      request.status = 'approved';
    }
    return request;
  }

  execute(requestId, executorUserId) {
    const request = this.requests.get(requestId);
    if (!request || request.status !== 'approved') {
      throw new Error('Recovery is not approved');
    }
    if (!request.policy.admins.includes(executorUserId)) {
      throw new Error('Executor is not an admin');
    }
    request.status = 'executed';
    credentialStore.audit('recovery-execute', { requestId, executorUserId });
    return request;
  }
}

module.exports = new RecoveryManager();