import type { IconName } from "@/components/icons/Icon";
import { SECTIONS, type EntreeReglage, type IdSection } from "@/components/reglages/catalogue";

/**
 * Les Réglages du serveur : ce qui appartient à la machine où tournent les agents (Ce PC ou un VPS),
 * à part des Réglages de l'app, comme dans OpenBot. Sur le bureau, les sections Claude, Agents,
 * Autres IA et Computer Use des Réglages de l'app vivent ici ; le téléphone garde les siennes.
 */

export type IdSectionServeur = "general" | "fournisseurs" | "agents" | "autres-ia" | "computer-use";

export interface SectionServeur {
  id: IdSectionServeur;
  titre: string;
  icone: IconName;
  description: string;
  entrees: EntreeReglage[];
  /** Seulement pour Ce PC : un VPS n'a pas (encore) ces réglages. */
  pcSeulement?: boolean;
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
      { id: "serveur-version", titre: "Version de KLYRA sur ce serveur", mots: "numero" },
      { id: "serveur-moteurs", titre: "Moteurs installés", mots: "claude code codex versions" },
    ],
  },
  {
    id: "fournisseurs",
    titre: "Fournisseurs",
    icone: "stars",
    description: "Les IA qui font travailler les agents sur ce serveur : leurs comptes, leurs clés et leurs versions.",
    entrees: [
      { id: "fournisseurs-liste", titre: "Fournisseurs connectés", mots: "claude chatgpt openai codex ia changer" },
      { id: "compte-chatgpt", titre: "Compte ChatGPT", mots: "openai codex connexion deconnexion abonnement plus pro" },
      { id: "cle-api-chatgpt", titre: "Clé API d’OpenAI", mots: "chatgpt codex cle trousseau" },
      { id: "moteur-version", titre: "Version et mise à jour des moteurs", mots: "claude code codex installer mettre a jour disponible" },
      ...reprise("claude").entrees,
    ],
  },
  { ...reprise("agents"), id: "agents", pcSeulement: true, entrees: [...reprise("agents").entrees, { id: "fournisseur-agent", titre: "Fournisseur de chaque agent", mots: "chatgpt claude codex ia par defaut" }] },
  { ...reprise("autres-ia"), id: "autres-ia", pcSeulement: true },
  { ...reprise("computer-use"), id: "computer-use", pcSeulement: true },
];

/** Les sections des Réglages de l'app qui sont maintenant ici (sur le bureau), et où les ouvrir. */
export const DEPLACEES: Partial<Record<IdSection, { section: IdSectionServeur; fournisseur?: string }>> = {
  claude: { section: "fournisseurs", fournisseur: "claude" },
  agents: { section: "agents" },
  "autres-ia": { section: "autres-ia" },
  "computer-use": { section: "computer-use" },
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
