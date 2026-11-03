import type { Rendu, TypeRendu } from "@/types/domain";

/**
 * Les rendus des agents (outil `publier_artefact`) : ce qu'un agent publie, lu et rangé sans Electron.
 * Le fichier reste où l'agent l'a écrit : on ne garde que son chemin, un titre et à quoi il sert.
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

/** Publier deux fois le même fichier met à jour son rendu (titre, description, date) au lieu d'en ajouter un. */
export function publierRendu(rendus: Rendu[], nouveau: Rendu): Rendu[] {
  const existant = rendus.find((r) => r.chemin === nouveau.chemin);
  if (!existant) return [nouveau, ...rendus];
  const misAJour: Rendu = { ...existant, titre: nouveau.titre, description: nouveau.description, type: nouveau.type, roleId: nouveau.roleId, chatId: nouveau.chatId, projectId: nouveau.projectId, misAJour: nouveau.misAJour };
  return [misAJour, ...rendus.filter((r) => r.id !== existant.id)];
}
