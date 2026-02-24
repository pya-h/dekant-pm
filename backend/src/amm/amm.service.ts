import { Injectable, NotFoundException } from '@nestjs/common';
import { MarketService } from '../market/market.service';
import { computeBinWeights } from './util/normal';

const SCALE = 1_000_000_000;

export interface EstimateBuyResult {
  tokensOut: number;
  fee: number;
  newProbabilities: number[];
}

export interface EstimateSellResult {
  collateralOut: number;
  fee: number;
  newProbabilities: number[];
}

export interface EstimateDistributionBuyResult {
  tokensPerBin: number[];
  fee: number;
  newProbabilities: number[];
}

@Injectable()
export class AmmService {
  constructor(private readonly marketService: MarketService) {}

  async estimateBuy(
    marketId: number,
    outcome: number,
    collateralAmount: number,
    tradeFeesBps = 30,
  ): Promise<EstimateBuyResult> {
    const market = await this.marketService.findById(marketId);
    const reserves = market.reserves.map(Number);
    const totalMinted = Number(market.totalMinted);

    const fee = Math.floor((collateralAmount * tradeFeesBps) / 10000);
    const effectiveCollateral = collateralAmount - fee;

    const tokensOut = this.computeBuy(
      [...reserves],
      totalMinted,
      outcome,
      effectiveCollateral,
    );

    const newReserves = [...reserves];
    for (let i = 0; i < newReserves.length; i++) {
      newReserves[i] += effectiveCollateral;
    }
    const kNew = totalMinted + effectiveCollateral;
    const sumOthersXSq = newReserves.reduce((sum, r, i) => {
      if (i === outcome) return sum;
      const x = kNew - r;
      return sum + x * x;
    }, 0);
    const xNewI = Math.sqrt(kNew * kNew - sumOthersXSq);
    newReserves[outcome] = kNew - xNewI;

    const newProbabilities = this.computeProbabilities(newReserves, kNew);

    return { tokensOut, fee, newProbabilities };
  }

  async estimateSell(
    marketId: number,
    outcome: number,
    tokenAmount: number,
    tradeFeesBps = 30,
  ): Promise<EstimateSellResult> {
    const market = await this.marketService.findById(marketId);
    const reserves = market.reserves.map(Number);
    const totalMinted = Number(market.totalMinted);

    const grossCollateral = this.computeSell(
      [...reserves],
      totalMinted,
      outcome,
      tokenAmount,
    );

    const fee = Math.floor((grossCollateral * tradeFeesBps) / 10000);
    const collateralOut = grossCollateral - fee;

    const newReserves = [...reserves];
    newReserves[outcome] += tokenAmount;
    let kNewSq = 0;
    for (const r of newReserves) {
      const x = totalMinted - r;
      kNewSq += x * x;
    }
    const kNew = Math.sqrt(kNewSq);
    const collateralBurn = totalMinted - kNew;
    for (let i = 0; i < newReserves.length; i++) {
      newReserves[i] -= collateralBurn;
    }

    const newProbabilities = this.computeProbabilities(newReserves, kNew);

    return { collateralOut, fee, newProbabilities };
  }

  async estimateDistributionBuy(
    marketId: number,
    mu: number,
    sigma: number,
    collateralAmount: number,
    tradeFeesBps = 30,
  ): Promise<EstimateDistributionBuyResult> {
    const market = await this.marketService.findById(marketId);
    const reserves = market.reserves.map(Number);
    const totalMinted = Number(market.totalMinted);
    const rangeMin = Number(market.rangeMin ?? 0);
    const rangeMax = Number(market.rangeMax ?? 0);

    const fee = Math.floor((collateralAmount * tradeFeesBps) / 10000);
    const effectiveCollateral = collateralAmount - fee;

    const weights = computeBinWeights(
      rangeMin,
      rangeMax,
      reserves.length,
      mu,
      sigma,
    );

    const tokensPerBin = this.computeDistributionBuy(
      [...reserves],
      totalMinted,
      weights,
      effectiveCollateral,
    );

    const newReserves = [...reserves];
    for (let i = 0; i < newReserves.length; i++) {
      newReserves[i] += effectiveCollateral;
      newReserves[i] -= tokensPerBin[i];
    }
    const kNew = totalMinted + effectiveCollateral;

    const newProbabilities = this.computeProbabilities(newReserves, kNew);

    return { tokensPerBin, fee, newProbabilities };
  }

  private computeBuy(
    reserves: number[],
    totalMinted: number,
    outcome: number,
    effectiveCollateral: number,
  ): number {
    const xI = totalMinted - reserves[outcome];
    let sumOthersXSq = 0;
    for (let j = 0; j < reserves.length; j++) {
      if (j !== outcome) {
        const x = totalMinted - reserves[j];
        sumOthersXSq += x * x;
      }
    }

    const kNew = totalMinted + effectiveCollateral;
    const kNewSq = kNew * kNew;

    if (kNewSq < sumOthersXSq) return 0;
    const xNewI = Math.sqrt(kNewSq - sumOthersXSq);

    return Math.max(0, Math.floor(xNewI - xI));
  }

  private computeSell(
    reserves: number[],
    totalMinted: number,
    outcome: number,
    tokensIn: number,
  ): number {
    const xI = totalMinted - reserves[outcome];
    if (xI < tokensIn) return 0;

    reserves[outcome] += tokensIn;

    let kNewSq = 0;
    for (const r of reserves) {
      const x = totalMinted - r;
      kNewSq += x * x;
    }
    const kNew = Math.sqrt(kNewSq);

    return Math.max(0, Math.floor(totalMinted - kNew));
  }

  private computeDistributionBuy(
    reserves: number[],
    totalMinted: number,
    weights: number[],
    effectiveCollateral: number,
  ): number[] {
    let xw = 0;
    let w2 = 0;
    for (let i = 0; i < reserves.length; i++) {
      const x = totalMinted - reserves[i];
      xw += x * weights[i];
      w2 += weights[i] * weights[i];
    }

    if (w2 === 0) return Array(reserves.length).fill(0);

    const kNew = totalMinted + effectiveCollateral;
    const kNewSq = kNew * kNew;
    const kOldSq = totalMinted * totalMinted;
    const excess = kNewSq - kOldSq;

    const disc = xw * xw + w2 * excess;
    const sqrtDisc = Math.sqrt(disc);
    const numerator = sqrtDisc - xw;

    return weights.map((w) => Math.max(0, Math.floor((numerator * w) / w2)));
  }

  private computeProbabilities(
    reserves: number[],
    totalMinted: number,
  ): number[] {
    if (totalMinted === 0) return reserves.map(() => 0);
    const kSq = totalMinted * totalMinted;
    return reserves.map((r) => {
      const x = totalMinted - r;
      return (x * x) / kSq;
    });
  }
}
