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

/* ─── Utilisateur ──────────────────────────────────────────────── */

export interface User {
  id: string;
  name: string;
  title: string;
  initial: string;
  /** Photo de profil, recadrée en carré (data URL), gardée sur le poste ; absente : les initiales. */
  photo?: string | null;
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

/**
 * Une conversation. `direct` : en tête-à-tête avec un agent (une par agent,
 * id `dm-<agent>`), hors projet. `equipe` : dans un projet, avec plusieurs
 * agents ; sans mention, c'est le Principal qui répond et répartit.
 */
export interface Chat {
  id: string;
  kind: "direct" | "equipe";
  projectId: string | null;
  title: string;
  roleIds: RoleId[];
  updatedAt: string;
  /** Épinglée en haut des listes d'équipe : date de pose. Préférence locale, jamais lue par les agents. */
  epingleLe?: string;
  /** Session Claude Code de chaque agent dans cette conversation : il s'en souvient d'un message à l'autre. */
  sessions: Record<RoleId, string>;
  /** Dernier message lu, pour les non-lus de la barre latérale. */
  luJusqua: string | null;
  /** Modèle choisi pour cette conversation (« opus »…) ; absent : celui de la fiche de l'agent. */
  modele?: string | null;
  /** Effort de réflexion choisi (« high »…) ; absent : celui par défaut. */
  effort?: string | null;
  /** La liste de tâches que l'agent tient pendant son travail (outil TodoWrite de Claude Code). */
  taches?: TacheAgent[];
  /** Branche d'une autre conversation : ce qui s'y était dit, donné à l'agent avec son premier message. */
  amorce?: string;
  /** Un fil : une conversation à part d'un agent, consacrée à une seule tâche (un onglet de son chat). */
  fil?: Fil;
}

/**
 * Un fil = une tâche. Il tourne à côté du chat principal de l'agent sans le
 * bloquer, avec sa propre mémoire de conversation : il ne voit pas le chat d'où
 * il vient, d'où le brief complet à l'ouverture. Fermé, il est archivé, jamais effacé.
 */
export interface Fil {
  /** L'agent qui fait la tâche. */
  roleId: RoleId;
  statut: "ouvert" | "archive";
  /** « Supprimé » : retiré de la liste des archivés, mais rien n'est effacé. */
  supprime?: boolean;
  creeLe: string;
  /** Qui l'a ouvert : un agent depuis sa conversation, ou absent si c'est toi. */
  lancePar?: { roleId: RoleId; chatId: string } | null;
  /** Celui qui l'a lancé attend la prochaine réponse : elle lui sera rapportée. */
  retourAttendu?: boolean;
}

/** Une tâche de la liste de l'agent. */
export interface TacheAgent {
  texte: string;
  statut: "a-faire" | "en-cours" | "fait";
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
/** Une étape du travail d'un agent : lire, modifier, lancer une commande, confier à un collègue. */
export interface Etape {
  id: string;
  outil: string;
  /** « Lit src/app/page.tsx », « Lance pnpm build »… */
  libelle: string;
  statut: "en-cours" | "fait" | "erreur";
  /** Étape faite par un collègue à qui l'agent a confié une partie. */
  parent: string | null;
  /** Fichier lu ou modifié par l'étape, chemin complet. */
  chemin?: string;
}

export type MessagePart =
  | { type: "text"; text: string }
  /** Fichiers joints par l'utilisateur (chemins complets). */
  | { type: "fichiers"; chemins: string[] }
  | { type: "etapes"; etapes: Etape[] }
  /** L'agent demande ton accord avant d'utiliser un outil hors de son accès. */
  | {
      type: "autorisation";
      id: string;
      outil: string;
      /** « Lance open https://klyra.fr ». */
      libelle: string;
      /** La commande, le fichier ou l'adresse concernés. */
      detail: string;
      description: string;
      statut: "attente" | "acceptee" | "refusee";
    }
  /** L'agent confie une partie du travail à un collègue. */
  | { type: "passation"; etapeId: string; roleId: RoleId; consigne: string; statut: "en-cours" | "fait" | "erreur" }
  /** L'assistant propose la fiche d'un nouvel agent : la personne l'ouvre, l'ajuste et l'enregistre (ou non). */
  | { type: "proposition-agent"; etapeId: string; proposition: PropositionAgent }
  | { type: "tasks"; tasks: Task[] }
  | { type: "options"; options: DeliverableOption[] }
  | { type: "worklog"; durationMin: number; files: ChangedFile[] }
  | { type: "actions"; actions: MessageAction[] };

/** Une fiche d'agent proposée par l'assistant (outil `proposer_agent`), pas encore enregistrée. */
export interface PropositionAgent {
  id: string;
  nom: string;
  role: string;
  description: string;
  consignes: string;
}

export interface Message {
  id: string;
  chatId: string;
  author: MessageAuthor;
  createdAt: string;
  parts: MessagePart[];
  /** Réponse d'agent : en cours d'écriture, finie, ou arrêtée sur une erreur. */
  statut?: "en-cours" | "fait" | "erreur";
  erreur?: string;
  /** L'exécution de routine (moteur du process principal) que ce message porte : la consigne, puis la réponse de l'agent. */
  routineRun?: string;
}

/* ─── Planning ─────────────────────────────────────────────────── */

/** Quand une tâche planifiée se relance. Heures au format « 09:00 ». */
export type Frequence =
  /** Seulement quand on la lance soi-même. */
  | { type: "manuel" }
  | { type: "heure" }
  | { type: "jour"; heure: string }
  | { type: "jours-ouvres"; heure: string }
  /** `jour` : 1 = lundi … 7 = dimanche. */
  | { type: "semaine"; jour: number; heure: string }
  /** `jour` : le jour du mois, de 1 à 28. */
  | { type: "mois"; jour: number; heure: string };

/** Une exécution passée d'une tâche planifiée. */
export interface ExecutionRoutine {
  at: string;
  chatId: string;
  /** Rattrapée : l'heure était passée pendant que l'app était fermée. */
  rattrapee: boolean;
  /** Où en est chaque agent de la chaîne dans ce passage. */
  etapes?: EtapePassage[];
}

/** Un relais de la chaîne : quand `de` a répondu, sa réponse part à `vers`, avec une consigne. */
export interface RelaisRoutine {
  id: string;
  de: RoleId;
  vers: RoleId;
  consigne: string;
}

/** La part d'un agent dans un passage de la chaîne. */
export interface EtapePassage {
  roleId: RoleId;
  statut: "en-cours" | "fait" | "erreur";
  /** Quand sa consigne lui est partie : sa réponse est le premier message d'après. */
  depuis: string;
}

/**
 * Une tâche planifiée : une consigne confiée à un agent, qui se relance toute
 * seule. Elle part dans la conversation directe de l'agent, ou dans une
 * conversation d'équipe du projet si elle en a un.
 */
export interface Routine {
  id: string;
  nom: string;
  roleId: RoleId;
  consigne: string;
  frequence: Frequence;
  projectId: string | null;
  active: boolean;
  creeLe: string;
  prochaine: string;
  historique: ExecutionRoutine[];
  /** La chaîne : à qui passe la main chaque agent, une fois sa réponse rendue. */
  relais?: RelaisRoutine[];
  /** Où sont posés le déclencheur et les agents sur le canevas (clé : « depart » ou l'id de l'agent). */
  positions?: Record<string, { x: number; y: number }>;
}

/* ─── Artefacts ────────────────────────────────────────────────── */

/** Une page publiée par Claude (claude.ai/artifact/…) : design system, document, présentation… */
export interface Artefact {
  id: string;
  titre: string;
  url: string;
  description: string;
  projectId: string | null;
  ajouteLe: string;
  /** « claude » : venu de la synchronisation avec le compte ; « manuel » : ajouté à la main. */
  source?: "claude" | "manuel";
  /** Dernière modification de la page sur claude.ai, si connue. */
  misAJour?: string | null;
  /** Le titre a été changé dans l'app : la synchronisation ne l'écrase plus. */
  titrePerso?: boolean;
}

/* ─── Tâches et calendrier ─────────────────────────────────────── */

/** Une tâche, façon Rappels : à cocher, avec une échéance, une priorité et des notes. */
export interface Tache {
  id: string;
  titre: string;
  notes: string;
  /** L'id de sa catégorie (« perso », « clients »…), cf. Categorie. */
  liste: string;
  /** Jour d'échéance « 2026-10-22 », ou null. */
  date: string | null;
  /** Heure « 14:00 » : à cette heure, une notification. null = toute la journée. */
  heure: string | null;
  /** Dernier jour, pour un rappel sur plusieurs jours (« du 22 au 25 ») ; absent : un seul jour. */
  fin?: string | null;
  /** 0 aucune, 1 basse (!), 2 moyenne (!!), 3 haute (!!!). */
  priorite: 0 | 1 | 2 | 3;
  signalee: boolean;
  faite: boolean;
  faiteLe: string | null;
  projectId: string | null;
  creeLe: string;
  /** La notification est déjà partie. */
  notifiee: boolean;
}

/** Un événement du calendrier : un rendez-vous, une échéance, une réunion. */
export interface Evenement {
  id: string;
  titre: string;
  /** Jour « 2026-10-22 ». */
  date: string;
  /** « 10:00 » ; null = toute la journée. */
  debut: string | null;
  fin: string | null;
  notes: string;
  projectId: string | null;
  /** Notification envoyée (10 min avant le début). */
  notifie: boolean;
  /** Rendez-vous de toute l'équipe. Le Weekly codé en dur est en lecture seule ; celui du compte suit `modifiable`. */
  equipe?: boolean;
  /** Se répète chaque semaine. */
  repete?: boolean;
  /** Occurrence déjà développée par le compte : le planning ne la redéploie pas. Jamais écrit sur le disque. */
  occurrence?: boolean;
  /** Identifiant Convex. Absent : rendez-vous de cet ordinateur. */
  compteId?: string;
  /** Premier jour d'une répétition du compte. */
  origine?: string;
  /** Couleur de l'organisateur. */
  teinte?: RoleTeinte;
  organisateur?: string;
  organisateurNom?: string;
  /** Faux pour le Weekly et pour un participant qui n'organise pas. Absent : on peut modifier. */
  modifiable?: boolean;
  /** Participants du compte, organisateur compris. */
  participants?: string[];
}

/** Une catégorie de rappels : une colonne, avec sa couleur et son icône. */
export interface Categorie {
  id: string;
  nom: string;
  /** Une des teintes pastel des agents. */
  teinte: RoleTeinte;
  /** Une icône du set officiel. */
  icone: string;
}
