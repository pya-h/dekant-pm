"use client";

import { MarketSlideshow } from "./market-slideshow";
import { FeaturedSidebar } from "./featured-sidebar";

export function FeaturedSection() {
  return (
    <section className="grid gap-6 lg:grid-cols-[1fr_280px]">
      {/* Main slideshow */}
      <MarketSlideshow />

      {/* Sidebar */}
      <aside className="hidden lg:block rounded-xl border border-border bg-card p-4">
        <FeaturedSidebar />
      </aside>
    </section>
  );
}
