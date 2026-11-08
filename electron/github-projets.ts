import { rmSync } from "node:fs";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, realpath, rename, rm } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { etatGit, type EtatGit } from "./git";

/** Connexion au code GitHub, indépendante de Composio (qui ne fournit pas d'identifiants à git).
 * gh est embarqué dans l'app ; ses identifiants ne sont jamais transmis à l'écran ni écrits dans Git.
 * Le même module tourne sur un VPS, avec le chiffrement de son Coffre. */
import type { EtatGithubProjet, DepotGithubProjet } from "./github-types";
export interface ConnexionGithubProjet { jeton: string; compte: string }
interface Options {
  racine: string;
  base?: string;
  gh: string;
  verifier?: () => void;
  lire: () => Promise<ConnexionGithubProjet | null>;
  ecrire: (v: ConnexionGithubProjet | null) => Promise<void>;
}

/** N'accepte que les noms GitHub, jamais une URL, un chemin ou une option de commande. */
export function validerNomDepot(v: unknown): string {
  if (typeof v !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9-]{0,38}\/[a-zA-Z0-9_.-]{1,100}$/.test(v) || /\/(?:\.|\.\.)$/.test(v)) throw new Error("Dépôt GitHub invalide.");
  return v;
}
export function validerBranche(v: unknown): string {
  if (typeof v !== "string" || !v || v.length > 255 || v.startsWith("-") || v.startsWith("/") || v.endsWith("/") || /[\s~^:?*\[\\\x00-\x1f\x7f]/.test(v) || v.includes("..") || v.includes("@{") || v.split("/").some((s) => !s || s.startsWith(".") || s.endsWith(".lock") || s.endsWith("."))) throw new Error("Branche GitHub invalide.");
  return v;
}

export class GithubProjets {
  private login: ChildProcess | null = null;
  private vue: EtatGithubProjet = { compte: null, connexion: null, enCours: false, erreur: null };
  private generation = 0;
  private loginDossier: string | null = null;
  private clones = new Set<string>();
  private readonly d: Options;
  constructor(d: Options) { this.d = d; }

  private env(jeton?: string, config?: string): NodeJS.ProcessEnv {
    const env = { ...process.env };
    // Aucune identité GitHub héritée du terminal ou des agents.
    for (const k of Object.keys(env)) if (/^(GH_|GITHUB_|GIT_CONFIG_|GIT_TRACE|GIT_CURL_VERBOSE|GIT_ASKPASS|SSH_ASKPASS|DEBUG$)/.test(k)) delete env[k];
    return { ...env, GH_HOST: "github.com", GH_PROMPT_DISABLED: "1", GH_NO_UPDATE_NOTIFIER: "1", GH_NO_EXTENSION_UPDATE_NOTIFIER: "1", NO_COLOR: "1", LANG: "C", LC_ALL: "C", ...(jeton ? { GH_TOKEN: jeton } : {}), ...(config ? { GH_CONFIG_DIR: config } : {}) };
  }

  private async commande(exe: string, args: string[], env: NodeJS.ProcessEnv, cwd?: string, timeout = 60_000): Promise<string> {
    return new Promise((resolve, reject) => execFile(exe, args, { env, cwd, timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (e, out) => {
      // Ni stderr (peut contenir une adresse authentifiée), ni les variables du processus dans l'erreur.
      if (e) reject(new Error((e as NodeJS.ErrnoException).code === "ENOENT" ? `${exe === "git" ? "Git" : "GitHub CLI"} est introuvable sur cette machine.` : "GitHub n’a pas confirmé l’opération. Vérifie la connexion et les droits sur ce dépôt."));
      else resolve(out);
    }));
  }

  async etat(): Promise<EtatGithubProjet> {
    try {
      const c = await this.d.lire();
      return { ...this.vue, compte: c?.compte ?? null };
    } catch {
      return { ...this.vue, compte: null, erreur: "La connexion GitHub ne peut plus être lue. Reconnecte GitHub." };
    }
  }

  async connecter(): Promise<EtatGithubProjet> {
    if (this.vue.enCours) return this.etat();
    const generation = ++this.generation;
    this.vue = { compte: null, connexion: null, enCours: true, erreur: null };
    let dossier: string;
    try {
      this.d.verifier?.();
      await this.commande(this.d.gh, ["--version"], this.env());
      dossier = await mkdtemp(path.join(os.tmpdir(), "klyra-github-"));
    } catch (e) {
      if (generation === this.generation) this.vue.enCours = false;
      throw e;
    }
    if (generation !== this.generation) { await rm(dossier, { recursive: true, force: true }); return this.etat(); }
    // stdin/stdout en pipes : gh affiche le code et attend l'autorisation, sans ouvrir
    // de navigateur sur la machine qui clone (notamment le VPS).
    this.loginDossier = dossier;
    const env = this.env(undefined, dossier);
    const enfant = spawn(this.d.gh, ["auth", "login", "--hostname", "github.com", "--git-protocol", "https", "--web", "--insecure-storage", "--scopes", "repo"], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.login = enfant;
    enfant.stdin?.end("\n");
    let sortie = "";
    let termine = false;
    const timer = setTimeout(() => enfant.kill(), 16 * 60_000);
    const fini = async (code: number | null) => {
      if (termine) return;
      termine = true;
      clearTimeout(timer);
      try {
        if (code !== 0) throw new Error("Connexion GitHub annulée ou expirée. Réessaie.");
        const jeton = (await this.commande(this.d.gh, ["auth", "token", "--hostname", "github.com"], this.env(undefined, dossier))).trim();
        if (!jeton || /\s/.test(jeton)) throw new Error("Connexion GitHub illisible.");
        const utilisateur = JSON.parse(await this.commande(this.d.gh, ["api", "--method", "GET", "/user"], this.env(jeton))) as { login?: unknown };
        if (typeof utilisateur.login !== "string" || !/^[a-zA-Z0-9-]{1,39}$/.test(utilisateur.login)) throw new Error("Compte GitHub illisible.");
        if (generation === this.generation) await this.d.ecrire({ jeton, compte: utilisateur.login });
      } catch (e) {
        if (generation === this.generation) this.vue.erreur = e instanceof Error ? e.message : "Connexion GitHub échouée.";
      } finally {
        await rm(dossier, { recursive: true, force: true });
        if (this.loginDossier === dossier) this.loginDossier = null;
        if (generation === this.generation) { this.login = null; this.vue.enCours = false; this.vue.connexion = null; }
      }
    };
    enfant.once("error", () => void fini(1));
    enfant.once("close", (code) => void fini(code));
    const lire = (b: Buffer) => {
      sortie = (sortie + b.toString("utf8")).slice(-8000);
      const code = sortie.match(/one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i)?.[1];
      if (code && generation === this.generation) this.vue.connexion = { code, url: "https://github.com/login/device" };
    };
    enfant.stderr?.on("data", lire);
    enfant.stdout?.on("data", lire);
    return this.etat();
  }

  /** Ferme une autorisation en attente, sans déconnecter le compte déjà enregistré. */
  fermer(): void {
    ++this.generation;
    this.login?.kill(); this.login = null;
    if (this.loginDossier) {
      try { rmSync(this.loginDossier, { recursive: true, force: true }); } catch { /* le callback close réessaie */ }
      this.loginDossier = null;
    }
    this.vue.enCours = false; this.vue.connexion = null;
  }

  async deconnecter(): Promise<EtatGithubProjet> {
    this.fermer();
    this.vue = { compte: null, connexion: null, enCours: false, erreur: null };
    await this.d.ecrire(null);
    return this.etat();
  }

  private async connexion(): Promise<ConnexionGithubProjet> {
    const c = await this.d.lire();
    if (!c) throw new Error("Connecte GitHub sur cette machine pour choisir un dépôt.");
    return c;
  }
  private async pages(endpoint: string): Promise<Record<string, unknown>[]> {
    const c = await this.connexion();
    const pages = JSON.parse(await this.commande(this.d.gh, ["api", "--method", "GET", "--paginate", "--slurp", endpoint], this.env(c.jeton))) as unknown;
    if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p))) throw new Error("Liste GitHub illisible.");
    return pages.flat().filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  }
  async depots(): Promise<DepotGithubProjet[]> {
    return (await this.pages("/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator,organization_member")).map((r) => ({ nom: validerNomDepot(r.full_name), prive: r.private === true, branche: typeof r.default_branch === "string" ? r.default_branch : "", archive: r.archived === true }));
  }
  async branches(depot: string): Promise<string[]> {
    const nom = validerNomDepot(depot);
    return (await this.pages(`/repos/${nom}/branches?per_page=100`)).map((b) => validerBranche(b.name));
  }

  private gitEnv(jeton: string): NodeJS.ProcessEnv {
    return { ...this.env(), GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never", GIT_CONFIG_COUNT: "4", GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader", GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${jeton}`).toString("base64")}`, GIT_CONFIG_KEY_1: "http.followRedirects", GIT_CONFIG_VALUE_1: "false", GIT_CONFIG_KEY_2: "credential.helper", GIT_CONFIG_VALUE_2: "", GIT_CONFIG_KEY_3: "core.hooksPath", GIT_CONFIG_VALUE_3: path.join(this.d.racine, ".hooks-desactives") };
  }

  private async racine(creer: boolean): Promise<string> {
    const base = path.resolve(this.d.base ?? path.dirname(this.d.racine));
    const relatif = path.relative(base, path.resolve(this.d.racine));
    if (!relatif || relatif.startsWith("..") || path.isAbsolute(relatif)) throw new Error("Racine GitHub invalide.");
    let dossier = await realpath(base);
    for (const segment of relatif.split(path.sep)) {
      dossier = path.join(dossier, segment);
      if (creer) await mkdir(dossier).catch((e: NodeJS.ErrnoException) => { if (e.code !== "EEXIST") throw e; });
      if (await realpath(dossier) !== dossier) throw new Error("Le dossier GitHub est un lien : ouverture refusée.");
    }
    return dossier;
  }

  async ouvrir(depot: string, branche: string): Promise<{ dossier: string; depot: string; deja: boolean }> {
    const nom = validerNomDepot(depot); validerBranche(branche);
    const compte = await this.connexion();
    const generation = this.generation;
    // Vérifier l'accès avec le compte choisi, avant de toucher au disque.
    if (!(await this.branches(nom)).includes(branche)) throw new Error("Cette branche n’existe plus sur GitHub.");
    const racine = await this.racine(true);
    const [owner, repo] = nom.split("/");
    const parent = path.join(racine, owner);
    await mkdir(parent, { recursive: true });
    if (await realpath(parent) !== parent) throw new Error("Le dossier du dépôt est un lien : ouverture refusée.");
    const cible = path.join(parent, `${repo}-${createHash("sha256").update(branche).digest("hex").slice(0, 12)}`);
    if (this.clones.has(cible)) throw new Error("Ce dépôt est déjà en cours d’ouverture.");
    this.clones.add(cible);
    let tmp: string | null = null;
    try {
      const existant = await realpath(cible).catch(() => null);
      if (existant) {
        if (existant !== cible) throw new Error("Le dossier du dépôt est un lien : ouverture refusée.");
        const origine = (await this.commande("git", ["config", "--get", "remote.origin.url"], this.env(), cible)).trim();
        const tete = (await this.commande("git", ["branch", "--show-current"], this.env(), cible)).trim();
        const sommet = (await this.commande("git", ["rev-parse", "--show-toplevel"], this.env(), cible)).trim();
        if (path.resolve(sommet) !== cible || origine !== `https://github.com/${nom}.git` || tete !== branche) throw new Error("Ce dossier appartient déjà à un autre dépôt ou à une autre branche. Rien n’a été changé.");
        return { dossier: cible, depot: nom, deja: true };
      }
      tmp = await mkdtemp(path.join(parent, ".klyra-clone-"));
      await this.commande("git", ["clone", "--no-recurse-submodules", "--branch", branche, "--", `https://github.com/${nom}.git`, tmp], this.gitEnv(compte.jeton), undefined, 5 * 60_000);
      if (generation !== this.generation) throw new Error("Le compte GitHub a changé pendant le clonage. Rouvre le dépôt avec le compte voulu.");
      await rename(tmp, cible); tmp = null;
      return { dossier: cible, depot: nom, deja: false };
    } finally {
      this.clones.delete(cible);
      if (tmp) await rm(tmp, { recursive: true, force: true });
    }
  }

  private async dossier(dossier: string): Promise<string> {
    if (typeof dossier !== "string" || !path.isAbsolute(dossier)) throw new Error("Dossier GitHub invalide.");
    const racine = await this.racine(false);
    const cible = await realpath(dossier);
    const rel = path.relative(racine, cible);
    if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("Ce projet n’est pas un dépôt GitHub de cette machine.");
    return cible;
  }

  async etatDepot(dossier: string): Promise<EtatGit> {
    return etatGit(await this.dossier(dossier));
  }

  async recuperer(dossier: string): Promise<EtatGit> {
    const c = await this.connexion();
    const cible = await this.dossier(dossier);
    const origine = (await this.commande("git", ["config", "--get", "remote.origin.url"], this.env(), cible)).trim();
    const match = origine.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\.git$/);
    if (!match) throw new Error("Ce projet n’est pas relié à GitHub.");
    validerNomDepot(match[1]);
    // git refuse les conflits ; aucun stash, reset ni merge automatique.
    await this.commande("git", ["-c", "pull.rebase=false", "pull", "--ff-only", "origin"], this.gitEnv(c.jeton), cible, 5 * 60_000);
    return etatGit(cible);
  }
}
