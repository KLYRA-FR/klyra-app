/**
 * Modèle de données de l'app. Les données factices (src/data/mock.ts) et le
 * futur back-end partagent exactement ces formes : brancher le back revient à
 * changer la source, pas les écrans. Dates en ISO 8601.
 */

/* ─── Rôles (agents) ───────────────────────────────────────────── */

/** Identifiant d'un agent = son `name` de sous-agent Claude Code
 *  (`~/.claude/agents/<id>.md`). « principal » est la session elle-même, qui
 *  orchestre les autres : il n'a pas de fichier. */
export type RoleId = string;

/** Teinte de l'illustration d'un agent (palette étendue du design system,
 *  réservée aux illustrations). */
export type RoleTeinte =
  | "bleu-k1"
  | "bleu-k2"
  | "bleu-k3"
  | "violet"
  | "orange"
  | "orange-k2"
  | "rouge"
  | "vert"
  | "vert-k2"
  | "jaune"
  | "rose"
  | "ocre";

export const ROLE_TEINTES: RoleTeinte[] = [
  "bleu-k1",
  "bleu-k2",
  "bleu-k3",
  "violet",
  "rose",
  "rouge",
  "orange",
  "orange-k2",
  "jaune",
  "ocre",
  "vert",
  "vert-k2",
];

/** Une section `## Titre` de la fiche, avec son texte Markdown. */
export interface RoleSection {
  title: string;
  body: string;
}

/** Le fichier d'un agent, tel que lu sur le disque. */
export interface RoleFile {
  path: string;
  content: string;
  modifiedAt: number;
}

/**
 * Un agent, tiré de sa fiche. Seuls `tag` et `teinte` sont propres à l'app
 * (gardés à côté, pas dans le fichier que lit Claude Code).
 */
export interface Role {
  id: RoleId;
  /** Prénom (`displayName`). */
  name: string;
  /** Rôle en un mot, affiché à côté du prénom dans le fil (« Dev »). */
  tag: string;
  /** Rôle complet, début de la description (« Dev frontend et backend »). */
  title: string;
  /** Lettre de l'avatar. */
  initial: string;
  teinte: RoleTeinte;
  /** Description complète, lue par Claude pour choisir l'agent. */
  description: string;
  /** La phrase « Appelle Hugo dès que… ». */
  whenToCall: string;
  /** Ce qu'il couvre, tiré de la description. */
  skills: string[];
  /** Titre de la fiche (« Hugo — Dev »). */
  heading: string;
  /** Présentation, à la première personne. */
  pitch: string;
  sections: RoleSection[];
  model: string;
  memory: string;
  /** null pour le Principal, et pour les fiches d'exemple hors app de bureau. */
  file: RoleFile | null;
}

/** Circuit de passation entre agents (« Construire un écran »). */
export interface TeamCircuit {
  id: string;
  title: string;
  steps: { roleId: RoleId | null; label: string }[];
}

/* ─── Utilisateur ──────────────────────────────────────────────── */

export interface User {
  id: string;
  name: string;
  title: string;
  initial: string;
}

/* ─── Projets ──────────────────────────────────────────────────── */

export type ProjectStatus = "en-cours" | "en-revue" | "livre";

export interface Project {
  id: string;
  name: string;
  subtitle: string;
  status: ProjectStatus;
  /** Projets épinglés dans la barre latérale. */
  pinned: boolean;
  roleIds: RoleId[];
  brief: string;
  previewUrl: string;
  /** Dossier du projet sur le disque. */
  folder: string;
  files: FileNode[];
  updatedAt: string;
}

/** Fichier ou dossier d'un projet, tel qu'il est sur le disque (tout le
 *  dossier : code, public, scripts, docs…). Chemins relatifs à la racine. */
export interface FileNode {
  name: string;
  path: string;
  kind: "dossier" | "fichier";
  children?: FileNode[];
}

/* ─── Chats et messages ────────────────────────────────────────── */

export interface Chat {
  id: string;
  projectId: string;
  title: string;
  roleIds: RoleId[];
  updatedAt: string;
}

export type MessageAuthor = { kind: "user" } | { kind: "role"; roleId: RoleId };

export type TaskStatus = "fait" | "en-cours" | "a-venir";

export interface Task {
  id: string;
  roleId: RoleId;
  label: string;
  status: TaskStatus;
}

export interface DeliverableOption {
  id: string;
  label: string;
  /** Structure de la vignette : avec ou sans média à droite. */
  layout: "texte" | "texte-media";
  selected: boolean;
}

export interface ChangedFile {
  path: string;
  added: number;
  removed: number;
}

export interface MessageAction {
  id: string;
  label: string;
  primary: boolean;
}

/** Un message est une suite de blocs : texte, tâches, livrable, journal, actions. */
export type MessagePart =
  | { type: "text"; text: string }
  | { type: "tasks"; tasks: Task[] }
  | { type: "options"; options: DeliverableOption[] }
  | { type: "worklog"; durationMin: number; files: ChangedFile[] }
  | { type: "actions"; actions: MessageAction[] };

export interface Message {
  id: string;
  chatId: string;
  author: MessageAuthor;
  createdAt: string;
  parts: MessagePart[];
}
