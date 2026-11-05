/**
 * Le rang d'une entrée d'historique dans l'app du téléphone (socle § 2.5) : 0 pour la première page
 * ouverte (lien, notification, rechargement), puis +1 à chaque page poussée dans l'app. Pur, testé.
 */
export function rangDansLApp(etat: unknown): number {
  const rang = typeof etat === "object" && etat !== null ? (etat as { klyraIdx?: unknown }).klyraIdx : undefined;
  return typeof rang === "number" && Number.isInteger(rang) && rang > 0 ? rang : 0;
}

/** Les paramètres qui ouvrent une page, sans remonter l'écran pour une recherche ou un filtre. */
export function clePageTelephone(pathname: string, params: Pick<URLSearchParams, "get">): string {
  let page: (string | null)[] = [];
  if (pathname === "/equipe") page = [params.get("agent"), params.get("mode") ?? params.get("section"), params.get("souvenir"), params.get("definition"), params.get("creer") ?? params.get("nouveau")];
  else if (pathname === "/chat") page = [params.get("id"), params.get("nouveau")];
  else if (pathname === "/projet" || pathname === "/fichiers") page = [params.get("id"), params.get("dossier"), params.get("fichier"), params.get("modifier")];
  else if (pathname === "/reglages") page = [params.get("section"), params.get("serveur")];
  else if (pathname === "/routines") page = [params.get("agent"), params.get("workflow")];
  else if (pathname === "/tickets") page = [params.get("id")];
  return JSON.stringify([pathname, ...page]);
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
