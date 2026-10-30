/** Nom à afficher d'un chemin disque Windows ou Unix, sans modifier le chemin utilisé pour l'ouvrir. Pas pour les URL. */
export function nomFichier(chemin: string): string {
  return chemin.split(/[\\/]/).filter(Boolean).pop() ?? chemin;
}
