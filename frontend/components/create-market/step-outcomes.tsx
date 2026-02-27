"use client";

import { useFormContext } from "react-hook-form";
import type { CreateMarketFormData } from "@/lib/schemas/create-market-schema";
import { MarketType } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Plus, Trash2 } from "lucide-react";

interface StepOutcomesProps {
  marketType: number;
}

export function StepOutcomes({ marketType }: StepOutcomesProps) {
  if (marketType === MarketType.Binary) return <BinaryOutcomes />;
  if (marketType === MarketType.MultiOutcome) return <MultiOutcomes />;
  return <ContinuousOutcomes />;
}

function BinaryOutcomes() {
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Outcomes</h2>
        <p className="text-sm text-muted-foreground">
          Binary markets have fixed Yes/No outcomes
        </p>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 text-center">
          <span className="font-semibold text-emerald-400">Yes</span>
        </div>
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/5 p-4 text-center">
          <span className="font-semibold text-rose-400">No</span>
        </div>
      </div>
    </div>
  );
}

function MultiOutcomes() {
  const {
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<CreateMarketFormData>();
  const labels = watch("outcomeLabels") ?? ["", "", ""];

  const addOutcome = () => {
    if (labels.length < 32) {
      setValue("outcomeLabels", [...labels, ""]);
    }
  };

  const removeOutcome = (index: number) => {
    if (labels.length > 3) {
      setValue(
        "outcomeLabels",
        labels.filter((_, i) => i !== index),
      );
    }
  };

  const updateLabel = (index: number, value: string) => {
    const updated = [...labels];
    updated[index] = value;
    setValue("outcomeLabels", updated);
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold">Outcomes</h2>
        <p className="text-sm text-muted-foreground">
          Define 3 to 32 possible outcomes
        </p>
      </div>

      <div className="space-y-2">
        {labels.map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="w-6 text-center text-xs text-muted-foreground">
              {i + 1}
            </span>
            <Input
              value={label}
              onChange={(e) => updateLabel(i, e.target.value)}
              placeholder={`Outcome ${i + 1}`}
              className="flex-1"
            />
            {labels.length > 3 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => removeOutcome(i)}
                className="h-8 w-8 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            )}
          </div>
        ))}
      </div>

      {labels.length < 32 && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={addOutcome}
          className="gap-1.5"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Outcome
        </Button>
      )}

      <p className="text-xs text-muted-foreground">
        {labels.length} / 32 outcomes
      </p>
      {errors.outcomeLabels && (
        <p className="text-xs text-destructive">
          {errors.outcomeLabels.message}
        </p>
      )}
    </div>
  );
}

function ContinuousOutcomes() {
  const {
    register,
    watch,
    setValue,
    formState: { errors },
  } = useFormContext<CreateMarketFormData>();
  const numBins = watch("numBins") ?? 64;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Range & Bins</h2>
        <p className="text-sm text-muted-foreground">
          Define the continuous range for distribution trading
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Range Min
          </label>
          <Input
            type="number"
            {...register("rangeMin", { valueAsNumber: true })}
            placeholder="e.g. 0"
          />
          {errors.rangeMin && (
            <p className="mt-1 text-xs text-destructive">
              {errors.rangeMin.message}
            </p>
          )}
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
            Range Max
          </label>
          <Input
            type="number"
            {...register("rangeMax", { valueAsNumber: true })}
            placeholder="e.g. 100"
          />
          {errors.rangeMax && (
            <p className="mt-1 text-xs text-destructive">
              {errors.rangeMax.message}
            </p>
          )}
        </div>
      </div>

      <div>
        <label className="mb-3 block text-xs font-medium text-muted-foreground">
          Number of Bins:{" "}
          <span className="font-semibold text-foreground">{numBins}</span>
        </label>
        <Slider
          value={[numBins]}
          onValueChange={([v]) => setValue("numBins", v)}
          min={16}
          max={256}
          step={1}
        />
        <div className="mt-2 flex justify-between text-[10px] text-muted-foreground">
          <span>16</span>
          <span>64</span>
          <span>128</span>
          <span>256</span>
        </div>
        <div className="mt-2 flex gap-2">
          {[64, 128, 256].map((n) => (
            <Button
              key={n}
              type="button"
              variant={numBins === n ? "default" : "outline"}
              size="xs"
              onClick={() => setValue("numBins", n)}
            >
              {n}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
