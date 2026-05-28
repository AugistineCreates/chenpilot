/**
 * Scam Link Detection Service
 * 
 * Detects and flags obvious scam links in Discord messages to protect users
 * from phishing, typosquatting, and other malicious URL patterns.
 */

export interface ScamDetectionResult {
  isScam: boolean;
  reason?: string;
  matchedPattern?: string;
}

export class ScamDetectionService {
  // Known suspicious TLDs often used for scams
  private readonly SUSPICIOUS_TLDS = [
    '.xyz', '.top', '.zip', '.mov', '.tk', '.ml', '.ga', '.cf', '.gq',
    '.pw', '.cc', '.men', '.date', '.loan', '.win', '.review', '.trade'
  ];

  // Common scam/ phishing keywords in URLs
  private readonly SCAM_KEYWORDS = [
    'free', 'bonus', 'giveaway', 'airdrop', 'claim', 'reward',
    'double', 'multiply', 'invest', 'profit', 'earn', 'crypto',
    'bitcoin', 'ethereum', 'stellar', 'xlm', 'wallet', 'connect',
    'verify', 'confirm', 'urgent', 'limited', 'exclusive', 'secret'
  ];

  // Known legitimate domains to whitelist
  private readonly WHITELISTED_DOMAINS = [
    'stellar.org', 'discord.com', 'discord.gg', 'github.com',
    'reddit.com', 'twitter.com', 'x.com', 'medium.com'
  ];

  // Typosquatting patterns for popular crypto sites
  private readonly TYPOSQUAT_PATTERNS = [
    { target: 'stellar.org', patterns: ['stellaar.org', 'stelllar.org', 'stelar.org', 'stellr.org', 'stllar.org', 'stellarr.org'] },
    { target: 'discord.com', patterns: ['d1scord.com', 'disc0rd.com', 'discrod.com', 'diiscord.com'] },
    { target: 'github.com', patterns: ['githuub.com', 'githhub.com', 'githab.com', 'gitthub.com'] },
  ];

  /**
   * Check if a message contains potential scam links
   */
  detectScamLinks(message: string): ScamDetectionResult {
    // Extract URLs from message
    const urls = this.extractUrls(message);
    
    if (urls.length === 0) {
      return { isScam: false };
    }

    for (const url of urls) {
      const result = this.checkUrl(url);
      if (result.isScam) {
        return result;
      }
    }

    return { isScam: false };
  }

  /**
   * Check a single URL for scam indicators
   */
  private checkUrl(url: string): ScamDetectionResult {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname.toLowerCase();

      // Check if domain is whitelisted
      if (this.isWhitelisted(domain)) {
        return { isScam: false };
      }

      // Check for suspicious TLD
      if (this.hasSuspiciousTLD(domain)) {
        return {
          isScam: true,
          reason: 'Suspicious top-level domain often used for scams',
          matchedPattern: domain
        };
      }

      // Check for typosquatting
      const typosquatResult = this.checkTyposquatting(domain);
      if (typosquatResult.isScam) {
        return typosquatResult;
      }

      // Check for scam keywords in URL path
      if (this.hasScamKeywords(url)) {
        return {
          isScam: true,
          reason: 'URL contains keywords commonly used in scam campaigns',
          matchedPattern: url
        };
      }

      // Check for suspicious URL patterns
      if (this.hasSuspiciousPatterns(url)) {
        return {
          isScam: true,
          reason: 'URL matches known scam patterns',
          matchedPattern: url
        };
      }

      // Check for IP address URLs (often used in phishing)
      if (this.isIpAddress(domain)) {
        return {
          isScam: true,
          reason: 'URL uses IP address instead of domain name',
          matchedPattern: domain
        };
      }

      return { isScam: false };
    } catch (error) {
      // Invalid URL, might be obfuscated
      return {
        isScam: true,
        reason: 'Invalid or obfuscated URL format',
        matchedPattern: url
      };
    }
  }

  /**
   * Extract URLs from text using regex
   */
  private extractUrls(text: string): string[] {
    const urlRegex = /(https?:\/\/[^\s<>"{}|\\^`\[\]]+)/gi;
    const matches = text.match(urlRegex);
    return matches || [];
  }

  /**
   * Check if domain is whitelisted
   */
  private isWhitelisted(domain: string): boolean {
    return this.WHITELISTED_DOMAINS.some(whitelisted => 
      domain === whitelisted || domain.endsWith(`.${whitelisted}`)
    );
  }

  /**
   * Check if domain has a suspicious TLD
   */
  private hasSuspiciousTLD(domain: string): boolean {
    return this.SUSPICIOUS_TLDS.some(tld => domain.endsWith(tld));
  }

  /**
   * Check for typosquatting patterns
   */
  private checkTyposquatting(domain: string): ScamDetectionResult {
    for (const { target, patterns } of this.TYPOSQUAT_PATTERNS) {
      for (const pattern of patterns) {
        if (domain === pattern || domain.endsWith(`.${pattern}`)) {
          return {
            isScam: true,
            reason: `Possible typosquatting attempt mimicking ${target}`,
            matchedPattern: domain
          };
        }
      }
    }
    return { isScam: false };
  }

  /**
   * Check if URL contains scam keywords
   */
  private hasScamKeywords(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    // Check if multiple scam keywords are present (more suspicious)
    const keywordCount = this.SCAM_KEYWORDS.filter(keyword => 
      lowerUrl.includes(keyword)
    ).length;
    
    return keywordCount >= 2; // Require at least 2 scam keywords
  }

  /**
   * Check for suspicious URL patterns
   */
  private hasSuspiciousPatterns(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    
    // Check for excessive subdomains
    const domain = new URL(url).hostname;
    const subdomainCount = domain.split('.').length - 2;
    if (subdomainCount > 3) {
      return true;
    }

    // Check for random-looking strings (common in scam URLs)
    const randomStringPattern = /[a-z0-9]{32,}/;
    if (randomStringPattern.test(lowerUrl)) {
      return true;
    }

    // Check for encoded characters (obfuscation)
    if (/%[0-9a-f]{2}/.test(lowerUrl)) {
      return true;
    }

    return false;
  }

  /**
   * Check if domain is an IP address
   */
  private isIpAddress(domain: string): boolean {
    const ipPattern = /^(\d{1,3}\.){3}\d{1,3}$/;
    return ipPattern.test(domain);
  }

  /**
   * Add a domain to the whitelist
   */
  addToWhitelist(domain: string): void {
    if (!this.WHITELISTED_DOMAINS.includes(domain)) {
      this.WHITELISTED_DOMAINS.push(domain);
    }
  }

  /**
   * Remove a domain from the whitelist
   */
  removeFromWhitelist(domain: string): void {
    const index = this.WHITELISTED_DOMAINS.indexOf(domain);
    if (index > -1) {
      this.WHITELISTED_DOMAINS.splice(index, 1);
    }
  }
}
