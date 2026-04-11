"use client";

import { useState } from "react";
import { useFormContext } from "react-hook-form";
import type { CreateMarketFormData } from "@/lib/schemas/create-market-schema";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";

const CATEGORIES = [
  "",
  "Crypto",
  "Politics",
  "Sports",
  "Entertainment",
  "Technology",
  "Science",
  "Economics",
  "Other",
];

export function StepQuestionDetails() {
  const {
    register,
    formState: { errors },
    watch,
    setValue,
  } = useFormContext<CreateMarketFormData>();
  const tags = watch("tags") ?? [];
  const [tagInput, setTagInput] = useState("");

  const handleAddTag = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      const trimmed = tagInput.trim();
      if (trimmed && !tags.includes(trimmed) && tags.length < 10) {
        setValue("tags", [...tags, trimmed]);
        setTagInput("");
      }
    }
  };

  const handleRemoveTag = (tag: string) => {
    setValue(
      "tags",
      tags.filter((t) => t !== tag),
    );
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold">Question Details</h2>
        <p className="text-sm text-muted-foreground">
          Define the market question and metadata
        </p>
      </div>

      {/* Title */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Title *
        </label>
        <Input
          {...register("title")}
          placeholder="Will Bitcoin reach $100K by end of 2026?"
        />
        {errors.title && (
          <p className="mt-1 text-xs text-destructive">
            {errors.title.message}
          </p>
        )}
      </div>

      {/* Description */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Description
        </label>
        <Textarea
          {...register("description")}
          placeholder="Additional context and resolution criteria..."
          rows={3}
        />
        {errors.description && (
          <p className="mt-1 text-xs text-destructive">
            {errors.description.message}
          </p>
        )}
      </div>

      {/* Category */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Category
        </label>
        <select
          {...register("category")}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          {CATEGORIES.map((cat) => (
            <option key={cat} value={cat}>
              {cat || "None"}
            </option>
          ))}
        </select>
      </div>

      {/* Tags */}
      <div>
        <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
          Tags (press Enter to add)
        </label>
        <Input
          value={tagInput}
          onChange={(e) => setTagInput(e.target.value)}
          onKeyDown={handleAddTag}
          placeholder="Add tags..."
        />
        {tags.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {tags.map((tag) => (
              <Badge key={tag} variant="outline" className="gap-1 text-xs">
                {tag}
                <button type="button" onClick={() => handleRemoveTag(tag)}>
                  <X className="h-3 w-3" />
                </button>
              </Badge>
            ))}
          </div>
        )}
        {errors.tags && (
          <p className="mt-1 text-xs text-destructive">
            {errors.tags.message}
          </p>
        )}
      </div>
    </div>
  );
}
