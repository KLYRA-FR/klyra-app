import { app, net } from "electron";
import { existsSync, readFileSync, statSync } from "node:fs";
import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { enregistrerConsommation } from "./consommation";
import { ligneValide } from "./consommation-ecart";
import type { AgentEvent, StreamOptions } from "./moteurs/types";
import { contexteDe, type ContexteReponse } from "./contexte-distant";
import { CHEMIN_JOINT, conversationValide, envoyerJoints, ErreurJoint, remplacerJoints } from "./joints-vps";
import { CHEMIN_SERVEUR } from "./lecture-serveur";
import type { SkillEnvoyee } from "./preparation-fournisseur";
import type { SkillsParAgent } from "./skills-par-agent";

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
  /** Un livrable publié par un agent du VPS (`publier_artefact`, cf. serveur/rendus.mjs) : l'écran l'ajoute, sans le copier sur ce PC. */
  rendu: (origine: string, rendu: RenduVps) => void;
  /** Ce qu'un VPS annonce de lui-même (cf. useEspaceServeurs). */
  serveur?: (origine: string, event: unknown) => void;
}

/** L'annonce d'un livrable du VPS, vérifiée champ par champ. */
export interface RenduVps {
  id: string;
  chemin: string;
  dossier: boolean;
  taille: number;
  titre: string;
  description: string;
  agent: string;
  conversation: string;
  at: number;
}

function renduDe(event: unknown): RenduVps | null {
  const e = (event ?? {}) as Record<string, unknown>;
  if (e.type !== "rendu" || typeof e.id !== "string" || !/^[0-9a-f-]{36}$/.test(e.id) || typeof e.chemin !== "string" || !e.chemin) return null;
  return {
    id: e.id,
    chemin: e.chemin,
    dossier: e.dossier === true,
    taille: typeof e.taille === "number" ? e.taille : 0,
    titre: typeof e.titre === "string" ? e.titre.slice(0, 80) : "",
    description: typeof e.description === "string" ? e.description.slice(0, 500) : "",
    agent: typeof e.agent === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(e.agent) ? e.agent : "principal",
    conversation: typeof e.conversation === "string" ? e.conversation.slice(0, 120) : "",
    at: typeof e.at === "number" ? e.at : Date.now(),
  };
}

/** Les annonces déjà passées à l'écran (une même publication relue n'est pas recopiée deux fois). */
const annonces = new Set<string>();

export interface Equipe {
  fiches: { id: string; nom: string; contenu: string }[];
  assistant: string | null;
  /**
   * La configuration KLYRA adoptée sur ce PC (mémoire coupée, consignes), appliquée par le VPS à toutes
   * ses sessions : messages du PC, du téléphone PC fermé, routines du serveur.
   */
  configuration: { memoireAgents: boolean; consignes: string | null; navigateur?: boolean; coffre?: boolean };
  /** La même, telle que l'écran la relit : un serveur qui n'en a pas encore l'affiche au lieu des valeurs par défaut. */
  configurationEcran?: unknown;
  /** Skills reçues par chaque agent. Un ancien serveur ignore le champ : tout reste reçu. */
  skillsParAgent: SkillsParAgent;
  /**
   * Dossiers des skills allumées pour au moins un agent. Un ancien serveur ignore le champ :
   * il n'écrit rien dans sa bibliothèque.
   */
  skills?: SkillEnvoyee[];
  empreinte: string;
}

