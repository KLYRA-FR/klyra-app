import { net } from "electron";
import { contenuFichier, type ContenuFichier, type Noeud } from "./projets";

/**
 * Les projets d'un VPS relié : l'arbre et les octets viennent du serveur (serveur/fichiers.mjs),
 * l'aperçu se fait ici, comme pour un projet du PC. Ouvrir dans une autre app ou dans le
 * gestionnaire de fichiers n'a pas de sens pour un fichier du VPS.
 */

const ATTENTE_MS = 20_000;

async function appel(origine: string, jeton: string | null, chemin: string, methode: "GET" | "POST" = "GET"): Promise<Record<string, unknown>> {
  if (!jeton) throw new Error("Ce PC n’est plus relié à ce VPS. Relance la commande sur le VPS et colle le nouveau lien dans Serveurs.");
  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_MS);
  try {
    const reponse = await net.fetch(`${origine}${chemin}`, { method: methode, headers: { Authorization: `Bearer ${jeton}` }, signal: controle.signal, redirect: "error", cache: "no-store" });
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
