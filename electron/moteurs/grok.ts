import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { app, safeStorage } from "electron";
import { consignesApp, dossierDeTravail, environnementAgent, pasDansMesAgents } from "../claude";
import { espaceComposio } from "../composio";
import { consigneSkillsCodex, filtreSkills, promptAvecSkillCodex } from "../connaissances-agent";
import { configMcp } from "../ia";
import { estActif, generation } from "../mes-agents";
import { signatureNavigateur } from "../navigateur/outils";
import { voirFin, voirOutil } from "../ordinateur/apercu";
import { signatureOrdinateur } from "../ordinateur/pilote";
import { lireReglages } from "../reglages";
import { lireUtilisationGrok, type Utilisation } from "../utilisation";
import { creerClientAcp, emailDeAuth, mcpPourAcp } from "./acp";
import { ficheBrute, ficheDe } from "./codex";
import { binaireGere, commande, derniereVersionNpm, estGere, installerDepuisNpm } from "./installation";
import type { AgentEvent, CompteMoteur, ModeleMoteur, Moteur, Progression, StreamOptions } from "./types";

/**
 * Grok, par Grok Build (xAI) : `grok agent stdio`, l'Agent Client Protocol (electron/moteurs/acp.ts,
 * le même client que sur le VPS). L'abonnement (SuperGrok, X Premium+) se connecte par `grok login`
 * (la page d'xAI s'ouvre dans le navigateur), comme dans le terminal ; une clé API de console.x.ai est
 * le repli, chiffrée par le trousseau du système et donnée au processus seulement (`XAI_API_KEY`).
 * Ses messages sont traduits en `AgentEvent` : l'interface ne voit pas la différence.
 */

const HOME = os.homedir();
const EXE = process.platform === "win32" ? "grok.exe" : "grok";
const CONNEXION_MAX_MS = 5 * 60 * 1000;
const PAQUET = "@xai-official/grok";

/** Le dossier de Grok (`GROK_HOME`, sinon `~/.grok`) : sa connexion est dans `auth.json`. */
const grokHome = () => process.env.GROK_HOME || path.join(HOME, ".grok");

/** Celui du poste d'abord (installé par xAI dans ~/.grok/bin, ou dans le PATH), puis celui que l'app a installé. */
export function trouverGrok(): string | null {
  const fromPath = (process.env.PATH ?? "").split(path.delimiter).filter(Boolean).map((d) => path.join(d, EXE));
  const candidats = [process.env.KLYRA_GROK_PATH, path.join(grokHome(), "bin", EXE), ...fromPath, "/opt/homebrew/bin/grok", "/usr/local/bin/grok", path.join(HOME, ".local", "bin", EXE), binaireGere("grok", EXE)];
  return candidats.find((c): c is string => !!c && existsSync(c)) ?? null;
}

/* ─── La clé API (repli) ───────────────────────────────────────── */

const fichierCle = () => path.join(process.env.KLYRA_USER_DATA || app.getPath("userData"), "grok-cle.json");

function lireCle(): string | null {
  try {
    if (!existsSync(fichierCle()) || !safeStorage.isEncryptionAvailable()) return null;
    const { cle } = JSON.parse(readFileSync(fichierCle(), "utf8")) as { cle?: string };
    return cle ? safeStorage.decryptString(Buffer.from(cle, "base64")) : null;
  } catch {
    return null;
  }
}

function ecrireCle(cle: string | null): void {
  if (cle === null) return rmSync(fichierCle(), { force: true });
  if (!safeStorage.isEncryptionAvailable()) throw new Error("Le trousseau du système est indisponible : la clé ne peut pas être protégée, elle n’est pas gardée.");
  writeFileSync(fichierCle(), JSON.stringify({ cle: safeStorage.encryptString(cle).toString("base64") }), { encoding: "utf8", mode: 0o600 });
}

/** L'environnement de Grok : celui des agents, et la clé API gardée par l'app s'il y en a une. */
function environnement(): Record<string, string | undefined> {
  const env: Record<string, string | undefined> = { ...environnementAgent() };
  const cle = lireCle();
  if (cle) env.XAI_API_KEY = cle;
  return env;
}

/* ─── Le client ────────────────────────────────────────────────── */

const client = creerClientAcp({
  trouver: trouverGrok,
  env: environnement,
  cwd: () => HOME,
  client: { name: "klyra", title: "KLYRA", version: app.getVersion() },
});

/** Ce qui change avec Grok : il n'appelle pas un agent de l'app directement, il passe par les fils. */
const CONSIGNE_GROK = "Dans cette session, tu travailles avec Grok : tu ne peux pas appeler un agent de l’équipe directement. Pour confier un travail, ouvre un fil avec ouvrir_fil.";
const CONSIGNE_GROK_SEUL = "Dans cette session, tu travailles avec Grok et tu ne peux confier aucun travail à l’équipe : fais ta part seul et dis ce qui reste.";

