import { app, net } from "electron";
import { existsSync, readFileSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AgentEvent, StreamOptions } from "./moteurs/types";
import { contexteDe, type ContexteReponse } from "./contexte-distant";

/**
 * Les agents d'un VPS relié (serveur/agents.mjs), vus par l'app comme ceux du PC :
 * mêmes `requestId`, mêmes événements (`claude:event`), mêmes réponses spontanées.
 *
 * Une connexion par VPS (`GET /klyra/v1/agent/evenements`, flux SSE), ouverte au démarrage pour
 * chaque VPS relié et gardée : une réponse finie pendant que l'app était fermée arrive à la réouverture.
 * Le dernier numéro lu est gardé sur le disque (`serveurs-curseurs.json`) : rien n'est lu deux fois.
 */

export interface Fenetre {
  evenement: (requestId: string, event: AgentEvent) => void;
  /** Une réponse que l'interface n'a pas demandée (tâche de fond, routine du VPS, réponse finie pendant l'absence de l'app). */
  spontane: (requestId: string, sessionId: string, contexte: (ContexteReponse & { lieu: string }) | null) => void;
}

export interface Equipe {
  fiches: { id: string; nom: string; contenu: string }[];
  assistant: string | null;
  empreinte: string;
}

interface Liaison {
  fenetre: () => Fenetre | null;
  equipe: () => Equipe;
  jeton: (origine: string) => string | null;
}

interface Entree {
  seq: number;
  requestId: string;
  sessionId: string | null;
  event?: AgentEvent;
  spontane?: boolean;
  contexte?: ContexteReponse;
}

const ATTENTE_MS = 15_000;
const fichierCurseurs = () => path.join(app.getPath("userData"), "serveurs-curseurs.json");

let liaison: Liaison | null = null;
const jetonDe = new Map<string, () => string | null>();
const connexions = new Map<string, { arreter: () => void }>();
/** Les réponses en cours sur un VPS : leur origine, pour autoriser et arrêter. */
const enCours = new Map<string, string>();
/** Les réponses déjà montrées à l'interface (demandées ici, ou ouvertes en spontané). */
const connues = new Set<string>();
const equipeEnvoyee = new Map<string, string>();

let curseurs: Record<string, { instance: string; seq: number }> | null = null;
let ecriture: Promise<void> = Promise.resolve();

function lireCurseurs() {
  if (curseurs) return curseurs;
  try {
    curseurs = existsSync(fichierCurseurs()) ? (JSON.parse(readFileSync(fichierCurseurs(), "utf8")) as typeof curseurs) : {};
  } catch {
    curseurs = {};
  }
  return curseurs!;
}

let minuterie: ReturnType<typeof setTimeout> | null = null;
function noterCurseur(origine: string, instance: string, seq: number) {
  lireCurseurs()[origine] = { instance, seq };
  if (minuterie) return;
  minuterie = setTimeout(() => {
    minuterie = null;
    const contenu = JSON.stringify(curseurs);
    ecriture = ecriture.then(async () => {
      const temporaire = `${fichierCurseurs()}.tmp`;
      await writeFile(temporaire, contenu, { encoding: "utf8", mode: 0o600 });
      await rename(temporaire, fichierCurseurs());
    }).catch(() => undefined);
  }, 500);
}

