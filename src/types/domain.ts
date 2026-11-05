import type { AjoutFiche, MajAtelier } from "../../electron/atelier-agent";
import type { ResultatCas, TypeCas } from "../../electron/epreuve";

export type { AjoutFiche, BrouillonAgent, DemandesEpreuve, MajAtelier, RoutineProposee, VoisinAgent } from "../../electron/atelier-agent";

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
  /** Le fournisseur de ses nouvelles conversations et de ses fils (« codex ») ; absent : Claude. */
  fournisseur?: string;
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
  /** Dossier du projet sur le disque (de ce PC, ou du VPS si `lieu`). */
  folder: string;
  /** Le VPS où vit le projet (origine https) ; absent : ce PC. Ses conversations y tournent. */
  lieu?: string | null;
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
  /** Le VPS où tournent ses agents (origine https) ; absent : ce PC. Changer de lieu repart d'une session neuve. */
  lieu?: string | null;
  /** Les sessions laissées sur les autres machines (« pc » ou l'origine du VPS), reprises quand la conversation y revient. */
  sessionsParLieu?: Record<string, Record<RoleId, string>>;
  /** Le moteur des agents de cette conversation (« codex » pour ChatGPT) ; absent : Claude Code. Sur un VPS : toujours Claude Code. */
  fournisseur?: string | null;
  /** Les sessions laissées dans les autres moteurs, reprises quand la conversation y revient (cf. lib/fournisseurs.ts). */
  sessionsParMoteur?: Record<string, Record<RoleId, string>>;
  /** Ce que relit chaque appel, par agent : jetons, socle de la session, date et session de la dernière mesure (cf. lib/contexte.ts). */
  contexte?: Record<RoleId, { jetons: number; base?: number; le: string; session: string | null }>;
  /** « Plus tard » sur le conseil de résumer : masqué tant que la conversation ne dépasse pas ce nombre de jetons. */
  contexteMasqueJusqua?: number;
  /** « Repartir à zéro » : les dates où la conversation a repris sans sa mémoire. Ce qui précède reste lisible, l'agent ne le relit plus (cf. lib/contexte.ts). */
  departs?: string[];
  /** Repartie à zéro ou effacée : sans session ici, l'agent en ouvre une neuve, un VPS ne reprend pas celle qu'il retient (cf. `sessionNeuve` des options). */
  sessionNeuve?: boolean;
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
  /** L'étape du ticket (src/lib/tickets.ts) ; « terminé », c'est `statut === "archive"`. */
  etape?: EtapeTicket;
  /** Pourquoi c'est bloqué, en une ligne. */
  raison?: string | null;
  /** L'étape a été posée exprès (outil mettre_a_jour_fil, tableau) depuis le début de la réponse : la fin ne la remplace pas. */
  etapePosee?: boolean;
  /** Comme un rappel : 0 aucune, 1 basse, 2 moyenne, 3 haute. */
  priorite?: 0 | 1 | 2 | 3;
  /** Jour « 2026-11-05 », ou null. */
  echeance?: string | null;
  /** Le projet concerné, pour filtrer. Pas `Chat.projectId` : le fil apparaîtrait dans les onglets des conversations du projet. */
  projetId?: string | null;
  /** Le rappel d'où vient ce fil (« Confier à un agent »). */
  rappel?: { source: "local" | "compte"; id: string } | null;
  /** Compte les demandes du téléphone appliquées : la copie du compte n'écrase pas un état plus récent. */
  revision?: number;
  /** Les dernières demandes du téléphone déjà appliquées : une reprise ne les rejoue pas. */
  demandes?: string[];
  /** Fermé (archivé) le : pour la colonne Terminé. Absent sur les fils fermés avant les tickets. */
  fermeLe?: string | null;
}

