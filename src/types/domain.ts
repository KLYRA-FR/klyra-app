/**
 * Modèle de données de l'app. Les données factices (src/data/mock.ts) et le
 * futur back-end partagent exactement ces formes : brancher le back revient à
 * changer la source, pas les écrans. Dates en ISO 8601.
 */

/* ─── Rôles (agents) ───────────────────────────────────────────── */

export type RoleId = "principal" | "dev" | "uxui" | "da";

export interface Role {
  id: RoleId;
  name: string;
  /** Étiquette courte affichée à côté du nom dans le fil (« Code »). */
  tag: string;
  /** Lettre de l'avatar. */
  initial: string;
  description: string;
  skills: string[];
  tools: string[];
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
  updatedAt: string;
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
