"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { WalletButton } from "@/components/common/wallet-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { env } from "@/lib/env";
import { Menu, X } from "lucide-react";

const navLinks: { href: string; label: string; soon?: boolean }[] = [
  { href: "/markets", label: "Markets" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/admin", label: "Admin" },
  { href: "/oracle", label: "Oracle", soon: true },
];

export function Navbar() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

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

        {/* Desktop nav links */}
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
                    "relative rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive
                      ? "text-foreground"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {label}
                  {isActive && (
                    <span className="absolute inset-x-1 -bottom-[calc(0.5rem+1px)] h-0.5 rounded-full bg-primary" />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Right side */}
        <div className="flex items-center gap-2">
          <WalletButton />
          {/* Mobile hamburger */}
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label="Toggle navigation"
          >
            {mobileOpen ? (
              <X className="h-5 w-5" />
            ) : (
              <Menu className="h-5 w-5" />
            )}
          </Button>
        </div>
      </nav>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <div className="border-t border-border/40 bg-background/95 backdrop-blur-lg md:hidden animate-in slide-in-from-top-2 fade-in-0 duration-200">
          <ul className="mx-auto max-w-7xl space-y-1 px-4 py-3">
            {navLinks.map(({ href, label, soon }) => {
              if (soon) {
                return (
                  <li key={href}>
                    <span className="block rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground/40">
                      {label}
                      <span className="ml-2 text-[10px] uppercase">soon</span>
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
                    onClick={() => setMobileOpen(false)}
                    className={cn(
                      "block rounded-md px-3 py-2.5 text-sm font-medium transition-colors",
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
        </div>
      )}
    </header>
  );
}
