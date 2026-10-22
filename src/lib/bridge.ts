/**
 * Pont vers le système, exposé par `electron/preload.ts` sous `window.klyra`.
 * Absent dans un navigateur (pnpm dev) : l'app passe alors en lecture seule.
 */

import type { FileNode } from "@/types/domain";

export type Reponse<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface AgentFile {
  name: string;
  path: string;
  content: string;
  modifiedAt: number;
}

export interface AgentsListing {
  dir: string;
  exists: boolean;
  agents: AgentFile[];
}

export interface HistoryEntry {
  id: string;
  savedAt: number;
}

export type AgentsMeta = Record<string, { tag?: string; teinte?: string }>;

export interface ClaudeResult {
  ok: boolean;
  text: string;
  error?: string;
  costUsd?: number;
}

/** Événements d'un agent qui travaille (cf. electron/claude.ts). */
export type AgentEvent =
  | { type: "session"; sessionId: string }
  | { type: "texte"; delta: string; nouveauBloc: boolean }
  | { type: "etape"; id: string; outil: string; entree: Record<string, unknown>; parent: string | null }
  | { type: "etape-fin"; id: string; ok: boolean; apercu: string }
  | { type: "autorisation"; id: string; outil: string; entree: Record<string, unknown>; description: string }
  | { type: "autorisation-fin"; id: string; accepte: boolean }
  | { type: "fin"; ok: boolean; texte: string; erreur?: string; costUsd?: number; sessionId?: string };

/** Utilisation de l'abonnement Claude (cf. electron/claude.ts). */
export interface FenetreUtilisation {
  /** Part utilisée, de 0 à 1. */
  utilise: number;
  reinitialiseA: number | null;
}

export interface Utilisation {
  session: FenetreUtilisation | null;
  semaine: FenetreUtilisation | null;
  statut: string;
  misAJour: number;
}

/** Le compte Claude du poste (cf. electron/claude.ts). */
export interface CompteClaude {
  installe: boolean;
  chemin: string | null;
  version: string | null;
  connecte: boolean;
  methode: string | null;
  email: string | null;
  organisation: string | null;
  abonnement: string | null;
  verifieLe: number;
}

export interface EtatGit {
  depot: boolean;
  branche: string | null;
  suivie: boolean;
  enAvance: number;
  fichiers: { statut: string; chemin: string }[];
  distant: string | null;
}

export interface ResultatPublication {
  ok: boolean;
  commit: string | null;
  branche: string | null;
  sortie: string;
}

export type ContenuFichier =
  | { type: "image"; dataUrl: string; taille: number }
  | { type: "texte"; texte: string; taille: number }
  | { type: "autre"; taille: number; raison: string };

export interface StreamOptions {
  agent: string | null;
  prompt: string;
  dossier: string | null;
  sessionId: string | null;
  modele?: string | null;
  effort?: string | null;
  fichiers?: string[];
  acces?: Acces;
}

/** Ce qu'un agent peut faire sans demander (cf. electron/claude.ts). */
export type Acces = "demander" | "projet" | "tout";

