import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Dirent } from "node:fs";
import { lstat, mkdir, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import type { CompteMoteur } from "./moteurs/types";

export interface CompteClaudeLocal extends CompteMoteur {
  id: string;
  erreur?: string;
  /** Seul ce compte continue à alimenter les agents existants. */
  poste: boolean;
}

interface SortieCommande { code: number | null; sortie: string }
type Executer = (bin: string, args: string[], env: NodeJS.ProcessEnv, delai: number) => Promise<SortieCommande>;

interface Options {
  dossier: string;
  home: string;
  binaire: () => string | null;
  environnement: () => NodeJS.ProcessEnv;
  poste: {
    lire: () => Promise<CompteMoteur>;
    connecter: () => Promise<CompteMoteur>;
    deconnecter: () => Promise<CompteMoteur>;
  };
  executer?: Executer;
}

const ID = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

/** Rien du compte du terminal parent ne doit masquer celui du dossier isolé. */
export function environnementCompte(env: NodeJS.ProcessEnv, dossier: string): NodeJS.ProcessEnv {
  const propre = Object.fromEntries(Object.entries(env).filter(([nom]) =>
    !/^(ANTHROPIC_|CLAUDE_(CONFIG_DIR|SECURESTORAGE_CONFIG_DIR)$|CLAUDE_CODE_OAUTH_|CLAUDE_CODE_SESSION_ACCESS_TOKEN$|CLAUDE_CODE_USE_(BEDROCK|VERTEX|FOUNDRY)$)/i.test(nom),
  ));
  return { ...propre, CLAUDE_CONFIG_DIR: dossier, CLAUDE_SECURESTORAGE_CONFIG_DIR: dossier };
}

function commande(home: string): Executer {
  return (bin, args, env, delai) => new Promise((resolve, reject) => {
    const child = spawn(bin, args, { cwd: home, env, windowsHide: true });
    let sortie = "";
    let depasse = false;
    // La sortie de connexion peut contenir une URL d'autorisation : elle ne quitte pas main.
    child.stdout.on("data", (d: Buffer) => { sortie = (sortie + d.toString()).slice(-64_000); });
    child.stderr.on("data", () => {});
    const timeout = setTimeout(() => { depasse = true; child.kill(); }, delai);
    child.once("error", () => { clearTimeout(timeout); reject(new Error("Impossible de lancer Claude Code.")); });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (depasse) reject(new Error("Claude Code n’a pas répondu à temps. Réessaie la connexion."));
      else resolve({ code, sortie });
    });
    child.stdin.end();
  });
}

/**
 * Un dossier de connexion par compte claude.ai. Aucun lien, copie de credentials ou
 * changement de process.env : les processus des agents gardent leur compte du poste.
 * https://code.claude.com/docs/en/authentication#log-in-with-multiple-accounts
 */
export class ComptesClaude {
  private action = false;
  private readonly executer: Executer;
  private readonly options: Options;

  constructor(options: Options) {
    this.options = options;
    this.executer = options.executer ?? commande(options.home);
  }

