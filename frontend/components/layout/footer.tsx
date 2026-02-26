import { env } from "@/lib/env";

export function Footer() {
  return (
    <footer className="border-t border-border/40 bg-muted/5">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <p className="text-xs text-muted-foreground/70">
          DekantPM Protocol
        </p>
        <div className="flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-border/40 px-2.5 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground/70">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {env.network}
          </span>
        </div>
      </div>
    </footer>
  );
}
