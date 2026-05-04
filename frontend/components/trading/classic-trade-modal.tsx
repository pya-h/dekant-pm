"use client";

import { useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { TradingPanel } from "./trading-panel";
import type { MarketDetail } from "@/lib/types";

interface ClassicTradeModalProps {
  market: MarketDetail;
}

export function ClassicTradeModal({ market }: ClassicTradeModalProps) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 text-muted-foreground hover:text-foreground"
          title="Classic Trade"
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Classic Trade</DialogTitle>
        </DialogHeader>
        <TradingPanel market={market} />
      </DialogContent>
    </Dialog>
  );
}
