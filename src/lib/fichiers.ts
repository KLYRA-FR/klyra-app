/** Nom à afficher d'un chemin disque Windows ou Unix, sans modifier le chemin utilisé pour l'ouvrir. Pas pour les URL. */
export function nomFichier(chemin: string): string {
  return chemin.split(/[\\/]/).filter(Boolean).pop() ?? chemin;
}

/** Les images que l'app sait montrer et que les agents savent lire. */
export function estImage(chemin: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(nomFichier(chemin));
}

/** La taille d'un fichier, lisible : « 234 Ko ». */
export function tailleLisible(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} Ko`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} Mo`;
}
