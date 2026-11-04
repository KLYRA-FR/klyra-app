/**
 * Quel espace montre un rendu. L'origine d'un livrable de VPS est `https://hôte#/chemin`
 * (cf. `workspace.tsx`). Un chemin de fichier est un livrable de ce PC.
 * `espace` null : Ce PC, le même `lieu` que le sélecteur.
 */

export function lieuDuRendu(origine: string): string | null {
  const i = origine.indexOf("#");
  if (i <= 0) return null;
  const lieu = origine.slice(0, i);
  return /^https?:\/\//.test(lieu) ? lieu : null;
}

export function renduDansEspace(origine: string, espace: string | null): boolean {
  return lieuDuRendu(origine) === (espace ?? null);
}

/** L'agent envoyé à Convex, ou null si le nom n'est pas un identifiant d'agent. */
export function agentPartageable(agent: string | null | undefined): string | null {
  if (!agent || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(agent)) return null;
  return agent;
}

/** Le coût Convex, sans liste : « Espace du compte : 12 Ko ». `complet` faux : le chiffre est un minimum. */
export function texteEspace(octets: number, complet: boolean): string {
  const texte = formaterOctets(octets);
  return complet ? `Espace du compte : ${texte}` : `Espace du compte : au moins ${texte}`;
}

function formaterOctets(octets: number): string {
  const n = (v: number) => v.toLocaleString("fr-FR", { maximumFractionDigits: 1 });
  if (octets < 1024) return `${octets} o`;
  if (octets < 1024 * 1024) return `${n(octets / 1024)} Ko`;
  if (octets < 1024 * 1024 * 1024) return `${n(octets / (1024 * 1024))} Mo`;
  return `${n(octets / (1024 * 1024 * 1024))} Go`;
}