export interface KlyraBridge {
  agents: {
    list: () => Promise<Reponse<AgentsListing>>;
    write: (name: string, content: string, expectedModifiedAt: number | null) => Promise<Reponse<AgentFile>>;
    create: (name: string, content: string) => Promise<Reponse<AgentFile>>;
    installTeam: (templates: { name: string; content: string }[]) => Promise<Reponse<string[]>>;
    history: (name: string) => Promise<Reponse<HistoryEntry[]>>;
    readVersion: (name: string, id: string) => Promise<Reponse<string>>;
    readMeta: () => Promise<Reponse<AgentsMeta>>;
    writeMeta: (meta: AgentsMeta) => Promise<Reponse<void>>;
    reveal: (name: string) => Promise<Reponse<void>>;
    onChange: (callback: () => void) => () => void;
  };
  claude: {
    status: () => Promise<Reponse<{ path: string | null }>>;
    run: (requestId: string, agent: string, prompt: string) => Promise<Reponse<ClaudeResult>>;
    cancel: (requestId: string) => Promise<Reponse<void>>;
    /** Ta réponse à une demande d'autorisation d'un agent. */
    autoriser: (requestId: string, demandeId: string, decision: "oui" | "toujours" | "non") => Promise<Reponse<boolean>>;
    stream: (requestId: string, options: StreamOptions) => Promise<Reponse<null>>;
    onEvent: (callback: (requestId: string, event: AgentEvent) => void) => () => void;
    utilisation: () => Promise<Reponse<Utilisation | null>>;
    compte: () => Promise<Reponse<CompteClaude>>;
    /** Ouvre la connexion Anthropic dans le navigateur et attend qu'elle soit validée. */
    connexion: () => Promise<Reponse<CompteClaude>>;
    deconnexion: () => Promise<Reponse<CompteClaude>>;
    actualiserUtilisation: () => Promise<Reponse<Utilisation | null>>;
    onUtilisation: (callback: (u: Utilisation) => void) => () => void;
  };
  projets: {
    dossierExiste: (dossier: string) => Promise<Reponse<boolean>>;
    /** Sélecteur de dossier du système ; null si on annule. */
    choisirDossier: () => Promise<Reponse<string | null>>;
    /** Le contenu réel du dossier d'un projet. */
    arbre: (dossier: string) => Promise<Reponse<FileNode[]>>;
    /** Le contenu d'un fichier du projet, pour la visionneuse. */
    lireFichier: (dossier: string, relatif: string) => Promise<Reponse<ContenuFichier>>;
    /** Ouvre le fichier avec l'app par défaut du Mac. */
    ouvrirFichier: (dossier: string, relatif: string) => Promise<Reponse<void>>;
    montrerFichier: (dossier: string, relatif: string) => Promise<Reponse<void>>;
  };
  artefacts: {
    /** Les artefacts du compte Claude, lus par Claude Code. */
    lister: () => Promise<Reponse<{ titre: string; url: string; misAJour: string | null }[]>>;
    /** Vignette PNG (data URL), null sans session claude.ai dans l'app. */
    vignette: (url: string, forcer: boolean) => Promise<Reponse<string | null>>;
    /** Ouvre l'artefact en grand dans une fenêtre de l'app. */
    ouvrir: (url: string, titre: string) => Promise<Reponse<void>>;
    /** Connecté à claude.ai dans l'app ? */
    etatSession: () => Promise<Reponse<boolean>>;
    connecter: () => Promise<Reponse<boolean>>;
    deconnecter: () => Promise<Reponse<void>>;
  };
  fenetres: {
    /** Ouvre une adresse locale (localhost) dans une fenêtre de l'app. */
    ouvrir: (url: string) => Promise<Reponse<void>>;
  };
  git: {
    /** Ce qui a changé dans le dossier d'un projet, et sa branche. */
    etat: (dossier: string) => Promise<Reponse<EtatGit>>;
    /** Commit de tout ce qui a changé, puis push de la branche en cours. */
    publier: (dossier: string, message: string) => Promise<Reponse<ResultatPublication>>;
  };
  systeme: {
    /** Le nom de la session Mac, pour le profil par défaut. */
    utilisateur: () => Promise<Reponse<{ nom: string; identifiant: string }>>;
  };
  fichiers: {
    /** Ouvre le sélecteur de fichiers du système ; renvoie les chemins choisis. */
    choisir: () => Promise<Reponse<string[]>>;
    /** Montre le fichier dans le Finder. */
    montrer: (chemin: string) => Promise<Reponse<void>>;
    /** Chemin sur le disque d'un fichier glissé dans la fenêtre ("" s'il n'en a pas). */
    cheminDe: (file: File) => string;
  };
  conversations: {
    avantFermeture: (callback: () => void) => () => void;
    read: () => Promise<Reponse<unknown>>;
    write: (data: unknown) => Promise<Reponse<void>>;
  };
}

declare global {
  interface Window {
    klyra?: KlyraBridge;
  }
}

/** Le pont si l'app tourne dans Electron, sinon null (navigateur). */
export function getBridge(): KlyraBridge | null {
  return typeof window !== "undefined" ? (window.klyra ?? null) : null;
}

/** Déballe une réponse du pont, ou lève une erreur avec son code. */
export class BridgeError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export function unwrap<T>(reponse: Reponse<T>): T {
  if (!reponse.ok) throw new BridgeError(reponse.code, reponse.message);
  return reponse.data;
}