const CONFIG_CLAUDE = () => process.env.CLAUDE_CONFIG_DIR || path.join(HOME, ".claude");

function lancer(requestId: string, options: StreamOptions, emit: (event: AgentEvent) => void): void {
  const echec = (erreur: string) => emit({ type: "fin", ok: false, texte: "", erreur });
  if (!trouverGrok()) return echec("Grok n’est pas installé sur ce poste : installe Grok Build dans Réglages du serveur › Fournisseurs.");
  if (options.agent !== null && !/^[a-z0-9][a-z0-9-]{0,63}$/.test(options.agent)) return echec("Nom d’agent invalide.");
  if (options.agent !== null && !estActif(options.agent)) return echec(pasDansMesAgents(options.agent));
  const cwd = dossierDeTravail(options.dossier);
  if (!cwd) return echec(`Le dossier du projet est introuvable : ${options.dossier}`);
  /* Les skills de Claude : Grok n'en lit aucune de lui-même ici (ENV_GROK) ; la consigne présente celles allumées pour cet agent. */
  const filtre = filtreSkills(lireReglages().skillsParAgent, options.agent, CONFIG_CLAUDE(), cwd);
  const skills = consigneSkillsCodex(options.agent ? ficheBrute(options.agent) : null, CONFIG_CLAUDE(), cwd, filtre.garder);
  const mcp = configMcp({ chatId: options.chatId ?? "", roleId: options.agent ?? "principal", routineRun: options.routineRun }, espaceComposio.creerCapacite());
  const fiche = options.agent ? ficheDe(options.agent) : null;
  const regles = [fiche, ...consignesApp(options, mcp), skills.texte, mcp ? CONSIGNE_GROK : CONSIGNE_GROK_SEUL].filter(Boolean).join("\n\n");
  const chatId = options.chatId ?? "";
  client.lancer(
    requestId,
    {
      sessionId: options.sessionId,
      cwd,
      prompt: promptAvecSkillCodex(options.prompt, options.skill, CONFIG_CLAUDE(), cwd, filtre.garder),
      regles,
      mcp: mcpPourAcp(mcp),
      acces: options.acces ?? "projet",
      modele: options.modele,
      effort: options.effort,
      signature: JSON.stringify([options.agent, generation(), espaceComposio.signature(), options.routineRun ?? null, signatureOrdinateur(), skills.noms, filtre.coupes, signatureNavigateur(), cwd]),
    },
    (event) => {
      if (event.type === "etape" && event.outil.startsWith("mcp__ordinateur__")) voirOutil(chatId, event.outil, event.entree);
      if (event.type === "fin") {
        voirFin(chatId);
        /* Les crédits ont bougé : relus après chaque réponse (une lecture du compte, sans modèle). */
        void utilisation(true);
      }
      emit(event);
    },
  );
}

/* ─── Utilisation de l'abonnement Grok ─────────────────────────── */

let derniereUtilisation: Utilisation | null = null;
const abonnesUtilisation = new Set<(u: Utilisation) => void>();

/** Connecté par son abonnement (`grok login`) : une clé API est facturée à l'usage, sans crédits du mois. */
const parAbonnement = () => existsSync(path.join(grokHome(), "auth.json"));

/** La dernière connue ; `actualiser` : relue par `x.ai/billing` (les crédits restants, ne consomme rien). */
async function utilisation(actualiser: boolean): Promise<Utilisation | null> {
  if (!actualiser && derniereUtilisation) return derniereUtilisation;
  if (!trouverGrok() || !parAbonnement()) return derniereUtilisation;
  try {
    const u = lireUtilisationGrok(await client.facturation(), derniereUtilisation);
    if (u && u !== derniereUtilisation) {
      derniereUtilisation = u;
      abonnesUtilisation.forEach((cb) => cb(u));
    }
  } catch {
    /* Cette version de Grok ne donne pas sa facturation : pas d'anneau, rien d'inventé. */
  }
  return derniereUtilisation;
}

function surUtilisation(callback: (u: Utilisation) => void): () => void {
  abonnesUtilisation.add(callback);
  return () => abonnesUtilisation.delete(callback);
}

/* ─── Compte et modèles ────────────────────────────────────────── */

let versionLue: { bin: string; version: string | null } | null = null;

async function lireVersion(bin: string): Promise<string | null> {
  if (versionLue?.bin === bin) return versionLue.version;
  const r = await commande(bin, ["--version"], 20_000);
  versionLue = { bin, version: /(\d+\.\d+\.\d+)/.exec(r.sortie)?.[1] ?? null };
  return versionLue.version;
}

