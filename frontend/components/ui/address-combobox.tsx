"use client";

import { useState, useRef, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { ChevronsUpDown, Check, Loader2 } from "lucide-react";

export interface ComboboxOption {
  value: string;
  label: string;
  description?: string;
}

interface AddressComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  isLoading?: boolean;
  className?: string;
}

export function AddressCombobox({
  value,
  onChange,
  options,
  placeholder,
  isLoading,
  className,
}: AddressComboboxProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  const query = value.toLowerCase();
  const filtered = options.filter(
    (opt) =>
      opt.value.toLowerCase().includes(query) ||
      opt.label.toLowerCase().includes(query) ||
      (opt.description?.toLowerCase().includes(query) ?? false),
  );

  const showDropdown = open && (isLoading || options.length > 0);

  return (
    <div ref={containerRef} className="relative">
      <Input
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          if (!open && options.length > 0) setOpen(true);
        }}
        onFocus={() => {
          if (options.length > 0 || isLoading) setOpen(true);
        }}
        placeholder={placeholder}
        className={cn("pr-8 font-mono text-sm", className)}
      />
      {(options.length > 0 || isLoading) && (
        <button
          type="button"
          onClick={() => setOpen(!open)}
          className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          tabIndex={-1}
        >
          {isLoading ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <ChevronsUpDown className="h-3.5 w-3.5" />
          )}
        </button>
      )}

      {showDropdown && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-md border bg-popover p-1 shadow-md animate-in fade-in-0 slide-in-from-top-1">
          {isLoading && filtered.length === 0 ? (
            <p className="flex items-center justify-center gap-2 px-2 py-3 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading...
            </p>
          ) : filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              No matches found
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto">
              {filtered.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none hover:bg-accent hover:text-accent-foreground",
                    value === opt.value && "bg-accent",
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium">
                      {opt.label}
                    </div>
                    {opt.description && (
                      <div className="truncate font-mono text-[11px] text-muted-foreground">
                        {opt.description}
                      </div>
                    )}
                  </div>
                  {value === opt.value && (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
