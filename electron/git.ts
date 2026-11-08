import { execFile } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DiffFichierGit } from "./github-types";

/**
 * Publier un projet depuis l'app : voir ce qui a changé, puis commit + push
 * de la branche en cours. Rien ne part sans que la personne l'ait demandé.
 */

export interface FichierGit {
  /** « M » modifié, « A » ajouté, « D » supprimé, « ? » nouveau, « R » renommé. */
  statut: string;
  chemin: string;
  /** Renommé : son ancien chemin. */
  ancien?: string;
}

export type { DiffFichierGit };

export interface EtatGit {
  /** Le dossier est-il un dépôt git ? */
  depot: boolean;
  branche: string | null;
  /** La branche a-t-elle un équivalent sur le serveur (origin) ? */
  suivie: boolean;
  /** Commits locaux pas encore poussés. */
  enAvance: number;
  /** Commits du dépôt distant pas encore récupérés (d'après la dernière récupération). */
  enRetard: number;
  fichiers: FichierGit[];
  distant: string | null;
}

export interface ResultatPublication {
  ok: boolean;
  commit: string | null;
  branche: string | null;
  sortie: string;
}

function absolu(dossier: string): string {
  const d = dossier.startsWith("~") ? path.join(os.homedir(), dossier.slice(1)) : dossier;
  if (!path.isAbsolute(d) || !existsSync(d)) throw new Error(`Dossier introuvable : ${dossier}`);
  return d;
}

/** `absent` : git n'est pas installé sur ce poste. `env` : seulement ajouté à celui du processus. */
function git(cwd: string, args: string[], delai = 120_000, env?: NodeJS.ProcessEnv): Promise<{ code: number; sortie: string; absent?: boolean }> {
  return new Promise((resolve) => {
    const options = { cwd, timeout: delai, maxBuffer: 10 * 1024 * 1024, windowsHide: true, ...(env ? { env: { ...process.env, ...env } } : {}) };
    execFile("git", args, options, (erreur, stdout, stderr) => {
      const code = erreur ? (typeof erreur.code === "number" ? erreur.code : 1) : 0;
      const absent = (erreur as NodeJS.ErrnoException | null)?.code === "ENOENT";
      resolve({ code, sortie: `${stdout}${stderr}`.trim(), ...(absent ? { absent } : {}) });
    });
  });
}

/** La sortie standard seule, telle quelle (ni l'erreur mêlée, ni les fins de ligne retirées). */
function gitSortie(cwd: string, args: string[], delai = 120_000): Promise<{ code: number; sortie: Buffer }> {
  return new Promise((resolve) => {
    execFile("git", args, { cwd, timeout: delai, maxBuffer: 16 * 1024 * 1024, windowsHide: true, encoding: "buffer" }, (erreur, stdout) => {
      resolve({ code: erreur ? (typeof erreur.code === "number" ? erreur.code : 1) : 0, sortie: stdout ?? Buffer.alloc(0) });
    });
  });
}

/** Les lignes de `git status --porcelain -z` : chemins tels quels (accents, espaces), renommés avec leur ancien chemin. */
export function lireStatutGit(brut: string): { tete: string; fichiers: FichierGit[] } {
  const morceaux = brut.split("\0");
  const tete = morceaux[0]?.startsWith("## ") ? morceaux.shift()! : "";
  const fichiers: FichierGit[] = [];
  for (let i = 0; i < morceaux.length; i++) {
    const l = morceaux[i];
    if (l.length < 4) continue;
    const code = l.slice(0, 2);
    const chemin = l.slice(3);
    if (code[0] === "R" || code[0] === "C") {
      fichiers.push({ statut: "R", chemin, ancien: morceaux[++i] ?? "" });
      continue;
    }
    const net = code.trim() || "M";
    fichiers.push({ statut: net === "??" ? "?" : net.charAt(0), chemin });
  }
  return { tete, fichiers };
}

