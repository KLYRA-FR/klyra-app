import type { FaconReessai } from "@/lib/workspace";

/**
 * Ce qui part avec un message écrit sur le téléphone (`messagesFile.options`, spec mobile T-02) :
 * le destinataire, le modèle et l'effort, une façon de refaire une réponse, une branche, une nouvelle
 * conversation d'équipe, l'ordinateur visé. L'ordinateur relit tout (`lireOptions`) : rien n'est cru.
 */
export interface OptionsMessage {
  /** Le destinataire dans une conversation d'équipe (« Destinataire », « @Hugo »). */
  a?: string;
  /** Présents : le modèle et l'effort choisis dans la feuille (null : ceux de la fiche). */
  modele?: string | null;
  effort?: string | null;
  /** Refaire une réponse (« Réessayer », « Plus concis », « Changer de modèle »…). */
  reessayer?: { messageId: string; facon: FaconReessai; modele?: string };
  /** « Créer une branche dans une nouvelle conversation » à partir de ce message. */
  brancher?: { messageId: string };
  /** Le premier message d'une conversation d'équipe ouverte sur le téléphone, dans ce projet. */
  nouveau?: { projetId: string };
  /** Avec deux ordinateurs ou plus : celui qui doit le prendre (sa clé). */
  poste?: string;
}

export const FACONS: readonly FaconReessai[] = ["reessayer", "details", "concis", "web"];

const ID = /^[\w.:-]{1,200}$/;
const ALIAS = /^[a-z0-9][a-z0-9.-]{0,39}$/;
const CLE_POSTE = /^[\w-]{8,80}$/;

const texte = (v: unknown, motif: RegExp): string | undefined => (typeof v === "string" && motif.test(v) ? v : undefined);
const objet = (v: unknown): Record<string, unknown> | null => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);

/** Les options relues, champ par champ : un champ mal formé est ignoré, jamais transmis tel quel. */
export function lireOptions(json: string | null | undefined): OptionsMessage {
  if (!json) return {};
  let brut: Record<string, unknown> | null;
  try {
    brut = objet(JSON.parse(json));
  } catch {
    return {};
  }
  if (!brut) return {};
  const options: OptionsMessage = {};
  const a = texte(brut.a, ID);
  if (a) options.a = a;
  if ("modele" in brut) options.modele = brut.modele === null ? null : (texte(brut.modele, ALIAS) ?? null);
  if ("effort" in brut) options.effort = brut.effort === null ? null : (texte(brut.effort, ALIAS) ?? null);
  const reessai = objet(brut.reessayer);
  const facon = reessai?.facon;
  const messageReessai = texte(reessai?.messageId, ID);
  if (messageReessai && typeof facon === "string" && (FACONS as readonly string[]).includes(facon)) {
    const modele = texte(reessai?.modele, ALIAS);
    options.reessayer = { messageId: messageReessai, facon: facon as FaconReessai, ...(modele ? { modele } : {}) };
  }
  const branche = texte(objet(brut.brancher)?.messageId, ID);
  if (branche) options.brancher = { messageId: branche };
  const projet = texte(objet(brut.nouveau)?.projetId, ID);
  if (projet) options.nouveau = { projetId: projet };
  const poste = texte(brut.poste, CLE_POSTE);
  if (poste) options.poste = poste;
  return options;
}

/** Un message pour cet ordinateur : sans ordinateur visé, le premier ouvert le prend. */
export function pourCePoste(options: OptionsMessage, cle: string | null): boolean {
  return !options.poste || options.poste === cle;
}

/** Les options écrites pour le compte, sans les champs vides ; null s'il n'y a rien. */
export function ecrireOptions(options: OptionsMessage): string | null {
  const propres = Object.fromEntries(Object.entries(options).filter(([, v]) => v !== undefined));
  return Object.keys(propres).length ? JSON.stringify(propres) : null;
}

/** Le modèle et l'effort choisis pour une conversation, tels que l'ordinateur les copie (`conversationsCompte.modele`). */
export function lireModele(json: string | null | undefined): { modele: string | null; effort: string | null } | null {
  if (!json) return null;
  try {
    const brut = objet(JSON.parse(json));
    if (!brut) return null;
    return { modele: texte(brut.modele, ALIAS) ?? null, effort: texte(brut.effort, ALIAS) ?? null };
  } catch {
    return null;
  }
}