/** L'étape d'un fil vu comme un ticket. « En cours » vaut aussi tant qu'une réponse tourne. */
export type EtapeTicket = "a-faire" | "en-cours" | "bloque" | "a-valider";

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
  /** Ton message répond à un message d'agent (« Répondre ») : son extrait, au-dessus de ta bulle. */
  | ({ type: "citation" } & Citation)
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
  /**
   * L'atelier d'un agent (outil `proposer_agent`) : ce que cet appel a appris. La carte plie tous
   * les appels de la conversation (`src/lib/atelier-agent.ts`). `teinte` : la couleur choisie par la
   * personne sur la carte ; `cree` : l'id de l'agent créé depuis cette carte.
   */
  | {
      type: "atelier-agent";
      etapeId: string;
      maj: MajAtelier;
      teinte?: RoleTeinte;
      cree?: string;
      /** L'entrée encore en cours d'écriture par le modèle (carte qui s'écrit en direct). */
      provisoire?: boolean;
      /** L'épreuve passée sur cette carte (cf. electron/epreuve.ts). */
      resultats?: ResultatCas[];
      /** Les phrases que la personne a ajoutées à la fiche (corrections de l'épreuve). */
      ajouts?: AjoutFiche[];
      /**
       * Les essais de l'épreuve en train de tourner (lancés du bureau ou du téléphone), pour que les
       * deux le voient. Retirés au chargement : un essai coupé par la fermeture de l'app ne reprend pas.
       */
      essais?: TypeCas[];
    }
  /** Des réponses toutes prêtes sous la question de l'assistant (outil `proposer_choix`). */
  | { type: "choix"; etapeId: string; question: string; options: string[]; multiple: boolean }
  /**
   * Un agent demande un secret (outil `coffre_demander`) : la carte sécurisée où la personne le colle.
   * La valeur va droit au Coffre ; le message ne garde que ce qui est demandé et la réponse.
   */
  | {
      type: "coffre-demande";
      etapeId: string;
      variable: string;
      nom: string;
      genre: "cle-api" | "jeton" | "mot-de-passe" | "autre";
      service: string;
      raison: string;
      ouTrouver: string;
      reponse?: { etat: "rangee" | "permise" | "refusee"; le: string };
    }
  | { type: "tasks"; tasks: Task[] }
  | { type: "options"; options: DeliverableOption[] }
  | { type: "worklog"; durationMin: number; files: ChangedFile[] }
  | { type: "actions"; actions: MessageAction[] };

/** Le message d'agent auquel on répond : son id, son auteur et le début de son texte, sans Markdown. */
export interface Citation {
  messageId: string;
  roleId: RoleId;
  extrait: string;
}

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
  /** Rangée par le VPS, PC fermé : son texte seul. L'app la remplace si le journal rejoue la réponse complète. */
  ecritParServeur?: boolean;
  erreur?: string;
  /** L'exécution de routine (moteur du process principal) que ce message porte : la consigne, puis la réponse de l'agent. */
  routineRun?: string;
  /** Réponse d'agent : le moteur qui l'a écrite (« codex ») ; absent : Claude Code. */
  moteur?: string;
  /** Réponse à « /compact » : la conversation résumée, pas une réponse de l'agent (cf. aReprendre). */
  compaction?: boolean;
  /** Résumé lancé par l'app (configuration KLYRA) : avant un message, ou pendant une pause. Sans notification. */
  compactionAuto?: "envoi" | "pause";
  /** Tes réactions à une réponse d'agent (émojis), pour le plaisir : rien n'est envoyé à l'agent. */
  reactions?: string[];
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

/** Ce que montre un rendu : sa vignette et la façon de l'ouvrir en dépendent. */
export type TypeRendu = "page" | "image" | "video" | "pdf" | "document";

/**
 * Un rendu d'agent : un fichier qu'il a produit et publié pour la personne (outil `publier_artefact`),
 * sur ce PC. Le fichier reste où l'agent l'a mis ; retirer le rendu de la liste ne l'efface pas.
 */
export interface Rendu {
  id: string;
  /**
   * La copie gardée par l'app (`~/.klyra/rendus/<agent>/…`) sur ce PC.
   * Vide quand le fichier reste sur le VPS (`distantId`) : rien n'est copié d'un espace à l'autre.
   */
  chemin: string;
  /** Le fichier publié par l'agent, là où il l'a mis. Sur un VPS : `https://hôte#/chemin`. */
  origine: string;
  /** Publication sur le VPS. Le fichier est servi depuis le serveur, pas depuis ce PC. */
  distantId?: string;
  /** Dossier d'une page (index.html) sur le VPS. */
  dossier?: boolean;
  /** Octets de la copie. */
  taille: number;
  titre: string;
  description: string;
  type: TypeRendu;
  /** L'agent qui l'a publié. */
  roleId: RoleId;
  chatId: string | null;
  projectId: string | null;
  ajouteLe: string;
  /** Dernière publication du même fichier. */
  misAJour: string;
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
