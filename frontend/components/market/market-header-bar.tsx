"use client";

import { useState, useCallback } from "react";
import { MarketStatsBar } from "./market-stats-bar";
import { MarketAssetIcon } from "./market-asset-icon";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { type MarketSummary } from "@/lib/types";
import { toast } from "sonner";
import {
  Download,
  Share2,
  BookmarkPlus,
  BookmarkMinus,
  Copy,
  Check,
  Loader2,
} from "lucide-react";

interface MarketHeaderBarProps {
  market: MarketSummary;
  /** Show the Claim Tokens button (market detail only, not slideshow) */
  showFaucet?: boolean;
  faucetAvailable?: number;
  faucetLoading?: boolean;
  onClaimFaucet?: () => void;
  /** Ref to the chart container for download functionality */
  chartRef?: React.RefObject<HTMLDivElement | null>;
  isBookmarked?: boolean;
  bookmarkLoading?: boolean;
  onToggleBookmark?: () => void;
  bookmarkDisabled?: boolean;
  /** When true, show the faucet button even if no claims remain (tutorial mode) */
  tutorialActive?: boolean;
}

export function MarketHeaderBar({
  market,
  showFaucet = false,
  faucetAvailable = 0,
  faucetLoading = false,
  onClaimFaucet,
  chartRef,
  isBookmarked = false,
  bookmarkLoading = false,
  onToggleBookmark,
  bookmarkDisabled = false,
  tutorialActive = false,
}: MarketHeaderBarProps) {
  const [shareOpen, setShareOpen] = useState(false);

  const deadline = new Date(market.deadline);
  const countdown = deadlineCountdown(deadline);

  const handleDownload = useCallback(() => {
    if (!chartRef?.current) {
      toast.error("No chart to download");
      return;
    }
    const svg = chartRef.current.querySelector("svg");
    if (!svg) {
      toast.error("No chart found");
      return;
    }
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    bg.setAttribute("width", "100%");
    bg.setAttribute("height", "100%");
    bg.setAttribute("fill", "#0a0a0f");
    clone.insertBefore(bg, clone.firstChild);

    const blob = new Blob([new XMLSerializer().serializeToString(clone)], {
      type: "image/svg+xml",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${market.title.replace(/[^a-zA-Z0-9]/g, "_")}_chart.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("Chart downloaded");
  }, [chartRef, market.title]);

  return (
    <div className="space-y-3">
      {/* Row 1: Icon + Title on left | Countdown + Claim Tokens on right */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <MarketAssetIcon
            subject={market.subject}
            icon={market.icon}
            className="shrink-0 p-2.5"
            symbolClassName="text-lg"
            imageClassName="h-5 w-5"
          />
          <h1 className="truncate text-lg font-semibold leading-snug">
            {market.title}
          </h1>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {/* Countdown */}
          {countdown ? (
            <div className="flex items-center gap-3 rounded-lg border border-border/30 bg-muted/20 px-3 py-2">
              {countdown.days > 0 && (
                <CountdownUnit value={countdown.days} label="Days" />
              )}
              <CountdownUnit value={countdown.hours} label="Hours" />
              <CountdownUnit value={countdown.minutes} label="Minutes" />
            </div>
          ) : (
            <div className="flex items-center rounded-lg border border-rose-500/30 bg-rose-500/5 px-3 py-2">
              <span className="text-sm font-semibold text-rose-400">Expired</span>
            </div>
          )}

          {/* Faucet button (market detail only) — visible during tutorial even if no claims remain */}
          {showFaucet && (faucetAvailable > 0 || tutorialActive) && (
            <Button
              data-tutorial="claim-tokens"
              onClick={onClaimFaucet}
              disabled={faucetLoading || (faucetAvailable <= 0 && tutorialActive)}
              className="rounded-lg bg-amber-500 px-4 py-2 text-sm font-semibold text-black hover:bg-amber-400 disabled:opacity-50"
            >
              {faucetLoading ? (
                <><Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> Claiming...</>
              ) : faucetAvailable > 0 ? (
                `Claim Tokens (${faucetAvailable})`
              ) : (
                "Claim Tokens"
              )}
            </Button>
          )}
        </div>
      </div>

      {/* Row 2: Stats fields on left | Action buttons on right */}
      <div className="flex flex-wrap items-stretch gap-2">
        <MarketStatsBar market={market} />

        {/* Action buttons — right-aligned */}
        <div className="ml-auto flex items-center gap-1.5 shrink-0 self-end pb-1">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground border-border/40"
            onClick={handleDownload}
            title="Download chart"
          >
            <Download className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-full text-muted-foreground border-border/40"
            onClick={() => setShareOpen(true)}
            title="Share"
          >
            <Share2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8 rounded-full border-border/40 text-muted-foreground"
            title={
              bookmarkLoading
                ? "Loading bookmark"
                : isBookmarked
                  ? "Remove bookmark"
                  : "Add bookmark"
            }
            onClick={onToggleBookmark}
            disabled={bookmarkDisabled || bookmarkLoading || !onToggleBookmark}
          >
            {bookmarkLoading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : isBookmarked ? (
              <BookmarkMinus className="h-3.5 w-3.5 text-amber-400" />
            ) : (
              <BookmarkPlus className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>
      </div>

      {/* Share modal */}
      <ShareDialog
        open={shareOpen}
        onOpenChange={setShareOpen}
        marketId={market.id}
        marketTitle={market.title}
      />
    </div>
  );
}

/* ── Share Dialog ── */

function ShareDialog({
  open,
  onOpenChange,
  marketId,
  marketTitle,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  marketId: string;
  marketTitle: string;
}) {
  const [copied, setCopied] = useState(false);

  const marketUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/markets/${marketId}`
      : `/markets/${marketId}`;

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(marketUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [marketUrl]);

  const shareText = encodeURIComponent(
    `Check out this prediction market: ${marketTitle}`,
  );
  const shareUrl = encodeURIComponent(marketUrl);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Share Market</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center gap-2 rounded-lg border border-border/40 bg-muted/20 px-3 py-2">
            <span className="flex-1 truncate text-sm text-muted-foreground">
              {marketUrl}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={handleCopy}
            >
              {copied ? (
                <Check className="h-4 w-4 text-emerald-400" />
              ) : (
                <Copy className="h-4 w-4" />
              )}
            </Button>
          </div>

          <div className="flex items-center justify-center gap-3">
            <a
              href={`https://t.me/share/url?url=${shareUrl}&text=${shareText}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-muted/20 text-muted-foreground transition-colors hover:bg-[#229ED9]/10 hover:text-[#229ED9] hover:border-[#229ED9]/40"
              title="Share on Telegram"
            >
              <TelegramIcon />
            </a>
            <a
              href={`https://x.com/intent/tweet?text=${shareText}&url=${shareUrl}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-muted/20 text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground hover:border-foreground/40"
              title="Share on X"
            >
              <XIcon />
            </a>
            <a
              href={`https://www.instagram.com/`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex h-12 w-12 items-center justify-center rounded-full border border-border/40 bg-muted/20 text-muted-foreground transition-colors hover:bg-[#E4405F]/10 hover:text-[#E4405F] hover:border-[#E4405F]/40"
              title="Share on Instagram"
            >
              <InstagramIcon />
            </a>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ── Inline SVG icons for social ── */

function TelegramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  );
}

function InstagramIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
      <path d="M12 0C8.74 0 8.333.015 7.053.072 5.775.132 4.905.333 4.14.63c-.789.306-1.459.717-2.126 1.384S.935 3.35.63 4.14C.333 4.905.131 5.775.072 7.053.012 8.333 0 8.74 0 12s.015 3.667.072 4.947c.06 1.277.261 2.148.558 2.913.306.788.717 1.459 1.384 2.126.667.666 1.336 1.079 2.126 1.384.766.296 1.636.499 2.913.558C8.333 23.988 8.74 24 12 24s3.667-.015 4.947-.072c1.277-.06 2.148-.262 2.913-.558.788-.306 1.459-.718 2.126-1.384.666-.667 1.079-1.335 1.384-2.126.296-.765.499-1.636.558-2.913.06-1.28.072-1.687.072-4.947s-.015-3.667-.072-4.947c-.06-1.277-.262-2.149-.558-2.913-.306-.789-.718-1.459-1.384-2.126C21.319 1.347 20.651.935 19.86.63c-.765-.297-1.636-.499-2.913-.558C15.667.012 15.26 0 12 0zm0 2.16c3.203 0 3.585.016 4.85.071 1.17.055 1.805.249 2.227.415.562.217.96.477 1.382.896.419.42.679.819.896 1.381.164.422.36 1.057.413 2.227.057 1.266.07 1.646.07 4.85s-.015 3.585-.074 4.85c-.061 1.17-.256 1.805-.421 2.227-.224.562-.479.96-.899 1.382-.419.419-.824.679-1.38.896-.42.164-1.065.36-2.235.413-1.274.057-1.649.07-4.859.07-3.211 0-3.586-.015-4.859-.074-1.171-.061-1.816-.256-2.236-.421-.569-.224-.96-.479-1.379-.899-.421-.419-.69-.824-.9-1.38-.165-.42-.359-1.065-.42-2.235-.045-1.26-.061-1.649-.061-4.844 0-3.196.016-3.586.061-4.861.061-1.17.255-1.814.42-2.234.21-.57.479-.96.9-1.381.419-.419.81-.689 1.379-.898.42-.166 1.051-.361 2.221-.421 1.275-.045 1.65-.06 4.859-.06l.045.03zm0 3.678a6.162 6.162 0 1 0 0 12.324 6.162 6.162 0 1 0 0-12.324zM12 16c-2.21 0-4-1.79-4-4s1.79-4 4-4 4 1.79 4 4-1.79 4-4 4zm7.846-10.405a1.441 1.441 0 1 1-2.882 0 1.441 1.441 0 0 1 2.882 0z" />
    </svg>
  );
}

/* ── Countdown helpers ── */

function CountdownUnit({ value, label }: { value: number; label: string }) {
  return (
    <div className="text-center">
      <div className="text-lg font-bold tabular-nums leading-tight">
        {String(value).padStart(2, "0")}
      </div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

function deadlineCountdown(
  deadline: Date,
): { days: number; hours: number; minutes: number } | null {
  const diff = deadline.getTime() - Date.now();
  if (diff <= 0) return null;
  const totalMinutes = Math.floor(diff / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  return { days, hours, minutes };
}
