import { net } from "electron";
import { readConversations } from "./conversations";
import type { Routine, RoutineRun } from "./routines/types";

/**
 * Les routines tenues par un VPS (serveur/routines.mjs) : ce PC garde leur définition et les montre,
 * le VPS les planifie, les lance et garde leur historique. Après chaque changement, la liste complète
 * des routines d'un VPS lui est renvoyée (`PUT /klyra/v1/routines`).
 */

const ATTENTE_MS = 15_000;

interface Liaison {
  jeton: (origine: string) => string | null;
  /** Les fiches des agents actifs, envoyées avant les routines (le VPS refuse un agent qu'il ne connaît pas). */
  equipe: (origine: string) => Promise<void>;
}

let liaison: Liaison | null = null;
export function brancherRoutinesVps(l: Liaison) {
  liaison = l;
}

async function appel(origine: string, chemin: string, methode: "GET" | "POST" | "PUT", corps?: unknown): Promise<Record<string, unknown>> {
  const jeton = liaison?.jeton(origine);
  if (!jeton) throw new Error("Ce PC n’est plus relié à ce VPS.");
  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_MS);
  try {
    const reponse = await net.fetch(`${origine}${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${jeton}`, ...(corps === undefined ? {} : { "Content-Type": "application/json" }) },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: controle.signal,
      redirect: "error",
      cache: "no-store",
    });
    const json = (await reponse.json().catch(() => null)) as Record<string, unknown> | null;
    if (reponse.status === 404) throw new Error("Ce VPS ne sait pas encore tenir de routines : relance la commande d’installation.");
    if (!reponse.ok || !json) throw new Error(typeof json?.erreur === "string" ? `Le VPS a refusé : ${json.erreur}.` : "Le VPS ne répond pas.");
    return json;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw new Error("Le VPS ne répond pas.");
    throw error;
  } finally {
    clearTimeout(delai);
  }
}

/** Le dossier sur le VPS d'un projet du VPS, et l'accès choisi dans l'app (conversations.json). */
async function contexteApp(): Promise<{ dossiers: Map<string, { folder: string; lieu: string }>; acces: string }> {
  const data = (await readConversations().catch(() => null)) as { projects?: { id: string; folder: string; lieu?: string | null }[]; acces?: string } | null;
  const dossiers = new Map<string, { folder: string; lieu: string }>();
  for (const p of data?.projects ?? []) if (p.lieu) dossiers.set(p.id, { folder: p.folder, lieu: p.lieu });
  return { dossiers, acces: typeof data?.acces === "string" ? data.acces : "projet" };
}

/** Renvoie au VPS la liste complète de ses routines. */
export async function synchroniserRoutinesVps(origine: string, routines: Routine[]): Promise<void> {
  if (!liaison) return;
  await liaison.equipe(origine);
  const { dossiers, acces } = await contexteApp();
  const miennes = routines.filter((r) => r.lieu === origine && !r.blockedReason);
  await appel(origine, "/klyra/v1/routines", "PUT", {
    routines: miennes.map((r) => {
      const projet = r.projectId ? dossiers.get(r.projectId) : undefined;
      return {
        id: r.id,
        agentId: r.agentId,
        name: r.name,
        instruction: r.instruction,
        schedule: r.schedule,
        timezone: r.timezone,
        active: r.active,
        missedPolicy: r.missedPolicy,
        dossier: projet && projet.lieu === origine ? projet.folder : null,
        chatId: `routine-${r.id}`,
        acces,
      };
    }),
  });
}

export async function executerRoutineVps(origine: string, id: string): Promise<RoutineRun> {
  const json = await appel(origine, "/klyra/v1/routines/executer", "POST", { id });
  return json.run as RoutineRun;
}

export async function historiqueRoutineVps(origine: string, id: string, limite: number): Promise<RoutineRun[]> {
  const json = await appel(origine, `/klyra/v1/routines/historique?id=${encodeURIComponent(id)}&limite=${limite}`, "GET");
  return Array.isArray(json.runs) ? (json.runs as RoutineRun[]) : [];
}

export async function interrompreRoutineVps(origine: string, runId: string): Promise<boolean> {
  const json = await appel(origine, "/klyra/v1/routines/interrompre", "POST", { runId });
  return json.ok === true;
}