async function compte(): Promise<CompteMoteur> {
  const bin = trouverGrok();
  const vide: CompteMoteur = { installe: !!bin, chemin: bin, version: null, connecte: false, methode: null, email: null, organisation: null, abonnement: null, verifieLe: Date.now() };
  if (!bin) return vide;
  const auth = path.join(grokHome(), "auth.json");
  const session = existsSync(auth);
  /* Ordre de Grok (« Auth Precedence ») : la session de `grok login`, puis la clé API. */
  const methode = session ? "grok.com" : lireCle() ? "cle-api" : process.env.XAI_API_KEY ? "env" : null;
  let email: string | null = null;
  try {
    email = session ? emailDeAuth(readFileSync(auth, "utf8")) : null;
  } catch {
    /* illisible : connecté quand même */
  }
  return { ...vide, version: await lireVersion(bin), connecte: !!methode, methode, email };
}

/** Connexion avec le compte Grok : `grok login` ouvre la page d'xAI dans le navigateur et attend qu'elle soit validée. */
async function connecter(): Promise<CompteMoteur> {
  const bin = trouverGrok();
  if (!bin) return compte();
  const r = await new Promise<{ code: number | null; sortie: string }>((resolve) => {
    const child = spawn(bin, ["login"], { cwd: HOME, env: { ...environnement(), GROK_DISABLE_AUTOUPDATER: "1" }, windowsHide: true });
    let sortie = "";
    child.stdout?.on("data", (d: Buffer) => (sortie = (sortie + d.toString()).slice(-4000)));
    child.stderr?.on("data", (d: Buffer) => (sortie = (sortie + d.toString()).slice(-4000)));
    const delai = setTimeout(() => child.kill("SIGTERM"), CONNEXION_MAX_MS);
    child.on("error", (error) => {
      clearTimeout(delai);
      resolve({ code: null, sortie: error.message });
    });
    child.on("close", (code) => {
      clearTimeout(delai);
      resolve({ code, sortie });
    });
  });
  // Le processus ouvert garde l'ancienne connexion en mémoire : le prochain appel relance Grok.
  client.fermer();
  // Les crédits lus étaient ceux de l'ancien compte.
  derniereUtilisation = null;
  const etat = await compte();
  if (!etat.connecte && r.code !== 0) throw new Error(r.sortie.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "").trim().split("\n").slice(-3).join(" ").slice(0, 400) || "La connexion à Grok n’a pas abouti.");
  return etat;
}

async function connecterAvecCle(cle: string): Promise<CompteMoteur> {
  if (!/^\S{10,400}$/.test(cle)) throw new Error("Cette clé ne ressemble pas à une clé API.");
  ecrireCle(cle);
  client.fermer();
  return compte();
}

async function deconnecter(): Promise<CompteMoteur> {
  const bin = trouverGrok();
  ecrireCle(null);
  derniereUtilisation = null;
  if (bin && existsSync(path.join(grokHome(), "auth.json"))) await commande(bin, ["logout"], 30_000);
  client.fermer();
  return compte();
}

async function modeles(): Promise<ModeleMoteur[]> {
  if (!trouverGrok()) return [];
  const vide = mkdtempSync(path.join(os.tmpdir(), "klyra-grok-modeles-"));
  try {
    return await client.modeles(vide);
  } finally {
    rmSync(vide, { recursive: true, force: true });
  }
}

/** Installe Grok Build publié sur npm par xAI, pour ce système, dans ~/.klyra/moteurs/grok. */
async function installer(progression: (p: Progression) => void): Promise<CompteMoteur> {
  await installerDepuisNpm({ moteur: "grok", paquet: PAQUET, executable: EXE, progression });
  // Le processus ouvert garde l'ancien programme : le prochain appel lance le nouveau.
  if (estGere(trouverGrok())) client.fermer();
  versionLue = null;
  return compte();
}

async function mettreAJour(progression: (p: Progression) => void): Promise<CompteMoteur> {
  const bin = trouverGrok();
  if (!bin || estGere(bin)) return installer(progression);
  progression({ etape: "mise-a-jour", recu: 0, total: null });
  client.fermer();
  const r = await commande(bin, ["update"], 10 * 60_000);
  versionLue = null;
  if (r.code !== 0) throw new Error(r.sortie.trim().split("\n").slice(-3).join(" ").slice(0, 400) || "La mise à jour de Grok a échoué.");
  return compte();
}

export const grok: Moteur = {
  id: "grok",
  nom: "Grok Build",
  fournisseur: "Grok",
  trouver: trouverGrok,
  compte,
  connecter,
  connecterAvecCle,
  deconnecter,
  modeles,
  versionDisponible: () => derniereVersionNpm(PAQUET),
  installer,
  mettreAJour,
  lancer,
  utilisation,
  surUtilisation,
  arreter: (requestId) => void client.arreter(requestId),
  autoriser: (requestId, demandeId, decision) => client.autoriser(requestId, demandeId, decision),
  fermer: () => client.fermer(),
};