interface Liaison {
  fenetre: () => Fenetre | null;
  equipe: () => Equipe;
  jeton: (origine: string) => string | null;
  /** Un agent du VPS appelle un outil du navigateur de KLYRA : ce PC l'exécute et rend le résultat MCP. */
  navigateur?: (origine: string, appel: AppelNavigateur) => Promise<unknown>;
  /** Un agent du VPS appelle un outil des workflows : ce PC (où ils vivent) répond. */
  workflow?: (origine: string, appel: AppelNavigateur) => Promise<unknown>;
  /**
   * Un agent du VPS appelle un outil du Coffre (cf. coffre-outils.ts) : `lireValeur` demande au VPS la
   * valeur d'un secret que l'agent range ; `valeur` est rendue au VPS, qui l'écrit dans son fichier.
   */
  coffre?: (origine: string, appel: AppelCoffre, lireValeur: () => Promise<string>) => Promise<{ resultat: { texte: string; erreur?: boolean }; valeur?: string }>;
}

/** Un appel d'outil du Coffre venu d'un agent du VPS (cf. serveur/coffre.mjs) : jamais une valeur dans l'événement. */
export interface AppelCoffre {
  id: string;
  nom: string;
  arguments: Record<string, unknown>;
  agent: string;
  conversation: string;
}

export function appelCoffreDe(event: unknown, maintenant = Date.now()): AppelCoffre | null {
  const e = (event ?? {}) as Record<string, unknown>;
  if (e.type !== "coffre" || typeof e.id !== "string" || !/^[0-9a-f-]{36}$/.test(e.id)) return null;
  if (typeof e.nom !== "string" || !["coffre_lister", "coffre_demander", "coffre_enregistrer", "coffre_ecrire_fichier"].includes(e.nom)) return null;
  if (typeof e.expire !== "number" || e.expire < maintenant) return null;
  if (typeof e.conversation !== "string" || !e.conversation || e.conversation.length > 120) return null;
  const args = e.arguments && typeof e.arguments === "object" && !Array.isArray(e.arguments) ? { ...(e.arguments as Record<string, unknown>) } : {};
  // La valeur d'un secret que l'agent range se lit à part, par la route du VPS.
  delete args.valeur;
  return { id: e.id, nom: e.nom, arguments: args, agent: typeof e.agent === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(e.agent) ? e.agent : "principal", conversation: e.conversation };
}

/** Un appel d'outil du navigateur venu d'un agent du VPS (cf. serveur/navigateur.mjs), vérifié champ par champ. */
export interface AppelNavigateur {
  id: string;
  nom: string;
  arguments: Record<string, unknown>;
  agent: string;
  conversation: string;
}

export function appelNavigateurDe(event: unknown, maintenant = Date.now(), type: "navigateur" | "workflow" = "navigateur"): AppelNavigateur | null {
  const e = (event ?? {}) as Record<string, unknown>;
  if (e.type !== type || typeof e.id !== "string" || !/^[0-9a-f-]{36}$/.test(e.id)) return null;
  if (typeof e.nom !== "string" || !(type === "navigateur" ? /^navigateur_[a-z]+$/ : /^(lister|lire|construire|lancer)_workflows?$/).test(e.nom)) return null;
  // Un appel relu après coup (reconnexion, redémarrage de l'app) a déjà abandonné côté VPS.
  if (typeof e.expire !== "number" || e.expire < maintenant) return null;
  if (typeof e.conversation !== "string" || !e.conversation || e.conversation.length > 120) return null;
  return {
    id: e.id,
    nom: e.nom,
    arguments: e.arguments && typeof e.arguments === "object" && !Array.isArray(e.arguments) ? (e.arguments as Record<string, unknown>) : {},
    agent: typeof e.agent === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(e.agent) ? e.agent : "principal",
    conversation: e.conversation,
  };
}

/** Les appels déjà servis (un même appel relu n'est pas exécuté deux fois). */
const appelsServis = new Set<string>();

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
const equipePropre = new Set<string>();

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

async function requete(origine: string, chemin: string, methode: "GET" | "POST" | "PUT", corps?: unknown): Promise<{ status: number; json: unknown }> {
  const jeton = jetonDe.get(origine)?.() ?? null;
  if (!jeton) throw new Error("jeton");
  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_MS);
  try {
    const reponse = await net.fetch(`${origine}${chemin}`, {
      method: methode,
      headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/json" },
      body: corps === undefined ? undefined : JSON.stringify(corps),
      signal: controle.signal,
      redirect: "error",
      cache: "no-store",
    });
    return { status: reponse.status, json: await reponse.json().catch(() => null) };
  } finally {
    clearTimeout(delai);
  }
}