export async function etatGit(dossier: string): Promise<EtatGit> {
  const cwd = absolu(dossier);
  const statut = await gitSortie(cwd, ["-c", "core.quotePath=false", "status", "--porcelain=v1", "-b", "-z", "--untracked-files=all"]);
  if (statut.code !== 0) return { depot: false, branche: null, suivie: false, enAvance: 0, enRetard: 0, fichiers: [], distant: null };

  const { tete, fichiers } = lireStatutGit(statut.sortie.toString("utf8"));
  // « ## main...origin/main [ahead 2, behind 1] » ou « ## pelin » (pas de branche distante).
  // Une branche peut porter des points (« release-1.2 ») ; « HEAD (no branch) » : aucune.
  const m = tete.match(/^## (?:No commits yet on |Initial commit on )?(\S+?)(?:\.\.\.(\S+))?(?: \[[^\]]*\])?$/);
  const avance = tete.match(/\[[^\]]*ahead (\d+)/);
  const retard = tete.match(/\[[^\]]*behind (\d+)/);
  const distant = await git(cwd, ["remote", "get-url", "origin"]);
  return {
    depot: true,
    branche: m?.[1] ?? null,
    suivie: !!m?.[2],
    enAvance: avance ? Number(avance[1]) : 0,
    enRetard: retard ? Number(retard[1]) : 0,
    fichiers,
    distant: distant.code === 0 ? distant.sortie : null,
  };
}

/** Au-delà, un côté du fichier n'est pas montré. */
export const DIFF_MAX = 512 * 1024;

/** Un chemin de `git status`, relatif au dépôt, sans remonter au-dessus ni entrer dans `.git`. */
export function cheminDansDepot(chemin: unknown): string {
  if (typeof chemin !== "string" || !chemin || chemin.length > 4096 || chemin.includes("\0") || path.isAbsolute(chemin) || /^[A-Za-z]:/.test(chemin)) throw new Error("Chemin de fichier invalide.");
  const parties = chemin.split(/[\\/]/);
  if (parties.some((p) => p === "..") || parties[0] === ".git") throw new Error("Chemin de fichier invalide.");
  return parties.filter((p) => p && p !== ".").join("/");
}

const estBinaire = (b: Buffer) => b.subarray(0, 8000).includes(0);

/**
 * Un fichier changé du dépôt : son contenu au dernier commit et sur le disque, pour le montrer ligne à ligne.
 * Lecture seule ; jamais un fichier hors du dépôt (lien compris), jamais plus de `DIFF_MAX` octets.
 */
export async function diffFichierGit(dossier: string, chemin: unknown, ancien?: unknown): Promise<DiffFichierGit> {
  const cwd = realpathSync(absolu(dossier));
  const relatif = cheminDansDepot(chemin);
  const relatifAvant = ancien === undefined || ancien === null || ancien === "" ? relatif : cheminDansDepot(ancien);
  let binaire = false;
  let tropGros = false;

  const lu = await gitSortie(cwd, ["show", `HEAD:${relatifAvant}`]);
  let avant: string | null = null;
  if (lu.code === 0) {
    if (lu.sortie.length > DIFF_MAX) tropGros = true;
    else if (estBinaire(lu.sortie)) binaire = true;
    else avant = lu.sortie.toString("utf8");
  }

  let apres: string | null = null;
  const cible = path.join(cwd, relatif);
  const reel = existsSync(cible) ? realpathSync(cible) : null;
  if (reel) {
    const rel = path.relative(cwd, reel);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Ce fichier sort du projet : il n’est pas montré.");
    const info = statSync(reel);
    if (info.isFile()) {
      if (info.size > DIFF_MAX) tropGros = true;
      else {
        const contenu = readFileSync(reel);
        if (estBinaire(contenu)) binaire = true;
        else apres = contenu.toString("utf8");
      }
    }
  }
  if (binaire || tropGros) return { chemin: relatif, avant: null, apres: null, binaire, tropGros };
  return { chemin: relatif, avant, apres, binaire: false, tropGros: false };
}

/** Commit de tout ce qui a changé, puis push de la branche en cours. */
export async function publier(dossier: string, message: string): Promise<ResultatPublication> {
  const cwd = absolu(dossier);
  const texte = message.trim();
  if (!texte) return { ok: false, commit: null, branche: null, sortie: "Le message du commit est vide." };

  const etat = await etatGit(dossier);
  if (!etat.depot || !etat.branche) return { ok: false, commit: null, branche: null, sortie: "Ce dossier n’est pas un dépôt git." };

  const sorties: string[] = [];
  if (etat.fichiers.length) {
    const ajout = await git(cwd, ["add", "-A"]);
    sorties.push(ajout.sortie);
    if (ajout.code !== 0) return { ok: false, commit: null, branche: etat.branche, sortie: sorties.join("\n") };
    const commit = await git(cwd, ["commit", "-m", texte]);
    sorties.push(commit.sortie);
    if (commit.code !== 0) return { ok: false, commit: null, branche: etat.branche, sortie: sorties.join("\n") };
  }
  if (!etat.distant) {
    return { ok: false, commit: null, branche: etat.branche, sortie: [...sorties, "Pas de dépôt distant (origin) : le commit est fait, rien n’a été poussé."].join("\n") };
  }
  const push = await git(cwd, etat.suivie ? ["push"] : ["push", "-u", "origin", etat.branche]);
  sorties.push(push.sortie);
  const hash = await git(cwd, ["rev-parse", "--short", "HEAD"]);
  return { ok: push.code === 0, commit: hash.code === 0 ? hash.sortie : null, branche: etat.branche, sortie: sorties.filter(Boolean).join("\n") };
}

/* ---------- Un dépôt GitHub comme projet : cloné sur ce poste, puis un projet comme un autre ---------- */

export interface DepotGithub {
  proprietaire: string;
  nom: string;
  /** L'adresse donnée à git : https, ou ssh si la personne l'a écrite ainsi (ses clés). */
  url: string;
}

const PROPRIETAIRE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const NOM_DEPOT = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * « owner/repo », « github.com/owner/repo », « https://github.com/owner/repo(.git)(/tree/…) »
 * ou « git@github.com:owner/repo.git » → le dépôt ; tout le reste (autre hôte, identifiant
 * dans l'adresse, caractères inattendus) → null. Jamais de jeton dans l'adresse.
 */
export function lireDepotGithub(saisie: string): DepotGithub | null {
  const texte = saisie.trim();
  let chemin: string;
  let ssh = false;
  const mSsh = texte.match(/^(?:ssh:\/\/)?git@github\.com[:/](.+)$/i);
  if (mSsh) {
    chemin = mSsh[1];
    ssh = true;
  } else if (/^(?:https?:\/\/)?(?:www\.)?github\.com\//i.test(texte)) {
    let u: URL;
    try {
      u = new URL(/^https?:\/\//i.test(texte) ? texte : `https://${texte}`);
    } catch {
      return null;
    }
    if (u.username || u.password || u.port || !/^(?:www\.)?github\.com$/i.test(u.hostname)) return null;
    chemin = u.pathname.replace(/^\//, "");
  } else if (/^[^/:@\s]+\/[^/:@\s]+$/.test(texte)) {
    chemin = texte;
  } else return null;
  const [proprietaire, brut = ""] = chemin.split("/");
  const nom = brut.replace(/\.git$/i, "");
  // Une adresse ssh s'arrête au dépôt ; une adresse web peut continuer (/tree/main…).
  if (ssh && chemin.split("/").filter(Boolean).length !== 2) return null;
  if (!PROPRIETAIRE.test(proprietaire) || !NOM_DEPOT.test(nom) || nom === "." || nom === "..") return null;
  return { proprietaire, nom, url: ssh ? `git@github.com:${proprietaire}/${nom}.git` : `https://github.com/${proprietaire}/${nom}.git` };
}

/** Là où l'app range un dépôt cloné quand la personne ne choisit pas : ~/KLYRA. */
export function dossierClones(): string {
  return path.join(os.homedir(), "KLYRA");
}

export interface ResultatClone {
  /** Le dossier du projet sur ce poste. */
  dossier: string;
  /** « owner/repo ». */
  depot: string;
  /** Le dossier existait déjà avec ce dépôt : rien n'a été cloné. */
  deja: boolean;
}

/** Deux chemins du même dossier (Windows : sans tenir compte de la casse ni du sens des barres). */
function memeChemin(a: string, b: string): boolean {
  const [x, y] = [path.resolve(a), path.resolve(b)];
  return process.platform === "win32" ? x.toLowerCase() === y.toLowerCase() : x === y;
}

/** Même dépôt GitHub, quelle que soit l'écriture de l'adresse (https, ssh, .git, casse). */
function memeDepot(a: string, b: DepotGithub): boolean {
  const d = lireDepotGithub(a);
  return !!d && d.proprietaire.toLowerCase() === b.proprietaire.toLowerCase() && d.nom.toLowerCase() === b.nom.toLowerCase();
}

/** Sortie de git → une phrase pour la personne (accès refusé, git absent, réseau). */
export function messageClone(sortie: string, absent = false): string {
  if (absent) return "Git n’est pas installé sur ce poste : installe-le (git-scm.com), puis réessaie.";
  if (/repository .*not found|authentication failed|could not read username|terminal prompts disabled|permission denied \(publickey\)|403/i.test(sortie)) {
    return "GitHub refuse l’accès : le dépôt est privé ou n’existe pas. Pour un dépôt privé, connecte git à ton compte GitHub sur ce poste (GitHub Desktop, « gh auth login » ou Git Credential Manager), puis réessaie.";
  }
  if (/could not resolve host|unable to access|timed out|network/i.test(sortie)) return "GitHub ne répond pas : vérifie la connexion à Internet, puis réessaie.";
  return `Le clonage a échoué : ${sortie.split("\n").filter(Boolean).pop() ?? "erreur inconnue"}`;
}

/** git sans question dans un terminal invisible : un accès manquant échoue tout de suite au lieu d'attendre. */
const SANS_QUESTION = { GIT_TERMINAL_PROMPT: "0" };

/** Clone `url` dans `cible` (qui ne doit pas exister ou être vide). Séparé pour les tests (dépôt local). */
export async function clonerVers(url: string, cible: string): Promise<{ ok: boolean; sortie: string; absent?: boolean }> {
  mkdirSync(path.dirname(cible), { recursive: true });
  const r = await git(path.dirname(cible), ["clone", "--", url, cible], 15 * 60_000, SANS_QUESTION);
  return { ok: r.code === 0, sortie: r.sortie, ...(r.absent ? { absent: true } : {}) };
}

/**
 * Clone un dépôt GitHub dans `parent` (absent : ~/KLYRA), sous son nom. Un dossier du même nom
 * qui est déjà ce dépôt est repris tel quel ; un autre dossier non vide n'est jamais touché.
 * L'accès passe par le git du poste (ses identifiants à lui) : l'app ne voit ni ne garde de jeton.
 */
export async function clonerDepot(saisie: string, parent: string | null): Promise<ResultatClone> {
  const depot = lireDepotGithub(String(saisie ?? ""));
  if (!depot) throw new Error("Adresse GitHub non reconnue : écris « propriétaire/dépôt » ou colle l’adresse du dépôt.");
  const racine = parent ? absolu(parent) : dossierClones();
  const cible = path.join(racine, depot.nom);
  const nom = `${depot.proprietaire}/${depot.nom}`;
  if (existsSync(cible) && readdirSync(cible).length > 0) {
    const origine = await git(cible, ["remote", "get-url", "origin"]);
    // Le dossier du dépôt lui-même (pas un dossier parent qui serait un dépôt) : la racine de git est la cible.
    const racineGit = await git(cible, ["rev-parse", "--show-toplevel"]);
    if (origine.code === 0 && racineGit.code === 0 && memeChemin(racineGit.sortie, cible) && memeDepot(origine.sortie, depot)) {
      return { dossier: cible, depot: nom, deja: true };
    }
    throw new Error(`Le dossier ${cible} existe déjà et n’est pas ce dépôt : choisis un autre endroit.`);
  }
  const r = await clonerVers(depot.url, cible);
  if (!r.ok) throw new Error(messageClone(r.sortie, r.absent));
  return { dossier: cible, depot: nom, deja: false };
}

export interface ResultatRecuperation {
  ok: boolean;
  /** Ce que git a répondu, pour la personne. */
  message: string;
  etat: EtatGit;
}

/** Récupère les nouveautés de la branche suivie, sans fusion ni écrasement (`pull --ff-only`). */
export async function recupererDepot(dossier: string): Promise<ResultatRecuperation> {
  const cwd = absolu(dossier);
  const avant = await etatGit(cwd);
  if (!avant.depot || !avant.distant) return { ok: false, message: "Ce dossier n’est pas relié à un dépôt distant.", etat: avant };
  if (!avant.suivie) return { ok: false, message: "Cette branche n’a pas d’équivalent sur le dépôt distant : rien à récupérer.", etat: avant };
  const r = await git(cwd, ["pull", "--ff-only"], 5 * 60_000, SANS_QUESTION);
  const etat = await etatGit(cwd);
  if (r.code === 0) return { ok: true, message: /already up to date|déjà à jour/i.test(r.sortie) ? "Déjà à jour." : "Nouveautés récupérées.", etat };
  if (/not possible to fast-forward|diverging|divergent/i.test(r.sortie)) {
    return { ok: false, message: "Ta branche et celle de GitHub ont divergé : rien n’a été changé. Demande à un agent de les réconcilier.", etat };
  }
  if (/would be overwritten|local changes/i.test(r.sortie)) {
    return { ok: false, message: "Des fichiers modifiés ici seraient écrasés : rien n’a été changé. Publie ou mets de côté tes changements d’abord.", etat };
  }
  return { ok: false, message: r.absent ? messageClone("", true) : messageClone(r.sortie).replace("Le clonage a échoué", "La récupération a échoué"), etat };
}
