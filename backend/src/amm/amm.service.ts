import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
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

export interface EstimateBuyBySharesResult {
  collateralNeeded: number;
  fee: number;
  newProbabilities: number[];
}

export interface EstimateSellByCollateralResult {
  tokensNeeded: number;
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
    if (market.marketType !== 2) {
      throw new BadRequestException(
        'Distribution buy is only available for continuous markets',
      );
    }
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

  async estimateDistributionSell(
    marketId: number,
    mu: number,
    sigma: number,
    tokenAmount: number,
    tradeFeesBps = 30,
  ): Promise<EstimateSellResult> {
    const market = await this.marketService.findById(marketId);
    if (market.marketType !== 2) {
      throw new BadRequestException('Distribution sell is only available for continuous markets');
    }

    const reserves = market.reserves.map(Number);
    const totalMinted = Number(market.totalMinted);
    const rangeMin = Number(market.rangeMin ?? 0);
    const rangeMax = Number(market.rangeMax ?? 0);

    const weights = computeBinWeights(
      rangeMin,
      rangeMax,
      reserves.length,
      mu,
      sigma,
    );

    const grossCollateral = this.computeDistributionSell(
      [...reserves],
      totalMinted,
      weights,
      tokenAmount,
    );

    const fee = Math.floor((grossCollateral * tradeFeesBps) / 10000);
    const collateralOut = grossCollateral - fee;

    // Compute post-sell reserves for probabilities
    const newReserves = [...reserves];
    let kNewSq = 0;
    for (let i = 0; i < newReserves.length; i++) {
      const tokensForBin = Math.floor((tokenAmount * weights[i]) / SCALE);
      newReserves[i] += tokensForBin;
      const x = totalMinted - newReserves[i];
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

  async estimateBuyByShares(
    marketId: number,
    outcome: number,
    desiredTokens: number,
    tradeFeesBps = 30,
  ): Promise<EstimateBuyBySharesResult> {
    const market = await this.marketService.findById(marketId);
    const reserves = market.reserves.map(Number);
    const totalMinted = Number(market.totalMinted);

    const effectiveCollateral = this.computeCollateralForTokens(
      reserves,
      totalMinted,
      outcome,
      desiredTokens,
    );

    // Gross up for fee: collateralNeeded - floor(collateralNeeded * feeBps / 10000) >= effectiveCollateral
    const collateralNeeded = Math.ceil(
      (effectiveCollateral * 10000) / (10000 - tradeFeesBps),
    );
    const fee = Math.floor((collateralNeeded * tradeFeesBps) / 10000);

    // Compute new probabilities using actual effective amount
    const actualEffective = collateralNeeded - fee;
    const kNew = totalMinted + actualEffective;
    const newReserves = reserves.map((r) => r + actualEffective);
    const sumOthersXSq = newReserves.reduce((sum, r, i) => {
      if (i === outcome) return sum;
      const x = kNew - r;
      return sum + x * x;
    }, 0);
    const xNewI = Math.sqrt(kNew * kNew - sumOthersXSq);
    newReserves[outcome] = kNew - xNewI;

    const newProbabilities = this.computeProbabilities(newReserves, kNew);

    return { collateralNeeded, fee, newProbabilities };
  }

  async estimateSellByCollateral(
    marketId: number,
    outcome: number,
    desiredCollateral: number,
    tradeFeesBps = 30,
  ): Promise<EstimateSellByCollateralResult> {
    const market = await this.marketService.findById(marketId);
    const reserves = market.reserves.map(Number);
    const totalMinted = Number(market.totalMinted);

    // Gross collateral needed before fee to yield desiredCollateral net
    const grossTarget = Math.ceil(
      (desiredCollateral * 10000) / (10000 - tradeFeesBps),
    );

    const tokensNeeded = this.computeTokensForCollateral(
      reserves,
      totalMinted,
      outcome,
      grossTarget,
    );

    // Use forward computation to get actual fee
    const actualGross = this.computeSell(
      [...reserves],
      totalMinted,
      outcome,
      tokensNeeded,
    );
    const fee = Math.floor((actualGross * tradeFeesBps) / 10000);

    // Compute new probabilities
    const newReserves = [...reserves];
    newReserves[outcome] += tokensNeeded;
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

    return { tokensNeeded, fee, newProbabilities };
  }

  async estimateDistributionSellByCollateral(
    marketId: number,
    mu: number,
    sigma: number,
    desiredCollateral: number,
    tradeFeesBps = 30,
  ): Promise<EstimateSellByCollateralResult> {
    const market = await this.marketService.findById(marketId);
    if (market.marketType !== 2) {
      throw new BadRequestException(
        'Distribution sell is only available for continuous markets',
      );
    }

    const reserves = market.reserves.map(Number);
    const totalMinted = Number(market.totalMinted);
    const rangeMin = Number(market.rangeMin ?? 0);
    const rangeMax = Number(market.rangeMax ?? 0);

    const weights = computeBinWeights(
      rangeMin,
      rangeMax,
      reserves.length,
      mu,
      sigma,
    );

    // Gross collateral needed before fee
    const grossTarget = Math.ceil(
      (desiredCollateral * 10000) / (10000 - tradeFeesBps),
    );

    // Find upper bound for binary search
    let hi = grossTarget * 2;
    let attempts = 0;
    while (
      this.computeDistributionSell([...reserves], totalMinted, [...weights], hi) <
      grossTarget
    ) {
      hi *= 2;
      if (++attempts > 50) {
        throw new BadRequestException(
          'Desired collateral exceeds market capacity',
        );
      }
    }

    // Binary search: find smallest totalTokens that yields >= grossTarget
    let lo = 0;
    for (let iter = 0; iter < 100; iter++) {
      const mid = Math.floor((lo + hi) / 2);
      if (mid === lo) break;
      const gross = this.computeDistributionSell(
        [...reserves],
        totalMinted,
        [...weights],
        mid,
      );
      if (gross >= grossTarget) {
        hi = mid;
      } else {
        lo = mid;
      }
    }

    const tokensNeeded = hi;

    // Compute actual fee from forward sell
    const actualGross = this.computeDistributionSell(
      [...reserves],
      totalMinted,
      [...weights],
      tokensNeeded,
    );
    const fee = Math.floor((actualGross * tradeFeesBps) / 10000);

    // Compute new probabilities
    const newReserves = [...reserves];
    let kNewSq = 0;
    for (let i = 0; i < newReserves.length; i++) {
      const tokensForBin = Math.floor((tokensNeeded * weights[i]) / SCALE);
      newReserves[i] += tokensForBin;
      const x = totalMinted - newReserves[i];
      kNewSq += x * x;
    }
    const kNew = Math.sqrt(kNewSq);
    const collateralBurn = totalMinted - kNew;
    for (let i = 0; i < newReserves.length; i++) {
      newReserves[i] -= collateralBurn;
    }
    const newProbabilities = this.computeProbabilities(newReserves, kNew);

    return { tokensNeeded, fee, newProbabilities };
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

  private computeDistributionSell(
    reserves: number[],
    totalMinted: number,
    weights: number[],
    totalTokens: number,
  ): number {
    if (totalTokens === 0) return 0;

    let kNewSq = 0;
    for (let i = 0; i < reserves.length; i++) {
      const tokensForBin = Math.floor((totalTokens * weights[i]) / SCALE);
      reserves[i] += tokensForBin;
      const xNew = totalMinted - reserves[i];
      kNewSq += xNew * xNew;
    }
    const kNew = Math.sqrt(kNewSq);

    return Math.max(0, Math.floor(totalMinted - kNew));
  }

  private computeCollateralForTokens(
    reserves: number[],
    totalMinted: number,
    outcome: number,
    desiredTokens: number,
  ): number {
    const xI = totalMinted - reserves[outcome];
    let sumOthersXSq = 0;
    for (let j = 0; j < reserves.length; j++) {
      if (j !== outcome) {
        const x = totalMinted - reserves[j];
        sumOthersXSq += x * x;
      }
    }

    const xNewI = xI + desiredTokens;
    const kNew = Math.sqrt(xNewI * xNewI + sumOthersXSq);
    const effectiveCollateral = kNew - totalMinted;

    if (effectiveCollateral <= 0) {
      throw new BadRequestException('Invalid desired tokens amount');
    }

    return Math.ceil(effectiveCollateral);
  }

  private computeTokensForCollateral(
    reserves: number[],
    totalMinted: number,
    outcome: number,
    grossCollateral: number,
  ): number {
    if (grossCollateral >= totalMinted) {
      throw new BadRequestException(
        'Desired collateral exceeds market capacity',
      );
    }

    const xI = totalMinted - reserves[outcome];
    let sumOthersXSq = 0;
    for (let j = 0; j < reserves.length; j++) {
      if (j !== outcome) {
        const x = totalMinted - reserves[j];
        sumOthersXSq += x * x;
      }
    }

    const kTarget = totalMinted - grossCollateral;
    const kTargetSq = kTarget * kTarget;

    if (kTargetSq < sumOthersXSq) {
      throw new BadRequestException(
        'Desired collateral exceeds capacity for this outcome',
      );
    }

    const xNewI = Math.sqrt(kTargetSq - sumOthersXSq);
    const tokensIn = xI - xNewI;

    if (tokensIn <= 0) {
      throw new BadRequestException('Desired collateral cannot be achieved');
    }

    return Math.ceil(tokensIn);
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
