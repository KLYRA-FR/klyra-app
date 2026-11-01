/** Lien `klyra://rejoindre` que l’app doit ouvrir. Null si ce n’est pas ce lien. */
export function lienRejoindre(lien: unknown): string | null {
  if (typeof lien !== "string" || lien.length < 16 || lien.length > 2048) return null;
  try {
    const url = new URL(lien);
    if (url.protocol !== "klyra:" || url.hostname !== "rejoindre") return null;
    const adresse = url.searchParams.get("adresse")?.trim() ?? "";
    if (!adresse || adresse.length > 300) return null;
    return lien;
  } catch {
    return null;
  }
}