  private async dossier(id: string): Promise<string> {
    if (!ID.test(id)) throw new Error("Compte Claude invalide.");
    const racine = path.resolve(this.options.dossier);
    const dossier = path.join(racine, id);
    const stat = await lstat(dossier);
    if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(dossier) !== path.join(await realpath(racine), id)) {
      throw new Error("Le dossier de ce compte Claude n’est pas isolé.");
    }
    return dossier;
  }

  private vide(id: string): CompteClaudeLocal {
    const bin = this.options.binaire();
    return {
      id, poste: false, installe: !!bin, chemin: bin, version: null, connecte: false,
      methode: null, email: null, organisation: null, abonnement: null, verifieLe: Date.now(),
    };
  }

  private async lireIsole(id: string): Promise<CompteClaudeLocal> {
    const dossier = await this.dossier(id);
    const vide = this.vide(id);
    const bin = vide.chemin;
    if (!bin) return vide;
    const env = environnementCompte(this.options.environnement(), dossier);
    const [version, statut] = await Promise.all([
      this.executer(bin, ["--version"], env, 15_000),
      this.executer(bin, ["auth", "status", "--json"], env, 15_000),
    ]);
    let s: Record<string, unknown>;
    try {
      s = JSON.parse(statut.sortie.slice(statut.sortie.indexOf("{"))) as Record<string, unknown>;
      if (!s || typeof s.loggedIn !== "boolean") throw new Error();
    } catch {
      throw new Error("Impossible de vérifier ce compte Claude. Réessaie.");
    }
    const texte = (v: unknown) => typeof v === "string" && v ? v : null;
    return {
      ...vide, version: version.sortie.match(/\d+\.\d+\.\d+/)?.[0] ?? null,
      connecte: s.loggedIn === true, methode: texte(s.authMethod), email: texte(s.email),
      organisation: texte(s.orgName), abonnement: texte(s.subscriptionType),
    };
  }

  async lire(id: string): Promise<CompteClaudeLocal> {
    return id === "poste" ? { ...await this.options.poste.lire(), id, poste: true } : this.lireIsole(id);
  }

  async lister(): Promise<CompteClaudeLocal[]> {
    let entrees: Dirent[];
    try { entrees = await readdir(this.options.dossier, { withFileTypes: true }); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      entrees = [];
    }
    const ids = entrees.filter((e) => e.isDirectory() && !e.isSymbolicLink() && ID.test(e.name)).map((e) => e.name).sort();
    return Promise.all([this.lire("poste"), ...ids.map((id) => this.lire(id).catch(() => ({
      ...this.vide(id), erreur: "Impossible de vérifier ce compte Claude. Réessaie.",
    })))]);
  }

  /** Les mutations sont sérialisées aussi côté main, même avec plusieurs fenêtres. */
  private async modifier(agir: () => Promise<CompteClaudeLocal>): Promise<CompteClaudeLocal> {
    if (this.action) throw new Error("Une connexion ou une déconnexion Claude est déjà en cours.");
    this.action = true;
    try { return await agir(); } finally { this.action = false; }
  }

  connecter(id?: string): Promise<CompteClaudeLocal> {
    return this.modifier(async () => {
      if (!this.options.binaire()) throw new Error("Claude Code est introuvable sur ce poste.");
      if (id !== undefined) {
        if ((await this.lire(id)).connecte) throw new Error("Ce compte Claude est déjà connecté. Ajoute un autre compte.");
      } else {
        id = randomUUID();
        await mkdir(this.options.dossier, { recursive: true, mode: 0o700 });
        await mkdir(path.join(this.options.dossier, id), { mode: 0o700 });
      }
      if (id === "poste") return { ...await this.options.poste.connecter(), id, poste: true };
      const dossier = await this.dossier(id);
      const r = await this.executer(this.options.binaire()!, ["auth", "login", "--claudeai"], environnementCompte(this.options.environnement(), dossier), 5 * 60_000);
      if (r.code !== 0) throw new Error("La connexion Claude n’a pas abouti. Réessaie depuis le navigateur.");
      const compte = await this.lire(id);
      if (!compte.connecte) throw new Error("La connexion Claude n’a pas abouti. Réessaie depuis le navigateur.");
      return compte;
    });
  }

  deconnecter(id: string): Promise<CompteClaudeLocal> {
    return this.modifier(async () => {
      if (id === "poste") return { ...await this.options.poste.deconnecter(), id, poste: true };
      const dossier = await this.dossier(id);
      const bin = this.options.binaire();
      if (!bin) throw new Error("Claude Code est introuvable sur ce poste.");
      const r = await this.executer(bin, ["auth", "logout"], environnementCompte(this.options.environnement(), dossier), 30_000);
      if (r.code !== 0) throw new Error("Ce compte Claude n’a pas pu être déconnecté. Réessaie.");
      const compte = await this.lire(id);
      if (compte.connecte) throw new Error("Ce compte Claude est encore connecté. Réessaie.");
      return compte;
    });
  }
}
