import { net } from "electron";
import type { EtatConsignesProjet } from "./consignes-projet";
import { contenuFichier, type ContenuFichier, type Noeud } from "./projets";
import type { ReglesProjet } from "./regles-projet";
import type { MessageSession, SessionTerminal } from "./sessions-terminal";

/**
 * Les projets d'un VPS relié : l'arbre et les octets viennent du serveur (serveur/fichiers.mjs),
 * l'aperçu se fait ici, comme pour un projet du PC. Ouvrir dans une autre app ou dans le
 * gestionnaire de fichiers n'a pas de sens pour un fichier du VPS.
 */

const ATTENTE_MS = 20_000;

async function appel(origine: string, jeton: string | null, chemin: string, methode: "GET" | "POST" = "GET", corps?: unknown): Promise<Record<string, unknown>> {
  if (!jeton) throw new Error("Ce PC n’est plus relié à ce VPS. Relance la commande sur le VPS et colle le nouveau lien dans Serveurs.");
  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_MS);
  try {
    const reponse = await net.fetch(`${origine}${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${jeton}`, ...(corps === undefined ? {} : { "Content-Type": "application/json" }) },
      signal: controle.signal,
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
    const json = (await reponse.json().catch(() => null)) as Record<string, unknown> | null;
    if (reponse.status === 401) throw new Error("Ce PC n’est plus relié à ce VPS.");
    if (!reponse.ok || !json) throw new Error(typeof json?.message === "string" ? json.message : "Le VPS ne sait pas encore lire les projets : relance la commande d’installation.");
    return json;
  } catch (error) {
    if (error instanceof Error && error.name !== "AbortError" && !/fetch|net::/i.test(error.message)) throw error;
    throw new Error("Le VPS ne répond pas.");
  } finally {
    clearTimeout(delai);
  }
}

const requete = (dossier: string, relatif?: string) =>
  `dossier=${encodeURIComponent(dossier)}${relatif ? `&relatif=${encodeURIComponent(relatif)}` : ""}`;

export async function arbreVps(origine: string, jeton: string | null, dossier: string, relatif: string): Promise<Noeud[]> {
  const json = await appel(origine, jeton, `/klyra/v1/fichiers/arbre?${requete(dossier, relatif)}`);
  if (!Array.isArray(json.noeuds)) throw new Error("Réponse illisible du VPS.");
  return (json.noeuds as Noeud[]).filter((n) => typeof n?.name === "string" && typeof n.path === "string" && (n.kind === "dossier" || n.kind === "fichier"));
}

/** Tous les fichiers d'un projet du VPS (chemins relatifs), pour la complétion « @ » du composeur. */
export async function fichiersVps(origine: string, jeton: string | null, dossier: string): Promise<{ fichiers: string[]; coupe: boolean }> {
  const json = await appel(origine, jeton, `/klyra/v1/fichiers/liste?${requete(dossier)}`);
  if (!Array.isArray(json.fichiers)) throw new Error("Réponse illisible du VPS.");
  return { fichiers: (json.fichiers as unknown[]).filter((f): f is string => typeof f === "string"), coupe: json.coupe === true };
}

/** Les autorisations retenues d'un projet du VPS ; `retirer` : en retire une. */
export async function reglesVps(origine: string, jeton: string | null, dossier: string, retirer?: { liste: string; regle: string }): Promise<ReglesProjet> {
  const json = await appel(origine, jeton, `/klyra/v1/fichiers/regles?${requete(dossier)}`, retirer ? "POST" : "GET", retirer);
  const r = (json.regles ?? {}) as Partial<ReglesProjet>;
  const liste = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  return { allow: liste(r.allow), ask: liste(r.ask), deny: liste(r.deny) };
}

/** Une branche de travail d'un projet du VPS (`git worktree`), ou la retirer. */
export async function brancheVps(origine: string, jeton: string | null, dossier: string, demande: { nom: string } | { retirer: true }): Promise<{ dossier: string; branche: string } | null> {
  const json = await appel(origine, jeton, `/klyra/v1/fichiers/branche?${requete(dossier)}`, "POST", demande);
  if ("retirer" in demande) return null;
  const b = (json.branche ?? {}) as { dossier?: unknown; branche?: unknown };
  if (typeof b.dossier !== "string" || typeof b.branche !== "string") throw new Error("Réponse illisible du VPS.");
  return { dossier: b.dossier, branche: b.branche };
}

/** Les sessions de Claude Code d'un projet du VPS lancées hors de l'app ; avec `id` : les messages de l'une d'elles. */
export async function sessionsTerminalVps(origine: string, jeton: string | null, dossier: string): Promise<SessionTerminal[]> {
  const json = await appel(origine, jeton, `/klyra/v1/fichiers/sessions?${requete(dossier)}`);
  return Array.isArray(json.sessions) ? (json.sessions as SessionTerminal[]).filter((s) => typeof s?.id === "string" && typeof s.titre === "string") : [];
}
export async function sessionTerminalVps(origine: string, jeton: string | null, dossier: string, id: string): Promise<MessageSession[]> {
  const json = await appel(origine, jeton, `/klyra/v1/fichiers/session?${requete(dossier)}&id=${encodeURIComponent(id)}`);
  return Array.isArray(json.messages) ? (json.messages as MessageSession[]).filter((m) => (m?.auteur === "personne" || m?.auteur === "agent") && typeof m.texte === "string") : [];
}

export async function lireFichierVps(origine: string, jeton: string | null, dossier: string, relatif: string): Promise<ContenuFichier> {
  const json = await appel(origine, jeton, `/klyra/v1/fichiers/lire?${requete(dossier, relatif)}`);
  const taille = typeof json.taille === "number" ? json.taille : 0;
  const nom = typeof json.nom === "string" ? json.nom : relatif;
  return contenuFichier(nom, taille, typeof json.base64 === "string" ? Buffer.from(json.base64, "base64") : null);
}

/** Crée le dossier d'un nouveau projet sur le VPS (sous le dossier de klyra) ; rend son chemin. */
export async function creerDossierVps(origine: string, jeton: string | null, dossier: string): Promise<string> {
  const json = await appel(origine, jeton, `/klyra/v1/fichiers/dossier?${requete(dossier)}`, "POST");
  if (typeof json.dossier !== "string") throw new Error("Réponse illisible du VPS.");
  return json.dossier;
}

/** Écrit le fichier texte d'un workflow du VPS (sous le dossier de klyra) ; rend son chemin complet. */
export async function ecrireFichierVps(origine: string, jeton: string | null, chemin: string, texte: string): Promise<string> {
  const json = await appel(origine, jeton, "/klyra/v1/fichiers/ecrire", "POST", { chemin, texte });
  if (typeof json.chemin !== "string") throw new Error("Réponse illisible du VPS.");
  return json.chemin;
}

/** Les consignes KLYRA d'un projet du VPS (serveur/fichiers.mjs, même module que sur ce PC). */
export async function consignesVps(origine: string, jeton: string | null, dossier: string, nom: string, ecrire = false): Promise<EtatConsignesProjet> {
  const json = await appel(origine, jeton, `/klyra/v1/fichiers/consignes?${requete(dossier)}&nom=${encodeURIComponent(nom)}`, ecrire ? "POST" : "GET");
  const c = json.consignes as EtatConsignesProjet | undefined;
  if (!c || typeof c !== "object" || !Array.isArray(c.propositions)) throw new Error("Réponse illisible du VPS.");
  return c;
}
