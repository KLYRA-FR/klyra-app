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
  | { type: "jetons"; total: number }
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
  /** La conversation de l'app : les outils des fils savent d'où vient l'agent. */
  chatId?: string;
}

/** Ce qu'un agent peut faire sans demander (cf. electron/claude.ts). */
export type Acces = "demander" | "projet" | "tout";

/** Une autre IA ajoutée dans les Réglages, sans sa clé. */
export interface AutreIa {
  id: string;
  nom: string;
  fournisseur: string;
  url: string;
  modele: string;
}

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
    /** L'agent reprend la parole de lui-même (une tâche de fond s'est terminée) : une nouvelle réponse. */
    onSpontane?: (callback: (requestId: string, sessionId: string) => void) => () => void;
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
    /** Les pages du site (routes Next), pour les suggestions de la barre d'adresse de l'aperçu. */
    pages?: (dossier: string) => Promise<Reponse<string[]>>;
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
    /** Demande l'accès au micro (une fois, par macOS). */
    micro?: () => Promise<Reponse<boolean>>;
    /** Transcrit un enregistrement (WebM) en texte, sur le Mac (Whisper). */
    transcrire?: (audio: Uint8Array) => Promise<Reponse<string>>;
    /** Notification du Mac (et pastille du Dock) ; un clic ramène à la conversation. Filtrée par les Réglages. */
    notifier?: (titre: string, texte: string, chatId: string, evenement?: "agentFini" | "agentErreur" | "workflow") => Promise<Reponse<void>>;
    onOuvrirChat?: (callback: (chatId: string) => void) => () => void;
  };
  /** Les outils des fils, appelés par les agents et exécutés ici. */
  outils?: {
    onAppel: (callback: (id: string, nom: string, args: Record<string, unknown>, appelant: { chatId: string; roleId: string }) => void) => () => void;
    repondre: (id: string, ok: boolean, texte: string) => void;
  };
  /** Les autres IA (ChatGPT, Gemini…) que les agents peuvent interroger. La clé ne revient jamais. */
  ia?: {
    fournisseurs: () => Promise<Reponse<Record<string, { nom: string; url: string; modele: string }>>>;
    lister: () => Promise<Reponse<AutreIa[]>>;
    ajouter: (entree: { nom: string; fournisseur: string; url: string; modele: string; cle: string }) => Promise<Reponse<AutreIa[]>>;
    retirer: (id: string) => Promise<Reponse<AutreIa[]>>;
    tester: (id: string) => Promise<Reponse<string>>;
  };
  /** Le planning en clair, que les agents lisent (~/.klyra/planning/planning.md). */
  planning?: {
    ecrire: (markdown: string) => Promise<Reponse<void>>;
  };
  fichiers: {
    /** Ouvre le sélecteur de fichiers du système ; renvoie les chemins choisis. */
    choisir: () => Promise<Reponse<string[]>>;
    /** Montre le fichier dans le Finder. */
    montrer: (chemin: string) => Promise<Reponse<void>>;
    /** Chemin sur le disque d'un fichier glissé dans la fenêtre ("" s'il n'en a pas). */
    cheminDe: (file: File) => string;
    /** Écrit un fichier texte (sortie d'un workflow) ; renvoie son chemin complet. Absent avant la relance de l'app. */
    ecrire?: (chemin: string, texte: string) => Promise<Reponse<string>>;
  };
  /** Les webhooks locaux des workflows. Absent avant la relance de l'app. */
  webhooks?: {
    /** L'adresse locale où appeler un déclencheur, pour ce secret. */
    adresse: (secret: string) => Promise<Reponse<string>>;
    onAppel: (callback: (secret: string, corps: string) => void) => () => void;
  };
  /** L'adresse de la page affichée dans l'aperçu. Absent avant la relance de l'app. */
  apercu?: {
    onAdresse: (callback: (url: string) => void) => () => void;
  };
  conversations: {
    avantFermeture: (callback: () => void) => () => void;
    read: () => Promise<Reponse<unknown>>;
    write: (data: unknown) => Promise<Reponse<void>>;
  };
  /** Les Réglages de l'app (cf. electron/reglages.ts). Absent avant la relance de l'app. */
  reglages?: {
    lire: () => Promise<Reponse<Reglages>>;
    ecrire: (reglages: Reglages) => Promise<Reponse<Reglages>>;
    lancement: () => Promise<Reponse<Lancement>>;
    changerLancement: (actif: boolean) => Promise<Reponse<Lancement>>;
    infos: () => Promise<Reponse<InfosApp>>;
    ouvrirDossier: (nom: DossierApp) => Promise<Reponse<void>>;
    essaiNotification: () => Promise<Reponse<void>>;
    autorisationsComputerUse: () => Promise<Reponse<AutorisationsComputerUse>>;
    ouvrirAutorisation: (type: "accessibilite" | "ecran") => Promise<Reponse<void>>;
  };
  /** La consommation de l'année (cf. electron/consommation.ts). */
  consommation?: {
    lire: () => Promise<Reponse<{ entrees: EntreeConsommation[]; depuis: number | null; historique?: EtatHistorique | null }>>;
  };
  /** Facultatif : usage et coût réels d'une organisation Console (cf. electron/anthropic-admin.ts). La clé ne revient jamais. */
  anthropicAdmin?: {
    etat: () => Promise<Reponse<{ configuree: boolean }>>;
    definir: (cle: string) => Promise<Reponse<RapportAdmin>>;
    retirer: () => Promise<Reponse<void>>;
    rapport: () => Promise<Reponse<RapportAdmin | null>>;
  };
  /** Les mises à jour de l'app (cf. electron/maj.ts). */
  maj?: {
    etat: () => Promise<Reponse<EtatMaj>>;
    verifier: () => Promise<Reponse<EtatMaj>>;
    installer: () => Promise<Reponse<void>>;
    /** Chaque changement d'état (téléchargement, version prête, erreur). Absent avant la relance de l'app. */
    onEtat?: (callback: (etat: EtatMaj) => void) => () => void;
  };
}

