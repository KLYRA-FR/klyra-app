/**
 * Pont vers le système, exposé par `electron/preload.ts` sous `window.klyra`.
 * Absent dans un navigateur (pnpm dev) : l'app passe alors en lecture seule.
 */

import type { FileNode } from "@/types/domain";
import type { EtatComposio } from "../../electron/composio-types";
export type { EtatComposio, VueCompteComposio, VueServiceComposio } from "../../electron/composio-types";
import type { EtatConnect } from "../../electron/composio-connect";
import type { ConfigurationKlyra } from "../../electron/configuration-klyra";
import type { DiagnosticPoste } from "../../electron/diagnostic-poste";
import type { RenduVps } from "../../electron/agents-distants";
import type { AjoutFiche } from "../../electron/atelier-agent";
import type { CasEpreuve, ResultatCas } from "../../electron/epreuve";
import type { EtatConsignesProjet } from "../../electron/consignes-projet";
import type { Competences as CompetencesAgent, Memoire as MemoireAgent, Souvenir } from "../../electron/connaissances-agent";
export type { Competence, Competences as CompetencesAgent, Memoire as MemoireAgent, Souvenir } from "../../electron/connaissances-agent";

/** La conversation dont on lit ce que sait l'agent : le dossier de son projet (null : son atelier) et sa session. */
export interface ContexteConnaissances {
  dossier: string | null;
  sessionId: string | null;
  /** Le VPS de la conversation (son origine) : `dossier` est alors celui du projet là-bas. Absent : ce PC. */
  lieu?: string | null;
}
export type { EtatConnect };

/** Un MCP direct branché dans la Marketplace : tout, sauf le jeton. */
export interface McpDirect {
  id: string;
  app: string | null;
  nom: string;
  url: string;
  avecJeton: boolean;
}
import type { Routine as RoutineMoteur, RoutineInput, RoutinePatch, RoutineRun, RunReport } from "@/types/routines";

export type Reponse<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

export interface AgentFile {
  name: string;
  path: string;
  content: string;
  modifiedAt: number;
  empreinte: string;
}

/** D'où vient un agent de Mes agents (cf. `electron/mes-agents.ts`). */
export type OrigineAgent =
  /** `publie` : partagé dans la bibliothèque par la personne, qui en est l'autrice. */
  | { type: "local"; publie?: { definitionId: string; version: number; compte: string } }
  /** `ignoree` : la version du modèle face à laquelle la personne a gardé sa fiche (plus proposée). */
  | { type: "modele"; modele: string; ignoree?: number }
  | {
      type: "bibliotheque";
      definitionId: string;
      version: number;
      auteur: string;
      compte: string;
      valeurs: Record<string, string>;
      ignoree: number | null;
    }
  /** Copie privée : plus de mise à jour ; l'auteur ne s'affiche que sous `compte`. */
  | { type: "copie"; definitionId: string; version: number; auteur: string; compte: string };

export interface EntreeMesAgents {
  actif: boolean;
  ajouteLe: number;
  /** Quand la personne l'a désactivé (absent s'il est actif). */
  desactiveLe?: number;
  origine: OrigineAgent;
  empreinte: string | null;
}

