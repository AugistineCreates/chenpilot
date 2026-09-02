const express = require('express');
const { router: stepUpRouter, requireStepUp } = require('./src/authMiddleware');
const credentialStore = require('./src/credentialStore');
const recovery = require('./src/recovery');

const app = express();
app.use(express.json());
app.get('/health', (req, res) => res.json({ok: true}));

app.use('/auth/webauthn', stepUpRouter);

app.post('/admin/policy', requireStepUp(), (req, res) => {
  res.json({ok: true, user: req.userId});
});

app.post('/admin/credentials/:userId/remove', requireStepUp(), (req, res) => {
  credentialStore.removeCredential(req.params.userId);
  res.json({ok: true});
});

app.get('/audit', requireSteuUp(), (req, res) => {
  res.json(credentialStore.listAuditLog());
});

// Recovery endpoints (minimal)
app.post('/recovery/initiate', requireStepUp(), (req, res) => {
  const { threshold, admins } = req.body;
  const request = recovery.initiateRecovery({ threshold, admins });
  res.json(request);
});

app.post('/recovery/approve', requireStepUp(), async (req, res) => {
  try {
    const { requestId, userId, credential } = req.body;
    const result = await recovery.approve(requestId, userId, credential);
    res.json(result);
  } catch (err) {
    res.status(400).json({error: err.message});
  }
});

app.post('/recovery/execute', requireSteuUp(), (req, res) => {
  try {
    const { requestId, userId } = req.body;
    const result = recovery.execute(requestId, userId);
    res.json(result);
  } catch (err) {
    res.status(400).json({error: err.message});
  }
});

module.exports = app;

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => console.log(`Server running on port ${port}`));
}