export interface PreferencesNotifications {
  actives: boolean;
  pastille: boolean;
  son: boolean;
  agentFini: boolean;
  agentErreur: boolean;
  workflow: boolean;
  majPrete: boolean;
}

export interface Reglages {
  notifications: PreferencesNotifications;
  computerUse: { actif: boolean };
}

export type EtatAutorisation = "accordee" | "refusee" | "a-demander" | "sans-objet" | "inconnue";

export interface AutorisationsComputerUse {
  plateforme: string;
  accessibilite: EtatAutorisation;
  ecran: EtatAutorisation;
}

/** Usage et coût d'une organisation Console sur 30 jours (cf. electron/anthropic-admin.ts). */
export interface RapportAdmin {
  debut: string;
  fin: string;
  coutUsd: number;
  coutCatalogueUsd: number;
  jetons: number;
  requetes: number;
  parModele: { modele: string; jetons: number }[];
  donneesAu: string | null;
  lu: number;
}

/** Le rattrapage des transcriptions de Claude Code d'avant le journal (cf. electron/historique.ts). */
export interface EtatHistorique {
  depuis: number | null;
  jusqua: number;
  sessionsApp: number;
  sessionsTrouvees: number;
  /** Toutes les sessions Claude Code de l'année sur ce poste (terminal, IDE, app). */
  sessionsTotal: number;
  raison: string | null;
  rattrapeLe: number;
}

/** Un appel à une IA : ses jetons et son coût (cf. electron/consommation.ts). */
export interface EntreeConsommation {
  at: number;
  fournisseur: string;
  modele: string;
  agent: string;
  jetons: { entree: number; sortie: number; cacheLu: number; cacheEcrit: number };
  coutUsd: number | null;
  /** Passé par l'app ; faux pour le terminal ou l'IDE. */
  klyra?: boolean;
}

export interface Lancement {
  /** Faux hors de l'app installée sur Mac ou Windows. */
  possible: boolean;
  actif: boolean;
}

export type DossierApp = "donnees" | "klyra" | "agents";

export interface InfosApp {
  version: string;
  installee: boolean;
  plateforme: string;
  electron: string;
  dossiers: Record<DossierApp, string>;
}

export interface EtatMaj {
  version: string;
  statut: "dev" | "inconnu" | "verification" | "telechargement" | "a-jour" | "prete" | "erreur";
  nouvelle: string | null;
  /** La dernière version publiée, vue à la dernière vérification. */
  disponible: string | null;
  /** Pendant le téléchargement : octets reçus et total (0 si inconnu). */
  progression: { recus: number; total: number } | null;
  verifieeLe: number | null;
  erreur: string | null;
  depot: string;
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
