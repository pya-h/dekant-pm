import { env } from "@/lib/env";

export function Footer() {
  return (
    <footer className="border-t border-border/40">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-center px-4 sm:px-6 lg:px-8">
        <p className="text-sm text-muted-foreground">
          DekantPM Protocol&nbsp;&mdash;&nbsp;
          <span className="capitalize">{env.network}</span>
        </p>
      </div>
    </footer>
  );
}
