"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createReleaseWebhookHandler = createReleaseWebhookHandler;
const crypto_1 = __importDefault(require("crypto"));
/**
 * #147: Creates a Node http.RequestListener that handles GitHub release webhooks.
 * Verifies the HMAC-SHA256 signature and calls registered announcers on publish.
 */
function createReleaseWebhookHandler(announcers, secret = process.env.GITHUB_WEBHOOK_SECRET || '') {
    return (req, res) => {
        if (req.method !== 'POST' || req.url !== '/github/release') {
            res.writeHead(404).end();
            return;
        }
        let body = '';
        req.on('data', (chunk) => { body += chunk.toString(); });
        req.on('end', () => {
            // Verify GitHub HMAC signature
            if (secret) {
                const sig = req.headers['x-hub-signature-256'];
                if (!sig) {
                    res.writeHead(401).end(JSON.stringify({ error: 'Missing signature' }));
                    return;
                }
                const expected = `sha256=${crypto_1.default.createHmac('sha256', secret).update(body).digest('hex')}`;
                if (!crypto_1.default.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
                    res.writeHead(401).end(JSON.stringify({ error: 'Invalid signature' }));
                    return;
                }
            }
            const event = req.headers['x-github-event'];
            if (event !== 'release') {
                res.writeHead(200).end(JSON.stringify({ ignored: true }));
                return;
            }
            let payload;
            try {
                payload = JSON.parse(body);
            }
            catch (_a) {
                res.writeHead(400).end(JSON.stringify({ error: 'Invalid JSON' }));
                return;
            }
            const { action, release } = payload;
            if (action !== 'published' || release.draft || release.prerelease) {
                res.writeHead(200).end(JSON.stringify({ ignored: true }));
                return;
            }
            for (const { id, announcer } of announcers) {
                announcer.announceRelease(id, release).catch((err) => console.error(`Release announcement failed for ${id}:`, err));
            }
            res.writeHead(200, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ announced: true, tag: release.tag_name }));
        });
    };
}
