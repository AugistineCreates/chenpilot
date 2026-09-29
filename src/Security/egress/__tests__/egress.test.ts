import {
  EgressController,
  EgressError,
  checkAddress,
  isIpLiteral,
  parseDestination,
  checkDestinationPolicy,
  secureFetch,
} from "../index";
import { AdapterEgressConfig, HostResolver } from "../types";

/**
 * SSRF / egress regression tests for the default-deny egress layer.
 *
 * Covers the acceptance criteria:
 *  - loopback / link-local / private / metadata-service / mixed-encoding
 *    address denial
 *  - IPv4 and IPv6 (including IPv4-mapped IPv6)
 *  - DNS-rebinding defence-in-depth (resolved address re-validation)
 *  - redirect re-validation
 *  - per-adapter destination allowlists
 *  - request budgets (redirect depth + concurrency)
 */

/** An adapter manifest that allows only public FQDNs over HTTPS. */
const PUBLIC_FQDN_EGRESS: AdapterEgressConfig = {
  allowedHosts: ["*"],
  allowedProtocols: ["https:", "http:"],
  maxConcurrentRequests: 4,
};

/** Resolver that maps hostnames to the provided addresses. */
function resolverFor(
  map: Record<string, string[]>
): HostResolver {
  return {
    async lookup(hostname) {
      const addrs = map[hostname];
      if (!addrs) throw new Error(`NXDOMAIN ${hostname}`);
      return addrs.map((address) => ({
        address,
        family: address.includes(":") ? (6 as const) : (4 as const),
      }));
    },
  };
}

describe("ipGuard: address classification", () => {
  it.each([
    ["127.0.0.1", "loopback"],
    ["127.0.0.2", "loopback"],
    ["::1", "loopback"],
    ["169.254.169.254", "metadata-service"],
    ["169.254.1.1", "link-local"],
    ["fe80::1", "link-local"],
    ["10.0.0.1", "private"],
    ["172.16.0.1", "private"],
    ["192.168.1.1", "private"],
    ["fd00::1", "private"],
    ["224.0.0.1", "multicast"],
    ["ff02::1", "multicast"],
  ])("(IPv4/IPv6) denies %s as %s", (ip, reason) => {
    const safety = checkAddress(ip as string);
    expect(safety.denied).toBe(true);
    expect(safety.reason).toBe(reason);
  });

  it("denies IPv4-mapped IPv6 addresses by their underlying IPv4 range", () => {
    expect(checkAddress("::ffff:127.0.0.1").denied).toBe(true);
    expect(checkAddress("::ffff:192.168.1.5").denied).toBe(true);
    expect(checkAddress("::ffff:169.254.169.254").reason).toBe(
      "metadata-service"
    );
    expect(checkAddress("::ffff:8.8.8.8").denied).toBe(false);
  });

  it("allows public addresses", () => {
    expect(checkAddress("8.8.8.8").denied).toBe(false);
    expect(checkAddress("2606:4700::1111").denied).toBe(false);
  });

  it("recognizes IP literals vs hostnames", () => {
    expect(isIpLiteral("127.0.0.1")).toBe(true);
    expect(isIpLiteral("::1")).toBe(true);
    expect(isIpLiteral("2130706433")).toBe(true);
    expect(isIpLiteral("example.com")).toBe(false);
  });
});

describe("urlGuard: parseDestination normalizes mixed-encoding hosts", () => {
  it.each([
    ["http://2130706433/", "127.0.0.1"],
    ["http://0x7f000001/", "127.0.0.1"],
    ["http://0177.0.0.1/", "127.0.0.1"],
    ["http://127.1/", "127.0.0.1"],
  ])("(mixed/integer encoding) parses %s to %s", (url, hostname) => {
    const parsed = parseDestination(url as string);
    expect(parsed.hostname).toBe(hostname);
  });

  it("decodes percent-encoded host octets", () => {
    const parsed = parseDestination("http://%31%32%37.0.0.1/");
    expect(parsed.hostname).toBe("127.0.0.1");
  });

  it("denies schemes outside the allowlist", () => {
    expect(() => parseDestination("ftp://example.com/", ["https"])).toThrow(
      /scheme/
    );
    expect(() => parseDestination("file:///etc/passwd", ["https"])).toThrow(
      /scheme/
    );
  });

  it("denies URLs with embedded credentials", () => {
    expect(() => parseDestination("http://user:pass@example.com/")).toThrow(
      /credentials/
    );
  });
});