async function requete(origine: string, chemin: string, methode: "POST" | "PUT", corps: unknown): Promise<{ status: number; json: unknown }> {
  const jeton = jetonDe.get(origine)?.() ?? null;
  if (!jeton) throw new Error("jeton");
  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_MS);
  try {
    const reponse = await net.fetch(`${origine}${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
      body: JSON.stringify(corps),
      signal: controle.signal,
      redirect: "error",
      cache: "no-store",
    });
    return { status: reponse.status, json: await reponse.json().catch(() => null) };
  } finally {
    clearTimeout(delai);
  }
}

function distribuer(origine: string, entree: Entree) {
  const fenetre = liaison?.fenetre();
  if (!fenetre || typeof entree.requestId !== "string") return;
  if (entree.spontane) {
    if (!entree.sessionId || connues.has(entree.requestId)) return;
    connues.add(entree.requestId);
    enCours.set(entree.requestId, origine);
    fenetre.spontane(entree.requestId, entree.sessionId, contexteDe(origine, entree.contexte));
    return;
  }
  if (!entree.event) return;
  if (!connues.has(entree.requestId)) {
    // Une réponse de routine, ou finie pendant que l'app était fermée : elle s'ouvre comme une réponse spontanée.
    if (!entree.sessionId) return;
    connues.add(entree.requestId);
    enCours.set(entree.requestId, origine);
    fenetre.spontane(entree.requestId, entree.sessionId, contexteDe(origine, entree.contexte));
  }
  fenetre.evenement(entree.requestId, entree.event);
  if (entree.event.type === "fin") enCours.delete(entree.requestId);
}

/** Lit un flux SSE jusqu'à sa fin. */
async function lireFlux(origine: string, signal: AbortSignal): Promise<void> {
  const jeton = jetonDe.get(origine)?.() ?? null;
  if (!jeton) throw new Error("jeton");
  const curseur = lireCurseurs()[origine];
  const url = `${origine}/klyra/v1/agent/evenements?depuis=${curseur?.seq ?? 0}&instance=${encodeURIComponent(curseur?.instance ?? "")}`;
  const reponse = await net.fetch(url, { headers: { Authorization: `Bearer ${jeton}` }, signal, cache: "no-store", redirect: "error" });
  if (!reponse.ok || !reponse.body) throw new Error(`statut ${reponse.status}`);
  const lecteur = reponse.body.getReader();
  const decodeur = new TextDecoder();
  let tampon = "";
  let instance = curseur?.instance ?? "";
  for (;;) {
    const { value, done } = await lecteur.read();
    if (done) return;
    tampon += decodeur.decode(value, { stream: true });
    const blocs = tampon.split("\n\n");
    tampon = blocs.pop() ?? "";
    for (const bloc of blocs) {
      const data = bloc.split("\n").find((l) => l.startsWith("data: "));
      if (!data) continue;
      let json: unknown;
      try {
        json = JSON.parse(data.slice(6));
      } catch {
        continue;
      }
      if (bloc.startsWith("event: instance")) {
        const recue = (json as { instance?: unknown }).instance;
        if (typeof recue === "string" && recue !== instance) {
          // Le serveur a redémarré : sa numérotation repart de zéro.
          instance = recue;
          noterCurseur(origine, instance, 0);
        }
        continue;
      }
      const entree = json as Entree;
      if (typeof entree.seq !== "number") continue;
      noterCurseur(origine, instance, entree.seq);
      distribuer(origine, entree);
    }
  }
}

/** Garde le flux d'un VPS ouvert ; reconnexion de 1 s à 30 s. S'arrête si le jeton disparaît. */
function suivre(origine: string) {
  if (connexions.has(origine)) return;
  let arrete = false;
  let controle: AbortController | null = null;
  connexions.set(origine, {
    arreter: () => {
      arrete = true;
      controle?.abort();
    },
  });
  void (async () => {
    let attente = 1000;
    while (!arrete && jetonDe.get(origine)?.()) {
      controle = new AbortController();
      const debut = Date.now();
      try {
        await lireFlux(origine, controle.signal);
      } catch {
        /* Coupure, VPS éteint, réseau Tailscale absent : on réessaie. */
      }
      if (arrete) break;
      attente = Date.now() - debut > 60_000 ? 1000 : Math.min(attente * 2, 30_000);
      await new Promise((r) => setTimeout(r, attente));
    }
    connexions.delete(origine);
  })();
}

/** Au démarrage : un flux par VPS relié, pour recevoir ce qui s'est passé pendant l'absence de l'app. */
export function brancherAgentsDistants(l: Liaison, origines: string[]) {
  liaison = l;
  for (const origine of origines) relierServeur(origine);
}

/** Un VPS vient d'être relié (ou l'était déjà) : son flux s'ouvre. */
export function relierServeur(origine: string) {
  if (!liaison) return;
  const l = liaison;
  jetonDe.set(origine, () => l.jeton(origine));
  suivre(origine);
}

export function oublierServeur(origine: string) {
  connexions.get(origine)?.arreter();
  connexions.delete(origine);
  jetonDe.delete(origine);
  equipeEnvoyee.delete(origine);
}

/** Envoie au VPS les fiches des agents actifs, si elles ont changé depuis le dernier envoi. */
export async function synchroniserEquipe(origine: string): Promise<void> {
  const equipe = liaison?.equipe();
  if (!equipe || equipeEnvoyee.get(origine) === equipe.empreinte) return;
  const recu = await requete(origine, "/klyra/v1/agents/fiches", "PUT", equipe);
  if (recu.status !== 200) throw new Error("fiches");
  equipeEnvoyee.set(origine, equipe.empreinte);
}

/** Fait répondre un agent sur le VPS. Comme `streamAgent` : se termine toujours par un événement `fin`. */
export async function streamDistant(origine: string, requestId: string, options: StreamOptions) {
  const fenetre = liaison?.fenetre();
  const echec = (erreur: string) => fenetre?.evenement(requestId, { type: "fin", ok: false, texte: "", erreur });
  if (!liaison?.jeton(origine)) return echec("Ce PC n’est plus relié à ce VPS. Relance la commande sur le VPS et colle le nouveau lien dans Serveurs.");
  relierServeur(origine);
  connues.add(requestId);
  enCours.set(requestId, origine);
  try {
    await synchroniserEquipe(origine);
    const recu = await requete(origine, "/klyra/v1/agent/envoyer", "POST", {
      requestId,
      options: {
        agent: options.agent,
        prompt: options.prompt,
        sessionId: options.sessionId,
        modele: options.modele ?? null,
        effort: options.effort ?? null,
        acces: options.acces ?? "projet",
        dossier: options.dossierVps ?? null,
        /* Le VPS retient la session de cette conversation : le téléphone, PC fermé, y reprend. */
        conversation: options.chatId ?? null,
      },
    });
    if (recu.status === 401) throw new Error("Ce PC n’est plus relié à ce VPS. Relance la commande sur le VPS et colle le nouveau lien dans Serveurs.");
    if (recu.status !== 202) throw new Error("Ce VPS ne sait pas encore faire tourner d’agents : relance la commande d’installation pour le mettre à jour.");
  } catch (error) {
    enCours.delete(requestId);
    const message = error instanceof Error && error.message.length > 20 ? error.message : "Le VPS ne répond pas. S’il est éteint, ou hors de ton réseau Tailscale, l’agent ne peut pas répondre.";
    echec(message);
  }
}

/** null : cette réponse ne tourne pas sur un VPS. */
export function autoriserDistant(requestId: string, demandeId: string, decision: string): Promise<boolean> | null {
  const origine = enCours.get(requestId);
  if (!origine) return null;
  return requete(origine, "/klyra/v1/agent/autoriser", "POST", { requestId, demandeId, decision })
    .then((r) => (r.json as { ok?: boolean } | null)?.ok === true)
    .catch(() => false);
}

/** Faux : cette réponse ne tourne pas sur un VPS. */
export function annulerDistant(requestId: string): boolean {
  const origine = enCours.get(requestId);
  if (!origine) return false;
  void requete(origine, "/klyra/v1/agent/annuler", "POST", { requestId }).catch(() => undefined);
  return true;
}
