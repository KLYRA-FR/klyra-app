import type { Metadata } from "next";
import { EcranServeurs } from "@/components/telephone/ServeursTelephone";

export const metadata: Metadata = { title: "Serveurs — KLYRA" };

/** À partir de 760 px, la fenêtre montre cet écran. Sous 760 px, la coque le remplace. */
export default function ServeursPage() {
  return <EcranServeurs cadre="bureau" />;
}
