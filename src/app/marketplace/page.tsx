import type { Metadata } from "next";
import { MarketplaceScreen } from "@/components/marketplace/MarketplaceScreen";

export const metadata: Metadata = { title: "Marketplace — KLYRA" };

export default function MarketplacePage() {
  return <MarketplaceScreen />;
}
