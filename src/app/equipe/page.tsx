import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/ComingSoon";

export const metadata: Metadata = { title: "Équipe — KLYRA" };

export default function TeamPage() {
  return <ComingSoon title="Équipe" description="Les cartes des rôles arrivent bientôt." />;
}
