const express = require('express');
const jwt = require('jsonwebtoken');
const webauthn = require('./webauthn'');
const credentialStore = require('./credentialStore');

const router = express.Router();
const jwtSecret = process.env.JWT_ACCESS_SECRET || 'test-secret-change-me';

function ensureAuthenticated(req, res, next) {
  const userId = req.query.userId || req.body.userId || req.headers['x-user-id'];
  if (!userId) return res.status(401).json({error: 'Missing userId'});
  req.userId = userId.toString();
  next();
}

router.post('/register/options', ensureAuthenticated, (req, res) => {
  try {
    const options = webauthn.generateRegistrationOptionsForUser({
      id: req.userId,
      username: req.body.username || req.userId,
    });
    res.json(options);
  } catch (err) {
    res.status(400).json({error: err.message});
  }
});

router.post('/register/verify', ensureAuthenticated, async (req, res) => {
  try {
    await webauthn.verifyRegistration(req.body.credential, req.userId, req.body.username || req.userId);
    res.json({ok: true});
  } catch (err) {
    res.status(400).json({error: err.message});
  }
});

router.post('/authenticate/options', ensureAuthenticated, (req, res) => {
  try {
    const options = webauthn.generateAuthenticationOptionsForUser(req.userId);
    res.json(options);
  } catch (err) {
    res.status(400).json({error: err.message});
  }
});

router.post('/authenticate/verify', ensureAuthenticated, async (req, res) => {
  try {
    await webauthn.verifyAuthentication(req.body.credential, req.userId);
    const token = jwt.sign({ sub: req.userId, stepUp: true }, jwtSecret, { expiresIn: '15m' });
    res.json({ ok: true, stepUpToken: token });
  } catch (err) {
    res.status(401).json({error: err.message});
  }
});

function requireStepUp(options = {}) {
  const { ttl = 15 * 60 * 1000 } = options;
  return (req, res, next) => {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) {
      return res.status(401).set('WW-Authenticate', 'WebAuthn').set('X-Step-Up-Required', 'true').json({error: 'Step-up authentication required'});
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      const age = Date.now() - payload.iat * 1000;
      if (payload.stepUp !== true || age > ttl) throw new Error('Step-up expired');
      req.userId = payload.sub;
      next();
    } catch (err) {
      return res.status(401).set('WW-Authenticate', 'WebAuthn').set('X-Step-up-Required', 'true').json({error: 'Step-up authentication required'});
    }
  };
}

module.exports = { router, requireStepUp };