/** Une pièce jointe peut peser 20 Mo : plus de temps qu'une requête ordinaire. */
const ATTENTE_JOINT_MS = 120_000;

/** Envoie au VPS une pièce jointe d'un message (octets bruts, cf. electron/joints-vps.ts). */
async function envoyerOctets(origine: string, conversation: string, nom: string, octets: Uint8Array): Promise<{ status: number; json: unknown }> {
  const jeton = jetonDe.get(origine)?.() ?? null;
  if (!jeton) return { status: 401, json: null };
  const controle = new AbortController();
  const delai = setTimeout(() => controle.abort(), ATTENTE_JOINT_MS);
  try {
    const parametres = new URLSearchParams({ conversation, nom });
    const reponse = await net.fetch(`${origine}${CHEMIN_JOINT}?${parametres}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${jeton}`, "Content-Type": "application/octet-stream" },
      body: octets as BodyInit,
      signal: controle.signal,
      redirect: "error",
      cache: "no-store",
    });
    return { status: reponse.status, json: await reponse.json().catch(() => null) };
  } finally {
    clearTimeout(delai);
  }
}

/** Taille d'un fichier joint de ce PC ; null s'il n'y est pas (ou n'est pas un fichier). */
function tailleSurCePc(chemin: string): number | null {
  if (!path.isAbsolute(chemin)) return null;
  try {
    const s = statSync(chemin);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

/**
 * Les pièces jointes partent au VPS avant le message, qui porte alors leurs chemins là-bas.
 * Sans pièce jointe de ce PC, le message part tel quel.
 */
async function promptAvecJoints(origine: string, options: StreamOptions): Promise<string> {
  const fichiers = options.fichiers ?? [];
  if (!fichiers.some((f) => tailleSurCePc(f) !== null)) return options.prompt;
  if (!conversationValide(options.chatId)) throw new ErreurJoint("Pièces jointes impossibles : la conversation n’est pas reconnue par le VPS.");
  const conversation = options.chatId;
  const envoyes = await envoyerJoints(fichiers, {
    taille: tailleSurCePc,
    lire: (chemin) => readFile(chemin),
    envoyer: (nom, octets) => envoyerOctets(origine, conversation, nom, octets),
  });
  return remplacerJoints(options.prompt, envoyes);
}

/** Les réponses du VPS dont la consommation est déjà inscrite : un événement relu n'est pas compté deux fois. */
const comptees = new Set<string>();

/**
 * Ce qu'une réponse du VPS a consommé (sa fin porte l'écart du `modelUsage`, calculé là-bas comme ici par
 * consommation-ecart.ts) : inscrit dans le journal de ce PC, comme une réponse locale, pour l'Utilisation
 * de l'agent et le Profil.
 */
function compterConsommation(requestId: string, event: unknown) {
  const c = (event as { type?: string; consommation?: { agent?: unknown; lignes?: unknown } }) ?? {};
  if (c.type !== "fin" || !c.consommation || comptees.has(requestId)) return;
  comptees.add(requestId);
  const agent = typeof c.consommation.agent === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(c.consommation.agent) ? c.consommation.agent : "principal";
  for (const brut of Array.isArray(c.consommation.lignes) ? c.consommation.lignes.slice(0, 20) : []) {
    const ligne = ligneValide(brut);
    if (ligne) enregistrerConsommation({ fournisseur: "Claude Code", modele: ligne.modele, agent, jetons: ligne.jetons, coutUsd: ligne.coutUsd });
  }
}

function distribuer(origine: string, entree: Entree) {
  if (typeof entree.requestId === "string" && entree.event) compterConsommation(entree.requestId, entree.event);
  const fenetre = liaison?.fenetre();
  if (!fenetre || typeof entree.requestId !== "string") return;
  // Les workflows qui tournent sur le serveur : leur avancée, leurs notifications, un espace qui a changé.
  if (entree.requestId === "workflows") {
    if (entree.event) fenetre.serveur?.(origine, entree.event);
    return;
  }
  // Un outil du navigateur appelé par un agent du VPS : exécuté dans le navigateur de ce PC, résultat renvoyé au VPS.
  const appel = appelNavigateurDe(entree.event);
  if (appel) {
    if (appelsServis.has(appel.id) || !liaison?.navigateur) return;
    appelsServis.add(appel.id);
    if (appelsServis.size > 500) appelsServis.delete(appelsServis.values().next().value!);
    void liaison
      .navigateur(origine, appel)
      .catch((e: unknown) => ({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true }))
      .then((resultat) => requete(origine, "/klyra/v1/agent/navigateur", "POST", { requestId: appel.id, resultat }))
      .catch(() => undefined);
    return;
  }
  // Un outil du Coffre appelé par un agent du VPS : le coffre est ici, le résultat (et, pour un fichier du VPS, la valeur) repart au VPS.
  const coffre = appelCoffreDe(entree.event);
  if (coffre) {
    if (appelsServis.has(coffre.id) || !liaison?.coffre) return;
    appelsServis.add(coffre.id);
    if (appelsServis.size > 500) appelsServis.delete(appelsServis.values().next().value!);
    const lireValeur = async () => {
      const r = await requete(origine, "/klyra/v1/agent/coffre", "POST", { requestId: coffre.id, lire: true });
      const valeur = (r.json as { valeur?: unknown } | null)?.valeur;
      if (r.status !== 200 || typeof valeur !== "string") throw new Error("Le serveur n’a plus la valeur à ranger : réessaie.");
      return valeur;
    };
    void liaison
      .coffre(origine, coffre, lireValeur)
      .catch((e: unknown) => ({ resultat: { texte: e instanceof Error ? e.message : String(e), erreur: true } }))
      .then((r) => requete(origine, "/klyra/v1/agent/coffre", "POST", { requestId: coffre.id, resultat: r.resultat, ...("valeur" in r && typeof r.valeur === "string" ? { valeur: r.valeur } : {}) }))
      .catch(() => undefined);
    return;
  }
  // Un outil des workflows appelé par un agent du VPS : les workflows vivent ici, la réponse repart au VPS.
  const appelWorkflow = appelNavigateurDe(entree.event, Date.now(), "workflow");
  if (appelWorkflow) {
    if (appelsServis.has(appelWorkflow.id) || !liaison?.workflow) return;
    appelsServis.add(appelWorkflow.id);
    if (appelsServis.size > 500) appelsServis.delete(appelsServis.values().next().value!);
    void liaison
      .workflow(origine, appelWorkflow)
      .catch((e: unknown) => ({ content: [{ type: "text", text: e instanceof Error ? e.message : String(e) }], isError: true }))
      .then((resultat) => requete(origine, "/klyra/v1/agent/workflow", "POST", { requestId: appelWorkflow.id, resultat }))
      .catch(() => undefined);
    return;
  }
  // Un livrable publié sur le VPS : il n'appartient à aucune réponse, l'écran le recopie dans Artefacts.
  const rendu = renduDe(entree.event);
  if (rendu) {
    if (!annonces.has(entree.requestId)) {
      annonces.add(entree.requestId);
      fenetre.rendu(origine, rendu);
    }
    return;
  }
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
  // Le serveur vient peut-être d'être mis à jour, app ouverte : il retrouve l'équipe sans attendre le prochain message.
  void synchroniserEquipe(origine).catch(() => undefined);
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
  equipePropre.delete(origine);
}

/**
 * L'empreinte de l'équipe qu'a le VPS : "" s'il n'en a pas, ou pas toute (cf. `empreinteEquipe`, serveur/agents.mjs).
 * null s'il ne la donne pas (serveur trop ancien). Un VPS qui ne répond pas : l'erreur remonte.
 */
async function empreinteDuServeur(origine: string): Promise<string | null> {
  const recu = await requete(origine, CHEMIN_SERVEUR, "GET");
  const corps = recu.json as { equipe?: unknown; equipePropre?: unknown; equipeInitialisee?: unknown } | null;
  if (corps?.equipePropre === true && corps.equipeInitialisee !== false) equipePropre.add(origine);
  else equipePropre.delete(origine);
  const equipe = corps?.equipe;
  return recu.status === 200 && typeof equipe === "string" ? equipe : null;
}

/**
 * Envoie au VPS les fiches des agents actifs, la configuration et les dossiers des skills allumées, si le VPS
 * n'a pas cette équipe : il a pu être mis à jour ou perdre son fichier depuis le dernier envoi.
 * Une fois au moins par lancement de l'app, même si les empreintes sont égales : un serveur d'avant
 * `equipeComplete` annonce la bonne empreinte sur un fichier qui a perdu la configuration.
 */
export async function synchroniserEquipe(origine: string): Promise<void> {
  const equipe = liaison?.equipe();
  if (!equipe) return;
  const surLeServeur = await empreinteDuServeur(origine);
  if (equipeEnvoyee.get(origine) === equipe.empreinte && (surLeServeur === null || surLeServeur === equipe.empreinte)) return;
  /*
   * Un serveur qui garde son équipe et ses réglages ne reçoit que ce que ce PC peut lui servir (navigateur, Coffre).
   * S'il est neuf (`equipeInitialisee` faux), il reçoit tout, une seule fois : c'est sa première copie.
   */
  const corps = equipePropre.has(origine)
    ? { fiches: [], partielle: true, configuration: { navigateur: equipe.configuration.navigateur, coffre: equipe.configuration.coffre }, configurationEcran: equipe.configurationEcran, empreinte: equipe.empreinte }
    : equipe;
  const recu = await requete(origine, "/klyra/v1/agents/fiches", "PUT", corps);
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
    const prompt = await promptAvecJoints(origine, options);
    const recu = await requete(origine, "/klyra/v1/agent/envoyer", "POST", {
      requestId,
      options: {
        /* Claude Code ou Codex (ChatGPT) ; absent : Claude Code, comme sur un serveur plus ancien. */
        ...(options.moteur && options.moteur !== "claude" ? { moteur: options.moteur } : {}),
        agent: options.agent,
        prompt,
        sessionId: options.sessionId,
        modele: options.modele ?? null,
        effort: options.effort ?? null,
        acces: options.acces ?? "projet",
        dossier: options.dossierVps ?? null,
        /* Le VPS retient la session de cette conversation : le téléphone, PC fermé, y reprend. */
        conversation: options.chatId ?? null,
        ...(options.sessionNeuve ? { sessionNeuve: true } : {}),
        /* `/<skill>` en tête du message : le VPS la remet devant le contexte s'il la connaît. */
        ...(options.skill ? { skill: options.skill } : {}),
      },
    });
    if (recu.status === 401) throw new Error("Ce PC n’est plus relié à ce VPS. Relance la commande sur le VPS et colle le nouveau lien dans Serveurs.");
    if (recu.status !== 202) throw new Error("Ce VPS ne sait pas encore faire tourner d’agents : relance la commande d’installation pour le mettre à jour.");
  } catch (error) {
    enCours.delete(requestId);
    const message = error instanceof ErreurJoint || (error instanceof Error && error.message.length > 20) ? (error as Error).message : "Le VPS ne répond pas. S’il est éteint, ou hors de ton réseau Tailscale, l’agent ne peut pas répondre.";
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
