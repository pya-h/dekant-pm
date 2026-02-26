import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { WalletButton } from "@/components/common/wallet-button";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-8 px-4">
      <div className="flex flex-col items-center gap-4 text-center">
        <Badge variant="secondary" className="text-sm">
          Devnet
        </Badge>
        <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
          DekantPM
        </h1>
        <p className="max-w-md text-lg text-muted-foreground">
          Continuous decentralized prediction market on Solana. Express full
          probability distributions, not just binary bets.
        </p>
      </div>
      <div className="flex gap-4">
        <Button asChild size="lg">
          <Link href="/markets">Explore Markets</Link>
        </Button>
        <WalletButton />
      </div>
    </div>
  );
}
