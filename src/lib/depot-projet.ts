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
