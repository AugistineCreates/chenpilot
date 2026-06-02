import { Asset, AssetAmount } from '../assets';
import { BaseEntity, Timestamp, UUID } from '../common';

export interface BalanceProps {
  accountId: UUID;
  asset: Asset;
  amount: string;
  buyingLiabilities: string;
  sellingLiabilities: string;
  lastUpdated: Timestamp;
}

export class Balance implements BaseEntity {
  constructor(
    public readonly id: UUID,
    public readonly accountId: UUID,
    public readonly asset: Asset,
    public readonly amount: string,
    public readonly buyingLiabilities: string,
    public readonly sellingLiabilities: string,
    public readonly lastUpdated: Timestamp,
    public readonly createdAt: Timestamp,
    public readonly updatedAt: Timestamp,
    public readonly version: number
  ) {}

  get availableBalance(): string {
    const amount = parseFloat(this.amount);
    const buying = parseFloat(this.buyingLiabilities);
    const selling = parseFloat(this.sellingLiabilities);
    return (amount - buying - selling).toString();
  }

  getAssetAmount(): AssetAmount {
    return AssetAmount.create(this.asset, this.amount);
  }

  getAvailableAssetAmount(): AssetAmount {
    return AssetAmount.create(this.asset, this.availableBalance);
  }

  canCover(amount: AssetAmount): boolean {
    if (!this.asset.equals(amount.asset)) {
      return false;
    }
    return parseFloat(this.availableBalance) >= parseFloat(amount.amount);
  }
}

export interface BalanceMap {
  [assetId: string]: Balance;
}

export class BalanceSnapshot {
  constructor(
    public readonly balances: BalanceMap,
    public readonly timestamp: Timestamp,
    public readonly blockNumber: number
  ) {}

  getBalanceForAsset(asset: Asset): Balance | undefined {
    return this.balances[asset.canonicalId];
  }

  getTotalValueInNative(priceMap: Map<string, string>): string {
    let total = 0;
    for (const balance of Object.values(this.balances)) {
      const price = priceMap.get(balance.asset.canonicalId);
      if (price) {
        total += parseFloat(balance.amount) * parseFloat(price);
      }
    }
    return total.toString();
  }
}
