import { Asset, AssetAmount } from '../index';

describe('Domain Models', () => {
  describe('Asset', () => {
    it('should create a native asset', () => {
      const xlm = Asset.native();
      expect(xlm.code).toBe('XLM');
      expect(xlm.type).toBe('native');
    });

    it('should create a custom asset', () => {
      const usdc = Asset.create({
        code: 'USDC',
        issuer: 'GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN',
        type: 'credit_alphanum4',
        decimals: 7,
      });
      expect(usdc.code).toBe('USDC');
      expect(usdc.issuer).toBeDefined();
    });

    it('should throw on invalid asset code', () => {
      expect(() => {
        Asset.create({
          code: '',
          type: 'credit_alphanum4',
          decimals: 7,
        });
      }).toThrow();
    });
  });

  describe('AssetAmount', () => {
    it('should create a valid asset amount', () => {
      const xlm = Asset.native();
      const amount = AssetAmount.create(xlm, '100.5');
      expect(amount.amount).toBe('100.5');
      expect(amount.toString()).toBe('100.5 XLM');
    });

    it('should throw on negative amount', () => {
      const xlm = Asset.native();
      expect(() => {
        AssetAmount.create(xlm, '-10');
      }).toThrow();
    });

    it('should add amounts correctly', () => {
      const xlm = Asset.native();
      const amount1 = AssetAmount.create(xlm, '100');
      const amount2 = AssetAmount.create(xlm, '50');
      const sum = amount1.add(amount2);
      expect(parseFloat(sum.amount)).toBe(150);
    });
  });
});
