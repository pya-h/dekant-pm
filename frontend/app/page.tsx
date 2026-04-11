import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WalletButton } from "@/components/common/wallet-button";
import { env } from "@/lib/env";
import { ArrowRight, BarChart3, TrendingUp, Shield } from "lucide-react";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col">
      {/* Hero section */}
      <section className="relative flex flex-1 flex-col items-center justify-center gap-8 px-4 py-20 overflow-hidden">
        {/* Background gradient orbs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="absolute -top-40 left-1/4 h-80 w-80 rounded-full bg-primary/5 blur-3xl" />
          <div className="absolute -bottom-40 right-1/4 h-80 w-80 rounded-full bg-cyan-500/5 blur-3xl" />
        </div>

        <div className="relative flex flex-col items-center gap-6 text-center">
          <Badge
            variant="outline"
            className="text-xs uppercase tracking-widest"
          >
            {env.network}
          </Badge>

          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-5xl lg:text-6xl">
            Predict the future with{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-violet-400 bg-clip-text text-transparent">
              probability distributions
            </span>
          </h1>

          <p className="max-w-lg text-lg leading-relaxed text-muted-foreground">
            DekantPM is a continuous decentralized prediction market on Solana.
            Express full probability distributions over any outcome — not just
            binary bets.
          </p>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button asChild size="lg" className="gap-2">
              <Link href="/markets">
                Explore Markets
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <WalletButton />
          </div>
        </div>
      </section>

      {/* Feature cards */}
      <section className="border-t border-border/40 bg-muted/20">
        <div className="mx-auto grid max-w-5xl gap-6 px-4 py-16 sm:grid-cols-3 sm:px-6 lg:px-8">
          <FeatureCard
            icon={<BarChart3 className="h-5 w-5 text-cyan-400" />}
            title="Distribution Markets"
            description="Express beliefs as full probability curves over continuous ranges — not just yes or no."
          />
          <FeatureCard
            icon={<TrendingUp className="h-5 w-5 text-violet-400" />}
            title="L2-Norm AMM"
            description="Paradigm's constant-function AMM ensures fair pricing and deep automated liquidity."
          />
          <FeatureCard
            icon={<Shield className="h-5 w-5 text-emerald-400" />}
            title="On-Chain Settlement"
            description="All positions and payouts are settled transparently on Solana. No custodial risk."
          />
        </div>
      </section>
    </div>
  );
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="group rounded-xl border border-border/40 bg-card/50 p-6 transition-all duration-300 hover:border-border hover:shadow-lg hover:shadow-primary/5">
      <div className="mb-3 inline-flex rounded-lg bg-muted p-2.5">{icon}</div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
        {description}
      </p>
    </div>
  );
}
