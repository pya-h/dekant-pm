type AssetVisual = {
  symbol: string;
  bgClass: string;
  textClass: string;
};

const KNOWN_ASSETS: Record<string, AssetVisual> = {
  BTC: { symbol: "₿", bgClass: "bg-amber-500/15", textClass: "text-amber-400" },
  ETH: { symbol: "Ξ", bgClass: "bg-slate-400/15", textClass: "text-slate-300" },
  SOL: { symbol: "◎", bgClass: "bg-fuchsia-500/15", textClass: "text-fuchsia-400" },
  USDC: { symbol: "$", bgClass: "bg-sky-500/15", textClass: "text-sky-400" },
  BNB: { symbol: "◆", bgClass: "bg-yellow-500/15", textClass: "text-yellow-400" },
  XRP: { symbol: "✕", bgClass: "bg-zinc-400/15", textClass: "text-zinc-300" },
  ADA: { symbol: "A", bgClass: "bg-blue-500/15", textClass: "text-blue-400" },
  DOGE: { symbol: "Ð", bgClass: "bg-orange-500/15", textClass: "text-orange-400" },
};

const DEFAULT_ASSET: AssetVisual = {
  symbol: "◉",
  bgClass: "bg-muted",
  textClass: "text-muted-foreground",
};

function isImageValue(value: string): boolean {
  return /^(https?:\/\/|\/)/i.test(value);
}

function normalizeSubject(subject: string | null | undefined): string {
  return (subject ?? "").trim().toUpperCase();
}

function normalizeTextIcon(icon: string): string {
  const cleaned = icon.trim();
  if (!cleaned) return "";
  return cleaned.length > 3 ? cleaned.slice(0, 3).toUpperCase() : cleaned.toUpperCase();
}

export function getMarketAssetVisual(
  subject: string | null | undefined,
  icon: string | null | undefined,
): {
  symbol: string;
  bgClass: string;
  textClass: string;
  imageSrc: string | null;
  asset: string;
} {
  const asset = normalizeSubject(subject);
  const known = asset ? KNOWN_ASSETS[asset] : undefined;

  const iconValue = icon?.trim();
  if (iconValue) {
    if (isImageValue(iconValue)) {
      return {
        symbol: known?.symbol ?? DEFAULT_ASSET.symbol,
        bgClass: known?.bgClass ?? DEFAULT_ASSET.bgClass,
        textClass: known?.textClass ?? DEFAULT_ASSET.textClass,
        imageSrc: iconValue,
        asset,
      };
    }

    return {
      symbol: normalizeTextIcon(iconValue),
      bgClass: known?.bgClass ?? DEFAULT_ASSET.bgClass,
      textClass: known?.textClass ?? DEFAULT_ASSET.textClass,
      imageSrc: null,
      asset,
    };
  }

  if (known) {
    return {
      symbol: known.symbol,
      bgClass: known.bgClass,
      textClass: known.textClass,
      imageSrc: null,
      asset,
    };
  }

  return {
    symbol: DEFAULT_ASSET.symbol,
    bgClass: DEFAULT_ASSET.bgClass,
    textClass: DEFAULT_ASSET.textClass,
    imageSrc: null,
    asset,
  };
}
