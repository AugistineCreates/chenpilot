import { Asset, AssetAmount } from '../assets';
import { BaseEntity, UUID } from '../common';

export interface PathNode {
  asset: Asset;
  amount: string;
  price: string;
}

export interface PathEdge {
  from: Asset;
  to: Asset;
  price: string;
  liquidity: string;
  exchangeId: string;
}

export interface PathProps {
  id: UUID;
  sourceAmount: AssetAmount;
  destinationAmount: AssetAmount;
  nodes: PathNode[];
  edges: PathEdge[];
  totalFee: string;
  estimatedTime: number; // milliseconds
}

export class Path implements BaseEntity {
  constructor(
    public readonly id: UUID,
    public readonly sourceAmount: AssetAmount,
    public readonly destinationAmount: AssetAmount,
    public readonly nodes: PathNode[],
    public readonly edges: PathEdge[],
    public readonly totalFee: string,
    public readonly estimatedTime: number,
    public readonly createdAt: string,
    public readonly updatedAt: string,
    public readonly version: number
  ) {}

  getHopCount(): number {
    return this.nodes.length;
  }

  getPriceImpact(): string {
    if (this.nodes.length === 0) return '0';
    const firstPrice = parseFloat(this.nodes[0].price);
    const lastPrice = parseFloat(this.nodes[this.nodes.length - 1].price);
    return ((lastPrice - firstPrice) / firstPrice * 100).toString();
  }

  toString(): string {
    const pathString = this.nodes.map(node => node.asset.code).join(' → ');
    return `${pathString}: ${this.sourceAmount.amount} → ${this.destinationAmount.amount}`;
  }
}

export interface PathRequest {
  sourceAsset: Asset;
  destinationAsset: Asset;
  amount: string;
  maxHops?: number;
  preferLiquidity?: boolean;
}
