import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/ComingSoon";

export const metadata: Metadata = { title: "Réglages — KLYRA" };

export default function SettingsPage() {
  return <ComingSoon title="Réglages" description="Le compte, les rôles par défaut et les raccourcis arrivent bientôt." />;
}
