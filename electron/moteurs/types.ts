/**
 * Le contrat entre l'app et un moteur : le programme qui fait travailler un agent
 * (Claude Code aujourd'hui ; Codex, Grok, OpenCode ensuite). Chaque moteur traduit
 * son flux en `AgentEvent` : l'interface des conversations ne connaît que lui.
 */

import type { Utilisation } from "../utilisation";

/** Les moteurs que l'app sait lancer : Claude Code, et Codex pour ChatGPT. */
export type IdMoteur = "claude" | "codex";

/** Ce que l'interface reçoit pendant qu'un agent travaille (cf. src/lib/bridge.ts). */
export type AgentEvent =
  | { type: "session"; sessionId: string }
  /** Un morceau du texte de la réponse. `nouveauBloc` : il suit des étapes, on passe à la ligne. */
  | { type: "texte"; delta: string; nouveauBloc: boolean }
  /** Une étape : lire un fichier, lancer une commande, confier à un agent… */
  | { type: "etape"; id: string; outil: string; entree: Record<string, unknown>; parent: string | null }
  /** L'entrée d'un outil pendant que le modèle l'écrit (la carte de l'atelier), refermée au mieux. */
  | { type: "etape-partielle"; id: string; outil: string; entree: Record<string, unknown> }
  | { type: "etape-fin"; id: string; ok: boolean; apercu: string }
  /** Les tokens écrits depuis le début (réflexion, texte, outils, sous-agents compris), estimés en direct. */
  | { type: "jetons"; total: number }
  /** Ce que relit chaque appel au modèle dans cette conversation (consignes, outils, échanges), en jetons. */
  | { type: "contexte"; jetons: number }
  /** La conversation a été résumée (/compact, ou d'office par Claude Code près de sa limite). */
  | { type: "compacte"; avant: number; apres: number }
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
  /** La skill que la personne a demandée en tête de son message (« /rangement … ») : remise en tête du prompt si elle existe. */
  skill?: string | null;
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

/** Où en est une installation ou une mise à jour, pour la barre de l'écran. */
export interface Progression {
  etape: "telechargement" | "verification" | "installation" | "mise-a-jour";
  recu: number;
  total: number | null;
}

/** Un modèle qu'un moteur annonce, avec les efforts de réflexion qu'il accepte. */
export interface ModeleMoteur {
  id: string;
  nom: string;
  efforts: string[];
  effortParDefaut: string | null;
  /** Celui du moteur quand on n'en choisit pas. */
  parDefaut: boolean;
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
  /** Se connecter avec une clé API plutôt qu'un abonnement ; absent si le moteur ne le permet pas ici. */
  connecterAvecCle?(cle: string): Promise<CompteMoteur>;
  /** Les modèles que le moteur annonce ; absent : la liste fixe de l'interface (les alias de Claude Code). */
  modeles?(): Promise<ModeleMoteur[]>;
  /** La dernière version publiée ; null si on ne sait pas la lire. */
  versionDisponible?(): Promise<string | null>;
  /** Installe le moteur dans ~/.klyra/moteurs ; absent : l'app ne sait pas l'installer. */
  installer?(progression: (p: Progression) => void): Promise<CompteMoteur>;
  /** Met le moteur à jour : celui de l'app est réinstallé, celui du poste par sa propre commande. */
  mettreAJour?(progression: (p: Progression) => void): Promise<CompteMoteur>;
  /** Fait répondre l'agent, en direct. Se termine toujours par un événement `fin`. */
  lancer(requestId: string, options: StreamOptions, emit: (event: AgentEvent) => void, spontane: Spontane): void;
  /** Arrête une réponse ; sans effet si elle n'est pas à ce moteur. */
  arreter(requestId: string): void;
  /** Transmet ta réponse à une demande d'autorisation ; false si elle n'est pas à ce moteur. */
  autoriser(requestId: string, demandeId: string, decision: Decision): boolean;
  /**
   * Les limites de l'abonnement (5 h, semaine), telles que le moteur les donne ; null si on ne les connaît pas.
   * `actualiser` : les redemander (Claude Code : une toute petite requête, qui compte un peu ; Codex : une lecture, gratuite).
   */
  utilisation?(actualiser: boolean): Promise<Utilisation | null>;
  /** Prévient à chaque nouvelle utilisation reçue pendant le travail des agents. */
  surUtilisation?(callback: (u: Utilisation) => void): () => void;
  /** Arrête ce que le moteur garde ouvert, quand l'app se ferme. */
  fermer?(): void;
}
