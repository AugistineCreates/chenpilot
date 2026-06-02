import { ValueObject, validateAssetCode } from '../common';

export type AssetType = 'native' | 'credit_alphanum4' | 'credit_alphanum12';

export interface AssetProps {
  code: string;
  issuer?: string;
  type: AssetType;
  name?: string;
  decimals: number;
  metadata?: Record<string, unknown>;
}

export class Asset extends ValueObject<AssetProps> {
  private constructor(props: AssetProps) {
    super(props);
  }

  static create(props: AssetProps): Asset {
    validateAssetCode(props.code);
    
    if (props.type !== 'native' && !props.issuer) {
      throw new Error('Issuer is required for non-native assets');
    }

    if (props.type === 'native' && props.code !== 'XLM') {
      throw new Error('Native asset code must be XLM');
    }

    return new Asset(props);
  }

  static native(): Asset {
    return Asset.create({
      code: 'XLM',
      type: 'native',
      decimals: 7,
      name: 'Stellar Lumens',
    });
  }

  get code(): string {
    return this._value.code;
  }

  get issuer(): string | undefined {
    return this._value.issuer;
  }

  get type(): AssetType {
    return this._value.type;
  }

  get name(): string | undefined {
    return this._value.name;
  }

  get decimals(): number {
    return this._value.decimals;
  }

  get metadata(): Record<string, unknown> | undefined {
    return this._value.metadata;
  }

  get canonicalId(): string {
    if (this.type === 'native') {
      return 'native:XLM';
    }
    return `${this.code}:${this.issuer}`;
  }

  toString(): string {
    if (this.type === 'native') {
      return 'XLM';
    }
    return `${this.code}-${this.issuer}`;
  }
}

export interface AssetBalance {
  asset: Asset;
  amount: string;
  buyingLiabilities: string;
  sellingLiabilities: string;
}
