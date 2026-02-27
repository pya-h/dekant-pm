"use client";

import { useFormContext } from "react-hook-form";
import type { CreateMarketFormData } from "@/lib/schemas/create-market-schema";
import { MarketType } from "@/lib/types";
import { cn } from "@/lib/utils";
import { CircleDot, LayoutGrid, Activity } from "lucide-react";

const TYPES = [
  {
    value: MarketType.Binary,
    label: "Binary",
    description: "Yes/No outcome. Simple two-sided market.",
    icon: CircleDot,
  },
  {
    value: MarketType.MultiOutcome,
    label: "Multi-Outcome",
    description: "3 to 32 possible outcomes with custom labels.",
    icon: LayoutGrid,
  },
  {
    value: MarketType.Continuous,
    label: "Continuous",
    description: "Numeric range with distribution trading.",
    icon: Activity,
  },
];

export function StepTypeSelection() {
  const { setValue, watch } = useFormContext<CreateMarketFormData>();
  const selected = watch("marketType");

  const handleSelect = (type: MarketType) => {
    setValue("marketType", type);
    // Reset type-dependent fields
    if (type === MarketType.Binary) {
      setValue("outcomeLabels", ["Yes", "No"]);
      setValue("rangeMin", undefined);
      setValue("rangeMax", undefined);
      setValue("numBins", undefined);
    } else if (type === MarketType.MultiOutcome) {
      setValue("outcomeLabels", ["", "", ""]);
      setValue("rangeMin", undefined);
      setValue("rangeMax", undefined);
      setValue("numBins", undefined);
    } else {
      setValue("outcomeLabels", undefined);
      setValue("rangeMin", 0);
      setValue("rangeMax", 100);
      setValue("numBins", 64);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Select Market Type</h2>
        <p className="text-sm text-muted-foreground">
          Choose the type of prediction market
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        {TYPES.map(({ value, label, description, icon: Icon }) => (
          <button
            key={value}
            type="button"
            onClick={() => handleSelect(value)}
            className={cn(
              "flex flex-col items-center gap-3 rounded-xl border p-6 text-center transition-all",
              selected === value
                ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                : "border-border/60 hover:border-border hover:bg-muted/20",
            )}
          >
            <Icon
              className={cn(
                "h-8 w-8",
                selected === value ? "text-primary" : "text-muted-foreground",
              )}
            />
            <div>
              <div className="font-semibold">{label}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {description}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
