import type { Rendu, TypeRendu } from "@/types/domain";

/**
 * Les rendus des agents (outil `publier_artefact`) : ce qu'un agent publie, lu et rangé sans Electron.
 * L'app en garde une copie dans l'espace de l'agent (cf. `electron/rendus.ts`), avec un titre et à quoi il sert.
 */

const TYPES: [RegExp, TypeRendu][] = [
  [/\.html?$/i, "page"],
  [/\.(png|jpe?g|gif|webp|svg|avif|bmp)$/i, "image"],
  [/\.(mp4|webm|mov|m4v)$/i, "video"],
  [/\.pdf$/i, "pdf"],
];

export function typeDeRendu(chemin: string): TypeRendu {
  return TYPES.find(([motif]) => motif.test(chemin))?.[1] ?? "document";
}

/** Un chemin complet : /…, ~/…, C:\… ou \\serveur\… */
export function estCheminComplet(chemin: string): boolean {
  return /^(\/|~[\\/]|[A-Za-z]:[\\/]|\\\\)/.test(chemin);
}

/** Le nom du fichier, sans le dossier (Windows ou non). */
export function nomDuFichier(chemin: string): string {
  return chemin.split(/[\\/]/).filter(Boolean).pop() ?? chemin;
}

export interface PublicationRendu {
  chemin: string;
  titre: string;
  description: string;
}

/** Ce que l'agent a envoyé à `publier_artefact`, vérifié ; une erreur dit quoi corriger. */
export function lirePublication(args: Record<string, unknown>): PublicationRendu {
  const chemin = typeof args.chemin === "string" ? args.chemin.trim() : "";
  if (!chemin) throw new Error("Indique le chemin du fichier (chemin).");
  if (!estCheminComplet(chemin)) throw new Error(`Donne le chemin complet du fichier, pas « ${chemin} ».`);
  const titre = (typeof args.titre === "string" ? args.titre : "").trim().replace(/\s+/g, " ") || nomDuFichier(chemin);
  const description = (typeof args.description === "string" ? args.description : "").trim();
  return { chemin, titre: titre.slice(0, 80), description: description.slice(0, 500) };
}

/** L'original déjà publié : sa fiche, pour remplacer sa copie au lieu d'en ajouter une. */
export function renduDeLOrigine(rendus: Rendu[], origine: string): Rendu | undefined {
  return rendus.find((r) => r.origine === origine);
}

/**
 * Un livrable annoncé par le VPS, sans copie sur ce PC.
 * `chemin` reste vide : le fichier est servi depuis le serveur (`distantId`).
 */
export function renduDepuisServeur(
  lieu: string,
  annonce: { id: string; chemin: string; dossier: boolean; taille: number; titre: string; description: string; agent: string },
  chat: { id: string; projectId: string | null } | undefined,
  maintenant: string,
  id: string,
): Rendu {
  return {
    id,
    chemin: "",
    origine: `${lieu}#${annonce.chemin}`,
    distantId: annonce.id,
    dossier: annonce.dossier,
    taille: annonce.taille,
    titre: annonce.titre || nomDuFichier(annonce.chemin),
    description: annonce.description,
    type: annonce.dossier ? "page" : typeDeRendu(annonce.chemin),
    roleId: annonce.agent,
    chatId: chat?.id ?? null,
    projectId: chat?.projectId ?? null,
    ajouteLe: maintenant,
    misAJour: maintenant,
  };
}

/** Publier deux fois le même original met son rendu à jour (copie, titre, description, date) et le remonte. */
export function publierRendu(rendus: Rendu[], nouveau: Rendu): Rendu[] {
  const existant = renduDeLOrigine(rendus, nouveau.origine);
  if (!existant) return [nouveau, ...rendus];
  const misAJour: Rendu = { ...nouveau, id: existant.id, ajouteLe: existant.ajouteLe };
  return [misAJour, ...rendus.filter((r) => r.id !== existant.id)];
}
