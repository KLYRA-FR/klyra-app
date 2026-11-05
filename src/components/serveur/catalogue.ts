import type { IconName } from "@/components/icons/Icon";
import { SECTIONS, type EntreeReglage, type IdSection } from "@/components/reglages/catalogue";

/**
 * Les Réglages du serveur : ce qui appartient à la machine où tournent les agents (Ce PC ou un VPS),
 * à part des Réglages de l'app, comme dans OpenBot. Sur le bureau, les sections Claude et Autres IA
 * des Réglages de l'app vivent ici, dans Fournisseurs ; le téléphone garde les siennes. Agents et
 * Computer Use restent dans les Réglages de l'app : ils règlent cet ordinateur, pas un serveur.
 */

export type IdSectionServeur = "general" | "fournisseurs";

export interface SectionServeur {
  id: IdSectionServeur;
  titre: string;
  icone: IconName;
  description: string;
  entrees: EntreeReglage[];
}

const reprise = (id: IdSection) => SECTIONS.find((s) => s.id === id)!;

export const SECTIONS_SERVEUR: SectionServeur[] = [
  {
    id: "general",
    titre: "Général",
    icone: "settings",
    description: "Ce serveur : où il est, sa version, et les moteurs qui font travailler les agents.",
    entrees: [
      { id: "serveur-nom", titre: "Nom du serveur", mots: "machine ordinateur vps" },
      { id: "serveur-version", titre: "Version du code de ce serveur", mots: "numero mise a jour retard ancien commande lancer" },
      { id: "serveur-moteurs", titre: "Moteurs installés", mots: "claude code codex grok build versions" },
      { id: "diagnostic-serveur", titre: "Ce que ce serveur ajoute", mots: "claude.md plugins skills mcp configuration jetons diagnostic" },
    ],
  },
  {
    id: "fournisseurs",
    titre: "Fournisseurs",
    icone: "stars",
    description: "Les IA de ce serveur : celles qui font travailler les agents, et celles qu’ils peuvent consulter.",
    entrees: [
      { id: "fournisseurs-liste", titre: "Fournisseurs connectés", mots: "claude chatgpt openai codex grok xai ia changer" },
      { id: "autres-ia", titre: "IA à consulter et leurs clés", mots: "autres ia chatgpt openai gemini mistral deepseek grok xai openrouter cle api trousseau deuxieme avis" },
      { id: "compte-chatgpt", titre: "Compte ChatGPT", mots: "openai codex connexion deconnexion abonnement plus pro" },
      { id: "cle-api-chatgpt", titre: "Clé API d’OpenAI", mots: "chatgpt codex cle trousseau" },
      { id: "compte-grok", titre: "Compte Grok", mots: "xai grok build supergrok x premium connexion deconnexion abonnement" },
      { id: "cle-api-grok", titre: "Clé API d’xAI", mots: "grok xai console cle trousseau" },
      { id: "moteur-version", titre: "Version et mise à jour des moteurs", mots: "claude code codex grok build installer mettre a jour disponible" },
      ...reprise("claude").entrees,
    ],
  },
];

/** Les sections des Réglages de l'app qui sont maintenant ici (sur le bureau), et où les ouvrir. */
export const DEPLACEES: Partial<Record<IdSection, { section: IdSectionServeur; fournisseur?: string }>> = {
  claude: { section: "fournisseurs", fournisseur: "claude" },
  "autres-ia": { section: "fournisseurs" },
};

/** Le chemin d'une section des Réglages du serveur, et d'un réglage où mener. */
export function cheminServeur(section: IdSectionServeur, o: { fournisseur?: string | null; reglage?: string | null; serveur?: string | null } = {}): string {
  const p = new URLSearchParams({ section });
  if (o.fournisseur) p.set("fournisseur", o.fournisseur);
  if (o.serveur) p.set("serveur", o.serveur);
  if (o.reglage) p.set("reglage", o.reglage);
  return `/serveur/reglages?${p.toString()}`;
}

/** Le réglage `id` d'une section déplacée : celui de Claude se trouve sur la page du fournisseur Claude. */
export function cheminDeplace(section: IdSection, reglage: string | null = null): string | null {
  const ici = DEPLACEES[section];
  return ici ? cheminServeur(ici.section, { fournisseur: ici.fournisseur, reglage }) : null;
}

export const estSectionServeur = (id: string | null | undefined): id is IdSectionServeur => SECTIONS_SERVEUR.some((s) => s.id === id);
