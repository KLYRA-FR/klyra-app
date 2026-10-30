import type { PropositionAgent } from "@/types/domain";

/**
 * La fiche d'agent que l'assistant propose (outil `proposer_agent`) : lue dans l'entrée de l'outil,
 * puis passée à l'éditeur, qui la montre préremplie. Rien n'est écrit sur le disque avant
 * « Enregistrer ».
 */

const texte = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");

export function lireProposition(entree: Record<string, unknown>): PropositionAgent | null {
  const proposition = {
    id: texte(entree.id, 64)
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, ""),
    nom: texte(entree.nom, 60),
    role: texte(entree.role, 40),
    description: texte(entree.description, 1200),
    consignes: texte(entree.consignes, 40_000),
  };
  return proposition.nom && proposition.consignes ? proposition : null;
}

const CLE = "klyra:proposition-agent";

/** Le brouillon passé à l'éditeur (le temps d'une navigation, jamais gardé après la fermeture de l'app). */
export function confierAEditeur(proposition: PropositionAgent): void {
  try {
    sessionStorage.setItem(CLE, JSON.stringify(proposition));
  } catch {
    /* sans stockage : l'éditeur s'ouvre vide */
  }
}

export function reprendreDansEditeur(): PropositionAgent | null {
  try {
    const brut = sessionStorage.getItem(CLE);
    sessionStorage.removeItem(CLE);
    return brut ? lireProposition(JSON.parse(brut) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
