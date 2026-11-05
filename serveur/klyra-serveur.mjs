/**
 * Programme qui répond sur le VPS. L’app l’appelle en GET /klyra/v1/serveur, avec son jeton d’appareil.
 * On ne l’installe pas depuis l’app : `serveur/lancer.sh` le pose sur la machine (Node 22 ou plus récent).
 * Le chemin est le même que CHEMIN_SERVEUR dans electron/lecture-serveur.ts.
 *
 * Appairage : `node klyra-serveur.mjs appairer` écrit un code à usage unique (10 min) et l’affiche
 * dans le terminal. L’app l’échange contre un jeton d’appareil (POST /klyra/v1/appairer).
 * Le serveur ne garde que l’empreinte des codes et des jetons. Aucun secret sur la page publique.
 */
import { ErreurEquipe } from "./equipe.mjs";
import { creerEspace, ErreurEspace } from "./espace.mjs";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { createServer as creerHttp } from "node:http";
import { createServer as creerHttps } from "node:https";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { creerAgents } from "./agents.mjs";
import { ErreurFichier, creerFichiers } from "./fichiers.mjs";
import { creerIa } from "./ia.mjs";
import { creerMoteurs } from "./moteurs.mjs";
import { creerRoutines } from "./routines.mjs";
import { VERSION_CODE_SERVEUR } from "./version-code.mjs";

export const CHEMIN = "/klyra/v1/serveur";
export const CHEMIN_APPAIRER = "/klyra/v1/appairer";
export const CHEMIN_APPAREIL = "/klyra/v1/appareil";
export const CHEMIN_AGENT = "/klyra/v1/agent";
export const CHEMIN_FICHES = "/klyra/v1/agents/fiches";
export const CHEMIN_FICHIERS = "/klyra/v1/fichiers";
export const CHEMIN_EQUIPE = "/klyra/v1/equipe";
export const CHEMIN_COFFRE = "/klyra/v1/coffre";
export const CHEMIN_ESPACE = "/klyra/v1/espace";
export const CHEMIN_COMPOSIO = "/klyra/v1/composio";
export const CHEMIN_ROUTINES = "/klyra/v1/routines";
export const CHEMIN_MOTEURS = "/klyra/v1/moteurs";
export const CHEMIN_IA = "/klyra/v1/ia";
export const CHEMIN_RENDUS = "/klyra/v1/rendus";
export const PROTOCOLE = 1;

export const DUREE_CODE_MS = 10 * 60_000;
/** Au-delà, tous les codes en attente tombent : il faut relancer `appairer`. */
const ECHECS_MAX = 5;
const CORPS_MAX = 2048;
/** Le retour de la page d'OpenAI (code et état d'OAuth dans l'adresse). */
const CORPS_RETOUR_MAX = 10_000;
const CORPS_AGENT_MAX = 1_000_000;
const CORPS_FICHES_MAX = 5_000_000;
/** Fiches et dossiers des skills allumées (texte ou base64). Les routines gardent CORPS_FICHES_MAX. */
const CORPS_EQUIPE_MAX = 20_000_000;
const JOURNAL_MAX = 5000;
const JOURNAL_DUREE_MS = 24 * 60 * 60 * 1000;
const APPAREILS_MAX = 20;

const empreinte = (secret) => createHash("sha256").update(secret, "utf8").digest("hex");

function egal(a, b) {
  const gauche = Buffer.from(a, "hex");
  const droite = Buffer.from(b, "hex");
  return gauche.length === droite.length && gauche.length > 0 && timingSafeEqual(gauche, droite);
}

/* ─── Ce que le serveur garde, dans son dossier de données ─────────── */

function lireJson(fichier, defaut) {
  try {
    return JSON.parse(readFileSync(fichier, "utf8"));
  } catch {
    return defaut;
  }
}

function ecrireJson(fichier, valeur) {
  mkdirSync(path.dirname(fichier), { recursive: true, mode: 0o700 });
  const temporaire = `${fichier}.tmp`;
  writeFileSync(temporaire, JSON.stringify(valeur, null, 2), { mode: 0o600 });
  renameSync(temporaire, fichier);
}

const fichierCodes = (dossier) => path.join(dossier, "codes.json");
const fichierAppareils = (dossier) => path.join(dossier, "appareils.json");

function lireCodes(dossier, maintenant) {
  const codes = lireJson(fichierCodes(dossier), []);
  return Array.isArray(codes) ? codes.filter((c) => c && typeof c.empreinte === "string" && typeof c.expire === "number" && c.expire > maintenant) : [];
}

export function lireAppareils(dossier) {
  const appareils = lireJson(fichierAppareils(dossier), []);
  return Array.isArray(appareils) ? appareils.filter((a) => a && typeof a.id === "string" && typeof a.empreinte === "string") : [];
}

/** Un code à usage unique, lisible au téléphone : 10 caractères sans 0/O ni 1/I. */
export function creerCode(dossier, maintenant = Date.now()) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const octets = randomBytes(10);
  let code = "";
  for (const octet of octets) code += alphabet[octet % alphabet.length];
  const codes = lireCodes(dossier, maintenant);
  codes.push({ empreinte: empreinte(code), expire: maintenant + DUREE_CODE_MS });
  ecrireJson(fichierCodes(dossier), codes.slice(-5));
  return code;
}

export function revoquerTout(dossier) {
  ecrireJson(fichierAppareils(dossier), []);
  ecrireJson(fichierCodes(dossier), []);
}

/* ─── HTTP ─────────────────────────────────────────────────────────── */