describe("destinationPolicy: per-adapter default-deny allowlist", () => {
  const adapter: AdapterEgressConfig = {
    allowedHosts: ["api.equilibre.io"],
    allowedProtocols: ["https:"],
  };

  it("allows a declared host over a declared protocol", () => {
    expect(
      checkDestinationPolicy("api.equilibre.io", "https:", adapter).ok
    ).toBe(true);
  });

  it("denies hosts not in the allowlist", () => {
    const r = checkDestinationPolicy("evil.com", "https:", adapter);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("host-not-allowed");
  });

  it("denies schemes not in the allowlist", () => {
    const r = checkDestinationPolicy("api.equilibre.io", "http:", adapter);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("scheme-not-allowed");
  });

  it("is default-deny when the adapter declares no egress manifest", () => {
    const r = checkDestinationPolicy(
      "example.com",
      "https:",
      { allowedHosts: [], allowedProtocols: [] }
    );
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("config-deny-all");
  });

  it("denies bare IP literals even when they are public (must use DNS names)", () => {
    const r = checkDestinationPolicy("8.8.8.8", "https:", {
      allowedHosts: ["8.8.8.8", "*"],
      allowedProtocols: ["https:"],
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("host-not-allowed");
  });

  it("supports *.suffix suffix matching", () => {
    const cfg: AdapterEgressConfig = {
      allowedHosts: ["*.stellar.org", "api.good.io"],
      allowedProtocols: ["https:"],
    };
    expect(checkDestinationPolicy("assets.stellar.org", "https:", cfg).ok).toBe(
      true
    );
    expect(checkDestinationPolicy("stellar.org", "https:", cfg).ok).toBe(true);
    expect(checkDestinationPolicy("api.good.io", "https:", cfg).ok).toBe(true);
    expect(checkDestinationPolicy("badstellar.org", "https:", cfg).ok).toBe(
      false
    );
  });
});

describe("secureFetch: literal-IP destinations are denied", () => {
  it.each([
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://169.254.169.254/latest/meta-data/",
    "http://10.0.0.1/",
    "http://192.168.1.1/",
    "http://2130706433/",
    "http://%31%32%37.0.0.1/",
  ])("denies literal-IP URL %s", async (url) => {
    await expect(
      secureFetch(url as string, {}, { egress: PUBLIC_FQDN_EGRESS })
    ).rejects.toThrow(EgressError);
  });
});

describe("secureFetch: resolved-address deny-list + DNS rebinding", () => {
  it("denies a hostname that resolves to a private address", async () => {
    const resolver = resolverFor({
      "internal.example.com": ["10.0.0.5"],
    });
    await expect(
      secureFetch(
        "https://internal.example.com/",
        {},
        { egress: PUBLIC_FQDN_EGRESS, resolver }
      )
    ).rejects.toMatchObject({ name: "EgressError", reason: "private" });
  });

  it("denies a hostname that resolves to a loopback address", async () => {
    const resolver = resolverFor({
      "localhost.evil.com": ["127.0.0.1"],
    });
    await expect(
      secureFetch(
        "https://localhost.evil.com/",
        {},
        { egress: PUBLIC_FQDN_EGRESS, resolver }
      )
    ).rejects.toMatchObject({ name: "EgressError", reason: "loopback" });
  });

  it("denies a hostname that resolves to the cloud metadata service (IPv6)", async () => {
    const resolver = resolverFor({
      "meta.example.com": ["fd00:ec2::254"],
    });
    await expect(
      secureFetch(
        "https://meta.example.com/",
        {},
        { egress: PUBLIC_FQDN_EGRESS, resolver }
      )
    ).rejects.toMatchObject({ name: "EgressError", reason: "metadata-service" });
  });

  it("DNS rebinding: re-resolves and denies if a later resolution is internal", async () => {
    // A rebinding scenario: the host resolves to a public address on the
    // first resolution, then resolves to an internal IPv6 address on a later
    // (redirect-hop) re-resolution. The egress layer re-validates every
    // resolved address on every request hop, so the rebound internal address
    // is denied rather than connected to.
    let call = 0;
    const rebinding: HostResolver = {
      async lookup() {
        call += 1;
        if (call === 1) {
          return [{ address: "2606:4700::1111", family: 6 }];
        }
        return [{ address: "fe80::1", family: 6 }];
      },
    };

    // Transport: issue a single 302 to the *same* hostname (path appended) so
    // the follow-up hop triggers a fresh, rebound DNS resolution.
    const transport = jest.fn(async (url: string) => {
      if (url === "https://victim.example.com/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://victim.example.com/target" },
        });
      }
      return new Response("ok", { status: 200 });
    });

    const controller = new EgressController();
    await expect(
      controller.secureFetch(
        "https://victim.example.com/start",
        {},
        {
          egress: PUBLIC_FQDN_EGRESS,
          resolver: rebinding,
          transport: transport as unknown as typeof fetch,
        }
      )
    ).rejects.toMatchObject({ name: "EgressError", reason: "link-local" });
    // The rebound resolution on the second hop is what got denied.
    expect(call).toBeGreaterThanOrEqual(2);
  });

  it("allows a public FQDN that resolves to a public address", async () => {
    const transport = jest.fn(async () => new Response("ok", { status: 200 }));
    const resolver = resolverFor({
      "api.equilibre.io": ["35.1.2.3"],
    });
    const res = await secureFetch(
      "https://api.equilibre.io/v1/prices",
      {},
      {
        egress: PUBLIC_FQDN_EGRESS,
        resolver,
        transport: transport as unknown as typeof fetch,
      }
    );
    expect(res.status).toBe(200);
    expect(transport).toHaveBeenCalledWith(
      "https://api.equilibre.io/v1/prices",
      expect.objectContaining({ redirect: "manual" })
    );
  });
});

