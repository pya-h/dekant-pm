"use client";

import { useState, useMemo, useCallback } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";

import { useAdminRole } from "@/hooks/use-admin-role";
import { useAuth } from "@/hooks/use-auth";
import { useProfile } from "@/hooks/use-profile";
import { cn } from "@/lib/utils";
import { WalletButton } from "@/components/common/wallet-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Menu, X, Search, User, LogOut, Copy, Check } from "lucide-react";

interface NavLink {
  href: string;
  label: string;
}

export function Navbar() {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);
  const { connected, publicKey, disconnect } = useWallet();
  const { isSuperadmin, isAdmin, isCreator, isOracle } = useAdminRole();
  const { token } = useAuth();
  const { data: profile } = useProfile(token);

  const roleLinks = useMemo(() => {
    const links: NavLink[] = [];

    if (connected && isCreator && !isAdmin && !isSuperadmin) {
      links.push({ href: "/creator", label: "Creator" });
    }
    if (connected && (isAdmin || isSuperadmin)) {
      links.push({ href: "/admin", label: "Admin" });
    }
    if (connected && isOracle) {
      links.push({ href: "/oracle", label: "Oracle" });
    }

    return links;
  }, [connected, isSuperadmin, isAdmin, isCreator, isOracle]);

  const allLinks: NavLink[] = [
    ...(connected ? [{ href: "/portfolio", label: "Portfolio" }] : []),
    ...roleLinks,
  ];

  const hasRoleLinks = roleLinks.length > 0;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (search.trim()) {
      router.push(`/?search=${encodeURIComponent(search.trim())}`);
    }
  };

  const displayName = profile?.username ?? (publicKey ? publicKey.toBase58().slice(0, 4) + "..." + publicKey.toBase58().slice(-4) : "");

  const handleCopyAddress = useCallback(() => {
    if (publicKey) {
      navigator.clipboard.writeText(publicKey.toBase58());
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  }, [publicKey]);

  return (
    <header className="sticky top-0 z-50 border-b border-border/40 bg-background/80 backdrop-blur-lg">
      <nav className="mx-auto flex h-16 max-w-7xl items-center gap-4 px-4 sm:px-6 lg:px-8">
        {/* Logo */}
        <Link
          href="/"
          className="flex shrink-0 items-center gap-2 text-xl font-bold tracking-tight transition-colors hover:text-primary"
        >
          <Image src="/dekant.png" alt="Dekant" width={28} height={28} className="rounded" />
          dekant
        </Link>

        {/* Search bar */}
        <form onSubmit={handleSearch} className={cn("relative flex-1", hasRoleLinks ? "max-w-md" : "max-w-xl")}>
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder="Search markets..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-9 pl-9 bg-muted/40 border-border/40"
          />
        </form>

        {/* Right side: nav links + wallet */}
        <div className="hidden items-center gap-1 md:flex">
          {allLinks.map(({ href, label }) => {
            const isActive =
              pathname === href || pathname.startsWith(href + "/");
            return (
              <Link
                key={href}
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
            );
          })}
        </div>

        {connected && publicKey ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="gap-2 text-sm font-medium"
              >
                <User className="h-3.5 w-3.5" />
                {displayName}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuItem onClick={() => router.push("/profile")}>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleCopyAddress}>
                {copied ? (
                  <Check className="mr-2 h-4 w-4 text-emerald-400" />
                ) : (
                  <Copy className="mr-2 h-4 w-4" />
                )}
                Copy Address
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => disconnect()}>
                <LogOut className="mr-2 h-4 w-4" />
                Disconnect
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <WalletButton />
        )}

        {/* Mobile hamburger */}
        <Button
          variant="ghost"
          size="icon"
          className="shrink-0 md:hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label="Toggle navigation"
        >
          {mobileOpen ? (
            <X className="h-5 w-5" />
          ) : (
            <Menu className="h-5 w-5" />
          )}
        </Button>
      </nav>

      {/* Mobile nav drawer */}
      {mobileOpen && (
        <div className="border-t border-border/40 bg-background/95 backdrop-blur-lg md:hidden animate-in slide-in-from-top-2 fade-in-0 duration-200">
          <ul className="mx-auto max-w-7xl space-y-1 px-4 py-3">
            {allLinks.map(({ href, label }) => {
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
            {connected && (
              <li>
                <Link
                  href="/profile"
                  onClick={() => setMobileOpen(false)}
                  className="block rounded-md px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground"
                >
                  Profile
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}
    </header>
  );
}