const ENTETES_CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};

function repondre(res, statut, corps) {
  const texte = JSON.stringify(corps);
  res.writeHead(statut, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(texte),
    "Cache-Control": "no-store",
    ...ENTETES_CORS,
  });
  res.end(texte);
}

function echapper(texte) {
  return texte.replace(/[&<>"']/g, (caractere) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[caractere]);
}

/** Ne montre ni lien ni code : ils ne s’affichent que dans le terminal du VPS. */
function pageAccueil(nom) {
  return `<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Serveur KLYRA</title><style>
body{margin:0;background:#fff;color:#111;font-family:system-ui,sans-serif}
main{max-width:420px;min-height:100dvh;margin:0 auto;padding:20px 16px 32px;display:flex;flex-direction:column;gap:12px}
h1{font-size:22px;margin:0}
p{margin:0;font-size:15px;line-height:1.35}
</style></head><body><main>
<h1>${echapper(nom)}</h1>
<p>Ce serveur KLYRA est en marche.</p>
<p>Pour y relier l’app, relance la commande d’installation sur le VPS : elle affiche un lien et un QR valables 10 minutes.</p>
</main></body></html>`;
}

function lireCorpsRequete(req, max = CORPS_MAX) {
  return new Promise((resolve) => {
    let texte = "";
    let trop = false;
    req.setEncoding("utf8");
    req.on("data", (morceau) => {
      if (trop) return;
      texte += morceau;
      if (texte.length > max) trop = true;
    });
    req.on("end", () => {
      if (trop) return resolve(null);
      try {
        resolve(JSON.parse(texte));
      } catch {
        resolve(null);
      }
    });
    req.on("error", () => resolve(null));
  });
}

/**
 * Les événements des agents, numérotés, gardés 24 h (5 000 au plus) : l'app les lit en direct
 * (`GET /klyra/v1/agent/evenements`, flux SSE) et rattrape, en se reconnectant, ce qu'elle a manqué.
 * `instance` change à chaque démarrage : l'app sait alors que la numérotation repart de zéro.
 */
/**
 * Un message écrit sur le téléphone, envoyé ici pendant que le PC est fermé : sa conversation et son
 * texte, pour que le PC l'y range à sa réouverture (avec la réponse). Renvoie null si c'est illisible.
 */
export function contexteTelephone(brut) {
  if (!brut || typeof brut !== "object") return null;
  const { chatId, agentId, titre, telephone } = brut;
  if (typeof chatId !== "string" || !/^[A-Za-z0-9_.:-]{1,120}$/.test(chatId) || /^routine-/.test(chatId)) return null;
  if (typeof agentId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(agentId)) return null;
  if (!telephone || typeof telephone !== "object") return null;
  const { messageId, texte, creeLe } = telephone;
  if (typeof messageId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(messageId)) return null;
  if (typeof texte !== "string" || !texte.trim() || texte.length > 8000) return null;
  if (typeof creeLe !== "string" || Number.isNaN(Date.parse(creeLe))) return null;
  return {
    chatId,
    agentId,
    titre: typeof titre === "string" ? titre.slice(0, 200) : "Conversation",
    telephone: { messageId, texte, creeLe: new Date(creeLe).toISOString() },
  };
}

/**
 * Ce qui identifie l'agent d'une conversation, pour retrouver sa session : « conversation|agent »,
 * et « |codex » ou « |grok » au bout pour celle de Codex ou de Grok (une session n'existe que dans le moteur qui l'a créée).
 */
export function cleConversation(conversation, agent, moteur = null) {
  if (typeof conversation !== "string" || !/^[A-Za-z0-9_.:-]{1,120}$/.test(conversation)) return null;
  return `${conversation}|${typeof agent === "string" && agent ? agent : "principal"}${moteur === "codex" || moteur === "grok" ? `|${moteur}` : ""}`;
}

/**
 * `fichierSessions` : où garder la dernière session de chaque agent dans chaque conversation, pour
 * que le téléphone (qui ne connaît pas les sessions : elles ne passent pas par le compte) y reprenne.
 */
export function creerJournal(maintenant = Date.now, fichierSessions = null) {
  const instance = randomBytes(8).toString("hex");
  let seq = 0;
  let entrees = [];
  const abonnes = new Set();
  /* Contexte d'un message du téléphone, le temps de sa réponse : chaque événement le porte. */
  const contextes = new Map();
  /* Conversation de chaque réponse en cours, et dernière session de chaque agent par conversation. */
  const conversations = new Map();
  let sessions = {};
  if (fichierSessions) {
    try {
      const lu = JSON.parse(readFileSync(fichierSessions, "utf8"));
      if (lu && typeof lu === "object" && !Array.isArray(lu)) sessions = lu;
    } catch {
      /* Pas encore de fichier. */
    }
  }
  const retenirSession = (requestId, sessionId) => {
    const cle = conversations.get(requestId);
    if (!cle || !sessionId || sessions[cle] === sessionId) return;
    sessions[cle] = sessionId;
    const cles = Object.keys(sessions);
    if (cles.length > 2000) delete sessions[cles[0]];
    if (fichierSessions) ecrireJson(fichierSessions, sessions);
  };
  const ecrireA = (res, entree) => res.write(`id: ${entree.seq}\ndata: ${JSON.stringify(entree)}\n\n`);
  function ajouter(entree) {
    const complete = { seq: ++seq, t: maintenant(), ...entree };
    entrees.push(complete);
    const limite = maintenant() - JOURNAL_DUREE_MS;
    if (entrees.length > JOURNAL_MAX || entrees[0].t < limite) entrees = entrees.filter((e) => e.t >= limite).slice(-JOURNAL_MAX);
    for (const abonne of abonnes) if (abonne.garder(complete)) ecrireA(abonne, complete);
  }
  return {
    instance,
    /** `contexte` : une réponse de routine, à ouvrir dans la conversation de la routine. */
    publier: (requestId, event, sessionId, contexte = null) => {
      const lie = contexte ?? contextes.get(requestId) ?? null;
      ajouter({ requestId, sessionId: sessionId ?? null, event, ...(lie ? { contexte: lie } : {}) });
      retenirSession(requestId, sessionId);
      if (event?.type === "fin") {
        contextes.delete(requestId);
        conversations.delete(requestId);
      }
    },
    /** La réponse appartient à cette conversation (`cleConversation`) : sa session y sera retenue. */
    lierConversation(requestId, cle) {
      if (conversations.size >= 500) conversations.delete(conversations.keys().next().value);
      conversations.set(requestId, cle);
    },
    sessionDe: (cle) => sessions[cle] ?? null,
    /** Le téléphone envoie lui-même (PC fermé) : la réponse portera sa conversation. */
    poserContexte(requestId, contexte) {
      if (contextes.size >= 500) contextes.delete(contextes.keys().next().value);
      contextes.set(requestId, contexte);
    },
    /** Une tâche de fond fait reparler l'agent : l'app ouvre une réponse sous ce numéro. */
    spontane: (sessionId) => {
      const requestId = randomUUID();
      ajouter({ requestId, sessionId, spontane: true });
      return requestId;
    },
    /** `requete` : seulement les événements de cette réponse (le téléphone suit le message qu'il a envoyé). */
    abonner(res, depuis, instanceConnue, requete = null) {
      res.write(`event: instance\ndata: ${JSON.stringify({ instance })}\n\n`);
      const debut = instanceConnue === instance ? depuis : 0;
      const garder = (entree) => entree.seq > debut && (requete === null || entree.requestId === requete);
      for (const entree of entrees) if (garder(entree)) ecrireA(res, entree);
      const abonne = { write: (texte) => res.write(texte), end: () => res.end(), garder, tout: requete === null };
      abonnes.add(abonne);
      const battement = setInterval(() => res.write(": battement\n\n"), 20_000);
      res.on("close", () => {
        clearInterval(battement);
        abonnes.delete(abonne);
      });
    },
    /** Les appareils qui suivent tout le journal (le PC ; le téléphone suit un message à la fois). */
    ecouteurs: () => [...abonnes].filter((a) => a.tout).length,
    fermerTout() {
      for (const res of abonnes) res.end();
      abonnes.clear();
    },
  };
}

function jetonDe(req) {
  const valeur = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  const trouve = /^Bearer ([A-Za-z0-9_-]{20,200})$/.exec(valeur.trim());
  return trouve ? trouve[1] : null;
}

/**
 * @param {{ nom?: string, dossier: string, maintenant?: () => number, journal?: ReturnType<typeof creerJournal>,
 *   agents?: ReturnType<typeof creerAgents>, fichiers?: ReturnType<typeof creerFichiers>, routines?: ReturnType<typeof creerRoutines>,
 *   moteurs?: ReturnType<typeof creerMoteurs>, ia?: ReturnType<typeof creerIa> }} options
 */
export function creerGestionnaire(options) {
  const nom = (options.nom ?? "").trim() || "KLYRA";
  const dossier = options.dossier;
  const maintenant = options.maintenant ?? Date.now;
  const journal = options.journal ?? null;
  const agents = options.agents ?? null;
  const fichiers = options.fichiers ?? null;
  const routines = options.routines ?? null;
  const moteurs = options.moteurs ?? null;
  const ia = options.ia ?? null;
  /* L'espace du serveur (conversations, projets, workflows…) : là où il y a des agents. */
  const espace = options.espace ?? (agents ? creerEspace({ donnees: dossier }) : null);
  let echecs = 0;

  const appareilDe = (req) => {
    const jeton = jetonDe(req);
    if (!jeton) return null;
    const cherche = empreinte(jeton);
    return lireAppareils(dossier).find((a) => egal(a.empreinte, cherche)) ?? null;
  };
  /* `versionCode` dit l'âge du code (l'app signale un serveur en retard) ; `version` reste pour les apps qui l'exigent encore. */
  const corpsServeur = () => ({ produit: "klyra-serveur", protocole: PROTOCOLE, nom, version: String(PROTOCOLE), versionCode: VERSION_CODE_SERVEUR });
  /** Ce que l'app doit savoir pour proposer ce VPS dans le sélecteur. */
  const capacites = () => ({
    agents: agents ? agents.etat() : "absent",
    equipe: agents ? agents.empreinteEquipe() : "",
    /* Ce serveur garde sa propre équipe (cf. equipe.mjs) : l'app la lit ici et n'y écrase plus les fiches. */
    ...(agents?.equipeServeur ? { equipePropre: true, equipeInitialisee: agents.equipeServeur.initialise() } : {}),
    ...(agents?.coffreServeur ? { coffrePropre: true } : {}),
    ...(espace ? { espacePropre: true } : {}),
    ...(agents?.composioServeur ? { composioPropre: true } : {}),
    ...(fichiers ? { projets: fichiers.racine } : {}),
    ...(routines ? { routines: true } : {}),
    /* Réglages du serveur › Fournisseurs : moteurs (Claude Code, Codex) et IA à consulter. */
    ...(moteurs && ia ? { fournisseurs: true } : {}),
    /* L'atelier d'un agent : outils de l'assistant et épreuve (avant : seulement sur le PC). */
    ...(agents && ia ? { atelier: true } : {}),
  });

  return async function gestionnaire(req, res) {
    if (req.method === "OPTIONS") {
      res.writeHead(204, { ...ENTETES_CORS, "Access-Control-Max-Age": "600" });
      res.end();
      return;
    }
    const url = new URL(req.url ?? "/", "http://127.0.0.1");

    if (url.pathname === "/") {
      if (req.method !== "GET") return repondre(res, 405, { erreur: "methode" });
      const html = pageAccueil(nom);
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Length": Buffer.byteLength(html),
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });
      res.end(html);
      return;
    }

    if (url.pathname === CHEMIN_APPAIRER) {
      if (req.method !== "POST") return repondre(res, 405, { erreur: "methode" });
      const corps = await lireCorpsRequete(req);
      const code = typeof corps?.code === "string" ? corps.code.trim().toUpperCase() : "";
      const appareil = typeof corps?.appareil === "string" ? corps.appareil.trim().slice(0, 80) : "";
      const codes = lireCodes(dossier, maintenant());
      const cherche = code ? empreinte(code) : "";
      const index = cherche ? codes.findIndex((c) => egal(c.empreinte, cherche)) : -1;
      if (index < 0) {
        echecs += 1;
        // Trop d’essais : plus aucun code ne vaut, il faut en redemander un sur le VPS.
        if (echecs >= ECHECS_MAX) {
          ecrireJson(fichierCodes(dossier), []);
          echecs = 0;
        }
        return repondre(res, 401, { erreur: "code" });
      }
      const appareils = lireAppareils(dossier);
      if (appareils.length >= APPAREILS_MAX) return repondre(res, 409, { erreur: "appareils" });
      codes.splice(index, 1);
      ecrireJson(fichierCodes(dossier), codes);
      const jeton = randomBytes(32).toString("base64url");
      const date = new Date(maintenant()).toISOString();
      appareils.push({ id: randomBytes(8).toString("hex"), nom: appareil || "Appareil", empreinte: empreinte(jeton), cree: date, vu: date });
      ecrireJson(fichierAppareils(dossier), appareils);
      return repondre(res, 200, { ...corpsServeur(), jeton });
    }

    if (url.pathname === CHEMIN_APPAREIL) {
      if (req.method !== "DELETE") return repondre(res, 405, { erreur: "methode" });
      const appareil = appareilDe(req);
      if (!appareil) return repondre(res, 401, { erreur: "appareil" });
      ecrireJson(fichierAppareils(dossier), lireAppareils(dossier).filter((a) => a.id !== appareil.id));
      res.writeHead(204, ENTETES_CORS);
      res.end();
      return;
    }

    if (url.pathname === CHEMIN_ROUTINES || url.pathname.startsWith(`${CHEMIN_ROUTINES}/`)) {
      if (!routines) return repondre(res, 404, { erreur: "introuvable" });
      if (!appareilDe(req)) return repondre(res, 401, { erreur: "appareil" });
      const action = url.pathname.slice(CHEMIN_ROUTINES.length + 1);
      try {
        if (action === "" && req.method === "PUT") {
          routines.recevoir((await lireCorpsRequete(req, CORPS_FICHES_MAX))?.routines);
          return repondre(res, 200, { ok: true });
        }
        if (action === "historique" && req.method === "GET") {
          return repondre(res, 200, { runs: routines.historique(url.searchParams.get("id") ?? "", Number(url.searchParams.get("limite") ?? "50")) });
        }
        if (action === "executer" && req.method === "POST") return repondre(res, 200, { run: routines.executer(String((await lireCorpsRequete(req))?.id ?? "")) });
        if (action === "interrompre" && req.method === "POST") return repondre(res, 200, { ok: routines.interrompre(String((await lireCorpsRequete(req))?.runId ?? "")) });
      } catch (erreur) {
        return repondre(res, 400, { erreur: erreur instanceof Error ? erreur.message : "routine" });
      }
      return repondre(res, 404, { erreur: "introuvable" });
    }

    if (url.pathname === CHEMIN_MOTEURS || url.pathname.startsWith(`${CHEMIN_MOTEURS}/`)) {
      if (!moteurs) return repondre(res, 404, { erreur: "introuvable" });
      if (!appareilDe(req)) return repondre(res, 401, { erreur: "appareil" });
      /* /klyra/v1/moteurs, ou /klyra/v1/moteurs/<id>/<action> */
      const [id = "", action = ""] = url.pathname.slice(CHEMIN_MOTEURS.length + 1).split("/");
      try {
        if (!id && req.method === "GET") return repondre(res, 200, { moteurs: moteurs.liste() });
        if (action === "compte" && req.method === "GET") return repondre(res, 200, { compte: await moteurs.compte(id), connexion: id === "codex" || id === "grok" ? moteurs.etatConnexion(id) : null });
        if (action === "modeles" && req.method === "GET") return repondre(res, 200, { modeles: await moteurs.modeles(id) });
        if (action === "utilisation" && req.method === "GET") return repondre(res, 200, { utilisation: await moteurs.utilisation(id, url.searchParams.get("actualiser") === "1") });
        if (action === "version-disponible" && req.method === "GET") return repondre(res, 200, { version: await moteurs.versionDisponible(id) });
        if ((action === "installer" || action === "mettre-a-jour") && req.method === "POST") return repondre(res, 202, { travail: moteurs.lancerTravail(id, action) });
        if (action === "connecter" && req.method === "POST") return repondre(res, 200, await moteurs.connecter(id, (await lireCorpsRequete(req))?.mode));
        if (action === "retour" && req.method === "POST") return repondre(res, 200, { statut: await moteurs.relayerRetour(id, (await lireCorpsRequete(req, CORPS_RETOUR_MAX))?.chemin) });
        if (action === "connecter-cle" && req.method === "POST") return repondre(res, 200, { compte: await moteurs.connecterAvecCle(id, (await lireCorpsRequete(req))?.cle) });
        if (action === "deconnecter" && req.method === "POST") return repondre(res, 200, { compte: await moteurs.deconnecter(id) });
      } catch (erreur) {
        return repondre(res, 400, { erreur: "moteur", message: erreur instanceof Error ? erreur.message : "Le fournisseur n’a pas répondu sur le VPS." });
      }
      return repondre(res, 404, { erreur: "introuvable" });
    }

    if (url.pathname === CHEMIN_IA || url.pathname.startsWith(`${CHEMIN_IA}/`)) {
      if (!ia) return repondre(res, 404, { erreur: "introuvable" });
      if (!appareilDe(req)) return repondre(res, 401, { erreur: "appareil" });
      const action = url.pathname.slice(CHEMIN_IA.length + 1);
      try {
        if (action === "" && req.method === "GET") return repondre(res, 200, { catalogue: ia.catalogue(), liste: ia.lister() });
        if (action === "ajouter" && req.method === "POST") return repondre(res, 200, { liste: ia.ajouter(await lireCorpsRequete(req)) });
        if (action === "retirer" && req.method === "POST") return repondre(res, 200, { liste: ia.retirer(String((await lireCorpsRequete(req))?.id ?? "")) });
        if (action === "tester" && req.method === "POST") return repondre(res, 200, { texte: await ia.tester(String((await lireCorpsRequete(req))?.id ?? "")) });
      } catch (erreur) {
        return repondre(res, 400, { erreur: "ia", message: erreur instanceof Error ? erreur.message : "L’IA n’a pas répondu." });
      }
      return repondre(res, 404, { erreur: "introuvable" });
    }

    /* Les livrables publiés par les agents du VPS (serveur/rendus.mjs), recopiés par l'app :
       /klyra/v1/rendus/<id>/fichiers (la liste), /klyra/v1/rendus/<id>/fichier?relatif=… (les octets). */
    if (url.pathname.startsWith(`${CHEMIN_RENDUS}/`)) {
      if (!agents?.rendus) return repondre(res, 404, { erreur: "introuvable" });
      if (!appareilDe(req)) return repondre(res, 401, { erreur: "appareil" });
      if (req.method !== "GET") return repondre(res, 405, { erreur: "methode" });
      const [id = "", action = ""] = url.pathname.slice(CHEMIN_RENDUS.length + 1).split("/");
      if (!/^[0-9a-f-]{36}$/.test(id)) return repondre(res, 404, { erreur: "introuvable" });
      try {
        if (action === "fichiers") return repondre(res, 200, { fichiers: agents.rendus.fichiers(id) });
        if (action === "fichier") {
          const { chemin, taille } = agents.rendus.fichierDe(id, url.searchParams.get("relatif") ?? "");
          res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": taille, "Cache-Control": "no-store", ...ENTETES_CORS });
          agents.rendus.flux(chemin).on("error", () => res.destroy()).pipe(res);
          return;
        }
      } catch (erreur) {
        return repondre(res, 400, { erreur: "rendu", message: erreur instanceof Error ? erreur.message : "Lecture impossible sur le VPS." });
      }
      return repondre(res, 404, { erreur: "introuvable" });
    }

    if (url.pathname.startsWith(`${CHEMIN_EQUIPE}/`)) {
      if (!agents?.equipeServeur) return repondre(res, 404, { erreur: "introuvable" });
      if (!appareilDe(req)) return repondre(res, 401, { erreur: "appareil" });
      if (req.method !== "POST") return repondre(res, 405, { erreur: "methode" });
      try {
        const corps = await lireCorpsRequete(req, CORPS_EQUIPE_MAX);
        return repondre(res, 200, { resultat: agents.appelerEquipe(url.pathname.slice(CHEMIN_EQUIPE.length + 1), corps ?? {}) });
      } catch (erreur) {
        if (erreur instanceof ErreurEquipe) return repondre(res, 400, { erreur: erreur.code, message: erreur.message });
        throw erreur;
      }
    }

    if (url.pathname.startsWith(`${CHEMIN_ESPACE}/`)) {
      if (!espace) return repondre(res, 404, { erreur: "introuvable" });
      if (!appareilDe(req)) return repondre(res, 401, { erreur: "appareil" });
      if (req.method !== "POST") return repondre(res, 405, { erreur: "methode" });
      try {
        const corps = await lireCorpsRequete(req, CORPS_EQUIPE_MAX);
        return repondre(res, 200, { resultat: espace.appeler(url.pathname.slice(CHEMIN_ESPACE.length + 1), corps ?? {}) });
      } catch (erreur) {
        if (erreur instanceof ErreurEspace) return repondre(res, 400, { erreur: "espace", message: erreur.message });
        throw erreur;
      }
    }

    if (url.pathname.startsWith(`${CHEMIN_COMPOSIO}/`)) {
      if (!agents?.composioServeur) return repondre(res, 404, { erreur: "introuvable" });
      if (!appareilDe(req)) return repondre(res, 401, { erreur: "appareil" });
      if (req.method !== "POST") return repondre(res, 405, { erreur: "methode" });
      try {
        const corps = await lireCorpsRequete(req);
        return repondre(res, 200, { resultat: await agents.composioServeur.appeler(url.pathname.slice(CHEMIN_COMPOSIO.length + 1), corps ?? {}) });
      } catch (erreur) {
        return repondre(res, 400, { erreur: "composio", message: erreur instanceof Error ? erreur.message : "Composio illisible." });
      }
    }

    if (url.pathname.startsWith(`${CHEMIN_COFFRE}/`)) {
      if (!agents?.coffreServeur) return repondre(res, 404, { erreur: "introuvable" });
      if (!appareilDe(req)) return repondre(res, 401, { erreur: "appareil" });
      if (req.method !== "POST") return repondre(res, 405, { erreur: "methode" });
      try {
        const corps = await lireCorpsRequete(req);
        return repondre(res, 200, { resultat: agents.coffreServeur.appeler(url.pathname.slice(CHEMIN_COFFRE.length + 1), corps ?? {}) });
      } catch (erreur) {
        return repondre(res, 400, { erreur: "coffre", message: erreur instanceof Error ? erreur.message : "Coffre illisible." });
      }
    }

    if (url.pathname.startsWith(`${CHEMIN_FICHIERS}/`)) {
      if (!fichiers) return repondre(res, 404, { erreur: "introuvable" });
      if (!appareilDe(req)) return repondre(res, 401, { erreur: "appareil" });
      const action = url.pathname.slice(CHEMIN_FICHIERS.length + 1);
      const dossierProjet = url.searchParams.get("dossier") ?? "";
      try {
        if (action === "arbre" && req.method === "GET") return repondre(res, 200, { noeuds: await fichiers.arbre(dossierProjet, url.searchParams.get("relatif") ?? "") });
        if (action === "lire" && req.method === "GET") return repondre(res, 200, await fichiers.lire(dossierProjet, url.searchParams.get("relatif") ?? ""));
        if (action === "dossier" && req.method === "POST") return repondre(res, 200, { dossier: await fichiers.creerDossier(dossierProjet) });
        if (action === "ecrire" && req.method === "POST") {
          const corps = await lireCorpsRequete(req, CORPS_FICHES_MAX);
          return repondre(res, 200, { chemin: await fichiers.ecrireTexte(corps?.chemin, corps?.texte) });
        }
        /* La carte « Consignes du projet » d'un projet du VPS : GET l'état (et ce qui serait écrit), POST l'écriture. */
        if (action === "consignes" && req.method === "GET") return repondre(res, 200, { consignes: fichiers.consignes(dossierProjet, url.searchParams.get("nom") ?? "") });
        if (action === "consignes" && req.method === "POST") return repondre(res, 200, { consignes: fichiers.ecrireConsignes(dossierProjet, url.searchParams.get("nom") ?? "") });
      } catch (erreur) {
        return repondre(res, 400, { erreur: "fichier", message: erreur instanceof ErreurFichier ? erreur.message : "Lecture impossible sur le VPS." });
      }
      return repondre(res, 404, { erreur: "introuvable" });
    }

    if (url.pathname.startsWith(`${CHEMIN_AGENT}/`) || url.pathname === CHEMIN_FICHES) {
      if (!agents || !journal) return repondre(res, 404, { erreur: "introuvable" });
      if (!appareilDe(req)) return repondre(res, 401, { erreur: "appareil" });
      const action = url.pathname === CHEMIN_FICHES ? "fiches" : url.pathname.slice(CHEMIN_AGENT.length + 1);
      if (action === "evenements") {
        if (req.method !== "GET") return repondre(res, 405, { erreur: "methode" });
        res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", Connection: "keep-alive", ...ENTETES_CORS });
        const depuis = Number(url.searchParams.get("depuis") ?? "0");
        const requete = url.searchParams.get("requete");
        journal.abonner(res, Number.isFinite(depuis) ? depuis : 0, url.searchParams.get("instance") ?? "", requete && /^[A-Za-z0-9_-]{1,100}$/.test(requete) ? requete : null);
        return;
      }
      if (action === "fiches") {
        if (req.method !== "PUT") return repondre(res, 405, { erreur: "methode" });
        const corps = await lireCorpsRequete(req, CORPS_EQUIPE_MAX);
        try {
          agents.recevoirFiches(corps);
        } catch {
          return repondre(res, 400, { erreur: "fiches" });
        }
        return repondre(res, 200, capacites());
      }
      /* Réglages du serveur › Général : ce que la configuration de Claude Code de ce VPS ajoute à chaque appel. */
      if (action === "diagnostic") {
        if (req.method !== "GET") return repondre(res, 405, { erreur: "methode" });
        return repondre(res, 200, { diagnostic: agents.diagnostic() });
      }
      /* Le panneau Compétences d'un agent de ce VPS (`?agent=…&dossier=…`). */
      if (action === "competences") {
        if (req.method !== "GET") return repondre(res, 405, { erreur: "methode" });
        try {
          return repondre(res, 200, { competences: agents.competences(url.searchParams.get("agent"), url.searchParams.get("dossier")) });
        } catch (erreur) {
          return repondre(res, 400, { erreur: "competences", message: erreur instanceof Error ? erreur.message : "Lecture impossible sur le VPS." });
        }
      }
      /*
       * La mémoire d'un agent de ce VPS, pour le panneau Souvenirs de l'app (comme sur le PC) :
       * GET memoire et souvenir (`?agent=…&dossier=…&session=…&id=…`), POST souvenir-ecrire et souvenir-creer.
       */
      if (action === "memoire" || action === "souvenir" || action === "souvenir-ecrire" || action === "souvenir-creer") {
        const lecture = action === "memoire" || action === "souvenir";
        if (req.method !== (lecture ? "GET" : "POST")) return repondre(res, 405, { erreur: "methode" });
        try {
          if (lecture) {
            const agent = url.searchParams.get("agent");
            const contexte = { dossier: url.searchParams.get("dossier"), sessionId: url.searchParams.get("session") };
            return repondre(res, 200, action === "memoire" ? { memoire: agents.memoire.lire(agent, contexte) } : { souvenir: agents.memoire.souvenir(agent, contexte, url.searchParams.get("id")) });
          }
          const c = (await lireCorpsRequete(req, CORPS_AGENT_MAX)) ?? {};
          const contexte = { dossier: c.dossier ?? null, sessionId: c.sessionId ?? null };
          if (action === "souvenir-ecrire") return repondre(res, 200, { ecrit: agents.memoire.ecrire(c.agent, contexte, c.id, c.contenu, c.attendu) });
          return repondre(res, 200, { souvenir: agents.memoire.creer(c.agent, contexte, c.titre, c.contenu) });
        } catch (erreur) {
          const code = erreur && typeof erreur === "object" && typeof erreur.code === "string" ? erreur.code : "memoire";
          return repondre(res, code === "conflit" ? 409 : 400, { erreur: code, message: erreur instanceof Error ? erreur.message : "Lecture impossible sur le VPS." });
        }
      }
      /*
       * L'épreuve d'un agent pas encore créé, dans une conversation de ce VPS (atelier, comme sur le PC) :
       * un essai de sa fiche sur une demande, puis un avis. `conversation` et `ajouts` : ce que la personne a
       * ajouté à la fiche, que l'assistant verra au prochain appel.
       */
      if (action === "essayer") {
        if (req.method !== "POST") return repondre(res, 405, { erreur: "methode" });
        const c = (await lireCorpsRequete(req, CORPS_AGENT_MAX)) ?? {};
        try {
          return repondre(res, 200, await agents.essayer(c.brouillon, c.cas, { conversation: c.conversation, ajouts: c.ajouts }));
        } catch (erreur) {
          return repondre(res, 400, { erreur: "essai", message: erreur instanceof Error ? erreur.message : "Essai impossible sur le VPS." });
        }
      }
      if (req.method !== "POST") return repondre(res, 405, { erreur: "methode" });
      // Le résultat d'un outil du navigateur peut porter une capture d'écran.
      const corps = await lireCorpsRequete(req, action === "navigateur" ? 10 * CORPS_AGENT_MAX : CORPS_AGENT_MAX);
      const requestId = typeof corps?.requestId === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(corps.requestId) ? corps.requestId : null;
      if (!requestId) return repondre(res, 400, { erreur: "requete" });
      if (action === "envoyer") {
        /* Venu du téléphone, PC fermé : la conversation où le PC rangera l'échange à sa réouverture. */
        let contexte = null;
        if (corps.contexte !== undefined) {
          contexte = contexteTelephone(corps.contexte);
          if (!contexte) return repondre(res, 400, { erreur: "contexte" });
          journal?.poserContexte(requestId, contexte);
        }
        /* La conversation (dite par le PC, ou par le contexte du téléphone) : sans session, l'agent reprend la sienne. */
        const options = corps.options && typeof corps.options === "object" ? { ...corps.options } : corps.options;
        const cle = options && typeof options === "object" ? cleConversation(options.conversation ?? contexte?.chatId, options.agent, options.moteur) : null;
        /* Écrit du téléphone : sa conversation sert aussi à suivre l'atelier d'un agent (cf. agents.mjs). */
        if (options && typeof options === "object" && options.conversation === undefined && typeof contexte?.chatId === "string") options.conversation = contexte.chatId;
        if (cle && journal) {
          journal.lierConversation(requestId, cle);
          /* Repartie à zéro sur le PC : surtout pas l'ancienne ; la session neuve la remplacera ici. */
          if (!options.sessionId && options.sessionNeuve !== true) options.sessionId = journal.sessionDe(cle);
        }
        agents.envoyer(requestId, options);
        return repondre(res, 202, { requestId });
      }
      if (action === "autoriser") return repondre(res, 200, { ok: agents.autoriser(requestId, String(corps.demandeId ?? ""), String(corps.decision ?? "")) });
      if (action === "annuler") return repondre(res, 200, { ok: agents.annuler(requestId) });
      /* Le PC rend le résultat d'un outil du navigateur de KLYRA demandé par un agent d'ici (cf. navigateur.mjs). */
      if (action === "navigateur") return repondre(res, 200, { ok: agents.navigateur?.repondre(requestId, corps.resultat) ?? false });
      /*
       * Le Coffre de KLYRA, sur le PC (cf. coffre.mjs) : `lire` rend une fois la valeur qu'un agent d'ici range ;
       * sinon, le PC rend le résultat (et, pour un fichier de ce VPS, la valeur, écrite ici).
       */
      if (action === "coffre") {
        if (corps.lire === true) {
          const valeur = agents.coffre?.lireValeur(requestId) ?? null;
          return valeur === null ? repondre(res, 404, { erreur: "introuvable" }) : repondre(res, 200, { valeur });
        }
        return repondre(res, 200, { ok: (await agents.coffre?.repondre(requestId, corps)) ?? false });
      }
      /* Le PC rend la réponse d'un outil des workflows demandé par un agent d'ici (cf. workflows.mjs). */
      if (action === "workflow") return repondre(res, 200, { ok: agents.workflows?.repondre(requestId, corps.resultat) ?? false });
      return repondre(res, 404, { erreur: "introuvable" });
    }

    if (url.pathname !== CHEMIN) return repondre(res, 404, { erreur: "introuvable" });
    if (req.method !== "GET") return repondre(res, 405, { erreur: "methode" });
    const appareil = appareilDe(req);
    if (!appareil) return repondre(res, 401, { erreur: "appareil" });
    // Dernière visite, à la minute près : pas une écriture par appel.
    const date = new Date(maintenant()).toISOString();
    if (appareil.vu?.slice(0, 16) !== date.slice(0, 16)) {
      ecrireJson(fichierAppareils(dossier), lireAppareils(dossier).map((a) => (a.id === appareil.id ? { ...a, vu: date } : a)));
    }
    return repondre(res, 200, { ...corpsServeur(), ...capacites() });
  };
}

