import type { EtatGit } from "@/lib/bridge";

/**
 * Ce que la page d'un projet dit de son dépôt (DepotProjet). Le distant n'est jamais montré tel quel :
 * une adresse https peut porter un identifiant ou un jeton (« https://x:jeton@github.com/… »).
 */
export function nomDepot(depot: string | undefined, distant: string | null): string {
  if (depot) return depot;
  if (!distant) return "Dépôt distant";
  const ssh = distant.match(/^(?:ssh:\/\/)?[^@/\s]+@([^:/\s]+)[:/](.+?)(?:\.git)?\/?$/);
  if (ssh) return ssh[1].toLowerCase() === "github.com" ? ssh[2] : `${ssh[1]}/${ssh[2]}`;
  try {
    const u = new URL(distant);
    const chemin = u.pathname.replace(/^\/|\/$/g, "").replace(/\.git$/, "");
    if (u.protocol === "file:") return "Dépôt local";
    return /^(www\.)?github\.com$/i.test(u.hostname) ? chemin : `${u.hostname}/${chemin}`;
  } catch {
    return "Dépôt distant";
  }
}

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** « Branche main · 2 nouveautés à récupérer · 1 fichier modifié ici ». */
export function resumeDepot(etat: Pick<EtatGit, "branche" | "suivie" | "enAvance" | "enRetard" | "fichiers">): string {
  const parties = [etat.branche ? `Branche ${etat.branche}` : "Aucune branche"];
  if (!etat.suivie) parties.push("pas encore sur le dépôt distant");
  const retard = etat.enRetard ?? 0;
  if (retard > 0) parties.push(`${pluriel(retard, "nouveauté", "nouveautés")} à récupérer`);
  if (etat.enAvance > 0) parties.push(`${pluriel(etat.enAvance, "commit", "commits")} à envoyer`);
  if (etat.fichiers.length > 0) parties.push(`${pluriel(etat.fichiers.length, "fichier modifié", "fichiers modifiés")} ici`);
  if (etat.suivie && retard === 0 && etat.enAvance === 0 && etat.fichiers.length === 0) parties.push("à jour depuis la dernière récupération");
  return parties.join(" · ");
}

/**
 * Où vit un projet, en mots : « Sur VPS Hetzner » pour un serveur (le chemin brut, sous
 * /var/lib/klyra/projets, ne dit rien à la personne), le dossier avec « ~ » sur ce poste
 * (/Users/x, /home/x ou C:\Users\x).
 */
export function emplacementProjet(folder: string, lieu: string | null | undefined, nomServeur: string): string {
  if (lieu) return `Sur ${nomServeur}`;
  return folder.replace(/^(?:\/Users\/[^/]+|\/home\/[^/]+|[A-Za-z]:\\Users\\[^\\]+)(?=$|[\\/])/, "~");
}

/** La même chose en une ligne courte, pour le panneau d'un projet : « main · 2 à récupérer · 1 modifié ». */
export function resumeCourt(etat: Pick<EtatGit, "branche" | "suivie" | "enAvance" | "enRetard" | "fichiers">): string {
  const parties = [etat.branche ?? "Aucune branche"];
  if (!etat.suivie) parties.push("pas sur GitHub");
  if ((etat.enRetard ?? 0) > 0) parties.push(`${etat.enRetard} à récupérer`);
  if (etat.enAvance > 0) parties.push(`${etat.enAvance} à envoyer`);
  if (etat.fichiers.length > 0) parties.push(pluriel(etat.fichiers.length, "modifié", "modifiés"));
  if (parties.length === 1) parties.push("à jour");
  return parties.join(" · ");
}