describe("secureFetch: redirect re-validation", () => {
  it("denies a redirect to a non-allowed host", async () => {
    const transport = jest.fn(async (url: string) => {
      if (url === "https://api.good.io/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "https://evil.com/target" },
        });
      }
      return new Response("ok", { status: 200 });
    });
    const r302 = transport as unknown as (
      url: string,
      init: RequestInit
    ) => Promise<Response>;
    const egress: AdapterEgressConfig = {
      allowedHosts: ["api.good.io"],
      allowedProtocols: ["https:"],
    };
    await expect(
      secureFetch(
        "https://api.good.io/start",
        {},
        {
          egress,
          resolver: resolverFor({
            "api.good.io": ["1.2.3.4"],
            "evil.com": ["5.6.7.8"],
          }),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          transport: r302 as any,
        }
      )
    ).rejects.toMatchObject({ name: "EgressError", reason: "host-not-allowed" });
  });

  it("denies a redirect to an internal IP", async () => {
    const transport = jest.fn(async (url: string) => {
      if (url === "https://api.good.io/start") {
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      }
      return new Response("ok", { status: 200 });
    });
    const egress: AdapterEgressConfig = {
      allowedHosts: ["api.good.io"],
      allowedProtocols: ["https:", "http:"],
    };
    await expect(
      secureFetch(
        "https://api.good.io/start",
        {},
        {
          egress,
          resolver: resolverFor({ "api.good.io": ["1.2.3.4"] }),
          transport: transport as unknown as typeof fetch,
        }
      )
    ).rejects.toMatchObject({ name: "EgressError", reason: "metadata-service" });
  });

  it("denies a redirect chain that exceeds the max redirect budget", async () => {
    let hop = 0;
    const transport = jest.fn(async (url: string) => {
      hop += 1;
      return new Response(null, {
        status: 302,
        headers: { location: `https://api.good.io/loop/${hop}` },
      });
    });
    const egress: AdapterEgressConfig = {
      allowedHosts: ["api.good.io"],
      allowedProtocols: ["https:"],
    };
    await expect(
      secureFetch(
        "https://api.good.io/start",
        {},
        {
          egress,
          resolver: resolverFor({ "api.good.io": ["1.2.3.4"] }),
          transport: transport as unknown as typeof fetch,
          budget: { maxRedirects: 2, timeLimitMs: 10_000 },
        }
      )
    ).rejects.toMatchObject({ name: "EgressError", reason: "redirect-deep-limit" });
  });
});

describe("secureFetch: request budgets", () => {
  it("denies when the concurrency budget for the adapter is exceeded", async () => {
    const egress: AdapterEgressConfig = {
      allowedHosts: ["api.busy.io"],
      allowedProtocols: ["https:"],
      maxConcurrentRequests: 1,
    };
    const controller = new EgressController();
    const budgetKey = "adapter-busy";

    // Hold one outstanding request open via a never-resolving transport.
    const unresolved = new Promise<Response>(() => {
      /* never resolves */
    });
    const transport = jest.fn(async () => unresolved);

    const first = controller.secureFetch(
      "https://api.busy.io/1",
      {},
      { egress, budgetKey, transport: transport as unknown as typeof fetch }
    );

    await expect(
      controller.secureFetch(
        "https://api.busy.io/2",
        {},
        { egress, budgetKey, transport: transport as unknown as typeof fetch }
      )
    ).rejects.toMatchObject({ name: "EgressError", reason: "budget-exceeded" });

    // Release the held slot so the test does not leak.
    controller.budgetFor(budgetKey).release(budgetKey);
    await expect(first).rejects.toThrow();
  });
});

describe("sep1-style: all-FQDN egress still blocks internal targets", () => {
  it("allows any public FQDN but blocks one resolving to metadata", async () => {
    const transport = jest.fn(async () => new Response("ok", { status: 200 }));
    const resolver = resolverFor({
      "example.com": ["93.184.216.34"],
      "meta.stuff.com": ["169.254.169.254"],
    });
    const res = await secureFetch(
      "https://example.com/.well-known/stellar.toml",
      {},
      {
        egress: PUBLIC_FQDN_EGRESS,
        resolver,
        transport: transport as unknown as typeof fetch,
      }
    );
    expect(res.status).toBe(200);
    await expect(
      secureFetch(
        "https://meta.stuff.com/latest/meta-data/",
        {},
        { egress: PUBLIC_FQDN_EGRESS, resolver }
      )
    ).rejects.toMatchObject({ reason: "metadata-service" });
  });
});
