/**
 * Le rang d'une entrée d'historique dans l'app du téléphone (socle § 2.5) : 0 pour la première page
 * ouverte (lien, notification, rechargement), puis +1 à chaque page poussée dans l'app. Pur, testé.
 */
export function rangDansLApp(etat: unknown): number {
  const rang = typeof etat === "object" && etat !== null ? (etat as { klyraIdx?: unknown }).klyraIdx : undefined;
  return typeof rang === "number" && Number.isInteger(rang) && rang > 0 ? rang : 0;
}

/**
 * L'onglet de la barre du bas qui contient une route (socle § 2.1, C-4). Toute route inconnue est
 * rangée dans Plus.
 */
export type OngletTelephone = "/chats" | "/planning" | "/equipe" | "/projets" | "/plus";

const ROUTES: Record<Exclude<OngletTelephone, "/plus">, string[]> = {
  "/chats": ["/", "/chats", "/chat"],
  "/planning": ["/planning"],
  "/equipe": ["/equipe"],
  "/projets": ["/projets", "/projet", "/fichiers"],
};

export function ongletDe(pathname: string): OngletTelephone {
  const chemin = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  for (const [onglet, routes] of Object.entries(ROUTES) as [OngletTelephone, string[]][]) {
    if (routes.includes(chemin)) return onglet;
  }
  return "/plus";
}
