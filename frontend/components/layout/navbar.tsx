"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { WalletButton } from "@/components/common/wallet-button";
import { Badge } from "@/components/ui/badge";
import { env } from "@/lib/env";

const navLinks: { href: string; label: string; soon?: boolean }[] = [
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio", soon: true },
  { href: "/admin", label: "Admin", soon: true },
  { href: "/oracle", label: "Oracle", soon: true },
];

export function Navbar() {
  const pathname = usePathname();

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-lg">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
        {/* Logo + network badge */}
        <div className="flex items-center gap-3">
          <Link
            href="/"
            className="text-xl font-bold tracking-tight transition-colors hover:text-primary"
          >
            DekantPM
          </Link>
          <Badge
            variant="outline"
            className="hidden text-[10px] uppercase tracking-widest sm:inline-flex"
          >
            {env.network}
          </Badge>
        </div>

        {/* Nav links — centered */}
        <ul className="hidden items-center gap-1 md:flex">
          {navLinks.map(({ href, label, soon }) => {
            if (soon) {
              return (
                <li key={href}>
                  <span
                    className="cursor-default rounded-md px-3 py-2 text-sm font-medium text-muted-foreground/40"
                    title="Coming soon"
                  >
                    {label}
                  </span>
                </li>
              );
            }
            const isActive =
              pathname === href || pathname.startsWith(href + "/");
            return (
              <li key={href}>
                <Link
                  href={href}
                  className={cn(
                    "rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "bg-accent text-accent-foreground"
                      : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
                  )}
                >
                  {label}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Wallet button */}
        <div className="flex items-center">
          <WalletButton />
        </div>
      </nav>
    </header>
  );
}
