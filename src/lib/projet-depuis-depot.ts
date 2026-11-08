import type { DepotGithubProjet } from "../../electron/github-types";
import { formatListDate } from "@/lib/format";
import type { Project } from "@/types/domain";

/**
 * Un projet ouvert depuis un dépôt GitHub, sans formulaire : ce que GitHub dit du dépôt suffit.
 * Le nom vient du dépôt, la ligne de description de sa description, l'aperçu de son site.
 * Le reste (statut, épingle, brief) se règle ensuite, au clic droit ou dans « Modifier ».
 */

const plat = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLocaleLowerCase("fr");

/** Un identifiant lisible tiré du nom (« klyra-app »), unique parmi les projets. */
export function identifiantProjet(nom: string, existants: Pick<Project, "id">[]): string {
  const base = plat(nom).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "projet";
  let id = base;
  for (let i = 2; existants.some((p) => p.id === id); i++) id = `${base}-${i}`;
  return id;
}

/** Le projet de ce dépôt déjà ouvert sur cette machine (sa branche par défaut, ou la première trouvée). */
export function projetDuDepot(nom: string, lieu: string | null, projets: Project[]): Project | undefined {
  const ici = projets.filter((p) => p.depot === nom && (p.lieu ?? null) === lieu);
  return ici.find((p) => p.githubConnecte) ?? ici[0];
}

/**
 * Le projet à enregistrer après le clone. Si un projet de cette machine pointe déjà sur ce dossier
 * (le même dépôt, la même branche), on le rouvre : jamais de doublon.
 */
export function projetDepuisDepot({
  depot,
  branche,
  dossier,
  lieu,
  projets,
  maintenant = new Date(),
}: {
  depot: DepotGithubProjet;
  branche: string;
  dossier: string;
  lieu: string | null;
  projets: Project[];
  maintenant?: Date;
}): { projet: Project; existant: boolean } {
  const deja = projets.find((p) => p.folder === dossier && (p.lieu ?? null) === lieu);
  if (deja) return { projet: deja, existant: true };
  const repo = depot.nom.split("/").pop() ?? depot.nom;
  const nom = depot.branche && branche !== depot.branche ? `${repo} (${branche})` : repo;
  return {
    existant: false,
    projet: {
      id: identifiantProjet(nom, projets),
      name: nom,
      subtitle: depot.description ?? "",
      brief: "",
      previewUrl: (depot.site ?? "").replace(/^https?:\/\//, "").replace(/\/$/, ""),
      status: "en-cours",
      pinned: false,
      folder: dossier,
      ...(lieu ? { lieu } : {}),
      depot: depot.nom,
      githubConnecte: true,
      roleIds: ["principal"],
      files: [],
      updatedAt: maintenant.toISOString(),
    },
  };
}

/**
 * Les dépôts à montrer pour une recherche : nom ou description, sans accent ni casse ; les plus récemment
 * modifiés d'abord, les archivés à la fin.
 */
export function depotsTrouves(depots: DepotGithubProjet[], recherche: string): DepotGithubProjet[] {
  const mots = plat(recherche).split(/\s+/).filter(Boolean);
  const trouves = depots.filter((d) => {
    const texte = plat(`${d.nom} ${d.description ?? ""}`);
    return mots.every((m) => texte.includes(m));
  });
  const date = (d: DepotGithubProjet) => (d.pousseLe ? Date.parse(d.pousseLe) : 0);
  return trouves
    .map((d, i) => ({ d, i }))
    .sort((a, b) => Number(a.d.archive) - Number(b.d.archive) || date(b.d) - date(a.d) || a.i - b.i)
    .map(({ d }) => d);
}

/** « TypeScript · modifié hier » : ce qui aide à reconnaître un dépôt dans la liste. */
export function detailsDepot(d: DepotGithubProjet, maintenant: Date = new Date()): string {
  const parties: string[] = [];
  if (d.prive) parties.push("Privé");
  if (d.archive) parties.push("Archivé");
  if (!d.branche) parties.push("Vide");
  if (d.langage) parties.push(d.langage);
  if (d.pousseLe) {
    const quand = formatListDate(d.pousseLe, maintenant);
    parties.push(`modifié ${/^\d/.test(quand) && quand.includes(":") ? "aujourd’hui" : quand.toLocaleLowerCase("fr")}`);
  }
  return parties.join(" · ");
}
