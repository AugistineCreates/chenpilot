import crypto from "crypto";
import http from "http";

export interface GitHubRelease {
  tag_name: string;
  name: string;
  html_url: string;
  body?: string;
  prerelease: boolean;
  draft: boolean;
}

export interface ReleaseAnnouncer {
  announceRelease(
    channelOrChatId: string,
    release: GitHubRelease
  ): Promise<boolean>;
}

/**
 * #147: Creates a Node http.RequestListener that handles GitHub release webhooks.
 * Verifies the HMAC-SHA256 signature and calls registered announcers on publish.
 */
export function createReleaseWebhookHandler(
  announcers: { id: string; announcer: ReleaseAnnouncer }[],
  secret: string = process.env.GITHUB_WEBHOOK_SECRET || ""
): http.RequestListener {
  return (req, res) => {
    if (req.method !== "POST" || req.url !== "/github/release") {
      res.writeHead(404).end();
      return;
    }

    let body = "";
    req.on("data", (chunk: Buffer) => {
      body += chunk.toString();
    });
    req.on("end", () => {
      // Verify GitHub HMAC signature
      if (secret) {
        const sig = req.headers["x-hub-signature-256"] as string | undefined;
        if (!sig) {
          res
            .writeHead(401)
            .end(JSON.stringify({ error: "Missing signature" }));
          return;
        }
        const expected = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
        if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
          res
            .writeHead(401)
            .end(JSON.stringify({ error: "Invalid signature" }));
          return;
        }
      }

      const event = req.headers["x-github-event"];
      if (event !== "release") {
        res.writeHead(200).end(JSON.stringify({ ignored: true }));
        return;
      }

      let payload: { action: string; release: GitHubRelease };
      try {
        payload = JSON.parse(body);
      } catch {
        res.writeHead(400).end(JSON.stringify({ error: "Invalid JSON" }));
        return;
      }

      const { action, release } = payload;
      if (action !== "published" || release.draft || release.prerelease) {
        res.writeHead(200).end(JSON.stringify({ ignored: true }));
        return;
      }

      for (const { id, announcer } of announcers) {
        announcer
          .announceRelease(id, release)
          .catch((err) =>
            console.error(`Release announcement failed for ${id}:`, err)
          );
      }

      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(JSON.stringify({ announced: true, tag: release.tag_name }));
    });
  };
}
