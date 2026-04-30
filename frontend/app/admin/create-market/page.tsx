"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Redirect old admin create-market URL to the new creator dashboard path. */
export default function AdminCreateMarketRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace("/creator/create-market");
  }, [router]);
  return null;
}
