import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, readlinkSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/**
 * Le terminal interactif des agents : de vraies sessions PTY (une commande qui attend une saisie, un OAuth
 * avec une URL de retour à coller, ssh, un assistant d'installation), que l'agent pilote par quatre outils et
 * que la personne voit et tape dans l'onglet Terminal du panneau de la conversation.
 *
 * Le PTY vient de `script` (util-linux sur Linux, BSD sur Mac) : aucune dépendance native, ce qui permet le
 * même module sur ce PC et sur un VPS (généré en `serveur/terminal.mjs` : le serveur est livré en .mjs, sans npm).
 * Windows n'a pas `script` : l'outil le dit.
 *
 * Garde-fous : fermeture après `INACTIVITE_MS` sans activité, `SESSIONS_MAX` sessions à la fois, rien n'est
 * écrit sur le disque (la sortie reste en mémoire, `TAMPON_MAX` au plus) ; un secret tapé par l'agent vient du
 * Coffre par son nom (`secret`), jamais en clair, et il est masqué dans la sortie si la commande l'affiche. Ce que
 * la personne tape dans le panneau va droit au PTY, sans journal. Aucune validation des commandes : c'est voulu.
 */

export const SESSIONS_MAX = 6;
export const INACTIVITE_MS = 30 * 60_000;
export const TAMPON_MAX = 512 * 1024;
export const LECTURE_MAX = 16_000;
export const COLONNES = 120;
export const LIGNES = 32;

export const TOUCHES: Record<string, string> = {
  entree: "\r",
  tab: "\t",
  echap: "\x1b",
  "retour-arriere": "\x7f",
  suppr: "\x1b[3~",
  haut: "\x1b[A",
  bas: "\x1b[B",
  droite: "\x1b[C",
  gauche: "\x1b[D",
  espace: " ",
  "ctrl-c": "\x03",
  "ctrl-d": "\x04",
  "ctrl-z": "\x1a",
  "ctrl-l": "\x0c",
};

const id = { type: "string", description: "L'identifiant rendu par terminal_ouvrir (term-…)." };

export const OUTILS_TERMINAL = [
  {
    name: "terminal_ouvrir",
    description:
      "Ouvre un vrai terminal interactif (PTY), pour une commande qui attend une saisie ou exige un terminal (« stdin isn't a terminal », OAuth d'un serveur MCP avec un lien puis une URL de retour à coller, ssh, assistant d'installation, invite y/n). La personne le voit en direct dans l'onglet Terminal du panneau de la conversation et peut y taper. Sans commande : un shell. Rend un identifiant ; lis ensuite avec terminal_lire. Pour une commande ordinaire, garde Bash.",
    inputSchema: {
      type: "object",
      properties: {
        commande: { type: "string", description: "La commande à lancer (interprétée par le shell). Vide : un shell interactif." },
        dossier: { type: "string", description: "Le dossier où la lancer (chemin complet). Par défaut : ton dossier de travail." },
        titre: { type: "string", description: "Un titre court pour la personne (ex. « Connexion Qonto »)." },
      },
    },
  },
  {
    name: "terminal_envoyer",
    description:
      "Tape dans un terminal ouvert : du texte, une touche, ou un secret du coffre par son nom de variable (jamais un secret en clair : il resterait dans la conversation). Puis lis la suite avec terminal_lire. Si la personne doit taper elle-même (mot de passe qu'elle seule connaît), dis-lui de le faire dans l'onglet Terminal.",
    inputSchema: {
      type: "object",
      properties: {
        id,
        texte: { type: "string", description: "Le texte à taper, tel quel." },
        touche: { type: "string", enum: Object.keys(TOUCHES), description: "Une touche, après le texte s'il y en a un." },
        secret: { type: "string", description: "Le nom de variable d'un secret du coffre (ex. QONTO_API_KEY), tapé sans que tu voies sa valeur." },
        entree: { type: "boolean", description: "Appuie sur Entrée à la fin (défaut : faux)." },
      },
      required: ["id"],
    },
  },
  {
    name: "terminal_lire",
    description:
      "Lit ce que le terminal a affiché depuis ta dernière lecture, en texte (couleurs et codes de terminal retirés), et dit s'il tourne encore. `attendre` : jusqu'à combien de secondes attendre que la sortie se calme (défaut 2, 30 au plus).",
    inputSchema: {
      type: "object",
      properties: { id, attendre: { type: "number", description: "Secondes d'attente au plus (0 à 30)." } },
      required: ["id"],
    },
  },
  {
    name: "terminal_fermer",
    description: "Ferme un terminal (arrête sa commande) quand tu n'en as plus besoin. Un terminal sans activité se ferme seul au bout de 30 minutes.",
    inputSchema: { type: "object", properties: { id }, required: ["id"] },
  },
];

