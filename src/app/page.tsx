import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/ComingSoon";

export const metadata: Metadata = { title: "Accueil — KLYRA" };

export default function HomePage() {
  return <ComingSoon title="Accueil" description="L’accueil arrive bientôt : composeur central, accès direct aux rôles et ce que fait l’équipe." />;
}
