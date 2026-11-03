import type { Competence, Competences, Memoire, PorteeMemoire, Souvenir } from "./connaissances-agent";
import { appel, VIEUX_SERVEUR } from "./fournisseurs-vps";

/**
 * Ce que sait un agent d'une conversation sur un VPS relié, pour le panneau Réglages de l'agent : ses
 * compétences et sa mémoire, lues et écrites sur le serveur (serveur/agents.mjs, mêmes fonctions que
 * connaissances-agent.ts sur ce PC). Mêmes réponses que les IPC locaux : l'écran ne voit pas la différence.
 */

type Json = Record<string, unknown>;

/** Le dossier d'un projet sur le VPS et la session : ce qui situe l'agent, comme sur ce PC. */
export interface ContexteVps {
  dossier: string | null;
  sessionId: string | null;
}

const PAS_ENCORE = "Ce VPS ne sait pas encore lire ce que savent les agents : relance la commande d’installation sur le VPS pour le mettre à jour.";

const agentValide = (agent: string) => {
  if (agent !== "principal" && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(agent)) throw new Error("Nom d’agent invalide.");
  return agent;
};

/** Un appel au serveur ; un serveur d'avant cette version répond « introuvable » : on le dit. */
async function demander(origine: string, jeton: string | null, chemin: string, methode: "GET" | "POST" = "GET", corps?: unknown): Promise<Json> {
  try {
    return await appel(origine, jeton, chemin, methode, corps);
  } catch (e) {
    if (e instanceof Error && e.message === VIEUX_SERVEUR) throw new Error(PAS_ENCORE);
    throw e;
  }
}

const requete = (action: string, agent: string, contexte: ContexteVps, autres: Record<string, string> = {}) => {
  const params = new URLSearchParams({ agent: agentValide(agent), ...autres });
  if (contexte.dossier) params.set("dossier", contexte.dossier);
  if (contexte.sessionId) params.set("session", contexte.sessionId);
  return `/klyra/v1/agent/${action}?${params}`;
};

/* ─── Compétences ─────────────────────────────────────────────── */

function competenceDe(c: unknown): Competence | null {
  if (!c || typeof c !== "object") return null;
  const x = c as Json;
  if (typeof x.nom !== "string" || !x.nom) return null;
  return {
    nom: x.nom,
    description: typeof x.description === "string" ? x.description : "",
    version: typeof x.version === "string" ? x.version : null,
    dossier: typeof x.dossier === "string" ? x.dossier : null,
  };
}

/** Ses compétences sur le VPS : celles que sa fiche précharge, du projet et de l'utilisateur klyra. */
export async function competencesVps(origine: string, jeton: string | null, agent: string, dossier: string | null): Promise<Competences> {
  const json = await demander(origine, jeton, requete("competences", agent, { dossier, sessionId: null }));
  const brut = json.competences as Json | undefined;
  if (!brut || typeof brut !== "object") throw new Error("Le VPS n’a pas répondu comme prévu.");
  const liste = (v: unknown) => (Array.isArray(v) ? v.map(competenceDe).filter((c): c is Competence => c !== null) : []);
  return { fiche: liste(brut.fiche), poste: liste(brut.poste), projet: liste(brut.projet) };
}

/* ─── Mémoire ─────────────────────────────────────────────────── */

const PORTEES: PorteeMemoire[] = ["user", "project", "local", "auto"];

function souvenirDe(s: unknown): Souvenir | null {
  if (!s || typeof s !== "object") return null;
  const x = s as Json;
  if (typeof x.id !== "string" || !x.id.endsWith(".md") || typeof x.titre !== "string") return null;
  return {
    id: x.id,
    titre: x.titre,
    description: typeof x.description === "string" ? x.description : "",
    toujours: x.toujours === true,
    modifieLe: typeof x.modifieLe === "number" ? x.modifieLe : 0,
  };
}

/** Sa mémoire sur le VPS (null : sa fiche n'en demande pas). */
export async function memoireVps(origine: string, jeton: string | null, agent: string, contexte: ContexteVps): Promise<Memoire | null> {
  const json = await demander(origine, jeton, requete("memoire", agent, contexte));
  if (json.memoire === null) return null;
  const m = json.memoire as Json | undefined;
  if (!m || typeof m !== "object" || !PORTEES.includes(m.portee as PorteeMemoire) || typeof m.dossier !== "string" || !Array.isArray(m.souvenirs))
    throw new Error("Le VPS n’a pas répondu comme prévu.");
  return {
    portee: m.portee as PorteeMemoire,
    dossier: m.dossier,
    souvenirs: m.souvenirs.map(souvenirDe).filter((s): s is Souvenir => s !== null),
    coupee: m.coupee === true,
  };
}

const fichierLu = (v: unknown): { contenu: string; modifieLe: number } => {
  const x = v as Json | undefined;
  if (!x || typeof x.contenu !== "string" || typeof x.modifieLe !== "number") throw new Error("Le VPS n’a pas répondu comme prévu.");
  return { contenu: x.contenu, modifieLe: x.modifieLe };
};

export async function souvenirVps(origine: string, jeton: string | null, agent: string, contexte: ContexteVps, id: string) {
  return fichierLu((await demander(origine, jeton, requete("souvenir", agent, contexte, { id: String(id) }))).souvenir);
}

/** Réécrit un souvenir sur le VPS ; le serveur refuse un fichier changé depuis sa lecture (`attendu`). */
export async function ecrireSouvenirVps(origine: string, jeton: string | null, agent: string, contexte: ContexteVps, id: string, contenu: string, attendu: number | null) {
  const json = await demander(origine, jeton, "/klyra/v1/agent/souvenir-ecrire", "POST", { agent: agentValide(agent), ...contexte, id: String(id), contenu: String(contenu), attendu });
  const ecrit = json.ecrit as Json | undefined;
  if (typeof ecrit?.modifieLe !== "number") throw new Error("Le VPS n’a pas répondu comme prévu.");
  return { modifieLe: ecrit.modifieLe };
}

export async function creerSouvenirVps(origine: string, jeton: string | null, agent: string, contexte: ContexteVps, titre: string, contenu: string): Promise<Souvenir> {
  const json = await demander(origine, jeton, "/klyra/v1/agent/souvenir-creer", "POST", { agent: agentValide(agent), ...contexte, titre: String(titre), contenu: String(contenu) });
  const s = souvenirDe(json.souvenir);
  if (!s) throw new Error("Le VPS n’a pas répondu comme prévu.");
  return s;
}
