const {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
} = require('@simplewebauthn/server');

const credentialStore = require('./credentialStore');

const rpID = process.env.WEBAUTHN_RP_ID || 'localhost';
const rpName = process.env.WEBAUTHN_RP_NAME || 'Chen Pilot';
const expectedOrigin = process.env.WEBAUTHN_ORIGIN || 'http://localhost:3000';

function generateRegistrationOptionsForUser(user) {
  const options = generateRegistrationOptions({
    rpName,
    rpID, userID: user.id,
    userName: user.username,
    timeout: 60000,
    attestationType: 'none',
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'required',
    },
  });
  credentialStore.setChallenge(user.id, options.challenge, 'registration');
  return options;
}

async function verifyRegistration(credential, userId, username) {
  const challenge = credentialStore.getChallenge(userId, 'registration');
  if (!challenge) throw new Error('Registration challenge not found or expired');
  const verification = await verifyRegistrationResponse({
    response: credential,
    expectedChallenge: challenge,
    expectedOrigin,
    expectedRPID: rpID,
  });
  if (!verification.verified) throw new Error('Registration verification failed');
  credentialStore.addCredential(userId, {
    id: credential.id,
    publicKey: verification.registrationInfo.credentialPublicKey,
    counter: verification.registrationInfo.counter,
    username,
  });
  credentialStore.deleteChallenge(userId, 'registration');
  credentialStore.audit('register', { userId, credentialId: credential.id });
  return verification;
}

function generateAuthenticationOptionsForUser(userId) {
  const userCredential = credentialStore.getCredentialByUserId(userId);
  if (!userCredential) throw new Error('No credentials found for user');
  const options = generateAuthenticationOptions({
    rpID,
    timeout: 60000,
    allowCredentials: [{ id: userCredential.id, type: 'public-key' }],
    userVerification: 'required',
  });
  credentialStore.setChallenge(userId, options.challenge, 'authentication');
  return options;
}

async function verifyAuthentication(credential, userId) {
  const storedChallenge = credentialStore.getChallenge(userId, 'authentication');
  if (!storedChallenge) throw new Error('Authentication challenge not found or expired');
  const userCredential = credentialStore.getCredentialByUserId(userId);
  if (!userCredential) throw new Error('No credentials found for user');
  const verification = await verifyAuthenticationResponse({
    response: credential,
    expectedChallenge: storedChallenge,
    expectedOrigin,
    expectedRPID: rpID,
    credential: {
      id: userCredential.id,
      publicKey: userCredential.publicKey,
      counter: userCredential.counter,
    },
  });
  if (!verification.verified) throw new Error('Authentication verification failed');
  if (verification.authenticationInfo.counter !== 0) {
    userCredential.counter = verification.authenticationInfo.counter;
  }
  credentialStore.deleteChallenge(userId, 'authentication');
  credentialStore.audit('authenticate', { userId, credentialId: credential.id });
  return verification;
}

module.exports = {
  generateRegistrationOptionsForUser,
  verifyRegistration,
  generateAuthenticationOptionsForUser,
  verifyAuthentication,
  rpID,
  expectedOrigin,
};