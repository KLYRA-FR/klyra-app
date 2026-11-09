/**
 * Les sessions de Claude Code d'un projet, lancées hors de l'app (terminal, éditeur…) : leur liste, et leurs
 * messages pour les reprendre dans une conversation de l'app (qui garde la même session : `--resume`). Lues dans
 * les transcriptions de Claude Code (`<config>/projects/<dossier encodé>/<session>.jsonl`), sans rien y écrire.
 * Seulement le texte échangé : ni résultats d'outils, ni rappels du système, ni sous-agents.
 * Pur et sans Electron : le même module sert à l'app et au serveur d'un VPS (généré en `serveur/sessions-terminal.mjs`).
 */
import { closeSync, existsSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import path from "node:path";

/** Le dossier des transcriptions d'un dossier de travail, comme Claude Code le nomme. */
export function dossierTranscriptions(configClaude: string, cwd: string): string {
  return path.join(configClaude, "projects", path.resolve(cwd).replace(/[^a-zA-Z0-9]/g, "-"));
}

export interface SessionTerminal {
  id: string;
  /** Le premier message de la personne, coupé. */
  titre: string;
  /** Dernière écriture (ms). */
  modifieLe: number;
  /** Ouverte par l'app de bureau (ses messages sont déjà dans une conversation). */
  deLApp: boolean;
}

export interface MessageSession {
  auteur: "personne" | "agent";
  texte: string;
  le: string;
}

const ID_SESSION = /^[0-9a-f-]{36}$/;
const TAILLE_MAX = 40 * 1024 * 1024;
/** Les messages que l'app écrit à un agent commencent ainsi : ces sessions sont déjà dans une conversation. */
const MARQUES_APP = /^\[(Contexte|Message de |Depuis ta dernière réponse|La conversation jusqu|Retour du fil|Conversation reprise)/;

/** Le texte d'un message de transcription (chaîne, ou blocs `text`), sans les rappels du système. */
function texteDe(contenu: unknown): string {
  const brut = typeof contenu === "string" ? contenu : Array.isArray(contenu) ? contenu.map((b) => (b && typeof b === "object" && (b as { type?: unknown }).type === "text" ? String((b as { text?: unknown }).text ?? "") : "")).join("\n") : "";
  return brut.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "").trim();
}

/** Un message de la personne qui n'en est pas un (commande locale, sortie de commande, rappel). */
const technique = (t: string) => !t || /^<(command-|local-command|bash-|user-memory)/.test(t) || t.startsWith("Caveat:");

/** Le début d'un fichier, sans tout lire. */
function debutDe(fichier: string, octets: number): string {
  const fd = openSync(fichier, "r");
  try {
    const tampon = Buffer.alloc(octets);
    const lus = readSync(fd, tampon, 0, octets, 0);
    return tampon.subarray(0, lus).toString("utf8");
  } finally {
    closeSync(fd);
  }
}

/** Les sessions de ce dossier, les plus récentes d'abord (`max` au plus). */
export function listerSessionsTerminal(configClaude: string, cwd: string, max = 30): SessionTerminal[] {
  const dossier = dossierTranscriptions(configClaude, cwd);
  if (!existsSync(dossier)) return [];
  const sessions: SessionTerminal[] = [];
  for (const nom of readdirSync(dossier)) {
    const id = nom.replace(/\.jsonl$/, "");
    if (!nom.endsWith(".jsonl") || !ID_SESSION.test(id)) continue;
    const fichier = path.join(dossier, nom);
    let modifieLe = 0;
    try {
      modifieLe = statSync(fichier).mtimeMs;
    } catch {
      continue;
    }
    let titre = "";
    let deLApp = false;
    for (const ligne of debutDe(fichier, 256 * 1024).split("\n")) {
      let e: Record<string, unknown>;
      try {
        e = JSON.parse(ligne) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (e.type !== "user" || e.isSidechain === true || e.isMeta === true) continue;
      const t = texteDe((e.message as { content?: unknown } | undefined)?.content);
      if (technique(t)) continue;
      deLApp = MARQUES_APP.test(t);
      titre = t.replace(/\s+/g, " ").slice(0, 140);
      break;
    }
    if (!titre) continue;
    sessions.push({ id, titre, modifieLe, deLApp });
  }
  return sessions.sort((a, b) => b.modifieLe - a.modifieLe).slice(0, max);
}

/** Les messages d'une session (texte seulement, 300 au plus, les derniers), pour la reprendre dans l'app. */
export function lireSessionTerminal(configClaude: string, cwd: string, id: string): MessageSession[] {
  if (!ID_SESSION.test(id)) throw new Error("Session invalide.");
  const fichier = path.join(dossierTranscriptions(configClaude, cwd), `${id}.jsonl`);
  if (!existsSync(fichier)) throw new Error("Cette session n’existe plus.");
  if (statSync(fichier).size > TAILLE_MAX) throw new Error("Cette session est trop longue pour être reprise ici.");
  const messages: MessageSession[] = [];
  for (const ligne of readFileSync(fichier, "utf8").split("\n")) {
    let e: Record<string, unknown>;
    try {
      e = JSON.parse(ligne) as Record<string, unknown>;
    } catch {
      continue;
    }
    if ((e.type !== "user" && e.type !== "assistant") || e.isSidechain === true || e.isMeta === true) continue;
    const t = texteDe((e.message as { content?: unknown } | undefined)?.content);
    if (e.type === "user" && technique(t)) continue;
    if (!t) continue;
    const auteur = e.type === "user" ? "personne" : "agent";
    const le = typeof e.timestamp === "string" ? e.timestamp : new Date(0).toISOString();
    const dernier = messages[messages.length - 1];
    /* Les blocs de texte d'une même réponse (entre deux outils) font un seul message. */
    if (dernier && dernier.auteur === "agent" && auteur === "agent") dernier.texte = `${dernier.texte}\n\n${t}`.slice(0, 40_000);
    else messages.push({ auteur, texte: t.slice(0, 40_000), le });
  }
  return messages.slice(-300);
}

/** La commande qui reprend une session dans un terminal, dans son dossier (sous Windows : pour PowerShell). */
export function commandeTerminal(cwd: string, sessionId: string, windows = false): string {
  if (!ID_SESSION.test(sessionId)) throw new Error("Session invalide.");
  if (windows) return `cd '${cwd.replace(/'/g, "''")}'; claude --resume ${sessionId}`;
  return `cd '${cwd.replace(/'/g, "'\\''")}' && claude --resume ${sessionId}`;
}
