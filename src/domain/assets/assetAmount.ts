import { ValueObject, validatePositive, validateNonNegative } from '../common';
import { Asset } from './asset';

export interface AssetAmountProps {
  asset: Asset;
  amount: string;
}

export class AssetAmount extends ValueObject<AssetAmountProps> {
  private constructor(props: AssetAmountProps) {
    super(props);
  }

  static create(asset: Asset, amount: string): AssetAmount {
    validateNonNegative(amount, 'amount');
    return new AssetAmount({ asset, amount });
  }

  static createPositive(asset: Asset, amount: string): AssetAmount {
    validatePositive(amount, 'amount');
    return new AssetAmount({ asset, amount });
  }

  get asset(): Asset {
    return this._value.asset;
  }

  get amount(): string {
    return this._value.amount;
  }

  add(other: AssetAmount): AssetAmount {
    if (!this.asset.equals(other.asset)) {
      throw new Error('Cannot add different assets');
    }
    const sum = (parseFloat(this.amount) + parseFloat(other.amount)).toString();
    return AssetAmount.create(this.asset, sum);
  }

  subtract(other: AssetAmount): AssetAmount {
    if (!this.asset.equals(other.asset)) {
      throw new Error('Cannot subtract different assets');
    }
    const diff = (parseFloat(this.amount) - parseFloat(other.amount)).toString();
    return AssetAmount.create(this.asset, diff);
  }

  isZero(): boolean {
    return parseFloat(this.amount) === 0;
  }

  isGreaterThan(other: AssetAmount): boolean {
    if (!this.asset.equals(other.asset)) {
      throw new Error('Cannot compare different assets');
    }
    return parseFloat(this.amount) > parseFloat(other.amount);
  }

  toString(): string {
    return `${this.amount} ${this.asset.code}`;
  }
}
