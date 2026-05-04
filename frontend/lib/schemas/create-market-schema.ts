import { z } from "zod";
import { MarketType } from "@/lib/types";

export const createMarketSchema = z
  .object({
    // Step 0: Type
    marketType: z.number().min(0).max(2),

    // Step 1: Question details
    title: z
      .string()
      .min(5, "Title must be at least 5 characters")
      .max(200, "Title too long"),
    description: z.string().max(2000, "Description too long").optional().or(z.literal("")),
    category: z.string().max(50).optional().or(z.literal("")),
    subject: z.string().max(30).optional().or(z.literal("")),
    tags: z.array(z.string().min(1).max(30)).max(10, "Maximum 10 tags").optional(),

    // Step 2: Outcomes (conditional on type)
    outcomeLabels: z
      .array(z.string().max(50))
      .optional(),
    rangeMin: z.number().optional(),
    rangeMax: z.number().optional(),
    numBins: z.number().min(2).max(256).optional(),

    // Step 3: Parameters
    deadline: z.string().min(1, "Deadline is required"),
    oracle: z
      .string()
      .min(1, "Oracle address is required")
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid base58 wallet address"),
    collateralMint: z
      .string()
      .min(1, "Mint address is required")
      .regex(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/, "Invalid base58 mint address"),
    initialLiquidity: z.string().min(1, "Liquidity amount is required"),
  })
  .superRefine((data, ctx) => {
    // Multi-outcome: 3–32 non-empty labels
    if (data.marketType === MarketType.MultiOutcome) {
      const filled = data.outcomeLabels?.filter((l) => l.trim().length > 0) ?? [];
      if (filled.length < 3) {
        ctx.addIssue({
          code: "custom",
          message: "Multi-outcome markets need at least 3 outcomes",
          path: ["outcomeLabels"],
        });
      }
      if (filled.length > 32) {
        ctx.addIssue({
          code: "custom",
          message: "Maximum 32 outcomes",
          path: ["outcomeLabels"],
        });
      }
    }

    // Continuous: valid range
    if (data.marketType === MarketType.Continuous) {
      if (data.rangeMin == null || data.rangeMax == null) {
        ctx.addIssue({
          code: "custom",
          message: "Range bounds are required for continuous markets",
          path: ["rangeMin"],
        });
      } else if (data.rangeMin >= data.rangeMax) {
        ctx.addIssue({
          code: "custom",
          message: "Range min must be less than range max",
          path: ["rangeMin"],
        });
      }
      if (!data.numBins) {
        ctx.addIssue({
          code: "custom",
          message: "Number of bins is required",
          path: ["numBins"],
        });
      }
    }

    // Deadline must be in the future
    if (data.deadline) {
      const deadlineDate = new Date(data.deadline);
      if (deadlineDate.getTime() <= Date.now()) {
        ctx.addIssue({
          code: "custom",
          message: "Deadline must be in the future",
          path: ["deadline"],
        });
      }
    }

    // Liquidity minimum: 1 USDC
    if (data.initialLiquidity) {
      const amount = parseFloat(data.initialLiquidity);
      if (isNaN(amount) || amount < 1) {
        ctx.addIssue({
          code: "custom",
          message: "Minimum 1 USDC liquidity required",
          path: ["initialLiquidity"],
        });
      }
    }
  });

export type CreateMarketFormData = z.infer<typeof createMarketSchema>;

/** Fields per step for partial validation with trigger(). */
export const STEP_FIELDS: Record<number, (keyof CreateMarketFormData)[]> = {
  0: ["marketType"],
  1: ["title", "description", "category", "subject", "tags"],
  2: ["outcomeLabels", "rangeMin", "rangeMax", "numBins"],
  3: ["deadline", "oracle", "collateralMint", "initialLiquidity"],
  4: [],
};

export const DEFAULT_VALUES: CreateMarketFormData = {
  marketType: MarketType.Binary,
  title: "",
  description: "",
  category: "crypto",
  subject: "SOL",
  tags: [],
  outcomeLabels: ["Yes", "No"],
  rangeMin: undefined,
  rangeMax: undefined,
  numBins: 64,
  deadline: "",
  oracle: "",
  collateralMint: "",
  initialLiquidity: "",
};