export interface MesAgents {
  version: 1;
  depart: "reprise" | "nouveau";
  assistant: { nom: string | null; teinte: string | null };
  agents: Record<string, EntreeMesAgents>;
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

/** Préférences personnelles de chaque agent : rôle court, couleur et nom affiché (sans toucher à la fiche). */
/** Préférences d'un agent sur ce poste. `masque`, `muet`, `epingleLe` : sa place dans la barre et ses notifications, rien de plus. */
export type AgentsMeta = Record<string, { tag?: string; teinte?: string; nom?: string; modele?: string; fournisseur?: string; masque?: boolean; muet?: boolean; epingleLe?: string; rang?: number }>;

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
  /** L'entrée d'un outil pendant que le modèle l'écrit (la carte de l'atelier), refermée au mieux. */
  | { type: "etape-partielle"; id: string; outil: string; entree: Record<string, unknown> }
  | { type: "etape-fin"; id: string; ok: boolean; apercu: string }
  | { type: "jetons"; total: number }
  | { type: "contexte"; jetons: number }
  | { type: "compacte"; avant: number; apres: number }
  | { type: "autorisation"; id: string; outil: string; entree: Record<string, unknown>; description: string }
  | { type: "autorisation-fin"; id: string; accepte: boolean }
  | { type: "fin"; ok: boolean; texte: string; erreur?: string; costUsd?: number; sessionId?: string; silencieux?: boolean };

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

/** Un moteur d'agents sur ce poste (cf. electron/moteurs). */
export interface MoteurPoste {
  id: string;
  /** Le programme : « Codex ». */
  nom: string;
  /** Ce que tu choisis : « ChatGPT ». */
  fournisseur: string;
  /** Où il est installé ; null s'il ne l'est pas. */
  chemin: string | null;
  /** Installé par l'app (dans ~/.klyra/moteurs) : c'est elle qui le met à jour. */
  gere: boolean;
  /** L'app sait l'installer elle-même. */
  installable: boolean;
}

/** Où en est une installation ou une mise à jour de moteur. */
export interface ProgressionMoteur {
  etape: "telechargement" | "verification" | "installation" | "mise-a-jour";
  recu: number;
  total: number | null;
}

/** Un modèle annoncé par un moteur, avec ses efforts de réflexion. */
export interface ModeleMoteur {
  id: string;
  nom: string;
  efforts: string[];
  effortParDefaut: string | null;
  parDefaut: boolean;
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

/** Une cellule d'un classeur, déjà mise en forme (date, pourcentage…) ; `nombre` : alignée à droite. */
export interface CelluleClasseur {
  texte: string;
  nombre?: true;
}

export interface FeuilleClasseur {
  nom: string;
  lignes: (CelluleClasseur | null)[][];
  colonnes: number;
  tronquee: boolean;
}

/** Un bout de texte d'un document Word ; `lien` : http, https ou mailto seulement. */
export interface MorceauDocument {
  texte: string;
  gras?: true;
  italique?: true;
  souligne?: true;
  barre?: true;
  lien?: string;
}

export type BlocDocument =
  | { type: "titre"; niveau: number; morceaux: MorceauDocument[] }
  | { type: "paragraphe"; morceaux: MorceauDocument[]; style?: "titre" | "sous-titre" | "citation" }
  | { type: "liste"; niveau: number; marque: string | null; morceaux: MorceauDocument[] }
  | { type: "tableau"; lignes: { morceaux: MorceauDocument[]; etendue?: number }[][] };

export type ContenuFichier =
  | { type: "image"; dataUrl: string; taille: number }
  | { type: "texte"; texte: string; taille: number }
  | { type: "classeur"; feuilles: FeuilleClasseur[]; taille: number }
  | { type: "document"; blocs: BlocDocument[]; taille: number }
  | { type: "autre"; taille: number; raison: string };

/** Une réponse d'un VPS ouverte dans sa conversation : routine, ou message écrit sur le téléphone PC fermé (electron/agents-distants.ts). */
export interface ContexteReponse {
  chatId: string;
  agentId: string;
  titre: string;
  lieu: string;
  telephone?: { messageId: string; texte: string; creeLe: string };
}

export interface StreamOptions {
  /** Le moteur qui fait travailler l'agent (« codex » pour ChatGPT) ; absent : Claude Code. */
  moteur?: string | null;
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
  routineRun?: string;
  /** Le VPS où tourne la conversation (origine https) ; absent : ce PC. */
  lieu?: string | null;
  /** Sur le VPS : le dossier du projet sur cette machine. */
  dossierVps?: string | null;
  /** La skill demandée en tête du message (« /rangement … ») : remise devant le contexte si elle existe. */
  skill?: string | null;
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

/** Les modèles de la dictée locale (Whisper) : `precis` (turbo) ou `rapide` (small). */
export type ModeleDictee = "precis" | "rapide";

/** Ce que l'interface sait de la dictée (electron/dictee.ts). */
export interface EtatDictee {
  moteur: "elevenlabs" | "local";
  cleElevenLabs: boolean;
  modele: ModeleDictee;
  modeles: { id: ModeleDictee; nom: string; taille: number; present: boolean }[];
  /** Le modèle choisi est en mémoire : la dictée démarre tout de suite. */
  pret: boolean;
}

export type ProgressionDictee =
  | { etape: "telechargement"; recu: number; total: number }
  | { etape: "chargement" }
  | { etape: "prete" };

/** Une erreur de la dictée, que l'interface sait expliquer. */
export type CodeErreurDictee = "cle" | "quota" | "reseau" | "service" | "local";

export type EvenementDictee =
  | { type: "partiel"; texte: string }
  | { type: "definitif"; texte: string }
  | { type: "erreur"; code: CodeErreurDictee; message: string }
  | { type: "fin" };

export interface KlyraBridge {
  agents: {
    list: () => Promise<Reponse<AgentsListing>>;
    write: (name: string, content: string, expectedModifiedAt: number | null) => Promise<Reponse<AgentFile>>;
    create: (name: string, content: string) => Promise<Reponse<AgentFile>>;
    /** Nouvelle fiche (modèle ou bibliothèque), jamais par-dessus une autre : erreur « existe-deja ». */
    installer: (name: string, content: string, origine: OrigineAgent, partage: string | null) => Promise<Reponse<{ file: AgentFile; mes: MesAgents }>>;
    /** Réécrit un agent reçu ; erreur « modifie-localement » si la fiche a changé depuis, sauf `forcer`. */
    appliquer: (
      name: string,
      content: string,
      origine: OrigineAgent,
      partage: string | null,
      expectedModifiedAt: number | null,
      forcer: boolean,
    ) => Promise<Reponse<{ file: AgentFile; mes: MesAgents }>>;
    mes: () => Promise<Reponse<MesAgents>>;
    nommerAssistant: (nom: string, teinte: string | null) => Promise<Reponse<MesAgents>>;
    activer: (name: string, actif: boolean) => Promise<Reponse<MesAgents>>;
    /** Ajoute à Mes agents une fiche déjà sur l'ordinateur. */
    ajouter: (name: string) => Promise<Reponse<MesAgents>>;
    changerOrigine: (name: string, origine: OrigineAgent) => Promise<Reponse<MesAgents>>;
    /** La définition partagée reçue, à la version choisie (null : pas de la bibliothèque). */
    definitionRecue: (name: string) => Promise<Reponse<string | null>>;
    history: (name: string) => Promise<Reponse<HistoryEntry[]>>;
    readVersion: (name: string, id: string) => Promise<Reponse<string>>;
    readMeta: () => Promise<Reponse<AgentsMeta>>;
    writeMeta: (meta: AgentsMeta) => Promise<Reponse<void>>;
    reveal: (name: string) => Promise<Reponse<void>>;
    /*
     * Ce que sait l'agent (cf. electron/connaissances-agent.ts), dans le dossier de la conversation
     * (`dossier` : celui du projet ; null : son atelier, retrouvé avec la session). Absents avant la relance de l'app.
     */
    memoire?: (agent: string, contexte: ContexteConnaissances) => Promise<Reponse<MemoireAgent | null>>;
    souvenir?: (agent: string, contexte: ContexteConnaissances, id: string) => Promise<Reponse<{ contenu: string; modifieLe: number }>>;
    ecrireSouvenir?: (agent: string, contexte: ContexteConnaissances, id: string, contenu: string, attendu: number | null) => Promise<Reponse<{ modifieLe: number }>>;
    creerSouvenir?: (agent: string, contexte: ContexteConnaissances, titre: string, contenu: string) => Promise<Reponse<Souvenir>>;
    montrerSouvenir?: (agent: string, contexte: ContexteConnaissances, id: string | null) => Promise<Reponse<void>>;
    competences?: (agent: string, contexte: { dossier: string | null; lieu?: string | null }) => Promise<Reponse<CompetencesAgent>>;
    montrerCompetence?: (agent: string, contexte: { dossier: string | null }, nom: string) => Promise<Reponse<void>>;
    onChange: (callback: () => void) => () => void;
  };
  /** Les moteurs des agents : Claude Code, Codex pour ChatGPT. Le compte a la forme de celui de Claude. */
  moteurs?: {
    /* `lieu` : ceux d'un VPS relié (son origine) ; absent : ceux de ce PC. */
    liste: (lieu?: string | null) => Promise<Reponse<MoteurPoste[]>>;
    compte: (id: string, lieu?: string | null) => Promise<Reponse<CompteClaude>>;
    /** Sur un VPS, Codex se connecte par code d'appareil : le code arrive sur `onCode`, la réponse une fois connecté. */
    connecter: (id: string, lieu?: string | null) => Promise<Reponse<CompteClaude>>;
    connecterAvecCle: (id: string, cle: string, lieu?: string | null) => Promise<Reponse<CompteClaude>>;
    deconnecter: (id: string, lieu?: string | null) => Promise<Reponse<CompteClaude>>;
    modeles: (id: string, lieu?: string | null) => Promise<Reponse<ModeleMoteur[]>>;
    versionDisponible: (id: string, lieu?: string | null) => Promise<Reponse<string | null>>;
    installer: (id: string, lieu?: string | null) => Promise<Reponse<CompteClaude>>;
    mettreAJour: (id: string, lieu?: string | null) => Promise<Reponse<CompteClaude>>;
    onProgression: (callback: (id: string, p: ProgressionMoteur, lieu: string | null) => void) => () => void;
    onCode?: (callback: (id: string, lieu: string, code: { url: string; code: string }) => void) => () => void;
  };
  claude: {
    status: () => Promise<Reponse<{ path: string | null }>>;
    run: (requestId: string, agent: string, prompt: string) => Promise<Reponse<ClaudeResult>>;
    /** Un titre de quelques mots pour une demande (null : Claude Code absent ou en échec). */
    titre?: (texte: string) => Promise<Reponse<string | null>>;
    /** L'épreuve d'un agent pas encore créé (atelier) : un essai sans outil, puis un avis (cf. electron/epreuve.ts). */
    essayer?: (
      requestId: string,
      brouillon: { id: string; description: string; corps: string; modele: string; fiche: string },
      cas: CasEpreuve,
      /** La conversation : sur un VPS (`lieu`), l'essai tourne là-bas ; `ajouts` y suivent l'atelier. */
      contexte?: { lieu: string | null; conversation: string; ajouts: AjoutFiche[] },
    ) => Promise<Reponse<ResultatCas>>;
    cancel: (requestId: string) => Promise<Reponse<void>>;
    /** Ta réponse à une demande d'autorisation d'un agent. */
    autoriser: (requestId: string, demandeId: string, decision: "oui" | "toujours" | "non") => Promise<Reponse<boolean>>;
    stream: (requestId: string, options: StreamOptions) => Promise<Reponse<null>>;
    onEvent: (callback: (requestId: string, event: AgentEvent) => void) => () => void;
    /** L'agent reprend la parole de lui-même (une tâche de fond s'est terminée) : une nouvelle réponse. */
    /** `contexte` : une réponse de routine d'un VPS, à ouvrir dans sa conversation (créée au besoin). */
    onSpontane?: (callback: (requestId: string, sessionId: string, contexte: ContexteReponse | null) => void) => () => void;
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
    /** Un niveau de l'arborescence : la racine, ou le dossier `relatif` du projet. */
    /** `lieu` : un projet sur un VPS relié (son origine) ; absent, un dossier de ce PC. */
    arbre: (dossier: string, relatif?: string, lieu?: string | null) => Promise<Reponse<FileNode[]>>;
    /** Crée le dossier d’un nouveau projet sur le VPS ; rend son chemin. */
    creerDossierVps?: (lieu: string, dossier: string) => Promise<Reponse<string>>;
    /** Les pages du site (routes Next), pour les suggestions de la barre d'adresse de l'aperçu. */
    pages?: (dossier: string) => Promise<Reponse<string[]>>;
    /** Le contenu d'un fichier du projet, pour la visionneuse. */
    lireFichier: (dossier: string, relatif: string, lieu?: string | null) => Promise<Reponse<ContenuFichier>>;
    /** Ouvre le fichier avec l'app par défaut du Mac. */
    ouvrirFichier: (dossier: string, relatif: string) => Promise<Reponse<void>>;
    montrerFichier: (dossier: string, relatif: string) => Promise<Reponse<void>>;
    /** Les consignes du projet pour ses agents (electron/consignes-projet.ts). Absent avant la relance de l'app. */
    consignes?: (dossier: string, nom: string, lieu?: string | null) => Promise<Reponse<EtatConsignesProjet>>;
    ecrireConsignes?: (dossier: string, nom: string, lieu?: string | null) => Promise<Reponse<EtatConsignesProjet>>;
  };
  artefacts: {
    /** Les artefacts claude.ai de la personne, lus dans sa galerie par la session claude.ai de l'app. */
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
  /** Les fichiers publiés par les agents (cf. `electron/rendus.ts`). */
  rendus: {
    /** Vignette PNG (data URL) ; null pour une vidéo, un PDF ou un document. */
    vignette: (chemin: string, forcer: boolean) => Promise<Reponse<string | null>>;
    /** Avec l'app du système ; un type qu'on ne sait pas montrer s'ouvre dans son dossier. */
    ouvrir: (chemin: string) => Promise<Reponse<void>>;
    montrer: (chemin: string) => Promise<Reponse<void>>;
    /** Copie un livrable dans l'espace de l'agent (`~/.klyra/rendus/<agent>/`) ; `remplace` : sa copie précédente. */
    copier: (origine: string, agent: string, remplace: string | null) => Promise<Reponse<{ chemin: string; taille: number; dossier: boolean }>>;
    /** Recopie le livrable d'un agent du VPS `lieu` (annoncé par `onVps`) dans l'espace de l'agent sur ce PC. */
    copierVps?: (lieu: string, id: string, agent: string, nom: string, dossier: boolean, remplace: string | null) => Promise<Reponse<{ chemin: string; taille: number; dossier: boolean }>>;
    /** Un agent du VPS `lieu` a publié un livrable (cf. serveur/rendus.mjs). */
    onVps?: (callback: (lieu: string, rendu: RenduVps) => void) => () => void;
    /** Supprime la copie d'un livrable (jamais hors de l'espace des rendus). */
    supprimer: (chemin: string) => Promise<Reponse<void>>;
    /** Copie le livrable dans un dossier choisi ; null si la personne annule. */
    enregistrer: (chemin: string, dossier: string | null) => Promise<Reponse<string | null>>;
    /** Ouvre l'espace des livrables d'un agent, ou son dossier de travail hors projet. */
    dossierAgent: (agent: string, quoi: "rendus" | "atelier") => Promise<Reponse<void>>;
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
    /** Les sons de l'interface sont-ils coupés dans les réglages du système ? */
    sonsCoupes?: () => Promise<Reponse<boolean>>;
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
    /* `lieu` : celles d'un VPS relié, dont la clé reste sur le VPS ; absent : celles de ce PC. */
    fournisseurs: (lieu?: string | null) => Promise<Reponse<Record<string, { nom: string; url: string; modele: string }>>>;
    lister: (lieu?: string | null) => Promise<Reponse<AutreIa[]>>;
    ajouter: (entree: { nom: string; fournisseur: string; url: string; modele: string; cle: string }, lieu?: string | null) => Promise<Reponse<AutreIa[]>>;
    retirer: (id: string, lieu?: string | null) => Promise<Reponse<AutreIa[]>>;
    tester: (id: string, lieu?: string | null) => Promise<Reponse<string>>;
  };
  /** Les MCP directs de la Marketplace (cf. electron/mcp-direct.ts). Le jeton ne revient jamais. */
  mcp?: {
    apps: () => Promise<Reponse<Record<string, { nom: string; url: string; jeton: string }>>>;
    lister: () => Promise<Reponse<McpDirect[]>>;
    ajouter: (entree: { app: string | null; nom?: string; url?: string; jeton?: string }) => Promise<Reponse<McpDirect[]>>;
    retirer: (id: string) => Promise<Reponse<McpDirect[]>>;
  };
  /** Le planning en clair, que les agents lisent (~/.klyra/planning/planning.md). */
  planning?: {
    ecrire: (markdown: string) => Promise<Reponse<void>>;
  };
  /** La dictée en direct (electron/dictee.ts). La clé ElevenLabs ne revient jamais. Absent avant la relance de l'app. */
  dictee?: {
    etat: () => Promise<Reponse<EtatDictee>>;
    choisirModele: (modele: ModeleDictee) => Promise<Reponse<EtatDictee>>;
    /** Vérifie la clé auprès d'ElevenLabs, puis la chiffre sur ce poste. */
    enregistrerCle: (cle: string) => Promise<Reponse<EtatDictee>>;
    retirerCle: () => Promise<Reponse<EtatDictee>>;
    testerCle: () => Promise<Reponse<void>>;
    /** Charge en avance le modèle local déjà téléchargé. */
    prechauffer: () => Promise<Reponse<void>>;
    /** Télécharge le modèle local s'il manque, puis le charge (progression par onProgression). */
    preparer: () => Promise<Reponse<void>>;
    /** Télécharge le modèle local choisi, sans le charger (secours hors ligne). */
    telecharger: () => Promise<Reponse<EtatDictee>>;
    onProgression: (callback: (p: ProgressionDictee) => void) => () => void;
    /** Le texte d'un segment (WAV 16 kHz mono), par le Whisper local. */
    transcrire: (wav: Uint8Array, precedent: string) => Promise<Reponse<string>>;
    /** Ouvre une session ElevenLabs ; rend son identifiant. */
    ouvrir: () => Promise<Reponse<string>>;
    onEvenement: (callback: (id: string, e: EvenementDictee) => void) => () => void;
    /** Un morceau d'audio (PCM 16 bits, 16 kHz) ; `valider` clôt le segment. */
    envoyer: (id: string, pcm: Uint8Array, valider: boolean) => void;
    fermer: (id: string) => Promise<Reponse<void>>;
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
    /** Écrit une image collée dans le dossier de l'app (`collages/`) ; renvoie son chemin. Absent avant la relance de l'app. */
    enregistrerCollage?: (octets: Uint8Array, type: string) => Promise<Reponse<string>>;
    /** Écrit une pièce jointe venue du téléphone dans le dossier de l'app (`telephone/`) ; renvoie son chemin. Absent avant la relance de l'app. */
    recevoirPiece?: (octets: Uint8Array, nom: string) => Promise<Reponse<string>>;
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
  /** Journal des travaux sur les fils. Absent tant que l'app n'a pas été relancée. */
  superagent?: {
    peutOuvrir: () => Promise<Reponse<{ ok: boolean; places: number }>>;
    ouvrir: (fait: Record<string, unknown>) => Promise<Reponse<{ ok: boolean; motif?: string; work_id?: string }>>;
    message: (fait: Record<string, unknown>) => Promise<Reponse<{ ok: boolean; motif?: string; disposition?: string }>>;
    etat: (filId: string) => Promise<Reponse<{ status: string; work_id: string } | null>>;
    marquer: (filId: string, status: string, controle: string | null) => Promise<Reponse<{ ok: boolean; motif?: string }>>;
    projection: (projectId: string | null) => Promise<Reponse<{
      travaux: { work_id: string; fil_id: string | null; titre: string; owner_agent_id: string | null; status: string; state_ref: string; deadline_at: string | null; mesures_cout: string | null }[];
      alertes: { work_id: string; type: string; motif: string; prochain_geste: string }[];
      blocages: { point: string; texte: string }[];
      evenements?: { event_id: string; work_id: string; type: string; resume: string }[];
      couverture: string;
    }>>;
    preuves: (workId: string) => Promise<Reponse<unknown>>;
    chercher: (requete: string, compte: string, projectId: string | null) => Promise<Reponse<{ resultats: { identifiant: string; extrait: string; chemin: string }[]; non_recherche: string[] }>>;
    preparer: (filId: string) => Promise<Reponse<{ ok: boolean; motif?: string }>>;
    /** Un passage du watchdog. Absent avant la relance de l'app. */
    passage?: () => Promise<Reponse<{ work_id: string; type: string; motif: string }[]>>;
    /** Relie une pull request ou enregistre un fait déjà lu. Absent avant la relance de l'app. */
    github?: (fait: Record<string, unknown>) => Promise<Reponse<{ ok: boolean; motif?: string; work_id?: string | null; disposition?: string; operations?: string[] }>>;
  };
  conversations: {
    avantFermeture: (callback: () => void) => () => void;
    read: () => Promise<Reponse<unknown>>;
    write: (data: unknown) => Promise<Reponse<void>>;
    /** Absent avant la relance de l'app ; seul le sélecteur main choisit la destination. */
    exporter?: (demande: { contenu: string; nomPropose: string }) => Promise<Reponse<
      { statut: "annule" | "occupe" } | { statut: "enregistre"; chemin: string; nom: string }
    >>;
  };
  /** Le moteur des routines (electron/routines/). Absent avant la relance de l'app. */
  routines?: {
    etat: () => Promise<Reponse<{ actif: boolean; erreur: string | null }>>;
    lister: (agentId?: string) => Promise<Reponse<RoutineMoteur[]>>;
    enCours: () => Promise<Reponse<RoutineRun[]>>;
    creer: (input: RoutineInput) => Promise<Reponse<RoutineMoteur>>;
    modifier: (id: string, patch: RoutinePatch) => Promise<Reponse<RoutineMoteur>>;
    supprimer: (id: string) => Promise<Reponse<void>>;
    /** « Exécuter maintenant » : la programmation ne bouge pas. */
    executer: (id: string) => Promise<Reponse<RoutineRun>>;
    interrompre: (runId: string) => Promise<Reponse<RoutineRun>>;
    historique: (id: string, limit?: number) => Promise<Reponse<RoutineRun[]>>;
    /** Les échéances des 7 prochains jours (vide en pause). */
    prochaines: (id: string) => Promise<Reponse<string[]>>;
    passages: (debut: string, fin: string) => Promise<Reponse<{ routineId: string; at: string }[]>>;
    apercu: (schedule: RoutineInput["schedule"], timezone: string) => Promise<Reponse<string[]>>;
    /** L'interface est chargée : le moteur lui confie les exécutions à poster. */
    pret: () => Promise<Reponse<null>>;
    signaler: (runId: string, rapport: RunReport) => Promise<Reponse<void>>;
    onLivrer: (callback: (run: RoutineRun, routine: RoutineMoteur | null) => void) => () => void;
    onAnnuler: (callback: (run: RoutineRun) => void) => () => void;
    onChange: (callback: () => void) => () => void;
  };
  /** Les Réglages de l'app (cf. electron/reglages.ts). Absent avant la relance de l'app. */
  reglages?: {
    lire: () => Promise<Reponse<Reglages>>;
    ecrire: (reglages: Reglages) => Promise<Reponse<Reglages>>;
    lancement: () => Promise<Reponse<Lancement>>;
    changerLancement: (actif: boolean) => Promise<Reponse<Lancement>>;
    infos: () => Promise<Reponse<InfosApp>>;
    ouvrirDossier: (nom: DossierApp) => Promise<Reponse<void>>;
    /** Ce que le poste ajoute à chaque appel (electron/diagnostic-poste.ts). Absent avant la relance de l'app. */
    /** Ce que la configuration de Claude Code ajoute à chaque appel : de ce poste, ou du VPS `lieu`. */
    diagnosticPoste?: (lieu?: string | null) => Promise<Reponse<DiagnosticPoste>>;
    montrerDiagnostic?: (chemin: string) => Promise<Reponse<void>>;
    essaiNotification: () => Promise<Reponse<void>>;
    autorisationsComputerUse: () => Promise<Reponse<AutorisationsComputerUse>>;
    ouvrirAutorisation: (type: "accessibilite" | "ecran") => Promise<Reponse<void>>;
    /** Le pilote de Computer Use (cua-driver) : démarré si l'interrupteur est allumé. Absent avant la relance de l'app. */
    etatComputerUse?: () => Promise<Reponse<EtatPilote>>;
    surEtatComputerUse?: (callback: (etat: EtatPilote) => void) => () => void;
  };
  /** Configuration Composio locale : la clé et les liens de consentement restent dans main. */
  composio?: {
    etat: () => Promise<Reponse<EtatComposio>>;
    importer: (contexte: string) => Promise<Reponse<boolean>>;
    /** La clé collée : elle part vers main une fois, pour être vérifiée puis chiffrée. */
    saisir: (contexte: string, cle: string) => Promise<Reponse<boolean>>;
    retirer: (contexte: string) => Promise<Reponse<void>>;
    selectionner: (contexte: string, service: string, compte: string | null) => Promise<Reponse<void>>;
    connecter: (contexte: string, service: string, configuration: string) => Promise<Reponse<{ compteId: string; service: string; expireLe: string | null }>>;
    deconnecter: (contexte: string, compte: string) => Promise<Reponse<void>>;
    console: () => Promise<Reponse<void>>;
    /** Composio Connect : connexion par le navigateur, sans clé. Les jetons restent dans main. */
    connect?: {
      etat: () => Promise<Reponse<EtatConnect>>;
      connecter: () => Promise<Reponse<boolean>>;
      annuler: () => Promise<Reponse<void>>;
      deconnecter: () => Promise<Reponse<void>>;
    };
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
  /** Le compte d'équipe (cf. electron/compte.ts). Absent avant la relance de l'app. */
  compte?: {
    /** L'adresse du déploiement Convex de l'app. */
    adresse: string | null;
    /** Les jetons de session de Convex Auth, chiffrés par le trousseau du système. */
    lireJeton: (cle: string) => Promise<Reponse<string | null>>;
    ecrireJeton: (cle: string, valeur: string) => Promise<Reponse<void>>;
    retirerJeton: (cle: string) => Promise<Reponse<void>>;
    /** Le code du dernier lien klyra://connexion ouvert, une seule fois. */
    prendreCode: () => Promise<Reponse<string | null>>;
    onLien: (callback: () => void) => () => void;
  };
  /** Un VPS déjà en marche (cf. electron/lien-rejoindre.ts). Absent avant la relance de l’app. */
  serveur?: {
    /** Le dernier lien klyra://rejoindre ouvert, une seule fois. */
    prendreLien: () => Promise<Reponse<string | null>>;
    /** Appels depuis le processus principal. Le rendu ne fetch pas cette origine et ne voit pas le jeton. */
    interroger: (adresse: string) => Promise<Reponse<{ ok: true; nom: string; version: string } | { ok: false; message: string }>>;
    /** Échange le code du lien contre un jeton, gardé chiffré par le processus principal. */
    appairer: (adresse: string, code: string) => Promise<Reponse<{ ok: true; nom: string; version: string } | { ok: false; message: string }>>;
    /** Le serveur oublie cet appareil s’il répond (vrai), ce PC oublie le jeton dans tous les cas. */
    retirer: (adresse: string) => Promise<Reponse<boolean>>;
    /** Les conversations sont chargées : les réponses des VPS arrivées pendant l’absence peuvent s’ouvrir. */
    pret?: () => Promise<Reponse<void>>;
    onLien: (callback: () => void) => () => void;
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

export interface PreferencesSons {
  finDeTache: boolean;
  theme: "silence" | "chaleureux" | "mecanique" | "petillant" | "clavier";
  /** De 0 à 1. */
  volume: number;
}

export interface Reglages {
  notifications: PreferencesNotifications;
  computerUse: { actif: boolean };
  sons: PreferencesSons;
  configuration: ConfigurationKlyra;
}

export type EtatAutorisation = "accordee" | "refusee" | "a-demander" | "sans-objet" | "inconnue";

/** Cf. electron/ordinateur/pilote.ts. */
export interface EtatPilote {
  statut: "coupe" | "non-pris-en-charge" | "absent" | "autorisations" | "pret" | "erreur";
  autorisations: { ecran: boolean; accessibilite: boolean } | null;
  message: string | null;
  version: string;
}

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