export const NOMS_TERMINAL = OUTILS_TERMINAL.map((o) => o.name);
export const estOutilTerminal = (nom: string): boolean => NOMS_TERMINAL.includes(nom);

/** Retire d'une sortie de terminal ce qui n'est pas du texte : codes de couleur et de curseur, retours chariot. */
export function nettoyerAnsi(brut: string): string {
  const sans = brut
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, "")
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1b[()*+][0-9A-Za-z]/g, "")
    .replace(/\x1b[@-Z\\-_=>78]/g, "")
    .replace(/\r\n/g, "\n");
  return sans
    .split("\n")
    .map((ligne) => {
      // Une ligne réécrite (barre de progression) : ce qui reste après le dernier retour chariot.
      const segments = ligne.split("\r");
      let l = segments.filter((s) => s !== "").pop() ?? "";
      while (/[^\x08]\x08/.test(l)) l = l.replace(/[^\x08]\x08/, "");
      return l.replace(/\x08/g, "").replace(/[\x00-\x08\x0b-\x1f\x7f]/g, "");
    })
    .join("\n");
}

/** Remplace chaque secret tapé par des points de même longueur : les positions de la sortie ne bougent pas. */
export function masquerSecrets(texte: string, secrets: readonly string[]): string {
  let t = texte;
  for (const s of secrets) if (s.length >= 4) t = t.split(s).join("•".repeat(s.length));
  return t;
}

/** Les arguments de `script` qui lancent `ligne` dans un PTY, selon le système (null : pas de PTY ici). */
export function commandePty(plateforme: NodeJS.Platform, ligne: string): { fichier: string; args: string[] } | null {
  if (plateforme === "linux") return { fichier: "script", args: ["-qfec", ligne, "/dev/null"] };
  if (plateforme === "darwin") return { fichier: "script", args: ["-q", "/dev/null", "/bin/sh", "-c", ligne] };
  return null;
}

const guillemets = (s: string) => `'${s.replace(/'/g, "'\\''")}'`;

/** Ce que `script` exécute : la taille de la fenêtre, puis la commande (ou un shell interactif). */
export function lignePty(shell: string, commande: string, cols = COLONNES, rows = LIGNES): string {
  const taille = `stty cols ${cols} rows ${rows} 2>/dev/null;`;
  return commande.trim() ? `${taille} exec ${guillemets(shell)} -c ${guillemets(commande)}` : `${taille} exec ${guillemets(shell)} -i`;
}

export interface Appelant {
  conversation: string;
  agent: string;
}

/** Ce que l'écran voit d'une session. */
export interface SessionVue {
  id: string;
  conversation: string;
  agent: string;
  titre: string;
  commande: string;
  dossier: string;
  ouvertLe: number;
  fini: boolean;
  code: number | null;
}

interface Session extends SessionVue {
  proc: ChildProcessWithoutNullStreams;
  /** La sortie gardée, et combien de caractères ont été oubliés avant elle. */
  sortie: string;
  base: number;
  /** Où l'agent en est de sa lecture (position absolue). */
  lu: number;
  secrets: string[];
  activite: number;
}

export interface OptionsTerminaux {
  plateforme?: NodeJS.Platform;
  shell?: string;
  dossierDefaut: (appelant: Appelant) => string;
  /** La valeur d'un secret du coffre que les agents peuvent utiliser (lève s'il n'existe pas). */
  secret: (variable: string) => string | Promise<string>;
  maintenant?: () => number;
  inactiviteMs?: number;
  sessionsMax?: number;
}

export type ReponseOutil = { texte: string; erreur?: boolean };

const ID = /^term-[0-9a-f]{12}$/;

