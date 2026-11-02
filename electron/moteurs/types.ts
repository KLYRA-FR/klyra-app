/**
 * Le contrat entre l'app et un moteur : le programme qui fait travailler un agent
 * (Claude Code aujourd'hui ; Codex, Grok, OpenCode ensuite). Chaque moteur traduit
 * son flux en `AgentEvent` : l'interface des conversations ne connaît que lui.
 */

/** Les moteurs que l'app sait lancer. */
export type IdMoteur = "claude";

/** Ce que l'interface reçoit pendant qu'un agent travaille (cf. src/lib/bridge.ts). */
export type AgentEvent =
  | { type: "session"; sessionId: string }
  /** Un morceau du texte de la réponse. `nouveauBloc` : il suit des étapes, on passe à la ligne. */
  | { type: "texte"; delta: string; nouveauBloc: boolean }
  /** Une étape : lire un fichier, lancer une commande, confier à un agent… */
  | { type: "etape"; id: string; outil: string; entree: Record<string, unknown>; parent: string | null }
  | { type: "etape-fin"; id: string; ok: boolean; apercu: string }
  /** Les tokens écrits depuis le début (réflexion, texte, outils, sous-agents compris), estimés en direct. */
  | { type: "jetons"; total: number }
  /** L'agent demande ton accord avant d'utiliser un outil hors de son accès. */
  | { type: "autorisation"; id: string; outil: string; entree: Record<string, unknown>; description: string }
  /** La demande a reçu sa réponse (de toi, ou d'office en accès complet). */
  | { type: "autorisation-fin"; id: string; accepte: boolean }
  | { type: "fin"; ok: boolean; texte: string; erreur?: string; costUsd?: number; sessionId?: string; silencieux?: boolean };

export interface StreamOptions {
  /** Le moteur qui fait travailler l'agent ; absent : Claude Code. */
  moteur?: string | null;
  /** Le sous-agent qui répond (`~/.claude/agents/<nom>.md`), ou null pour la session principale. */
  agent: string | null;
  prompt: string;
  /** Dossier du projet : l'agent y travaille. */
  dossier: string | null;
  /** Session à reprendre : l'agent se souvient de la conversation. */
  sessionId: string | null;
  /** Modèle choisi dans la conversation (« opus », « sonnet », « haiku »), ou null : celui de la fiche. */
  modele?: string | null;
  /** Effort de réflexion : low, medium, high, xhigh, max ; null : celui par défaut. */
  effort?: string | null;
  /** Fichiers joints au message : leurs dossiers sont ouverts en lecture à l'agent. */
  fichiers?: string[];
  /**
   * Ce que l'agent peut faire sans demander :
   * - « demander » : il lit seul, et demande pour tout le reste ;
   * - « projet » : fichiers du dossier et commandes de travail seul, il demande pour le reste ;
   * - « tout » : tout lui est accordé, sans demander.
   */
  acces?: "demander" | "projet" | "tout";
  /** La conversation de l'app : les outils des fils savent d'où vient l'agent. */
  chatId?: string;
  /** Réservé par le moteur avant de lancer ce tour. */
  routineRun?: string;
  /** Le VPS où tourne la conversation (son origine https) ; absent : ce PC (cf. agents-distants.ts). */
  lieu?: string | null;
  /** Sur le VPS : le dossier du projet sur cette machine. */
  dossierVps?: string | null;
}

/** Réponse à une demande d'autorisation. « toujours » : accordé pour le reste de la session. */
export type Decision = "oui" | "toujours" | "non";

/** Ouvre une réponse spontanée dans l'interface ; null si elle n'est plus là. */
export type Spontane = (sessionId: string) => { requestId: string; emit: (event: AgentEvent) => void } | null;

/** Le moteur sur ce poste et le compte qui y est connecté. */
export interface CompteMoteur {
  /** Le moteur est trouvé sur le poste. */
  installe: boolean;
  chemin: string | null;
  version: string | null;
  connecte: boolean;
  /** Comment le compte paie : « claude.ai » (abonnement) ou « console » (facturation à l'usage) pour Claude. */
  methode: string | null;
  email: string | null;
  organisation: string | null;
  /** « max », « pro », « team »… */
  abonnement: string | null;
  verifieLe: number;
}

export interface Moteur {
  id: IdMoteur;
  /** Le programme : « Claude Code ». */
  nom: string;
  /** Ce que la personne choisit : « Claude ». */
  fournisseur: string;
  /** Le chemin du programme sur ce poste, ou null s'il n'y est pas. */
  trouver(): string | null;
  compte(): Promise<CompteMoteur>;
  /** Ouvre la connexion du moteur et attend qu'elle aboutisse. */
  connecter(): Promise<CompteMoteur>;
  deconnecter(): Promise<CompteMoteur>;
  /** Fait répondre l'agent, en direct. Se termine toujours par un événement `fin`. */
  lancer(requestId: string, options: StreamOptions, emit: (event: AgentEvent) => void, spontane: Spontane): void;
  /** Arrête une réponse ; sans effet si elle n'est pas à ce moteur. */
  arreter(requestId: string): void;
  /** Transmet ta réponse à une demande d'autorisation ; false si elle n'est pas à ce moteur. */
  autoriser(requestId: string, demandeId: string, decision: Decision): boolean;
}
