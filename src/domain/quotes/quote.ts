import { Asset, AssetAmount } from '../assets';
import { BaseEntity, Timestamp, UUID } from '../common';

export type QuoteType = 'buy' | 'sell';
export type QuoteStatus = 'pending' | 'accepted' | 'expired' | 'rejected';

export interface QuoteProps {
  id: UUID;
  type: QuoteType;
  sourceAsset: Asset;
  destinationAsset: Asset;
  sourceAmount: string;
  destinationAmount: string;
  price: string; // destination/source ratio
  fee: string;
  slippage: string;
  expirationTime: Timestamp;
  status: QuoteStatus;
  createdAt: Timestamp;
}

export class Quote implements BaseEntity {
  constructor(
    public readonly id: UUID,
    public readonly type: QuoteType,
    public readonly sourceAsset: Asset,
    public readonly destinationAsset: Asset,
    public readonly sourceAmount: string,
    public readonly destinationAmount: string,
    public readonly price: string,
    public readonly fee: string,
    public readonly slippage: string,
    public readonly expirationTime: Timestamp,
    public readonly status: QuoteStatus,
    public readonly createdAt: Timestamp,
    public readonly updatedAt: Timestamp,
    public readonly version: number
  ) {}

  getSourceAmountObject(): AssetAmount {
    return AssetAmount.create(this.sourceAsset, this.sourceAmount);
  }

  getDestinationAmountObject(): AssetAmount {
    return AssetAmount.create(this.destinationAsset, this.destinationAmount);
  }

  isExpired(): boolean {
    return new Date(this.expirationTime) < new Date();
  }

  accept(): Quote {
    if (this.status !== 'pending') {
      throw new Error(`Cannot accept quote with status ${this.status}`);
    }
    if (this.isExpired()) {
      throw new Error('Cannot accept expired quote');
    }
    return new Quote(
      this.id,
      this.type,
      this.sourceAsset,
      this.destinationAsset,
      this.sourceAmount,
      this.destinationAmount,
      this.price,
      this.fee,
      this.slippage,
      this.expirationTime,
      'accepted',
      this.createdAt,
      new Date().toISOString(),
      this.version + 1
    );
  }

  reject(): Quote {
    return new Quote(
      this.id,
      this.type,
      this.sourceAsset,
      this.destinationAsset,
      this.sourceAmount,
      this.destinationAmount,
      this.price,
      this.fee,
      this.slippage,
      this.expirationTime,
      'rejected',
      this.createdAt,
      new Date().toISOString(),
      this.version + 1
    );
  }
}

export interface QuoteRequest {
  sourceAsset: Asset;
  destinationAsset: Asset;
  sourceAmount?: string;
  destinationAmount?: string;
  slippageTolerance?: string;
}