/** Le gestionnaire des terminaux d'un poste ou d'un serveur : un seul par process. */
export function creerTerminaux(options: OptionsTerminaux) {
  const plateforme = options.plateforme ?? process.platform;
  const maintenant = options.maintenant ?? Date.now;
  const inactivite = options.inactiviteMs ?? INACTIVITE_MS;
  const max = options.sessionsMax ?? SESSIONS_MAX;
  const sessions = new Map<string, Session>();
  const ecouteurs = new Set<() => void>();
  const signaler = () => ecouteurs.forEach((f) => f());

  const vue = (s: Session): SessionVue => ({ id: s.id, conversation: s.conversation, agent: s.agent, titre: s.titre, commande: s.commande, dossier: s.dossier, ouvertLe: s.ouvertLe, fini: s.fini, code: s.code });

  function ajouterSortie(s: Session, morceau: string) {
    const avant = s.sortie.length;
    s.sortie += morceau;
    if (s.secrets.length) {
      const fenetre = Math.max(0, avant - Math.max(...s.secrets.map((x) => x.length)));
      s.sortie = s.sortie.slice(0, fenetre) + masquerSecrets(s.sortie.slice(fenetre), s.secrets);
    }
    if (s.sortie.length > TAMPON_MAX) {
      const coupe = s.sortie.length - TAMPON_MAX;
      s.sortie = s.sortie.slice(coupe);
      s.base += coupe;
    }
    s.activite = maintenant();
  }

  function fermerSession(s: Session) {
    // `script` ignore SIGHUP : SIGTERM (il le passe à la commande), puis SIGKILL si rien n'a bougé.
    if (!s.fini) {
      s.proc.kill("SIGTERM");
      setTimeout(() => {
        if (!s.fini) s.proc.kill("SIGKILL");
      }, 2000).unref?.();
    }
    sessions.delete(s.id);
    signaler();
  }

  /** Ferme ce qui dort depuis trop longtemps (appelé par une minuterie, et à chaque ouverture). */
  function nettoyer() {
    const t = maintenant();
    for (const s of [...sessions.values()]) if (t - s.activite > inactivite) fermerSession(s);
  }
  const minuterie = setInterval(nettoyer, 60_000);
  minuterie.unref?.();

  function ouvrir(appelant: Appelant, args: { commande?: unknown; dossier?: unknown; titre?: unknown }): SessionVue {
    nettoyer();
    if (sessions.size >= max) throw new Error(`Déjà ${max} terminaux ouverts : ferme-en un (terminal_fermer) avant d'en ouvrir un autre.`);
    const commande = typeof args.commande === "string" ? args.commande.slice(0, 8000) : "";
    const dossier = typeof args.dossier === "string" && args.dossier.trim() ? path.resolve(args.dossier.trim()) : options.dossierDefaut(appelant);
    if (!existsSync(dossier) || !statSync(dossier).isDirectory()) throw new Error(`Le dossier ${dossier} n'existe pas.`);
    const shell = options.shell ?? process.env.SHELL ?? "/bin/bash";
    const pty = commandePty(plateforme, lignePty(shell, commande));
    if (!pty) throw new Error("Le terminal interactif n'existe pas encore sous Windows : utilise Bash, ou demande à la personne de lancer la commande.");
    const env: NodeJS.ProcessEnv = { ...process.env, TERM: "xterm-256color", COLUMNS: String(COLONNES), LINES: String(LIGNES) };
    delete env.ELECTRON_RUN_AS_NODE;
    const proc = spawn(pty.fichier, pty.args, { cwd: dossier, env, stdio: ["pipe", "pipe", "pipe"] });
    const t = maintenant();
    const titre = typeof args.titre === "string" && args.titre.trim() ? args.titre.trim().slice(0, 80) : (commande.trim().split(/\s+/).slice(0, 4).join(" ") || "Shell");
    const s: Session = { id: `term-${randomBytes(6).toString("hex")}`, conversation: appelant.conversation, agent: appelant.agent, titre, commande, dossier, ouvertLe: t, fini: false, code: null, proc, sortie: "", base: 0, lu: 0, secrets: [], activite: t };
    proc.stdout.setEncoding("utf8");
    proc.stderr.setEncoding("utf8");
    proc.stdout.on("data", (d: string) => ajouterSortie(s, d));
    proc.stderr.on("data", (d: string) => ajouterSortie(s, d));
    proc.stdin.on("error", () => {});
    const finir = (code: number | null) => {
      if (s.fini) return;
      s.fini = true;
      s.code = code;
      signaler();
    };
    proc.on("exit", (code) => finir(code));
    proc.on("error", (e) => {
      ajouterSortie(s, `\r\n[Terminal impossible : ${e.message}]\r\n`);
      finir(null);
    });
    sessions.set(s.id, s);
    signaler();
    return vue(s);
  }

  const trouver = (idSession: unknown): Session | null => (typeof idSession === "string" && ID.test(idSession) ? sessions.get(idSession) ?? null : null);
  /** Une session de la conversation de l'agent : il ne voit pas celles des autres. */
  const sienne = (appelant: Appelant, idSession: unknown) => {
    const s = trouver(idSession);
    return s && s.conversation === appelant.conversation ? s : null;
  };

  function ecrire(s: Session, donnees: string) {
    if (s.fini) throw new Error("Ce terminal est terminé.");
    s.proc.stdin.write(donnees);
    s.activite = maintenant();
  }

  /** Ce qui est apparu depuis la dernière lecture de l'agent, nettoyé ; avance son curseur. */
  function lirePourAgent(s: Session): string {
    const perdu = s.lu < s.base ? "[début de la sortie oublié]\n" : "";
    const brut = s.sortie.slice(Math.max(s.lu, s.base) - s.base);
    s.lu = s.base + s.sortie.length;
    const texte = nettoyerAnsi(brut).replace(/\n{3,}/g, "\n\n");
    return perdu + (texte.length > LECTURE_MAX ? `[… ${texte.length - LECTURE_MAX} caractères plus haut]\n${texte.slice(-LECTURE_MAX)}` : texte);
  }

  const etatTexte = (s: Session) => (s.fini ? `Terminé${s.code === null ? "" : ` (code ${s.code})`}.` : "Il tourne encore.");

  /** Attend que la sortie se calme (rien de neuf pendant 400 ms) ou que la commande finisse, `ms` au plus. */
  async function attendreCalme(s: Session, ms: number) {
    // L'horloge réelle : `maintenant` ne sert qu'à l'inactivité (un test peut la figer).
    const fin = Date.now() + ms;
    let vu = s.base + s.sortie.length;
    let calme = Date.now();
    const pause = () => new Promise((r) => setTimeout(r, 100));
    await pause();
    while (Date.now() < fin && !s.fini) {
      const n = s.base + s.sortie.length;
      if (n !== vu) {
        vu = n;
        calme = Date.now();
      } else if (Date.now() - calme >= 400) break;
      await pause();
    }
  }

  /** Les quatre outils des agents. */
  async function executer(nom: string, args: Record<string, unknown>, appelant: Appelant): Promise<ReponseOutil> {
    try {
      if (nom === "terminal_ouvrir") {
        const v = ouvrir(appelant, args);
        const s = sessions.get(v.id)!;
        await attendreCalme(s, 1500);
        return { texte: `Terminal ${v.id} ouvert dans ${v.dossier} (visible dans l'onglet Terminal du panneau).\n${etatTexte(s)}\n--- Sortie ---\n${lirePourAgent(s)}` };
      }
      const s = sienne(appelant, args.id);
      if (!s) return { texte: "Aucun terminal de cette conversation avec cet identifiant (fermé, ou jamais ouvert).", erreur: true };
      if (nom === "terminal_fermer") {
        fermerSession(s);
        return { texte: `Terminal ${s.id} fermé.` };
      }
      if (nom === "terminal_lire") {
        const attendre = typeof args.attendre === "number" && Number.isFinite(args.attendre) ? Math.min(30, Math.max(0, args.attendre)) : 2;
        await attendreCalme(s, attendre * 1000);
        s.activite = maintenant();
        const texte = lirePourAgent(s);
        return { texte: `${etatTexte(s)}\n--- Sortie ---\n${texte || "(rien de neuf)"}` };
      }
      if (nom === "terminal_envoyer") {
        let donnees = typeof args.texte === "string" ? args.texte : "";
        if (typeof args.secret === "string" && args.secret.trim()) {
          const valeur = await options.secret(args.secret.trim());
          if (!s.secrets.includes(valeur)) s.secrets.push(valeur);
          donnees += valeur;
        }
        if (typeof args.touche === "string") {
          const t = TOUCHES[args.touche];
          if (!t) return { texte: `Touche inconnue. Possibles : ${Object.keys(TOUCHES).join(", ")}.`, erreur: true };
          donnees += t;
        }
        if (args.entree === true) donnees += "\r";
        if (!donnees) return { texte: "Rien à taper : donne un texte, une touche ou un secret.", erreur: true };
        ecrire(s, donnees);
        return { texte: `Tapé dans ${s.id}${typeof args.secret === "string" && args.secret.trim() ? ` (dont le secret ${args.secret.trim()}, masqué)` : ""}. Lis la suite avec terminal_lire.` };
      }
      return { texte: "Outil inconnu.", erreur: true };
    } catch (e) {
      return { texte: e instanceof Error ? e.message : String(e), erreur: true };
    }
  }

  /* ─── Pour l'écran (onglet Terminal) ─── */

  const lister = (conversation: string): SessionVue[] => [...sessions.values()].filter((s) => s.conversation === conversation).map(vue);

  /** La sortie brute depuis `depuis` (position absolue) : `reprise` si une partie a été oubliée entre-temps. */
  function flux(idSession: unknown, depuis: unknown): { donnees: string; position: number; reprise: boolean; fini: boolean; code: number | null } | null {
    const s = trouver(idSession);
    if (!s) return null;
    const d = typeof depuis === "number" && Number.isFinite(depuis) && depuis >= 0 ? depuis : 0;
    const reprise = d < s.base || d > s.base + s.sortie.length;
    return { donnees: s.sortie.slice(reprise ? 0 : d - s.base), position: s.base + s.sortie.length, reprise, fini: s.fini, code: s.code };
  }

  /**
   * Ce que la personne tape dans le panneau : droit au PTY, jamais noté. `secret` : masqué aussi dans la sortie si
   * la commande le répète (l'adresse de retour d'un OAuth, cf. mcp-sante.ts).
   */
  function saisir(idSession: unknown, donnees: unknown, o: { secret?: boolean } = {}): boolean {
    const s = trouver(idSession);
    if (!s || s.fini || typeof donnees !== "string" || !donnees || donnees.length > 64 * 1024) return false;
    if (o.secret === true && !s.secrets.includes(donnees)) s.secrets.push(donnees);
    ecrire(s, donnees);
    return true;
  }

  /** Le panneau change de taille : Linux seulement (le PTY de `script` se règle par `stty -F`). */
  function taille(idSession: unknown, cols: unknown, rows: unknown): boolean {
    const s = trouver(idSession);
    if (!s || s.fini || plateforme !== "linux" || !s.proc.pid) return false;
    if (typeof cols !== "number" || typeof rows !== "number" || cols < 20 || rows < 5 || cols > 500 || rows > 200) return false;
    try {
      const enfants = readFileSync(`/proc/${s.proc.pid}/task/${s.proc.pid}/children`, "utf8").trim().split(/\s+/).filter(Boolean);
      if (!enfants.length) return false;
      const tty = readlinkSync(`/proc/${enfants[0]}/fd/0`);
      if (!/^\/dev\/pts\/\d+$/.test(tty)) return false;
      return spawnSync("stty", ["-F", tty, "cols", String(Math.round(cols)), "rows", String(Math.round(rows))], { timeout: 2000 }).status === 0;
    } catch {
      return false;
    }
  }

  function fermer(idSession: unknown): boolean {
    const s = trouver(idSession);
    if (!s) return false;
    fermerSession(s);
    return true;
  }

  function fermerTout() {
    clearInterval(minuterie);
    for (const s of [...sessions.values()]) fermerSession(s);
  }

  return {
    executer,
    /** Ouvre une session pour l'app elle-même (la reconnexion d'un MCP), pas pour un agent. */
    ouvrir,
    lister,
    flux,
    saisir,
    taille,
    fermer,
    fermerTout,
    nettoyer,
    surChangement: (f: () => void) => {
      ecouteurs.add(f);
      return () => ecouteurs.delete(f);
    },
  };
}

export type Terminaux = ReturnType<typeof creerTerminaux>;

/** Le dossier par défaut d'un agent qui n'en donne pas : son atelier s'il existe, sinon le dossier personnel. */
export function dossierParDefaut(atelier: string | null): string {
  return atelier && existsSync(atelier) ? atelier : os.homedir();
}
