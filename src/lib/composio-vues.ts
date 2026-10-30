import type { VueCompteComposio } from "./bridge";

export const nomCompteComposio = (c: VueCompteComposio) => c.nom || c.alias || `Compte sans nom · ${c.id.slice(-4)}`;
export const compteComposioActif = (c: VueCompteComposio) => c.statut === "ACTIVE" && !c.desactive;

export function statutCompteComposio(c: VueCompteComposio): { texte: string; ton: "ok" | "attente" | "neutre" } {
  if (c.desactive || c.statut === "INACTIVE") return { texte: "Désactivé", ton: "neutre" };
  switch (c.statut) {
    case "ACTIVE": return { texte: "Connecté", ton: "ok" };
    case "EXPIRED": return { texte: "Expiré", ton: "attente" };
    case "FAILED": return { texte: "Échec", ton: "attente" };
    case "INITIATED": case "INITIALIZING": return { texte: "En attente", ton: "attente" };
    case "REVOKED": return { texte: "Déconnecté", ton: "neutre" };
    default: return { texte: "État inconnu", ton: "neutre" };
  }
}

export const heureComposio = (date: number | string) => {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleTimeString("fr", { hour: "2-digit", minute: "2-digit" });
};