/** @param {Parameters<typeof creerGestionnaire>[0] & { port?: number, hote?: string, cert?: Buffer, cle?: Buffer }} options */
export function ecouter(options) {
  const gestionnaire = creerGestionnaire(options);
  const appel = (req, res) => {
    gestionnaire(req, res).catch(() => {
      if (!res.headersSent) repondre(res, 500, { erreur: "serveur" });
    });
  };
  const serveur = options.cert && options.cle ? creerHttps({ cert: options.cert, key: options.cle }, appel) : creerHttp(appel);
  const port = options.port ?? 0;
  const hote = options.hote ?? "127.0.0.1";
  return new Promise((resolve, reject) => {
    serveur.once("error", reject);
    serveur.listen(port, hote, () => {
      const adresse = serveur.address();
      resolve({
        serveur,
        port: typeof adresse === "object" && adresse ? adresse.port : port,
        fermer: () => {
          options.journal?.fermerTout();
          options.agents?.fermerTout();
          options.ia?.fermer();
          options.routines?.arreter();
          return new Promise((fini, echec) => serveur.close((err) => (err ? echec(err) : fini())));
        },
      });
    });
  });
}

function lireFichier(chemin, etiquette) {
  try {
    return readFileSync(chemin);
  } catch {
    process.stderr.write(`${etiquette} illisible.\n`);
    process.exit(1);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dossier = path.resolve(process.env.KLYRA_SERVEUR_DONNEES || path.join(path.dirname(process.argv[1]), "donnees"));
  const commande = process.argv[2] ?? "";
  if (commande === "appairer") {
    process.stdout.write(`${creerCode(dossier)}\n`);
    process.exit(0);
  }
  if (commande === "revoquer-tout") {
    revoquerTout(dossier);
    process.stdout.write("Plus aucun appareil n’est relié à ce serveur.\n");
    process.exit(0);
  }
  if (commande) {
    process.stderr.write("Commandes : appairer, revoquer-tout, ou rien pour lancer le serveur.\n");
    process.exit(1);
  }
  if (!existsSync(dossier)) mkdirSync(dossier, { recursive: true, mode: 0o700 });

  const certChemin = process.env.KLYRA_SERVEUR_CERT ?? "";
  const cleChemin = process.env.KLYRA_SERVEUR_CLE ?? "";
  if (Boolean(certChemin) !== Boolean(cleChemin)) {
    process.stderr.write("Le certificat et la clé vont ensemble.\n");
    process.exit(1);
  }
  const port = Number(process.env.KLYRA_SERVEUR_PORT ?? "8791");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write("KLYRA_SERVEUR_PORT n’est pas un port.\n");
    process.exit(1);
  }
  const nomServeur = (process.env.KLYRA_SERVEUR_NOM ?? "").trim() || "KLYRA";
  const home = process.env.HOME || path.dirname(dossier);
  /* La session de chaque agent par conversation : gardée entre deux redémarrages, le téléphone y reprend. */
  const journal = creerJournal(Date.now, path.join(dossier, "sessions-conversations.json"));
  /* Les réponses de routine portent leur conversation ; le moteur des routines suit leur fin. */
  let routines = null;
  const publier = (requestId, event, sessionId) => {
    journal.publier(requestId, event, sessionId, routines?.contexte(requestId) ?? null);
    routines?.surEvenement(requestId, event);
  };
  const ia = creerIa({ donnees: dossier, version: String(PROTOCOLE) });
  await ia.demarrer();
  const agents = creerAgents({ home, donnees: dossier, nomServeur, publier, spontane: journal.spontane, ia, version: String(PROTOCOLE), ecouteurs: journal.ecouteurs });
  const moteurs = creerMoteurs({ home, claude: agents.claude, codex: agents.codex, grok: agents.grok });
  routines = creerRoutines({ donnees: dossier, home, envoyer: agents.envoyer, annuler: agents.annuler });
  const ecoute = await ecouter({
    nom: process.env.KLYRA_SERVEUR_NOM,
    dossier,
    journal,
    agents,
    fichiers: creerFichiers(home),
    routines,
    moteurs,
    ia,
    port,
    hote: process.env.KLYRA_SERVEUR_HOTE ?? "127.0.0.1",
    cert: certChemin ? lireFichier(certChemin, "Certificat") : undefined,
    cle: cleChemin ? lireFichier(cleChemin, "Clé") : undefined,
  });
  routines.demarrer();
  process.stdout.write(`klyra-serveur ${ecoute.port}\n`);
}
