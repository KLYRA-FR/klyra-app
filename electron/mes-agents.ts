import { app } from "electron";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * « Mes agents » : les agents que la personne a choisis sur cet ordinateur, et l'assistant qu'elle a nommé.
 *
 * Quatre choses distinctes :
 * - le fichier d'exécution `~/.claude/agents/<id>.md`, que Claude Code lit (jamais supprimé par l'app) ;
 * - ce choix (`userData/mes-agents.json`) : actif ou non, et d'où vient l'agent ;
 * - la définition partagée reçue de la bibliothèque, à la version choisie (`userData/definitions-recues/<id>.md`) ;
 * - les préférences personnelles : nom affiché et couleur (`agents-meta.json`), dossiers configurés (ici, `valeurs`).
 *
 * Premier lancement de cette version (fichier absent) :
 * - installation existante (des données de l'app sont déjà là) : toutes les fiches présentes restent actives,
 *   l'assistant garde le nom « Principal » ;
 * - nouveau profil : aucun agent, l'assistant attend son nom. Les fiches déjà sur l'ordinateur (autres outils)
 *   restent intactes, proposées sans être choisies.
 */

export type Origine =
  /** Créé ici ou trouvé sur l'ordinateur. `publie` : la personne l'a partagé dans la bibliothèque (elle en est l'autrice). */
  | { type: "local"; publie?: { definitionId: string; version: number; compte: string } }
  /** `ignoree` : la version du modèle face à laquelle la personne a gardé sa fiche (plus proposée). */
  | { type: "modele"; modele: string; ignoree?: number }
  | {
      type: "bibliotheque";
      definitionId: string;
      version: number;
      auteur: string;
      /** Le compte d'équipe qui l'a ajoutée : les mises à jour ne sont cherchées qu'avec lui. */
      compte: string;
      /** Les dossiers choisis sur cet ordinateur pour ses dépendances. */
      valeurs: Record<string, string>;
      /** Version proposée que la personne a écartée : pas reproposée, une plus récente le sera. */
      ignoree: number | null;
    }
  /** Copie privée d'une définition : ne reçoit plus de mise à jour. Son auteur ne s'affiche que sous `compte`. */
  | { type: "copie"; definitionId: string; version: number; auteur: string; compte: string };

export interface EntreeAgent {
  actif: boolean;
  ajouteLe: number;
  /** Quand la personne l'a désactivé (absent s'il est actif). */
  desactiveLe?: number;
  origine: Origine;
  /** Empreinte de la fiche telle que l'app l'a écrite : une autre empreinte sur le disque = modifiée ailleurs. */
  empreinte: string | null;
}

export interface MesAgents {
  version: 1;
  depart: "reprise" | "nouveau";
  assistant: { nom: string | null; teinte: string | null };
  agents: Record<string, EntreeAgent>;
}

export const NOM_VALIDE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Les modèles KLYRA embarqués (`agents-equipe/*.md`) : à la reprise, une fiche de ce nom est notée « modèle ». */
export const MODELES_KLYRA = ["commercial", "designer", "dev", "diego-discord-ops", "growth", "motion", "prompty", "qa", "redacteur", "stratege", "val"];

const texte = (v: unknown, max = 200): string => {
  if (typeof v !== "string" || v.length > max) throw new Error("Origine d’agent invalide.");
  return v;
};

/** Une origine reçue de l'interface, vérifiée champ par champ. */
export function origineValide(brut: unknown): Origine {
  const o = (brut ?? {}) as Record<string, unknown>;
  const version = () => {
    if (!Number.isInteger(o.version) || (o.version as number) < 1) throw new Error("Origine d’agent invalide.");
    return o.version as number;
  };
  switch (o.type) {
    case "local": {
      const p = o.publie as Record<string, unknown> | undefined;
      if (!p) return { type: "local" };
      if (!Number.isInteger(p.version) || (p.version as number) < 1) throw new Error("Origine d’agent invalide.");
      return { type: "local", publie: { definitionId: texte(p.definitionId), version: p.version as number, compte: texte(p.compte) } };
    }
    case "modele": {
      if (o.ignoree === undefined || o.ignoree === null) return { type: "modele", modele: texte(o.modele, 64) };
      if (!Number.isInteger(o.ignoree) || (o.ignoree as number) < 1) throw new Error("Origine d’agent invalide.");
      return { type: "modele", modele: texte(o.modele, 64), ignoree: o.ignoree as number };
    }
    case "copie":
      return { type: "copie", definitionId: texte(o.definitionId), version: version(), auteur: texte(o.auteur, 120), compte: texte(o.compte) };
    case "bibliotheque": {
      const valeurs: Record<string, string> = {};
      for (const [cle, val] of Object.entries((o.valeurs ?? {}) as Record<string, unknown>).slice(0, 20)) valeurs[texte(cle, 40)] = texte(val, 1000);
      const ignoree = o.ignoree === null || o.ignoree === undefined ? null : Number(o.ignoree);
      return {
        type: "bibliotheque",
        definitionId: texte(o.definitionId),
        version: version(),
        auteur: texte(o.auteur, 120),
        compte: texte(o.compte),
        valeurs,
        ignoree: ignoree !== null && Number.isInteger(ignoree) ? ignoree : null,
      };
    }
    default:
      throw new Error("Origine d’agent invalide.");
  }
}

/** Les sous-agents fournis par Claude Code lui-même : des outils de l'assistant, pas des spécialistes. */
export const AGENTS_DE_CLAUDE = ["general-purpose", "Explore", "Plan", "statusline-setup", "claude", "claude-code-guide", "output-style-setup"];

export const dossierAgents = () => path.join(os.homedir(), ".claude", "agents");
const fichierEtat = () => path.join(app.getPath("userData"), "mes-agents.json");
const dossierRecues = () => path.join(app.getPath("userData"), "definitions-recues");

export function empreinte(contenu: string): string {
  return createHash("sha256").update(contenu.replace(/\r\n/g, "\n")).digest("hex");
}

let etat: MesAgents | null = null;
/** Une écriture à la fois, dans l'ordre des demandes. */
let file: Promise<unknown> = Promise.resolve();

function enFile<T>(travail: () => Promise<T>): Promise<T> {
  const suite = file.then(travail, travail);
  file = suite.catch(() => {});
  return suite;
}

async function ecrire(nouvel: MesAgents): Promise<MesAgents> {
  const cible = fichierEtat();
  await fs.mkdir(path.dirname(cible), { recursive: true });
  const tmp = `${cible}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(nouvel, null, 2), "utf8");
  await fs.rename(tmp, cible);
  etat = nouvel;
  return nouvel;
}

function lisible(brut: unknown): MesAgents | null {
  const e = brut as Partial<MesAgents> | null;
  if (!e || e.version !== 1 || typeof e.agents !== "object" || e.agents === null || !e.assistant) return null;
  return { version: 1, depart: e.depart === "nouveau" ? "nouveau" : "reprise", assistant: e.assistant, agents: e.agents };
}

/** Les fiches `<id>.md` présentes dans le dossier des agents. */
function fichesPresentes(): string[] {
  const dossier = dossierAgents();
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier)
    .filter((f) => f.endsWith(".md"))
    .map((f) => f.slice(0, -3))
    .filter((n) => NOM_VALIDE.test(n));
}

/**
 * Lit le choix de la personne, ou le crée la première fois (migration). À appeler avant d'ouvrir la
 * fenêtre : l'interface écrit ses données peu après, et elles décideraient sinon d'une « reprise ».
 */
export function chargerMesAgents(modeles: string[]): Promise<MesAgents> {
  return enFile(async () => {
    try {
      const lu = lisible(JSON.parse(await fs.readFile(fichierEtat(), "utf8")));
      if (lu) return (etat = lu);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        // Fichier illisible : on le garde de côté plutôt que de l'écraser, et on repart d'une reprise.
        await fs.rename(fichierEtat(), `${fichierEtat()}.illisible-${Date.now()}`).catch(() => {});
      }
    }
    const donnees = app.getPath("userData");
    const reprise = ["conversations.json", "agents-meta.json", "historique-agents"].some((f) => existsSync(path.join(donnees, f)));
    const maintenant = Date.now();
    const agents: Record<string, EntreeAgent> = {};
    if (reprise) {
      for (const id of fichesPresentes()) {
        agents[id] = { actif: true, ajouteLe: maintenant, origine: modeles.includes(id) ? { type: "modele", modele: id } : { type: "local" }, empreinte: null };
      }
    }
    return ecrire({ version: 1, depart: reprise ? "reprise" : "nouveau", assistant: { nom: reprise ? "Principal" : null, teinte: null }, agents });
  });
}

/** L'état connu (chargé au démarrage). */
export function mesAgents(): MesAgents {
  if (!etat) throw new Error("Mes agents n’est pas encore chargé.");
  return etat;
}

export function estActif(id: string): boolean {
  return !!etat?.agents[id]?.actif;
}

function modifier(change: (e: MesAgents) => MesAgents): Promise<MesAgents> {
  return enFile(async () => ecrire(change(structuredClone(mesAgents()))));
}

export function nommerAssistant(nom: string, teinte: string | null): Promise<MesAgents> {
  const propre = String(nom ?? "").trim().replace(/\s+/g, " ");
  if (!propre || propre.length > 40) throw new Error("Le nom de l’assistant doit faire de 1 à 40 caractères.");
  return modifier((e) => ({ ...e, assistant: { nom: propre, teinte: teinte ?? e.assistant.teinte } }));
}

export function activer(id: string, actif: boolean): Promise<MesAgents> {
  return modifier((e) => {
    const entree = e.agents[id];
    if (!entree) throw new Error(`« ${id} » n’est pas dans Mes agents.`);
    if (entree.actif === actif) return e;
    entree.actif = actif;
    if (actif) delete entree.desactiveLe;
    else entree.desactiveLe = Date.now();
    return e;
  });
}

/** Ajoute à Mes agents une fiche déjà sur l'ordinateur (ou celle qu'on vient d'écrire). */
export function ajouter(id: string, origine: Origine, contenu: string | null): Promise<MesAgents> {
  if (!NOM_VALIDE.test(id)) throw new Error("Nom d’agent invalide.");
  return modifier((e) => {
    const deja = e.agents[id];
    e.agents[id] = deja
      ? { ...deja, actif: true, desactiveLe: undefined }
      : { actif: true, ajouteLe: Date.now(), origine, empreinte: contenu === null ? null : empreinte(contenu) };
    return e;
  });
}

/** Nouvelle origine (mise à jour acceptée, copie privée, version écartée) et empreinte de la fiche écrite. */
export function changerOrigine(id: string, origine: Origine, contenu?: string): Promise<MesAgents> {
  return modifier((e) => {
    const entree = e.agents[id];
    if (!entree) throw new Error(`« ${id} » n’est pas dans Mes agents.`);
    e.agents[id] = { ...entree, origine, empreinte: contenu === undefined ? entree.empreinte : empreinte(contenu) };
    return e;
  });
}

/** La définition partagée gardée à la version choisie (null si l'agent ne vient pas de la bibliothèque). */
export async function lireDefinitionRecue(id: string): Promise<string | null> {
  if (!NOM_VALIDE.test(id)) throw new Error("Nom d’agent invalide.");
  try {
    return await fs.readFile(path.join(dossierRecues(), `${id}.md`), "utf8");
  } catch {
    return null;
  }
}

export async function garderDefinitionRecue(id: string, contenu: string): Promise<void> {
  if (!NOM_VALIDE.test(id)) throw new Error("Nom d’agent invalide.");
  await fs.mkdir(dossierRecues(), { recursive: true });
  const cible = path.join(dossierRecues(), `${id}.md`);
  await fs.writeFile(`${cible}.tmp`, contenu, "utf8");
  await fs.rename(`${cible}.tmp`, cible);
}

/* ─── Ce que Claude Code charge vraiment ───────────────────────────── */

/** Le nom sous lequel Claude Code connaît une fiche : son champ `name`, sinon le nom du fichier. */
function nomDansFiche(fichier: string, defaut: string): string {
  try {
    const debut = readFileSync(fichier, "utf8").slice(0, 4000).replace(/\r\n/g, "\n");
    const m = debut.match(/^---\n[\s\S]*?^name:\s*["']?([^"'\n]+?)["']?\s*$/m);
    return m?.[1].trim() || defaut;
  } catch {
    return defaut;
  }
}

/** Les fiches d'un dossier d'agents, sous-dossiers compris (Claude Code les lit à toute profondeur ; au-delà de 8, le contrôle à l'appel suffit). */
function fichesDe(dossier: string, profondeur = 0): { id: string; nom: string }[] {
  if (profondeur > 8 || !existsSync(dossier)) return [];
  const trouvees: { id: string; nom: string }[] = [];
  for (const f of readdirSync(dossier)) {
    const chemin = path.join(dossier, f);
    let st;
    try {
      st = statSync(chemin);
    } catch {
      continue;
    }
    if (st.isDirectory()) trouvees.push(...fichesDe(chemin, profondeur + 1));
    else if (f.endsWith(".md")) trouvees.push({ id: f.slice(0, -3), nom: nomDansFiche(chemin, f.slice(0, -3)) });
  }
  return trouvees;
}

/**
 * Les dossiers d'agents que Claude Code lit pour une session ouverte dans `cwd` : celui de
 * l'utilisateur (et de `CLAUDE_CONFIG_DIR`), puis `.claude/agents` du dossier et de ses parents.
 */
function dossiersLus(cwd: string): string[] {
  const dossiers = new Set([dossierAgents()]);
  if (process.env.CLAUDE_CONFIG_DIR) dossiers.add(path.join(process.env.CLAUDE_CONFIG_DIR, "agents"));
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    dossiers.add(path.join(d, ".claude", "agents"));
    if (path.dirname(d) === d) break;
  }
  return [...dossiers];
}

/** Les noms sous lesquels les agents actifs sont connus de Claude Code. */
function nomsActifs(): Set<string> {
  const noms = new Set<string>();
  const actifs = Object.entries(etat?.agents ?? {}).filter(([, e]) => e.actif);
  for (const [id] of actifs) {
    noms.add(id);
    noms.add(nomDansFiche(path.join(dossierAgents(), `${id}.md`), id));
  }
  return noms;
}

/**
 * Les règles `Agent(<nom>)` à refuser à une session : chaque fiche lue par Claude Code qui n'est pas
 * un agent actif de Mes agents. Un agent refusé n'est plus proposé au modèle et son appel échoue
 * (vérifié sur Claude Code 2.1, cf. docs/JOURNAL.md). Les fiches elles-mêmes ne sont jamais touchées.
 */
export function agentsARefuser(cwd: string): string[] {
  const actifs = nomsActifs();
  const refus = new Set<string>();
  for (const dossier of dossiersLus(cwd)) {
    for (const { id, nom } of fichesDe(dossier)) {
      for (const n of [id, nom]) if (!actifs.has(n) && /^[\w.:-]{1,80}$/.test(n)) refus.add(n);
    }
  }
  return [...refus].sort();
}

/**
 * Le filet de sécurité, au moment de l'appel (agents de plugins, d'une configuration gérée, fiche
 * apparue après le lancement) : seuls les agents actifs et ceux de Claude Code peuvent être appelés.
 */
export function agentAutorise(type: unknown): boolean {
  if (typeof type !== "string" || !type) return true; // sans type : l'agent généraliste de Claude Code
  return nomsActifs().has(type) || AGENTS_DE_CLAUDE.includes(type);
}

/** Les agents actifs, avec le prénom de leur fiche, pour les présenter à l'assistant. */
export function presentationActifs(): { id: string; nom: string }[] {
  return Object.entries(etat?.agents ?? {})
    .filter(([id, e]) => e.actif && existsSync(path.join(dossierAgents(), `${id}.md`)))
    .map(([id]) => {
      let nom = id;
      try {
        const debut = readFileSync(path.join(dossierAgents(), `${id}.md`), "utf8").slice(0, 4000).replace(/\r\n/g, "\n");
        nom = debut.match(/^---\n[\s\S]*?^displayName:\s*["']?([^"'\n]+?)["']?\s*$/m)?.[1].trim() || id;
      } catch {
        /* fiche illisible : son identifiant suffit */
      }
      return { id, nom };
    });
}

/** Change à chaque modification de Mes agents : une session lancée avant est relancée au message suivant. */
export function generation(): string {
  return etat ? empreinte(JSON.stringify([etat.assistant.nom, Object.entries(etat.agents).map(([id, e]) => [id, e.actif])])).slice(0, 12) : "";
}
