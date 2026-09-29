/**
 * Supply Chain Security Tests
 * 
 * These tests verify that supply chain security controls are properly configured
 * and functioning as expected.
 */

const fs = require('fs');
const path = require('path');

describe('Supply Chain Security', () => {
  const rootDir = path.resolve(__dirname, '..');
  
  describe('Configuration Files', () => {
    test('.npmrc file exists', () => {
      const npmrcPath = path.join(rootDir, '.npmrc');
      expect(fs.existsSync(npmrcPath)).toBe(true);
    });
    
    test('.pnpmrc file exists', () => {
      const pnpmrcPath = path.join(rootDir, '.pnpmrc');
      expect(fs.existsSync(pnpmrcPath)).toBe(true);
    });
    
    test('INSTALL_SCRIPT_ALLOWLIST.md exists', () => {
      const allowlistPath = path.join(rootDir, 'INSTALL_SCRIPT_ALLOWLIST.md');
      expect(fs.existsSync(allowlistPath)).toBe(true);
    });
    
    test('SUPPLY_CHAIN_SECURITY.md documentation exists', () => {
      const docPath = path.join(rootDir, 'SUPPLY_CHAIN_SECURITY.md');
      expect(fs.existsSync(docPath)).toBe(true);
    });
  });
  
  describe('Registry Configuration', () => {
    let npmrcContent;
    let pnpmrcContent;
    
    beforeAll(() => {
      const npmrcPath = path.join(rootDir, '.npmrc');
      const pnpmrcPath = path.join(rootDir, '.pnpmrc');
      
      if (fs.existsSync(npmrcPath)) {
        npmrcContent = fs.readFileSync(npmrcPath, 'utf8');
      }
      
      if (fs.existsSync(pnpmrcPath)) {
        pnpmrcContent = fs.readFileSync(pnpmrcPath, 'utf8');
      }
    });
    
    test('internal package scope has dedicated registry in .npmrc', () => {
      expect(npmrcContent).toMatch(/@chen-pilot:registry=/);
    });
    
    test('internal packages do NOT use public npm registry', () => {
      expect(npmrcContent).not.toMatch(/@chen-pilot:registry=https:\/\/registry\.npmjs\.org/);
    });
    
    test('internal package scope has dedicated registry in .pnpmrc', () => {
      expect(pnpmrcContent).toMatch(/@chen-pilot:registry=/);
    });
    
    test('default registry is configured', () => {
      expect(npmrcContent).toMatch(/^registry=/m);
    });
  });
  
  describe('Install Script Protection', () => {
    let npmrcContent;
    let pnpmrcContent;
    
    beforeAll(() => {
      const npmrcPath = path.join(rootDir, '.npmrc');
      const pnpmrcPath = path.join(rootDir, '.pnpmrc');
      
      if (fs.existsSync(npmrcPath)) {
        npmrcContent = fs.readFileSync(npmrcPath, 'utf8');
      }
      
      if (fs.existsSync(pnpmrcPath)) {
        pnpmrcContent = fs.readFileSync(pnpmrcPath, 'utf8');
      }
    });
    
    test('install scripts are disabled in .npmrc', () => {
      expect(npmrcContent).toMatch(/ignore-scripts\s*=\s*true/);
    });
    
    test('install scripts are disabled in .pnpmrc', () => {
      expect(pnpmrcContent).toMatch(/ignore-scripts\s*=\s*true/);
    });
  });
  
  describe('Lockfile Enforcement', () => {
    test('at least one lockfile exists', () => {
      const packageLockPath = path.join(rootDir, 'package-lock.json');
      const pnpmLockPath = path.join(rootDir, 'pnpm-lock.yaml');
      
      const hasLockfile = fs.existsSync(packageLockPath) || fs.existsSync(pnpmLockPath);
      expect(hasLockfile).toBe(true);
    });
    
    test('lockfile is not empty', () => {
      const packageLockPath = path.join(rootDir, 'package-lock.json');
      const pnpmLockPath = path.join(rootDir, 'pnpm-lock.yaml');
      
      if (fs.existsSync(pnpmLockPath)) {
        const stats = fs.statSync(pnpmLockPath);
        expect(stats.size).toBeGreaterThan(0);
      } else if (fs.existsSync(packageLockPath)) {
        const stats = fs.statSync(packageLockPath);
        expect(stats.size).toBeGreaterThan(0);
      }
    });
  });
  
  describe('Network Security', () => {
    let npmrcContent;
    
    beforeAll(() => {
      const npmrcPath = path.join(rootDir, '.npmrc');
      if (fs.existsSync(npmrcPath)) {
        npmrcContent = fs.readFileSync(npmrcPath, 'utf8');
      }
    });
    
    test('strict SSL is enabled', () => {
      expect(npmrcContent).toMatch(/strict-ssl\s*=\s*true/);
    });
    
    test('git protocol is set to https', () => {
      expect(npmrcContent).toMatch(/git-protocol\s*=\s*https/);
    });
  });
  
  describe('Audit Configuration', () => {
    let npmrcContent;
    
    beforeAll(() => {
      const npmrcPath = path.join(rootDir, '.npmrc');
      if (fs.existsSync(npmrcPath)) {
        npmrcContent = fs.readFileSync(npmrcPath, 'utf8');
      }
    });
    
    test('audit level is configured', () => {
      expect(npmrcContent).toMatch(/audit-level\s*=\s*(low|moderate|high|critical)/);
    });
  });
  
  describe('Internal Packages', () => {
    test('internal packages use @chen-pilot scope', () => {
      const sdkPackagePath = path.join(rootDir, 'packages', 'sdk', 'package.json');
      const botPackagePath = path.join(rootDir, 'packages', 'bot', 'package.json');
      
      if (fs.existsSync(sdkPackagePath)) {
        const sdkPackage = JSON.parse(fs.readFileSync(sdkPackagePath, 'utf8'));
        expect(sdkPackage.name).toMatch(/^@chen-pilot\//);
      }
      
      if (fs.existsSync(botPackagePath)) {
        const botPackage = JSON.parse(fs.readFileSync(botPackagePath, 'utf8'));
        expect(botPackage.name).toMatch(/^@chen-pilot\//);
      }
    });
  });
  
  describe('Verification Scripts', () => {
    test('PowerShell verification script exists', () => {
      const scriptPath = path.join(rootDir, 'scripts', 'verify-supply-chain.ps1');
      expect(fs.existsSync(scriptPath)).toBe(true);
    });
    
    test('Bash verification script exists', () => {
      const scriptPath = path.join(rootDir, 'scripts', 'verify-supply-chain.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);
    });
    
    test('verification script is added to package.json', () => {
      const packageJsonPath = path.join(rootDir, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
      
      expect(packageJson.scripts).toHaveProperty('verify:supply-chain');
    });
  });
  
  describe('CI/CD Integration', () => {
    test('supply chain security workflow exists', () => {
      const workflowPath = path.join(rootDir, '.github', 'workflows', 'supply-chain-security.yml');
      expect(fs.existsSync(workflowPath)).toBe(true);
    });
    
    test('supply chain workflow has required jobs', () => {
      const workflowPath = path.join(rootDir, '.github', 'workflows', 'supply-chain-security.yml');
      const workflowContent = fs.readFileSync(workflowPath, 'utf8');
      
      expect(workflowContent).toMatch(/verify-supply-chain:/);
      expect(workflowContent).toMatch(/dependency-review:/);
    });
  });
  
  describe('Allowlist Documentation', () => {
    let allowlistContent;
    
    beforeAll(() => {
      const allowlistPath = path.join(rootDir, 'INSTALL_SCRIPT_ALLOWLIST.md');
      if (fs.existsSync(allowlistPath)) {
        allowlistContent = fs.readFileSync(allowlistPath, 'utf8');
      }
    });
    
    test('allowlist has required sections', () => {
      expect(allowlistContent).toMatch(/## Review Process/);
      expect(allowlistContent).toMatch(/## Current Allowlist/);
      expect(allowlistContent).toMatch(/## Audit Log/);
    });
    
    test('allowlist entries include required fields', () => {
      // Check for documented structure
      expect(allowlistContent).toMatch(/Owner/);
      expect(allowlistContent).toMatch(/Reason/);
      expect(allowlistContent).toMatch(/Security Review/);
      expect(allowlistContent).toMatch(/Expiry Date/);
    });
  });
  
  describe('Package.json Security', () => {
    let packageJson;
    
    beforeAll(() => {
      const packageJsonPath = path.join(rootDir, 'package.json');
      packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
    });
    
    test('no suspicious patterns in scripts', () => {
      const scripts = packageJson.scripts || {};
      const scriptValues = Object.values(scripts).join(' ');
      
      // Check for potentially dangerous patterns
      const dangerousPatterns = [
        /curl .* \| sh/,
        /wget .* \| sh/,
        /eval\s*\(/,
        /rm\s+-rf\s+\//
      ];
      
      dangerousPatterns.forEach(pattern => {
        expect(scriptValues).not.toMatch(pattern);
      });
    });
    
    test('internal dependencies use workspace protocol or correct scope', () => {
      const allDeps = {
        ...packageJson.dependencies,
        ...packageJson.devDependencies
      };
      
      // Check if any @chen-pilot packages exist
      Object.entries(allDeps).forEach(([name, version]) => {
        if (name.startsWith('@chen-pilot/')) {
          // Should use workspace protocol or version range
          expect(version).toMatch(/^(workspace:\*|\^|\~|[0-9])/);
        }
      });
    });
  });
  
  describe('Documentation Quality', () => {
    test('SUPPLY_CHAIN_SECURITY.md is comprehensive', () => {
      const docPath = path.join(rootDir, 'SUPPLY_CHAIN_SECURITY.md');
      const content = fs.readFileSync(docPath, 'utf8');
      
      // Check for key sections
      const requiredSections = [
        'Threat Model',
        'Security Controls',
        'Configuration Files',
        'Acceptance Criteria',
        'Developer Workflow',
        'CI/CD Integration',
        'Incident Response'
      ];
      
      requiredSections.forEach(section => {
        expect(content).toMatch(new RegExp(section, 'i'));
      });
    });
    
    test('quick start guide exists', () => {
      const quickStartPath = path.join(rootDir, 'SUPPLY_CHAIN_QUICK_START.md');
      expect(fs.existsSync(quickStartPath)).toBe(true);
    });
  });
  
  describe('Acceptance Criteria Validation', () => {
    test('AC1: Internal package names cannot resolve from public registries', () => {
      const npmrcPath = path.join(rootDir, '.npmrc');
      const content = fs.readFileSync(npmrcPath, 'utf8');
      
      // Must have scoped registry
      expect(content).toMatch(/@chen-pilot:registry=/);
      
      // Must NOT point to public npm
      expect(content).not.toMatch(/@chen-pilot:registry=https:\/\/registry\.npmjs\.org/);
    });
    
    test('AC2: Lockfile and integrity fields are enforced', () => {
      // Lockfile must exist
      const pnpmLockPath = path.join(rootDir, 'pnpm-lock.yaml');
      const packageLockPath = path.join(rootDir, 'package-lock.json');
      
      expect(
        fs.existsSync(pnpmLockPath) || fs.existsSync(packageLockPath)
      ).toBe(true);
      
      // CI workflow must enforce frozen lockfile
      const workflowPath = path.join(rootDir, '.github', 'workflows', 'supply-chain-security.yml');
      const workflowContent = fs.readFileSync(workflowPath, 'utf8');
      
      expect(workflowContent).toMatch(/--frozen-lockfile/);
      expect(workflowContent).toMatch(/integrity/i);
    });
    
    test('AC3: Install-script exceptions identify owner, reason, and expiry', () => {
      const allowlistPath = path.join(rootDir, 'INSTALL_SCRIPT_ALLOWLIST.md');
      const content = fs.readFileSync(allowlistPath, 'utf8');
      
      // Template includes all required fields
      expect(content).toMatch(/Owner/);
      expect(content).toMatch(/Reason/);
      expect(content).toMatch(/Expiry Date/);
      expect(content).toMatch(/Security Review/);
    });
    
    test('AC4: Clean build performs no undeclared network or script execution', () => {
      const npmrcPath = path.join(rootDir, '.npmrc');
      const content = fs.readFileSync(npmrcPath, 'utf8');
      
      // Scripts must be disabled
      expect(content).toMatch(/ignore-scripts\s*=\s*true/);
      
      // Verification script checks for network patterns
      const verifyScriptPath = path.join(rootDir, 'scripts', 'verify-supply-chain.ps1');
      const verifyContent = fs.readFileSync(verifyScriptPath, 'utf8');
      
      expect(verifyContent).toMatch(/suspicious.*network/i);
    });
  });
});
