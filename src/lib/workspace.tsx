"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from "react";
import { PRINCIPAL } from "@/data/agents";
import { Bouton } from "@/components/ui/Bouton";
import { createMockWorkspace, type MockWorkspace } from "@/data/mock";
import { AgentsProvider, useAgents } from "@/lib/agents";
import { getBridge, type Acces, type AgentEvent } from "@/lib/bridge";
import { evenementsEquipeEntre } from "@/lib/agenda-equipe";
import { identiteAffichee, type Identite, type ProfilCompte } from "@/lib/identite";
import { libelleEtape } from "@/lib/etapes";
import { planningPourAgents } from "@/lib/planning-agents";
import { prochainPassage } from "@/lib/planning";
import { lireProposition } from "@/lib/proposition-agent";
import { reglagesActuels } from "@/lib/reglages";
import { useLivraisonRoutines } from "@/lib/routines-livraison";
import { useRoutines } from "@/lib/routines";
import { marquerRappelNotifie, restaurerRappels, supprimerRappel, type RappelSupprime } from "@/lib/suppression-rappels";
import { jouer, notificationSonore } from "@/lib/sons/sons";
import { avecEpingle, basculerEpingle, trierConversations } from "@/lib/epinglage";
import { executer, type Outils, type Resultat } from "@/lib/workflows/moteur";
import type { ExecutionWorkflow, SourceExecution, VersionWorkflow, Workflow } from "@/types/workflows";
import type {
  Artefact,
  Chat,
  Etape,
  Message,
  MessagePart,
  Project,
  Role,
  RelaisRoutine,
  RoleId,
  Routine,
  Tache,
  TacheAgent,
  Evenement,
  Categorie,
  User,
} from "@/types/domain";

/** Les catégories de rappels à la première ouverture. */
const CATEGORIES_DE_DEPART: Categorie[] = [
  { id: "perso", nom: "Perso", teinte: "violet", icone: "home-01" },
  { id: "clients", nom: "Clients", teinte: "bleu-k2", icone: "users-profiles-01" },
  { id: "ecole", nom: "École", teinte: "jaune", icone: "file-01" },
];

/** Les catégories enregistrées. Les anciennes « listes » (de simples noms) laissent place aux catégories de départ ;
 *  un rappel dont la catégorie n'existe plus s'affiche dans la première. */
function lireCategories(brut: unknown): Categorie[] | null {
  if (!Array.isArray(brut) || !brut.length || typeof brut[0] === "string") return null;
  return brut as Categorie[];
}

/** Les artefacts déjà connus à la première ouverture : le design system KLYRA. */
const ARTEFACTS_DE_DEPART: Artefact[] = [
  {
    id: "design-system-klyra",
    titre: "Design system KLYRA",
    url: "https://claude.ai/artifact/C3Tqnor89ed3qjk6n1Wben",
    description: "La référence visuelle : tokens, composants, icônes, logos. Le site en ligne et ce design system font foi.",
    projectId: null,
    ajouteLe: "2026-10-07T12:00:00.000Z",
  },
];

/**
 * État de l'espace de travail : projets, conversations, messages.
 * Dans l'app de bureau, les agents répondent pour de vrai (Claude Code, cf.
 * electron/claude.ts) et les conversations sont gardées sur le disque. Dans
 * un navigateur, l'app montre des conversations d'exemple et simule les
 * réponses.
 */

/** Un agent au travail dans une conversation. */
export interface Travail {
  roleId: RoleId;
  messageId: string;
  debut: number;
  /** Tokens écrits depuis le début, estimés en direct : la preuve que l'agent avance. */
  jetons?: number;
}

/** Un message envoyé pendant que l'agent travaille : il part dès qu'il a fini. */
export interface EnAttente {
  id: string;
  text: string;
  to: RoleId | null;
  fichiers: string[];
  /** Une exécution de routine qui attend son tour (cf. `useLivraisonRoutines`). */
  routineRun?: string;
}

interface WorkspaceState extends MockWorkspace {
  /** Faux tant que les conversations ne sont pas lues sur le disque. */
  charge: boolean;
  travail: Record<string, Travail>;
  file: Record<string, EnAttente[]>;
  routines: Routine[];
  artefacts: Artefact[];
  /** Ce que les agents peuvent faire sans demander (réglage de ce poste). */
  acces: Acces;
  taches: Tache[];
  /** Annulation temporaire, jamais écrite sur le disque. */
  rappelsSupprimes: RappelSupprime[];
  evenements: Evenement[];
  /** Les catégories de rappels, dans l'ordre des colonnes. */
  categories: Categorie[];
  workflows: Workflow[];
  /** Les exécutions des workflows, les plus récentes d'abord. */
  executions: ExecutionWorkflow[];
  /** Le profil du compte d'équipe connecté (cf. `src/lib/identite.ts`). En mémoire seulement : jamais écrit sur le disque. */
  profilCompte: ProfilCompte | null;
}

/** Liste explicite : les états transitoires (dont Annuler) ne quittent jamais la mémoire. */
function conversationsAEnregistrer(etat: WorkspaceState) {
  return {
    version: VERSION_STOCKAGE, chats: etat.chats, messages: etat.messages,
    routines: etat.routines, artefacts: etat.artefacts, projects: etat.projects,
    currentUser: etat.currentUser, acces: etat.acces, taches: etat.taches,
    evenements: etat.evenements, categories: etat.categories,
    workflows: etat.workflows, executions: etat.executions,
  };
}

type WorkspaceAction =
  | {
      type: "charger";
      chats: Chat[];
      messages: Message[];
      routines: Routine[];
      artefacts: Artefact[];
      projects: Project[];
      currentUser: User | null;
      acces: Acces | null;
      taches: Tache[];
      evenements: Evenement[];
      categories: Categorie[] | null;
      workflows: Workflow[];
      executions: ExecutionWorkflow[];
    }
  | { type: "tache/enregistrer"; tache: Tache }
  | { type: "tache/supprimer"; id: string }
  | { type: "tache/restaurer" }
  | { type: "tache/oublierSuppressions" }
  | { type: "tache/notifiee"; id: string }
  | { type: "evenement/enregistrer"; evenement: Evenement }
  | { type: "evenement/supprimer"; id: string }
  | { type: "categories/changer"; categories: Categorie[] }
  | { type: "acces/choisir"; acces: Acces }
  | { type: "projet/enregistrer"; project: Project }
  | { type: "projet/supprimer"; id: string }
  | { type: "profil/enregistrer"; user: User }
  | { type: "profil/modifier"; patch: Partial<User> }
  | { type: "compte/profil"; profil: ProfilCompte | null }
  | { type: "routine/enregistrer"; routine: Routine }
  | { type: "routine/supprimer"; id: string }
  | { type: "artefact/ajouter"; artefact: Artefact }
  | { type: "artefact/supprimer"; id: string }
  | { type: "artefact/modifier"; id: string; patch: Partial<Artefact> }
  | { type: "artefact/synchroniser"; liste: { titre: string; url: string; misAJour: string | null }[] }
  | { type: "chat/add"; chat: Chat }
  | { type: "chat/update"; id: string; patch: (chat: Chat) => Chat }
  | { type: "chat/vider"; id: string }
  | { type: "message/add"; message: Message }
  | { type: "message/update"; id: string; patch: (message: Message) => Message }
  | { type: "travail/debut"; chatId: string; travail: Travail }
  | { type: "travail/fin"; chatId: string; messageId?: string }
  | { type: "travail/jetons"; chatId: string; total: number }
  | { type: "file/ajouter"; chatId: string; message: EnAttente }
  | { type: "file/retirer"; chatId: string; id: string }
  | { type: "workflow/enregistrer"; workflow: Workflow }
  | { type: "workflow/supprimer"; id: string }
  | { type: "execution/enregistrer"; execution: ExecutionWorkflow };

/** Les exécutions gardées par workflow. */
const EXECUTIONS_GARDEES = 30;

function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "charger":
      return {
        ...state,
        chats: action.chats,
        messages: action.messages,
        routines: action.routines,
        artefacts: action.artefacts,
        projects: action.projects,
        currentUser: action.currentUser ?? state.currentUser,
        acces: action.acces ?? state.acces,
        taches: action.taches,
        evenements: action.evenements,
        categories: action.categories ?? state.categories,
        workflows: action.workflows,
        executions: action.executions,
        charge: true,
      };
    case "workflow/enregistrer": {
      const existe = state.workflows.some((w) => w.id === action.workflow.id);
      return {
        ...state,
        workflows: existe
          ? state.workflows.map((w) => (w.id === action.workflow.id ? action.workflow : w))
          : [...state.workflows, action.workflow],
      };
    }
    case "workflow/supprimer":
      return {
        ...state,
        workflows: state.workflows.filter((w) => w.id !== action.id),
        executions: state.executions.filter((e) => e.workflowId !== action.id),
      };
    case "execution/enregistrer": {
      const e = action.execution;
      const autres = state.executions.filter((x) => x.id !== e.id);
      const memes = autres.filter((x) => x.workflowId === e.workflowId).slice(0, EXECUTIONS_GARDEES - 1);
      return {
        ...state,
        executions: [e, ...autres.filter((x) => x.workflowId !== e.workflowId), ...memes].sort((a, b) =>
          b.debut.localeCompare(a.debut),
        ),
      };
    }
    case "tache/enregistrer": {
      const existe = state.taches.some((t) => t.id === action.tache.id);
      return {
        ...state,
        taches: existe ? state.taches.map((t) => (t.id === action.tache.id ? action.tache : t)) : [...state.taches, action.tache],
      };
    }
    case "tache/supprimer":
      return supprimerRappel(state, action.id);
    case "tache/restaurer":
      return restaurerRappels(state);
    case "tache/oublierSuppressions":
      return { ...state, rappelsSupprimes: [] };
    case "tache/notifiee":
      return marquerRappelNotifie(state, action.id);
    case "evenement/enregistrer": {
      const existe = state.evenements.some((e) => e.id === action.evenement.id);
      return {
        ...state,
        evenements: existe
          ? state.evenements.map((e) => (e.id === action.evenement.id ? action.evenement : e))
          : [...state.evenements, action.evenement],
      };
    }
    case "evenement/supprimer":
      return { ...state, evenements: state.evenements.filter((e) => e.id !== action.id) };
    case "categories/changer":
      return { ...state, categories: action.categories };
    case "acces/choisir":
      return { ...state, acces: action.acces };
    case "projet/enregistrer": {
      const existe = state.projects.some((p) => p.id === action.project.id);
      return {
        ...state,
        projects: existe
          ? state.projects.map((p) => (p.id === action.project.id ? action.project : p))
          : [...state.projects, action.project],
      };
    }
    case "projet/supprimer":
      return { ...state, projects: state.projects.filter((p) => p.id !== action.id) };
    case "profil/enregistrer":
      return { ...state, currentUser: action.user };
    case "profil/modifier":
      return { ...state, currentUser: { ...state.currentUser, ...action.patch } };
    case "compte/profil":
      return { ...state, profilCompte: action.profil };
    case "routine/enregistrer": {
      const existe = state.routines.some((r) => r.id === action.routine.id);
      return {
        ...state,
        routines: existe
          ? state.routines.map((r) => (r.id === action.routine.id ? action.routine : r))
          : [...state.routines, action.routine],
      };
    }
    case "routine/supprimer":
      return { ...state, routines: state.routines.filter((r) => r.id !== action.id) };
    case "artefact/ajouter":
      return { ...state, artefacts: [action.artefact, ...state.artefacts] };
    case "artefact/supprimer":
      return { ...state, artefacts: state.artefacts.filter((a) => a.id !== action.id) };
    case "artefact/modifier":
      return { ...state, artefacts: state.artefacts.map((a) => (a.id === action.id ? { ...a, ...action.patch } : a)) };
    case "artefact/synchroniser": {
      // Par lien : on met à jour ceux qu'on a déjà (sans écraser un titre changé dans l'app), on ajoute les nouveaux.
      const cle = (url: string) => url.replace(/\/$/, "");
      const parUrl = new Map(state.artefacts.map((a) => [cle(a.url), a]));
      const maintenant = new Date().toISOString();
      const nouveaux: Artefact[] = [];
      for (const x of action.liste) {
        const avant = parUrl.get(cle(x.url));
        if (avant) {
          parUrl.set(cle(x.url), {
            ...avant,
            titre: avant.titrePerso ? avant.titre : x.titre,
            misAJour: x.misAJour ?? avant.misAJour ?? null,
            source: avant.source ?? "claude",
          });
        } else {
          nouveaux.push({
            id: crypto.randomUUID(),
            titre: x.titre,
            url: x.url,
            description: "",
            projectId: null,
            ajouteLe: maintenant,
            source: "claude",
            misAJour: x.misAJour,
          });
        }
      }
      return { ...state, artefacts: [...nouveaux, ...state.artefacts.map((a) => parUrl.get(cle(a.url)) ?? a)] };
    }
    case "chat/add":
      if (state.chats.some((c) => c.id === action.chat.id)) return state;
      return { ...state, chats: [action.chat, ...state.chats] };
    case "chat/update":
      return {
        ...state,
        chats: state.chats.map((c) => (c.id === action.id ? action.patch(c) : c)),
      };
    case "message/add": {
      const { message } = action;
      return {
        ...state,
        messages: [...(message.routineRun ? state.messages.filter((m) => m.id !== message.id) : state.messages), message],
        chats: state.chats.map((chat) =>
          chat.id === message.chatId ? { ...chat, updatedAt: message.createdAt } : chat,
        ),
      };
    }
    case "chat/vider":
      return {
        ...state,
        messages: state.messages.filter((m) => m.chatId !== action.id),
        chats: state.chats.map((c) => (c.id === action.id ? { ...c, sessions: {}, taches: [], luJusqua: null } : c)),
      };
    case "message/update":
      return {
        ...state,
        messages: state.messages.map((m) => (m.id === action.id ? action.patch(m) : m)),
      };
    case "travail/debut":
      return {
        ...state,
        travail: { ...state.travail, [action.chatId]: action.travail },
      };
    case "travail/jetons": {
      const t = state.travail[action.chatId];
      if (!t) return state;
      return { ...state, travail: { ...state.travail, [action.chatId]: { ...t, jetons: action.total } } };
    }
    case "travail/fin": {
      if (action.messageId && state.travail[action.chatId]?.messageId !== action.messageId) return state;
      const travail = { ...state.travail };
      delete travail[action.chatId];
      return { ...state, travail };
    }
    case "file/ajouter":
      return {
        ...state,
        file: {
          ...state.file,
          [action.chatId]: [...(state.file[action.chatId] ?? []), action.message],
        },
      };
    case "file/retirer":
      return {
        ...state,
        file: {
          ...state.file,
          [action.chatId]: (state.file[action.chatId] ?? []).filter((m) => m.id !== action.id),
        },
      };
  }
}

/* ─── Construction des messages d'un agent ─────────────────────── */

/** Ajoute un morceau de texte à la réponse : à la suite du dernier texte, ou dans un nouveau bloc. */
function ajouterTexte(parts: MessagePart[], delta: string, nouveauBloc: boolean): MessagePart[] {
  const dernier = parts[parts.length - 1];
  if (dernier?.type === "text" && !nouveauBloc) {
    return [...parts.slice(0, -1), { type: "text", text: dernier.text + delta }];
  }
  return [...parts, { type: "text", text: delta }];
}

/** Outils par lesquels un agent confie une partie du travail à un collègue. */
const OUTILS_PASSATION = new Set(["Agent", "Task"]);

function ajouterEtape(
  parts: MessagePart[],
  etape: Etape,
  roles: Role[],
  entree: Record<string, unknown>,
): MessagePart[] {
  const sousAgent = typeof entree.subagent_type === "string" ? entree.subagent_type : null;
  if (OUTILS_PASSATION.has(etape.outil) && sousAgent && roles.some((r) => r.id === sousAgent)) {
    const consigne = typeof entree.description === "string" ? entree.description : "";
    return [
      ...parts,
      {
        type: "passation",
        etapeId: etape.id,
        roleId: sousAgent,
        consigne,
        statut: "en-cours",
      },
    ];
  }
  // L'assistant propose un nouvel agent : une carte à ouvrir dans l'éditeur, après ses étapes.
  const proposition = etape.outil === "mcp__klyra__proposer_agent" ? lireProposition(entree) : null;
  if (proposition) return [...parts, { type: "proposition-agent", etapeId: etape.id, proposition }];
  // Toutes les étapes de la réponse vivent dans un seul bloc, en tête du message.
  const index = parts.findIndex((p) => p.type === "etapes");
  if (index === -1) return [{ type: "etapes", etapes: [etape] }, ...parts];
  return parts.map((p, i) => (i === index && p.type === "etapes" ? { ...p, etapes: [...p.etapes, etape] } : p));
}

function finirEtape(parts: MessagePart[], id: string, ok: boolean): MessagePart[] {
  const statut = ok ? "fait" : "erreur";
  // Une proposition d'agent refusée par l'app (identifiant déjà pris…) ne devient pas une carte.
  const gardees = ok ? parts : parts.filter((p) => !(p.type === "proposition-agent" && p.etapeId === id));
  return gardees.map((p) => {
    if (p.type === "passation" && p.etapeId === id) return { ...p, statut };
    if (p.type === "etapes")
      return {
        ...p,
        etapes: p.etapes.map((e) => (e.id === id ? { ...e, statut } : e)),
      };
    return p;
  });
}

/** La liste de tâches envoyée par l'outil TodoWrite. */
function lireTaches(entree: Record<string, unknown>): TacheAgent[] | null {
  if (!Array.isArray(entree.todos)) return null;
  return entree.todos
    .map((t: { content?: unknown; status?: unknown }) => ({
      texte: typeof t.content === "string" ? t.content : "",
      statut: t.status === "completed" ? "fait" : t.status === "in_progress" ? "en-cours" : "a-faire",
    }))
    .filter((t): t is TacheAgent => !!t.texte);
}

/** Le texte d'un message, pour le contexte donné à un agent et les aperçus. */
export function texteDe(message: Message): string {
  return message.parts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n")
    .trim();
}

/* Réponses simulées, dans un navigateur (sans l'app de bureau). */
const SIMULATED_REPLIES: Record<string, string> = {
  principal: "Bien reçu. Je regarde qui s’en occupe et je reviens vers toi ici.",
  dev: "Je m’en occupe. Je te montre le résultat sur l’aperçu dès que c’est prêt.",
  designer: "Ok, je te prépare la spec avec deux options et je la poste ici.",
  motion: "Je commence par le storyboard, je te le montre avant d’animer.",
  qa: "Envoie-moi le hash du commit et les points à vérifier, je contrôle.",
  commercial: "Je regarde la grille et je te prépare une proposition chiffrée.",
  stratege: "Je te fais un brief d’une page : cible, message, métrique.",
  growth: "J’écris l’expérience avant de lancer : hypothèse, seuil, budget.",
  redacteur: "Je te propose trois accroches, tu choisis, puis j’écris.",
  val: "Je trie et je te prépare le brouillon. Rien ne part sans ta validation.",
  "diego-discord-ops": "Je prépare le plan et un dry-run, je te montre avant d’appliquer.",
  prompty: "Je lis la doc du modèle et je te rends un prompt avec son critère de réussite.",
};

/** Préfixe des conversations directes : `dm-<agent>`. */
/** Les façons de refaire une réponse, depuis le menu sous le message. */
export type FaconReessai = "reessayer" | "details" | "concis" | "web";

export const DIRECT = "dm-";

export function idDirect(roleId: RoleId): string {
  return `${DIRECT}${roleId}`;
}

/** Les fils d'un agent : `klyra-fil-…`, l'identifiant qu'on cite. */
export const FIL = "klyra-fil-";

/** Une conversation avec un agent : son chat principal ou un de ses fils. */
export function estConversationAgent(id: string | null | undefined): boolean {
  return !!id && (id.startsWith(DIRECT) || id.startsWith(FIL));
}

/** Titre d'un fil tant qu'il n'a pas de premier message. */
export const FIL_SANS_TITRE = "Nouveau fil";

/** Titre d'un nouveau chat : le début du premier message. */
function chatTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 40).trimEnd()}…` : clean;
}

/**
 * Une notification du système qui prévient à coup sûr (rappel à son heure,
 * rendez-vous, accord attendu). Le son : celui du système si le réglage
 * « Son » est actif, sinon celui de KLYRA ; jamais les deux.
 */
function notifierRappel(titre: string, corps: string, encoreValide?: () => boolean) {
  void reglagesActuels().then(({ notifications: n }) => {
    if (encoreValide && !encoreValide()) return;
    const systeme = typeof Notification !== "undefined";
    if (systeme) new Notification(titre, { body: corps, silent: !n.son });
    if (!systeme || !n.son) jouer("notification");
  });
}

const VERSION_STOCKAGE = 1;

interface WorkspaceApi {
  state: WorkspaceState;
  /** Envoie un message ; sans destinataire, c'est le Principal (ou l'agent de la conversation directe) qui répond. */
  sendMessage: (chatId: string, text: string, to: RoleId | null, fichiers?: string[]) => void;
  /** Modèle et effort de la conversation (null : ceux de la fiche de l'agent). */
  choisirModele: (chatId: string, modele: string | null, effort: string | null) => void;
  /** Repart de zéro avec l'agent : les messages et sa mémoire de cette conversation sont effacés. */
  nouvelleConversation: (chatId: string) => void;
  /** Ouvre une conversation d'équipe dans un projet avec ce premier message ; renvoie son id. */
  startChat: (projectId: string, text: string, to: RoleId | null, fichiers?: string[]) => string;
  reessayer: (chatId: string, messageId: string, facon: FaconReessai, modele?: string) => void;
  brancher: (chatId: string, messageId: string) => string | null;
  /** Arrête l'agent qui travaille dans cette conversation. */
  arreter: (chatId: string) => void;
  /** Ouvre un fil (une tâche) dans le chat de l'agent ; renvoie son id. */
  creerFil: (roleId: RoleId, titre?: string, lancePar?: { roleId: RoleId; chatId: string } | null) => string;
  renommerChat: (chatId: string, titre: string) => void;
  epinglerChat: (chatId: string, epingler: boolean) => void;
  /** Ferme un fil : il s'arrête et part dans les archivés (« supprimé » : caché des archivés). Rien n'est effacé. */
  archiverFil: (chatId: string, supprime?: boolean) => void;
  rouvrirFil: (chatId: string) => void;
  retirerDeLaFile: (chatId: string, id: string) => void;
  marquerLu: (chatId: string) => void;
  /** Crée ou modifie une tâche planifiée. */
  enregistrerRoutine: (routine: Routine) => void;
  supprimerRoutine: (id: string) => void;
  /** Lance une tâche planifiée tout de suite, sans attendre son heure. */
  lancerRoutine: (id: string) => void;
  ajouterArtefact: (artefact: Omit<Artefact, "id" | "ajouteLe">) => void;
  modifierArtefact: (id: string, patch: Partial<Artefact>) => void;
  /** Lit les artefacts du compte Claude et met la liste à jour ; renvoie combien sont arrivés. */
  synchroniserArtefacts: () => Promise<{ total: number; nouveaux: number }>;
  /** Crée ou modifie un projet (le dossier reste où il est sur le disque). */
  enregistrerProjet: (project: Project) => void;
  /** Retire un projet de l'app ; son dossier et ses conversations restent. */
  retirerProjet: (id: string) => void;
  enregistrerProfil: (user: User) => void;
  /** Change une partie du profil de cet ordinateur ; le reste (photo…) ne bouge pas. */
  modifierProfil: (patch: Partial<User>) => void;
  /** Le compte d'équipe connecté (ou null) : posé par `CompteProvider`, gardé en mémoire seulement. */
  appliquerProfilCompte: (profil: ProfilCompte | null) => void;
  /** Qui tu es dans l'app, selon les règles de `src/lib/identite.ts`. */
  moi: Identite;
  choisirAcces: (acces: Acces) => void;
  enregistrerTache: (tache: Tache) => void;
  supprimerTache: (id: string) => void;
  restaurerTaches: () => RappelSupprime[];
  oublierSuppressions: () => void;
  enregistrerEvenement: (evenement: Evenement) => void;
  supprimerEvenement: (id: string) => void;
  changerCategories: (categories: Categorie[]) => void;
  /** Ta réponse à une demande d'autorisation d'un agent. */
  repondreAutorisation: (messageId: string, demandeId: string, decision: "oui" | "toujours" | "non") => void;
  supprimerArtefact: (id: string) => void;
  /** Crée ou modifie un workflow ; une version auto est gardée toutes les 5 min d'édition. */
  enregistrerWorkflow: (workflow: Workflow) => void;
  supprimerWorkflow: (id: string) => void;
  /** Lance un workflow (depuis un déclencheur, ou tout), ou une seule étape ; renvoie l'id de l'exécution. */
  lancerWorkflow: (
    id: string,
    options?: { declencheurId?: string | null; source?: SourceExecution; charge?: string; seule?: string },
  ) => string | null;
  arreterExecution: (id: string) => void;
  /** Ta décision sur une étape d'approbation. */
  deciderApprobation: (etapeId: string, approuver: boolean) => void;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

function WorkspaceStore({ children }: { children: ReactNode }) {
  const bridge = getBridge();
  const [erreurChargement, setErreurChargement] = useState<string | null>(null);
  const { routines: routinesLocales, actif: moteurRoutines } = useRoutines();
  const { roles, status: statutAgents } = useAgents();
  const [state, dispatch] = useReducer(reducer, undefined, (): WorkspaceState => {
    const mock = createMockWorkspace();
    // App de bureau : de vraies conversations, lues sur le disque juste après.
    return bridge
      ? {
          ...mock,
          chats: [],
          messages: [],
          // Les projets et le profil de chacun sont sur son poste, lus juste après.
          projects: [],
          currentUser: { id: "moi", name: "", title: "", initial: "" },
          charge: false,
          travail: {},
          file: {},
          routines: [],
          artefacts: [],
          acces: "projet",
          taches: [],
          rappelsSupprimes: [],
          evenements: [],
          categories: CATEGORIES_DE_DEPART,
          workflows: [],
          executions: [],
          profilCompte: null,
        }
      : {
          ...mock,
          charge: true,
          travail: {},
          file: {},
          routines: [],
          artefacts: ARTEFACTS_DE_DEPART,
          acces: "projet",
          taches: [],
          rappelsSupprimes: [],
          evenements: [],
          categories: CATEGORIES_DE_DEPART,
          workflows: [],
          executions: [],
          profilCompte: null,
        };
  });

  /** Qui tu es : le compte d'équipe connecté, sinon le profil de cet ordinateur. */
  const moi = useMemo(() => identiteAffichee(state.currentUser, state.profilCompte), [state.currentUser, state.profilCompte]);

  /* Les fonctions ci-dessous lisent toujours l'état le plus récent. */
  const stateRef = useRef(state);
  const ecritureRegroupee = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rolesRef = useRef(roles);
  useEffect(() => {
    stateRef.current = state;
    rolesRef.current = roles;
  });
  const ecouteurs = useRef(new Map<string, (event: AgentEvent) => void>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const notifiesEquipe = useRef(new Set<string>());

  /* Lecture des conversations gardées sur le disque. */
  useEffect(() => {
    if (!bridge) return;
    let actif = true;
    void bridge.conversations.read().then((reponse) => {
      if (!actif) return;
      if (!reponse.ok) { setErreurChargement(reponse.message); return; }
      const data = reponse.ok
        ? (reponse.data as {
            version?: number;
            chats?: Chat[];
            messages?: Message[];
            routines?: Routine[];
            artefacts?: Artefact[];
            projects?: Project[];
            currentUser?: User;
            acces?: Acces;
            taches?: Tache[];
            evenements?: Evenement[];
            listes?: string[];
            categories?: Categorie[];
            workflows?: Workflow[];
            executions?: ExecutionWorkflow[];
          } | null)
        : null;
      const valide = data?.version === VERSION_STOCKAGE;
      if (data !== null && !valide) { setErreurChargement("Le format des conversations n’est pas reconnu. Les données existantes sont conservées."); return; }
      const messages = (valide ? (data.messages ?? []) : []).map((m) =>
        // Une réponse coupée par la fermeture de l'app ne reprendra pas.
        m.statut === "en-cours"
          ? {
              ...m,
              statut: "erreur" as const,
              erreur: "Interrompu : l’app a été fermée.",
            }
          : m,
      );
      dispatch({
        type: "charger",
        chats: valide ? (data.chats ?? []) : [],
        messages,
        routines: valide ? (data.routines ?? []) : [],
        artefacts: valide && data.artefacts ? data.artefacts : ARTEFACTS_DE_DEPART,
        projects: valide ? (data.projects ?? []) : [],
        currentUser: valide ? (data.currentUser ?? null) : null,
        acces: valide ? (data.acces ?? null) : null,
        taches: valide ? (data.taches ?? []) : [],
        evenements: valide ? (data.evenements ?? []) : [],
        categories: valide ? lireCategories(data.categories ?? data.listes) : null,
        workflows: valide ? (data.workflows ?? []) : [],
        // Une exécution coupée par la fermeture de l'app ne reprendra pas.
        executions: (valide ? (data.executions ?? []) : []).map((e) =>
          e.statut === "en-cours" || e.statut === "approbation"
            ? {
                ...e,
                statut: "arrete" as const,
                erreur: "Interrompue : l’app a été fermée.",
                etapes: e.etapes.map((x) =>
                  x.statut === "en-cours" || x.statut === "approbation" ? { ...x, statut: "arrete" as const } : x,
                ),
              }
            : e,
        ),
      });
    }).catch((error: unknown) => { if (actif) setErreurChargement(error instanceof Error ? error.message : String(error)); });
    return () => {
      actif = false;
    };
  }, [bridge]);

  /* Écriture sur le disque, regroupée, à chaque changement. */
  useEffect(() => {
    if (!bridge || !state.charge) return;
    const timer = setTimeout(() => {
      void bridge.conversations.write(conversationsAEnregistrer(stateRef.current));
    }, 400);
    ecritureRegroupee.current = timer;
    return () => clearTimeout(timer);
  }, [bridge, state.charge, state.chats, state.messages, state.routines, state.artefacts, state.projects, state.currentUser, state.acces, state.taches, state.evenements, state.categories, state.workflows, state.executions]);

  /* Le planning, en clair pour les agents (~/.klyra/planning/planning.md), à chaque changement. */
  useEffect(() => {
    const ecrire = bridge?.planning?.ecrire;
    if (!ecrire || !state.charge) return;
    const timer = setTimeout(() => {
      void ecrire(
        planningPourAgents({
          evenements: state.evenements,
          taches: state.taches,
          categories: state.categories,
          routines: routinesLocales,
          projects: state.projects,
          roles,
          chats: state.chats,
          artefacts: state.artefacts,
          workflows: state.workflows,
          personne: moi.name,
        }),
      );
    }, 1000);
    return () => clearTimeout(timer);
  }, [bridge, state.charge, state.evenements, state.taches, state.categories, routinesLocales, state.projects, roles, state.chats, state.artefacts, state.workflows, moi.name]);

  /* Fermeture de l'app : le dernier état part tout de suite, sans attendre le regroupement. */
  useEffect(() => {
    if (!bridge) return;
    return bridge.conversations.avantFermeture(() => {
      const etat = stateRef.current;
      if (!etat.charge) return;
      void bridge.conversations.write(conversationsAEnregistrer(etat));
    });
  }, [bridge]);

  /* Un seul abonnement aux événements des agents, distribués par demande. */
  useEffect(() => {
    if (!bridge) return;
    return bridge.claude.onEvent((requestId, event) => ecouteurs.current.get(requestId)?.(event));
  }, [bridge]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  /** Ce que l'agent reçoit : le contexte au premier message, puis ce qui s'est dit depuis sa dernière réponse. */
  const construirePrompt = useCallback((chat: Chat, roleId: RoleId, messageUtilisateur: Message): string => {
    const { messages, projects } = stateRef.current;
    const personne = identiteAffichee(stateRef.current.currentUser, stateRef.current.profilCompte);
    const allRoles = rolesRef.current;
    const nom = (id: RoleId) => allRoles.find((r) => r.id === id)?.name ?? id;
    const fil = messages.filter((m) => m.chatId === chat.id && m.id !== messageUtilisateur.id);
    const derniere = fil.findLastIndex((m) => m.author.kind === "role" && m.author.roleId === roleId);
    const depuis = fil
      .slice(derniere + 1)
      .filter((m) => m.statut !== "en-cours")
      .map((m) => {
        const texte = texteDe(m);
        if (!texte) return null;
        const auteur = m.author.kind === "user" ? personne.name : nom(m.author.roleId);
        return `${auteur} : ${texte}`;
      })
      .filter(Boolean);

    const lignes: string[] = [];
    if (!chat.sessions[roleId]) {
      const project = projects.find((p) => p.id === chat.projectId);
      lignes.push(
        `[Contexte] Tu échanges avec ${personne.name} (${personne.title}) dans l’app de bureau KLYRA, comme dans une messagerie : réponds en français, court et direct, en Markdown simple.`,
      );
      if (chat.kind === "equipe" && project) {
        const autres = chat.roleIds.filter((id) => id !== roleId).map(nom);
        lignes.push(
          `Conversation d’équipe « ${chat.title} » du projet ${project.name} (${project.subtitle}). Tu travailles dans le dossier du projet : ${project.folder}. Si tu lances le serveur de dev, lance-le en arrière-plan et écris son adresse (par exemple localhost:3000) dans ta réponse : l’app l’ouvre dans l’aperçu.` +
            (autres.length ? ` Sont aussi dans la conversation : ${autres.join(", ")}.` : ""),
        );
      } else if (chat.fil) {
        const par = chat.fil.lancePar ? nom(chat.fil.lancePar.roleId) : personne.name;
        lignes.push(
          `Tu travailles dans un fil, une tâche à part : « ${chat.title} » (${chat.id}), ouvert par ${par}. Ce fil ne voit pas les autres conversations : tout ce qu’il faut est dans le brief. Quand tu as fini, termine par le résultat, clairement${chat.fil.lancePar ? ` : ta réponse revient à ${par}` : ""}.`,
        );
      } else {
        lignes.push("Conversation en tête-à-tête, hors projet.");
      }
      if (chat.amorce) lignes.push(`[Conversation reprise jusqu’ici]\n${chat.amorce}`);
    }
    if (depuis.length) lignes.push(`[Depuis ta dernière réponse]\n${depuis.join("\n\n")}`);
    // Le retour d'un fil arrive au nom de l'agent qui l'a fait, pas de la personne.
    const de = messageUtilisateur.author.kind === "role" ? `Retour du fil, de ${nom(messageUtilisateur.author.roleId)}` : `Message de ${personne.name}`;
    lignes.push(`${lignes.length || messageUtilisateur.author.kind === "role" ? `[${de}]\n` : ""}${texteDe(messageUtilisateur)}`);
    const joints = messageUtilisateur.parts.find((p) => p.type === "fichiers");
    if (joints?.type === "fichiers" && joints.chemins.length) {
      lignes.push(`[Fichiers joints, à lire]\n${joints.chemins.map((c) => `- ${c}`).join("\n")}`);
    }
    return lignes.join("\n\n");
  }, []);

  /** `lancer`, pour ce qui est déclaré avant lui (retours des fils). */
  const lancerTot = useRef<(chatId: string, roleId: RoleId, message: Message) => void>(() => {});
  const envoyerRef = useRef<
    (chatId: string, text: string, to: RoleId | null, fichiers: string[], horsFile?: boolean, routineRun?: string) => void
  >(() => {});

  /** La suite de la file d'attente, quand l'agent a fini. */
  const suivant = useCallback((chatId: string) => {
    // Un fil a rapporté pendant que l'agent travaillait : son retour passe en premier.
    const retour = retours.current.get(chatId)?.shift();
    if (retour) {
      timers.current.push(setTimeout(() => lancerTot.current(chatId, retour.roleId, retour.message), 0));
      return;
    }
    const prochain = stateRef.current.file[chatId]?.[0];
    if (!prochain) return;
    dispatch({ type: "file/retirer", chatId, id: prochain.id });
    // L'état « travail » est libéré au rendu suivant : le message part juste après.
    timers.current.push(
      setTimeout(() => envoyerRef.current(chatId, prochain.text, prochain.to, prochain.fichiers, true, prochain.routineRun), 0),
    );
  }, []);

  /** Suit une réponse d'agent au fil de l'eau, jusqu'à sa fin. */
  /** Les retours de fils en attente, par conversation de l'agent qui les a lancés. */
  const retours = useRef(new Map<string, { roleId: RoleId; message: Message }[]>());

  /* Un fil lancé par un agent a répondu : sa réponse revient à cet agent, dans sa conversation. */
  const rapporterFil = (chatId: string, messageId: string, ok: boolean) => {
    const { chats, messages, travail } = stateRef.current;
    const fil = chats.find((c) => c.id === chatId);
    const lancePar = fil?.fil?.lancePar;
    if (!fil?.fil?.retourAttendu || !lancePar || !chats.some((c) => c.id === lancePar.chatId)) return;
    dispatch({ type: "chat/update", id: chatId, patch: (c) => (c.fil ? { ...c, fil: { ...c.fil, retourAttendu: false } } : c) });
    const reponse = messages.find((m) => m.id === messageId);
    const nom = rolesRef.current.find((r) => r.id === fil.fil!.roleId)?.name ?? fil.fil.roleId;
    const corps = reponse ? texteDe(reponse) : "";
    const message: Message = {
      id: crypto.randomUUID(),
      chatId: lancePar.chatId,
      author: { kind: "role", roleId: fil.fil.roleId },
      createdAt: new Date().toISOString(),
      parts: [
        {
          type: "text",
          text: `**${ok ? "Fil terminé" : "Fil arrêté sur une erreur"} : ${fil.title}** (${fil.id}) · ${nom}\n\n${corps || reponse?.erreur || "Pas de texte dans la réponse."}`,
        },
      ],
    };
    dispatch({ type: "message/add", message });
    if (travail[lancePar.chatId]) {
      // L'agent qui a lancé le fil travaille encore : le retour attend son tour.
      retours.current.set(lancePar.chatId, [...(retours.current.get(lancePar.chatId) ?? []), { roleId: lancePar.roleId, message }]);
      return;
    }
    timers.current.push(setTimeout(() => lancerTot.current(lancePar.chatId, lancePar.roleId, message), 0));
  };

  /* Une réponse finie là où tu ne regardes pas (autre conversation, autre app) : le Mac te prévient.
     Renvoie vrai si une notification est demandée. */
  const prevenir = (chatId: string, roleId: RoleId, messageId: string, ok: boolean): boolean => {
    const notifier = getBridge()?.systeme.notifier;
    if (!notifier) return false;
    const ouverte = location.pathname === "/chat" && new URLSearchParams(location.search).get("id") === chatId;
    if (ouverte && document.hasFocus()) return false;
    const nom = rolesRef.current.find((r) => r.id === roleId)?.name ?? "L’agent";
    const message = stateRef.current.messages.find((m) => m.id === messageId);
    const extrait = message ? texteDe(message).replace(/[*`#>_]/g, "").replace(/\s+/g, " ").trim() : "";
    void notifier(
      ok ? `${nom} a fini` : `${nom} s’est arrêté sur une erreur`,
      extrait || (ok ? "Sa réponse t’attend." : (message?.erreur ?? "")),
      chatId,
      ok ? "agentFini" : "agentErreur",
    );
    return true;
  };

  const suivreReponse = useCallback(
    (chatId: string, roleId: RoleId, messageId: string) => {
      const maj = (patch: (m: Message) => Message) => dispatch({ type: "message/update", id: messageId, patch });
      const terminer = () => {
        ecouteurs.current.delete(messageId);
        // Une réponse spontanée peut finir pendant qu'une autre est en cours : seule la sienne libère la conversation.
        const etaitLeTravail = stateRef.current.travail[chatId]?.messageId === messageId;
        dispatch({ type: "travail/fin", chatId, messageId });
        if (etaitLeTravail) suivant(chatId);
      };

    ecouteurs.current.set(messageId, (event) => {
      switch (event.type) {
        case "session":
          dispatch({
            type: "chat/update",
            id: chatId,
            patch: (c) => ({
              ...c,
              sessions: { ...c.sessions, [roleId]: event.sessionId },
            }),
          });
          break;
        case "texte":
          maj((m) => ({
            ...m,
            parts: ajouterTexte(m.parts, event.delta, event.nouveauBloc),
          }));
          break;
        case "etape": {
          const chemin = event.entree.file_path ?? event.entree.notebook_path;
          const etape: Etape = {
            id: event.id,
            outil: event.outil,
            libelle: libelleEtape(event.outil, event.entree, rolesRef.current),
            statut: "en-cours",
            parent: event.parent,
            ...(typeof chemin === "string" ? { chemin } : {}),
          };
          const taches = event.outil === "TodoWrite" ? lireTaches(event.entree) : null;
          if (taches)
            dispatch({
              type: "chat/update",
              id: chatId,
              patch: (c) => ({ ...c, taches }),
            });
          maj((m) => ({
            ...m,
            parts: ajouterEtape(m.parts, etape, rolesRef.current, event.entree),
          }));
          break;
        }
        case "jetons":
          dispatch({ type: "travail/jetons", chatId, total: event.total });
          break;
        case "etape-fin":
          maj((m) => ({
            ...m,
            parts: finirEtape(m.parts, event.id, event.ok),
          }));
          break;
        case "autorisation": {
          const e = event.entree;
          const detail = [e.command, e.file_path, e.notebook_path, e.url, e.pattern].find((v) => typeof v === "string");
          maj((m) => ({
            ...m,
            parts: [
              ...m.parts,
              {
                type: "autorisation",
                id: event.id,
                outil: event.outil,
                libelle: libelleEtape(event.outil, event.entree, rolesRef.current),
                detail: typeof detail === "string" ? detail : "",
                description: event.description,
                statut: "attente",
              },
            ],
          }));
          break;
        }
        case "autorisation-fin":
          maj((m) => ({
            ...m,
            parts: m.parts.map((p) =>
              p.type === "autorisation" && p.id === event.id && p.statut === "attente"
                ? { ...p, statut: event.accepte ? "acceptee" : "refusee" }
                : p,
            ),
          }));
          break;
        case "fin":
          maj((m) => {
            const aDuTexte = m.parts.some((p) => p.type === "text" && p.text.trim());
            const parts = !aDuTexte && event.texte ? ajouterTexte(m.parts, event.texte, true) : m.parts;
            return event.ok
              ? { ...m, parts, statut: "fait" }
              : { ...m, parts, statut: "erreur", erreur: event.erreur };
          });
          if (event.sessionId) {
            const sessionId = event.sessionId;
            dispatch({
              type: "chat/update",
              id: chatId,
              patch: (c) => ({
                ...c,
                sessions: { ...c.sessions, [roleId]: sessionId },
              }),
            });
          }
          terminer();
          if (event.erreur !== "Arrêté par toi." && !event.silencieux) {
            const notifiee = prevenir(chatId, roleId, messageId, event.ok);
            // Le son de l'app, sauf si la notification du système sonne déjà.
            if (!(notifiee && notificationSonore(event.ok ? "agentFini" : "agentErreur"))) jouer(event.ok ? "fin-de-tache" : "erreur");
          }
          rapporterFil(chatId, messageId, event.ok);
          break;
      }
    });
    },
    [suivant],
  );

  /* L'agent reprend la parole de lui-même (un agent d'arrière-plan a fini, un serveur s'est arrêté) :
     sa réponse s'ouvre dans la conversation de cette session. */
  useEffect(() => {
    if (!bridge?.claude.onSpontane) return;
    return bridge.claude.onSpontane((requestId, sessionId) => {
      const chat = stateRef.current.chats.find((c) => Object.values(c.sessions).includes(sessionId));
      const roleId = chat && Object.entries(chat.sessions).find(([, s]) => s === sessionId)?.[0];
      if (!chat || !roleId) return;
      dispatch({
        type: "message/add",
        message: { id: requestId, chatId: chat.id, author: { kind: "role", roleId }, createdAt: new Date().toISOString(), parts: [], statut: "en-cours" },
      });
      if (!stateRef.current.travail[chat.id]) {
        dispatch({ type: "travail/debut", chatId: chat.id, travail: { roleId, messageId: requestId, debut: Date.now() } });
      }
      suivreReponse(chat.id, roleId, requestId);
    });
  }, [bridge, suivreReponse]);

  /** Fait répondre un agent à un message. */
  const lancer = useCallback(
    (chatId: string, roleId: RoleId, messageUtilisateur: Message) => {
      const chat = stateRef.current.chats.find((c) => c.id === chatId);
      if (!chat) return;
      const messageId = messageUtilisateur.routineRun ? `routine-answer-${messageUtilisateur.routineRun}` : crypto.randomUUID();
      const reponse: Message = {
        id: messageId,
        chatId,
        author: { kind: "role", roleId },
        createdAt: new Date().toISOString(),
        parts: [],
        statut: "en-cours",
        ...(messageUtilisateur.routineRun ? { routineRun: messageUtilisateur.routineRun } : {}),
      };
      dispatch({ type: "message/add", message: reponse });
      dispatch({
        type: "travail/debut",
        chatId,
        travail: { roleId, messageId, debut: Date.now() },
      });
      if (!chat.roleIds.includes(roleId)) {
        dispatch({
          type: "chat/update",
          id: chatId,
          patch: (c) => ({ ...c, roleIds: [...c.roleIds, roleId] }),
        });
      }

      const maj = (patch: (m: Message) => Message) => dispatch({ type: "message/update", id: messageId, patch });
      const terminer = () => {
        ecouteurs.current.delete(messageId);
        dispatch({ type: "travail/fin", chatId });
        suivant(chatId);
      };

      /* Navigateur : réponse simulée, écrite au fil de l'eau. */
      if (!bridge) {
        const texte = SIMULATED_REPLIES[roleId] ?? "Bien reçu, je m’en occupe et je te réponds ici.";
        const mots = texte.split(/(?<= )/);
        mots.forEach((mot, i) => {
          timers.current.push(
            setTimeout(
              () =>
                maj((m) => ({
                  ...m,
                  parts: ajouterTexte(m.parts, mot, false),
                })),
              1200 + i * 45,
            ),
          );
        });
        timers.current.push(
          setTimeout(
            () => {
              maj((m) => ({ ...m, statut: "fait" }));
              terminer();
            },
            1300 + mots.length * 45,
          ),
        );
        return;
      }

      suivreReponse(chatId, roleId, messageId);

      const project = stateRef.current.projects.find((p) => p.id === chat.projectId);
      // La consigne ET sa réponse sont durables avant le claim dans Electron.
      const demarrer = async () => {
        if (messageUtilisateur.routineRun) {
          const etat = stateRef.current;
          const messages = etat.messages.filter((m) => m.id !== messageUtilisateur.id && m.id !== reponse.id);
          stateRef.current = { ...etat, messages: [...messages, messageUtilisateur, reponse] };
          const sauvegarde = await bridge.conversations.write(conversationsAEnregistrer(stateRef.current));
          if (!sauvegarde.ok) {
            void bridge.routines?.signaler(messageUtilisateur.routineRun, { state: "failed", chatId: null, messageId: null, error: sauvegarde.message });
            throw new Error(sauvegarde.message);
          }
        }
        return bridge.claude.stream(messageId, {
          agent: roleId === "principal" ? null : roleId,
          prompt: construirePrompt(chat, roleId, messageUtilisateur),
          dossier: chat.kind === "equipe" ? (project?.folder ?? null) : null,
          sessionId: chat.sessions[roleId] ?? null,
          modele: stateRef.current.chats.find((c) => c.id === chatId)?.modele ?? null,
          effort: stateRef.current.chats.find((c) => c.id === chatId)?.effort ?? null,
          acces: stateRef.current.acces,
          fichiers: messageUtilisateur.parts.flatMap((p) => (p.type === "fichiers" ? p.chemins : [])),
          chatId,
          ...(messageUtilisateur.routineRun ? { routineRun: messageUtilisateur.routineRun } : {}),
        });
      };
      void demarrer().then((r) => {
          if (!r.ok)
            ecouteurs.current.get(messageId)?.({
              type: "fin",
              ok: false,
              texte: "",
              erreur: r.message,
            });
        }).catch((error: unknown) => ecouteurs.current.get(messageId)?.({
          type: "fin", ok: false, texte: "", erreur: error instanceof Error ? error.message : String(error),
        }));
    },
    [bridge, construirePrompt, suivant, suivreReponse],
  );
  const lancerRef = useRef(lancer);
  useEffect(() => {
    lancerRef.current = lancer;
    lancerTot.current = lancer;
  });

  /** La conversation, créée si c'est la première fois qu'on s'adresse à cet agent en direct. */
  const assurerChat = useCallback((chatId: string): Chat | undefined => {
    let chat = stateRef.current.chats.find((c) => c.id === chatId);
    if (!chat && chatId.startsWith(DIRECT)) {
      const roleId = chatId.slice(DIRECT.length);
      const role = rolesRef.current.find((r) => r.id === roleId);
      if (!role) return;
      chat = {
        id: chatId,
        kind: "direct",
        projectId: null,
        title: role.name,
        roleIds: [roleId],
        updatedAt: new Date().toISOString(),
        sessions: {},
        luJusqua: null,
      };
      dispatch({ type: "chat/add", chat });
      stateRef.current = {
        ...stateRef.current,
        chats: [chat, ...stateRef.current.chats],
      };
    }
    return chat;
  }, []);

  /** `horsFile` : le message sort de la file, l'agent vient de finir (l'état n'est peut-être pas encore à jour). */
  const envoyer = useCallback(
    (chatId: string, text: string, to: RoleId | null, fichiers: string[], horsFile = false, routineRun?: string) => {
      const chat = assurerChat(chatId);
      if (!chat) return;

      // Une routine attend aussi si son agent travaille dans une autre conversation.
      const agentOccupe = routineRun && Object.values(stateRef.current.travail).some((t) => t.roleId === to);
      if ((stateRef.current.travail[chatId] && !horsFile) || agentOccupe) {
        dispatch({
          type: "file/ajouter",
          chatId,
          message: { id: crypto.randomUUID(), text, to, fichiers, ...(routineRun ? { routineRun } : {}) },
        });
        return;
      }

      // Un fil sans titre prend le début de son premier message.
      if (chat.fil && chat.title === FIL_SANS_TITRE && text.trim()) {
        dispatch({ type: "chat/update", id: chatId, patch: (c) => ({ ...c, title: chatTitle(text) }) });
      }

      const message: Message = {
        id: routineRun ? `routine-user-${routineRun}` : crypto.randomUUID(),
        chatId,
        author: { kind: "user" },
        createdAt: new Date().toISOString(),
        parts: fichiers.length
          ? [
              { type: "text", text },
              { type: "fichiers", chemins: fichiers },
            ]
          : [{ type: "text", text }],
        ...(routineRun ? { routineRun } : {}),
      };
      dispatch({ type: "message/add", message });
      const parDefaut = chat.roleIds.includes("principal") ? "principal" : chat.roleIds[0];
      const roleId = chat.kind === "direct" ? chat.roleIds[0] : (to ?? parDefaut);
      // Le message est dans l'état au prochain rendu : l'agent part juste après.
      timers.current.push(setTimeout(() => lancerRef.current(chatId, roleId, message), 0));
    },
    [assurerChat],
  );
  useEffect(() => {
    envoyerRef.current = envoyer;
  });
  // Une routine qui attend un agent occupé ailleurs repart quand cet agent se libère.
  useEffect(() => {
    const ids = new Set(Object.values(state.travail).map((t) => t.roleId));
    for (const [chatId, file] of Object.entries(state.file)) {
      const prochain = file[0];
      if (!prochain?.routineRun || state.travail[chatId] || ids.has(prochain.to ?? "")) continue;
      ids.add(prochain.to ?? "");
      dispatch({ type: "file/retirer", chatId, id: prochain.id });
      timers.current.push(setTimeout(() => envoyerRef.current(chatId, prochain.text, prochain.to, prochain.fichiers, true, prochain.routineRun), 0));
    }
  }, [state.travail, state.file]);
  const sendMessage = useCallback(
    (chatId: string, text: string, to: RoleId | null, fichiers: string[] = []) => envoyer(chatId, text, to, fichiers),
    [envoyer],
  );

  const choisirModele = useCallback(
    (chatId: string, modele: string | null, effort: string | null) => {
      if (!assurerChat(chatId)) return;
      dispatch({
        type: "chat/update",
        id: chatId,
        patch: (c) => ({ ...c, modele, effort }),
      });
    },
    [assurerChat],
  );

  /** Sous une réponse : la refaire, plus détaillée, plus concise, en cherchant sur le web, ou avec un autre modèle. */
  const reessayer = useCallback(
    (chatId: string, messageId: string, facon: FaconReessai, modele?: string) => {
      const { messages, chats } = stateRef.current;
      const message = messages.find((m) => m.id === messageId);
      const chat = chats.find((c) => c.id === chatId);
      if (!message || !chat || message.author.kind !== "role") return;
      const roleId = message.author.roleId;
      const fil = messages.filter((m) => m.chatId === chatId);
      const derniere = fil.findLast((m) => m.author.kind === "role" && m.author.roleId === roleId);
      const extrait = texteDe(message).replace(/\s+/g, " ").slice(0, 80);
      const laquelle = derniere?.id === messageId || !extrait ? "ta dernière réponse" : `ta réponse « ${extrait}… »`;
      if (modele) {
        const suite = { ...chat, modele };
        dispatch({ type: "chat/update", id: chatId, patch: (c) => ({ ...c, modele }) });
        stateRef.current = { ...stateRef.current, chats: chats.map((c) => (c.id === chatId ? suite : c)) };
      }
      const consignes: Record<FaconReessai, string> = {
        reessayer: `Refais ${laquelle}, autrement.`,
        details: `Reprends ${laquelle} en plus détaillé.`,
        concis: `Reprends ${laquelle} en plus concis.`,
        web: `Refais ${laquelle} en cherchant d’abord sur le web.`,
      };
      envoyerRef.current(chatId, consignes[facon], roleId, []);
    },
    [],
  );

  /** Une nouvelle conversation qui reprend celle-ci jusqu'à ce message ; l'originale ne bouge pas. */
  const brancher = useCallback((chatId: string, messageId: string): string | null => {
    const { messages, chats } = stateRef.current;
    const personne = identiteAffichee(stateRef.current.currentUser, stateRef.current.profilCompte);
    const chat = chats.find((c) => c.id === chatId);
    const fil = messages.filter((m) => m.chatId === chatId);
    const fin = fil.findIndex((m) => m.id === messageId);
    if (!chat || fin < 0) return null;
    const allRoles = rolesRef.current;
    const nom = ({ author }: Message) => {
      if (author.kind === "user") return personne.name;
      return allRoles.find((r) => r.id === author.roleId)?.name ?? author.roleId;
    };
    const repris = fil.slice(0, fin + 1).filter((m) => m.statut !== "en-cours");
    const id = crypto.randomUUID();
    const branche: Chat = {
      id,
      kind: "equipe",
      projectId: chat.projectId,
      title: `${chat.title} · branche`,
      roleIds: chat.roleIds,
      updatedAt: new Date().toISOString(),
      sessions: {},
      luJusqua: null,
      modele: chat.modele,
      effort: chat.effort,
      amorce: repris
        .map((m) => `${nom(m)} : ${texteDe(m)}`)
        .filter((l) => !l.endsWith(": "))
        .join("\n\n")
        .slice(-24000),
    };
    dispatch({ type: "chat/add", chat: branche });
    for (const m of repris) dispatch({ type: "message/add", message: { ...m, id: crypto.randomUUID(), chatId: id } });
    // Les messages repris gardent leur date : la branche, elle, remonte en tête des récentes.
    dispatch({ type: "chat/update", id, patch: (c) => ({ ...c, updatedAt: new Date().toISOString() }) });
    stateRef.current = { ...stateRef.current, chats: [branche, ...chats] };
    return id;
  }, []);

  const startChat = useCallback((projectId: string, text: string, to: RoleId | null, fichiers: string[] = []) => {
    const id = crypto.randomUUID();
    const roleIds: RoleId[] = to && to !== "principal" ? ["principal", to] : ["principal"];
    const chat: Chat = {
      id,
      kind: "equipe",
      projectId,
      title: chatTitle(text),
      roleIds,
      updatedAt: new Date().toISOString(),
      sessions: {},
      luJusqua: null,
    };
    dispatch({ type: "chat/add", chat });
    stateRef.current = {
      ...stateRef.current,
      chats: [chat, ...stateRef.current.chats],
    };
    envoyerRef.current(id, text, to, fichiers);
    return id;
  }, []);

  const arreter = useCallback(
    (chatId: string) => {
      const travail = stateRef.current.travail[chatId];
      if (travail && bridge) void bridge.claude.cancel(travail.messageId);
    },
    [bridge],
  );

  const creerFil = useCallback((roleId: RoleId, titre?: string, lancePar?: { roleId: RoleId; chatId: string } | null) => {
    const maintenant = new Date().toISOString();
    const chat: Chat = {
      id: `${FIL}${crypto.randomUUID().slice(0, 8)}`,
      kind: "direct",
      projectId: null,
      title: titre?.trim() ? chatTitle(titre) : FIL_SANS_TITRE,
      roleIds: [roleId],
      updatedAt: maintenant,
      sessions: {},
      luJusqua: null,
      fil: { roleId, statut: "ouvert", creeLe: maintenant, lancePar: lancePar ?? null },
    };
    dispatch({ type: "chat/add", chat });
    stateRef.current = { ...stateRef.current, chats: [chat, ...stateRef.current.chats] };
    return chat.id;
  }, []);

  const renommerChat = useCallback((chatId: string, titre: string) => {
    const propre = titre.replace(/\s+/g, " ").trim().slice(0, 80);
    if (propre) dispatch({ type: "chat/update", id: chatId, patch: (c) => ({ ...c, title: propre }) });
  }, []);

  const epinglerChat = useCallback((chatId: string, epingler: boolean) => {
    const maintenant = new Date().toISOString();
    const chats = basculerEpingle(stateRef.current.chats, chatId, epingler, maintenant);
    if (chats === stateRef.current.chats) return;
    // La fermeture peut précéder le prochain rendu et l'écriture regroupée de 400 ms.
    stateRef.current = { ...stateRef.current, chats };
    dispatch({ type: "chat/update", id: chatId, patch: (c) => avecEpingle(c, epingler, maintenant) });
    // Fermer la dernière fenêtre peut détruire le renderer avant « avantFermeture ».
    // Le main attend déjà la fin des écritures IPC avant de quitter.
    if (bridge && stateRef.current.charge) {
      if (ecritureRegroupee.current) clearTimeout(ecritureRegroupee.current);
      void bridge.conversations.write(conversationsAEnregistrer(stateRef.current));
    }
  }, [bridge]);

  const archiverFil = useCallback(
    (chatId: string, supprime = false) => {
      // Un fil archivé s'arrête : il ne travaille plus.
      const travail = stateRef.current.travail[chatId];
      if (travail && bridge) void bridge.claude.cancel(travail.messageId);
      dispatch({
        type: "chat/update",
        id: chatId,
        patch: (c) => (c.fil ? { ...c, fil: { ...c.fil, statut: "archive", supprime } } : c),
      });
    },
    [bridge],
  );

  const rouvrirFil = useCallback((chatId: string) => {
    dispatch({
      type: "chat/update",
      id: chatId,
      patch: (c) => (c.fil ? { ...c, fil: { ...c.fil, statut: "ouvert", supprime: false } } : c),
    });
  }, []);

  /* Les outils des fils, appelés par les agents (serveur MCP de l'app, electron/ia.ts) : une tâche = un fil. */
  useEffect(() => {
    const outils = bridge?.outils;
    if (!outils) return;
    const executer = (nom: string, args: Record<string, unknown>, appelant: { chatId: string; roleId: string }): string => {
      const { chats, messages, travail } = stateRef.current;
      const roles = rolesRef.current;
      const nomDe = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
      const filDe = (id: unknown) => {
        const fil = chats.find((c) => c.id === String(id ?? "").trim() && c.fil);
        if (!fil?.fil) throw new Error(`Aucun fil « ${String(id)} ».`);
        return fil as Chat & { fil: NonNullable<Chat["fil"]> };
      };
      const etat = (c: Chat) => (travail[c.id] ? "en cours" : c.fil?.statut === "archive" ? "fermé" : "fini, en attente");
      const resume = (c: Chat & { fil: NonNullable<Chat["fil"]> }) => `${c.title} (${c.id}) · ${nomDe(c.fil.roleId)} · ${etat(c)}`;

      switch (nom) {
        case "ouvrir_fil": {
          const agent = String(args.agent ?? "").trim();
          const titre = String(args.titre ?? "").trim();
          const brief = String(args.brief ?? "").trim();
          if (!roles.some((r) => r.id === agent)) {
            throw new Error(`« ${agent} » n’est pas dans Mes agents : il ne peut pas recevoir de fil. Agents disponibles : ${roles.map((r) => `${r.id} (${r.name})`).join(", ")}.`);
          }
          if (!brief) throw new Error("Le brief est vide : le fil ne voit pas ta conversation, il lui faut tout.");
          const lanceur = chats.some((c) => c.id === appelant.chatId) ? { roleId: appelant.roleId, chatId: appelant.chatId } : null;
          const id = creerFil(agent, titre || brief, lanceur);
          if (lanceur) {
            dispatch({ type: "chat/update", id, patch: (c) => (c.fil ? { ...c, fil: { ...c.fil, retourAttendu: true } } : c) });
          }
          timers.current.push(setTimeout(() => envoyerRef.current(id, brief, null, []), 0));
          return `Fil ouvert : ${titre || "sans titre"} (${id}). ${nomDe(agent)} y travaille, dans un onglet de son chat.${lanceur ? " Sa réponse te reviendra automatiquement dans cette conversation : inutile de la surveiller." : ""}`;
        }
        case "lister_fils": {
          const agent = typeof args.agent === "string" && args.agent ? args.agent : null;
          const ouverts = chats.filter((c): c is Chat & { fil: NonNullable<Chat["fil"]> } => !!c.fil && c.fil.statut === "ouvert" && (!agent || c.fil.roleId === agent));
          return ouverts.length ? ouverts.map((c) => `- ${resume(c)}`).join("\n") : "Aucun fil ouvert.";
        }
        case "lire_fil": {
          const fil = filDe(args.id);
          const derniere = messages.findLast((m) => m.chatId === fil.id && m.author.kind === "role" && m.statut !== "en-cours");
          const texte = derniere ? texteDe(derniere) || derniere.erreur || "" : "";
          return `${resume(fil)}\n\n${texte ? `Dernière réponse :\n${texte.slice(-8000)}` : "Pas encore de réponse."}`;
        }
        case "ecrire_dans_fil": {
          const fil = filDe(args.id);
          const message = String(args.message ?? "").trim();
          if (!message) throw new Error("Le message est vide.");
          if (fil.fil.statut === "archive") throw new Error("Ce fil est fermé : demande à la personne de le rouvrir, ou ouvre-en un autre.");
          if (fil.fil.lancePar?.chatId === appelant.chatId) {
            dispatch({ type: "chat/update", id: fil.id, patch: (c) => (c.fil ? { ...c, fil: { ...c.fil, retourAttendu: true } } : c) });
          }
          envoyerRef.current(fil.id, message, null, []);
          return travail[fil.id] ? "Ajouté : il le lira après sa réponse en cours." : "Envoyé : il s’y met.";
        }
        case "arreter_fil": {
          const fil = filDe(args.id);
          if (!travail[fil.id]) return "Il ne travaillait pas.";
          arreter(fil.id);
          return "Arrêté. Le fil reste ouvert.";
        }
        case "fermer_fil": {
          const fil = filDe(args.id);
          archiverFil(fil.id);
          return `Fil fermé et archivé : ${fil.title} (${fil.id}). Il peut être rouvert.`;
        }
        case "proposer_agent": {
          const proposition = lireProposition(args);
          if (!proposition) throw new Error("Il manque le prénom ou les consignes de l’agent proposé.");
          if (roles.some((r) => r.id === proposition.id)) throw new Error(`« ${proposition.id} » est déjà dans Mes agents : propose un autre identifiant, ou un changement de sa fiche.`);
          return `Proposition affichée à la personne : ${proposition.nom} (${proposition.role || "sans rôle"}). Elle l’ouvre dans l’éditeur, l’ajuste et l’enregistre elle-même ; rien n’est créé tant qu’elle n’a pas enregistré.`;
        }
        default:
          throw new Error("Outil inconnu.");
      }
    };
    return outils.onAppel((id, nom, args, appelant) => {
      try {
        outils.repondre(id, true, executer(nom, args, appelant));
      } catch (e) {
        outils.repondre(id, false, e instanceof Error ? e.message : String(e));
      }
    });
  }, [bridge, creerFil, archiverFil, arreter]);

  const nouvelleConversation = useCallback((chatId: string) => {
    if (stateRef.current.travail[chatId]) return;
    dispatch({ type: "chat/vider", id: chatId });
  }, []);

  const retirerDeLaFile = useCallback(
    (chatId: string, id: string) => {
      // Une exécution de routine retirée de la file : le moteur l'annule, sinon l'agent resterait réservé.
      const routineRun = stateRef.current.file[chatId]?.find((m) => m.id === id)?.routineRun;
      if (routineRun) void bridge?.routines?.interrompre(routineRun);
      dispatch({ type: "file/retirer", chatId, id });
    },
    [bridge],
  );

  const marquerLu = useCallback((chatId: string) => {
    const dernier = stateRef.current.messages.findLast((m) => m.chatId === chatId);
    const chat = stateRef.current.chats.find((c) => c.id === chatId);
    if (!dernier || !chat || (chat.luJusqua && chat.luJusqua >= dernier.createdAt)) return;
    dispatch({
      type: "chat/update",
      id: chatId,
      patch: (c) => ({ ...c, luJusqua: dernier.createdAt }),
    });
  }, []);

  /* ─── Planning ─────────────────────────────────────────────── */

  /** Lance une routine : sa consigne part à son agent. Une routine en chaîne, ou
   *  rangée dans un projet, a sa conversation d'équipe, avec tous les agents de la chaîne. */
  const chatDeRoutine = useCallback(
    (routine: { id: string; nom: string; roleId: RoleId; projectId: string | null; relais?: RelaisRoutine[] }) => {
      const relais = routine.relais ?? [];
      if (!routine.projectId && relais.length === 0) return idDirect(routine.roleId);
      const chatId = `routine-${routine.id}`;
      const roleIds = [...new Set<RoleId>(["principal", routine.roleId, ...relais.flatMap((l) => [l.de, l.vers])])];
      const existant = stateRef.current.chats.find((c) => c.id === chatId);
      if (!existant) {
        const chat: Chat = {
          id: chatId,
          kind: "equipe",
          projectId: routine.projectId,
          title: routine.nom,
          roleIds,
          updatedAt: new Date().toISOString(),
          sessions: {},
          luJusqua: null,
        };
        dispatch({ type: "chat/add", chat });
        stateRef.current = { ...stateRef.current, chats: [chat, ...stateRef.current.chats] };
      } else if (roleIds.some((id) => !existant.roleIds.includes(id))) {
        // Un agent ajouté à la chaîne entre dans la conversation.
        const patch = (c: Chat): Chat => ({ ...c, roleIds: [...new Set([...c.roleIds, ...roleIds])] });
        dispatch({ type: "chat/update", id: chatId, patch });
        stateRef.current = { ...stateRef.current, chats: stateRef.current.chats.map((c) => (c.id === chatId ? patch(c) : c)) };
      }
      return chatId;
    },
    [],
  );

  /* Le moteur du process principal (electron/routines/) : ses exécutions partent ici par le chemin
     habituel des messages. */
  useLivraisonRoutines({
    bridge: moteurRoutines ? bridge : null,
    // Les fiches des agents lues sur le disque : un agent pas encore chargé (ou une lecture
    // en erreur) n'est pas un agent introuvable. Les exécutions attendent.
    pret: state.charge && statutAgents === "disque",
    messages: state.messages,
    file: state.file,
    poster: (run, routine) => {
      if (!rolesRef.current.some((r) => r.id === run.agentId)) return null;
      const chatId = chatDeRoutine({
        id: run.routineId,
        nom: run.routineName,
        roleId: run.agentId,
        projectId: run.projectId,
        relais: routine?.relais,
      });
      envoyerRef.current(chatId, `Routine « ${run.routineName} »\n\n${run.instruction}`, run.agentId, [], false, run.id);
      return chatId;
    },
    lire: () => stateRef.current,
    retirerDeFile: (chatId, id) => dispatch({ type: "file/retirer", chatId, id }),
    texte: texteDe,
  });

  const enregistrerRoutine = useCallback((routine: Routine) => {
    dispatch({ type: "routine/enregistrer", routine });
  }, []);
  const supprimerRoutine = useCallback((id: string) => dispatch({ type: "routine/supprimer", id }), []);
  const lancerRoutine = useCallback(
    (id: string) => {
      void bridge?.routines?.executer(id);
    },
    [bridge],
  );

  const ajouterArtefact = useCallback((artefact: Omit<Artefact, "id" | "ajouteLe">) => {
    dispatch({
      type: "artefact/ajouter",
      artefact: { ...artefact, id: crypto.randomUUID(), ajouteLe: new Date().toISOString() },
    });
  }, []);
  const supprimerArtefact = useCallback((id: string) => dispatch({ type: "artefact/supprimer", id }), []);
  const modifierArtefact = useCallback(
    (id: string, patch: Partial<Artefact>) => dispatch({ type: "artefact/modifier", id, patch }),
    [],
  );
  const synchroniserArtefacts = useCallback(async () => {
    if (!bridge) throw new Error("La synchronisation marche dans l’app de bureau.");
    const r = await bridge.artefacts.lister();
    if (!r.ok) throw new Error(r.message);
    const connus = new Set(stateRef.current.artefacts.map((a) => a.url.replace(/\/$/, "")));
    dispatch({ type: "artefact/synchroniser", liste: r.data });
    return { total: r.data.length, nouveaux: r.data.filter((a) => !connus.has(a.url.replace(/\/$/, ""))).length };
  }, [bridge]);

  const enregistrerProjet = useCallback((project: Project) => dispatch({ type: "projet/enregistrer", project }), []);
  const retirerProjet = useCallback((id: string) => dispatch({ type: "projet/supprimer", id }), []);
  const enregistrerProfil = useCallback((user: User) => dispatch({ type: "profil/enregistrer", user }), []);
  const modifierProfil = useCallback((patch: Partial<User>) => dispatch({ type: "profil/modifier", patch }), []);
  const appliquerProfilCompte = useCallback((profil: ProfilCompte | null) => dispatch({ type: "compte/profil", profil }), []);
  const choisirAcces = useCallback((acces: Acces) => dispatch({ type: "acces/choisir", acces }), []);
  /* Les actions de rappels sont visibles immédiatement par les notifications,
     le prochain clic (ou blur) et la fermeture, avant le prochain rendu React. */
  const agirRappel = useCallback((action: Extract<WorkspaceAction, { type: "tache/enregistrer" | "tache/supprimer" | "tache/restaurer" | "tache/oublierSuppressions" | "tache/notifiee" }>) => {
    stateRef.current = reducer(stateRef.current, action);
    dispatch(action);
  }, []);
  const enregistrerTache = useCallback((tache: Tache) => agirRappel({ type: "tache/enregistrer", tache }), [agirRappel]);
  const supprimerTache = useCallback((id: string) => agirRappel({ type: "tache/supprimer", id }), [agirRappel]);
  const oublierSuppressions = useCallback(() => agirRappel({ type: "tache/oublierSuppressions" }), [agirRappel]);
  const restaurerTaches = useCallback(() => {
    const avant = stateRef.current;
    const rendus = avant.rappelsSupprimes.filter(({ tache }) => !avant.taches.some((t) => t.id === tache.id));
    if (!avant.rappelsSupprimes.length) return [];
    agirRappel({ type: "tache/restaurer" });
    if (bridge && stateRef.current.charge) {
      if (ecritureRegroupee.current !== null) clearTimeout(ecritureRegroupee.current);
      void bridge.conversations.write(conversationsAEnregistrer(stateRef.current));
    }
    return rendus;
  }, [agirRappel, bridge]);
  const enregistrerEvenement = useCallback((evenement: Evenement) => dispatch({ type: "evenement/enregistrer", evenement }), []);
  const supprimerEvenement = useCallback((id: string) => dispatch({ type: "evenement/supprimer", id }), []);
  const changerCategories = useCallback(
    (categories: Categorie[]) => dispatch({ type: "categories/changer", categories }),
    [],
  );

  /* Rappels : une notification macOS à l'heure d'une tâche, et 10 min avant un événement.
     Vérifié toutes les 30 s tant que l'app est ouverte. */
  useEffect(() => {
    if (!state.charge || typeof Notification === "undefined") return;
    const verifier = () => {
      const maintenant = Date.now();
      for (const t of stateRef.current.taches) {
        if (t.faite || t.notifiee || !t.date || !t.heure) continue;
        if (new Date(`${t.date}T${t.heure}`).getTime() > maintenant) continue;
        const categorie = stateRef.current.categories.find((c) => c.id === t.liste)?.nom ?? "Rappel";
        notifierRappel(t.titre, t.notes || categorie, () => {
          // Les réglages sont lus de façon asynchrone : la personne a pu supprimer,
          // cocher ou reporter le rappel entre-temps. Jamais de recréation.
          const actuel = stateRef.current.taches.find((r) => r.id === t.id);
          if (!actuel || actuel.faite || actuel.notifiee || !actuel.date || !actuel.heure ||
              new Date(actuel.date + "T" + actuel.heure).getTime() > Date.now()) return false;
          agirRappel({ type: "tache/notifiee", id: t.id });
          return true;
        });
      }
      /* Les rendez-vous d'équipe : une notification par occurrence, retenue le temps de la session. */
      const demain = new Date(maintenant + 86_400_000);
      for (const e of evenementsEquipeEntre(new Date(maintenant), demain)) {
        const debut = new Date(`${e.date}T${e.debut}`).getTime();
        if (notifiesEquipe.current.has(e.id) || debut - 10 * 60_000 > maintenant || debut < maintenant) continue;
        notifiesEquipe.current.add(e.id);
        notifierRappel(e.titre, `À ${e.debut} · ${e.notes}`);
      }
      for (const e of stateRef.current.evenements) {
        if (e.notifie || !e.debut) continue;
        const debut = new Date(`${e.date}T${e.debut}`).getTime();
        if (debut - 10 * 60_000 > maintenant || debut < maintenant - 60 * 60_000) continue;
        notifierRappel(e.titre, `À ${e.debut}${e.notes ? ` · ${e.notes}` : ""}`);
        dispatch({ type: "evenement/enregistrer", evenement: { ...e, notifie: true } });
      }
    };
    verifier();
    const id = setInterval(verifier, 30_000);
    return () => clearInterval(id);
  }, [state.charge, agirRappel]);

  const repondreAutorisation = useCallback(
    (messageId: string, demandeId: string, decision: "oui" | "toujours" | "non") => {
      if (!bridge) return;
      const accepte = decision !== "non";
      // L'accord donné à un agent : une validation qui s'entend.
      if (accepte) jouer("validation");
      dispatch({
        type: "message/update",
        id: messageId,
        patch: (m) => ({
          ...m,
          parts: m.parts.map((p) =>
            p.type === "autorisation" && p.id === demandeId ? { ...p, statut: accepte ? "acceptee" : "refusee" } : p,
          ),
        }),
      });
      void bridge.claude.autoriser(messageId, demandeId, decision);
    },
    [bridge],
  );

  /* Premier lancement : le profil part du nom de la session Mac. */
  useEffect(() => {
    if (!bridge || !state.charge || state.currentUser.name) return;
    let actif = true;
    void bridge.systeme.utilisateur().then((r) => {
      if (!actif || !r.ok) return;
      // Le prénom : le mot du nom complet qui correspond à l'identifiant de session
      // (« Bagcaci Pelin » + « pelin » → « Pelin »), sinon le premier mot.
      const mots = r.data.nom.split(/\s+/).filter(Boolean);
      const name =
        mots.find((m) => m.toLowerCase() === r.data.identifiant.toLowerCase()) ??
        mots[0] ??
        r.data.identifiant.charAt(0).toUpperCase() + r.data.identifiant.slice(1);
      dispatch({
        type: "profil/enregistrer",
        user: { id: r.data.identifiant, name, title: "KLYRA", initial: name.charAt(0).toUpperCase() },
      });
    });
    return () => {
      actif = false;
    };
  }, [bridge, state.charge, state.currentUser.name]);


  /* ─── Workflows ────────────────────────────────────────────── */

  const controleurs = useRef(new Map<string, AbortController>());
  const approbations = useRef(new Map<string, (ok: boolean) => void>());
  /* Les étapes Agent qui attendent la réponse de leur agent. */
  const attentesAgent = useRef<{ chatId: string; roleId: RoleId; depuis: string; resoudre: (r: Resultat) => void }[]>([]);
  useEffect(() => {
    if (!attentesAgent.current.length) return;
    attentesAgent.current = attentesAgent.current.filter((a) => {
      const reponse = state.messages.find(
        (m) =>
          m.chatId === a.chatId &&
          m.author.kind === "role" &&
          m.author.roleId === a.roleId &&
          m.createdAt >= a.depuis &&
          m.statut !== "en-cours",
      );
      if (!reponse) return true;
      a.resoudre(
        reponse.statut === "erreur"
          ? { ok: false, erreur: reponse.erreur ?? "L’agent s’est arrêté sur une erreur." }
          : { ok: true, texte: texteDe(reponse) },
      );
      return false;
    });
  }, [state.messages]);

  /** Un appel au modèle, sans conversation ni outil (étapes LLM et conditions). */
  const appelLibre = useCallback(
    (o: { prompt: string; systeme: string; modele: string | null; effort: string | null; signal: AbortSignal }) =>
      new Promise<Resultat>((resoudre) => {
        if (!bridge) {
          setTimeout(() => resoudre({ ok: true, texte: "OUI. (Réponse simulée : l’app n’est pas ouverte sur le bureau.)" }), 800);
          return;
        }
        const id = crypto.randomUUID();
        let texte = "";
        ecouteurs.current.set(id, (event) => {
          if (event.type === "texte") texte += event.delta;
          // Pas d'outils ici : toute demande est refusée d'office.
          else if (event.type === "autorisation") void bridge.claude.autoriser(id, event.id, "non");
          else if (event.type === "fin") {
            ecouteurs.current.delete(id);
            resoudre(
              event.ok
                ? { ok: true, texte: (texte || event.texte).trim() }
                : { ok: false, erreur: event.erreur ?? "Le modèle n’a pas répondu." },
            );
          }
        });
        o.signal.addEventListener("abort", () => void bridge.claude.cancel(id));
        const prompt = o.systeme.trim() ? `[Consigne système]\n${o.systeme.trim()}\n\n[Demande]\n${o.prompt}` : o.prompt;
        void bridge.claude
          .stream(id, { agent: null, prompt, dossier: null, sessionId: null, modele: o.modele, effort: o.effort, acces: "demander" })
          .then((r) => {
            if (r.ok) return;
            ecouteurs.current.delete(id);
            resoudre({ ok: false, erreur: r.message });
          });
      }),
    [bridge],
  );

  /** Ce que le moteur peut faire, pour un workflow : ses agents travaillent dans sa conversation. */
  const outilsPour = useCallback(
    (wf: Workflow): Outils => {
      const chatId = `wf-${wf.id}`;
      const assurerChat = (id: string, titre: string, roleIds: RoleId[]) => {
        const existant = stateRef.current.chats.find((c) => c.id === id);
        if (!existant) {
          const chat: Chat = {
            id,
            kind: "equipe",
            projectId: wf.projectId,
            title: titre,
            roleIds: [...new Set<RoleId>(["principal", ...roleIds])],
            updatedAt: new Date().toISOString(),
            sessions: {},
            luJusqua: null,
          };
          dispatch({ type: "chat/add", chat });
          stateRef.current = { ...stateRef.current, chats: [chat, ...stateRef.current.chats] };
        } else if (roleIds.some((r) => !existant.roleIds.includes(r))) {
          const patch = (c: Chat): Chat => ({ ...c, roleIds: [...new Set([...c.roleIds, ...roleIds])] });
          dispatch({ type: "chat/update", id, patch });
          stateRef.current = { ...stateRef.current, chats: stateRef.current.chats.map((c) => (c.id === id ? patch(c) : c)) };
        }
      };
      return {
        agent: ({ roleId, consigne, fichiers, signal }) =>
          new Promise<Resultat>((resoudre) => {
            assurerChat(chatId, `Workflow · ${wf.titre}`, [roleId]);
            attentesAgent.current.push({ chatId, roleId, depuis: new Date().toISOString(), resoudre });
            signal.addEventListener("abort", () => resoudre({ ok: false, erreur: "Arrêté." }));
            envoyerRef.current(chatId, `Workflow « ${wf.titre} »\n\n${consigne}`, roleId, fichiers);
          }),
        llm: appelLibre,
        notifier: (titre, texte) => {
          // Les Réglages peuvent couper les notifications des workflows, ou leur son : alors celui de KLYRA.
          void reglagesActuels().then(({ notifications: n }) => {
            if (!n.actives || !n.workflow) return;
            const systeme = typeof Notification !== "undefined";
            if (systeme) new Notification(titre, { body: texte, silent: !n.son });
            if (!systeme || !n.son) jouer("notification");
          });
        },
        conversation: (titre, texte) => {
          const id = `wf-sortie-${wf.id}`;
          assurerChat(id, titre, []);
          dispatch({
            type: "message/add",
            message: {
              id: crypto.randomUUID(),
              chatId: id,
              author: { kind: "role", roleId: "principal" },
              createdAt: new Date().toISOString(),
              parts: [{ type: "text", text: texte || "(vide)" }],
              statut: "fait",
            },
          });
          return { ok: true, texte: `Publié dans la conversation « ${titre} ».` };
        },
        ecrireFichier: async (chemin, texte) => {
          const ecrire = bridge?.fichiers.ecrire;
          if (!ecrire) return { ok: false, erreur: "Relance l’app une fois pour qu’elle puisse écrire des fichiers." };
          const r = await ecrire(chemin, texte);
          return r.ok ? { ok: true, texte: `Écrit dans ${r.data}.` } : { ok: false, erreur: r.message };
        },
        approbation: (etapeId, signal) =>
          new Promise<boolean>((resoudre) => {
            approbations.current.set(etapeId, resoudre);
            signal.addEventListener("abort", () => resoudre(false));
            notifierRappel(`${wf.titre} attend ton accord`, "Ouvre le workflow pour approuver ou refuser.");
          }),
      };
    },
    [appelLibre, bridge],
  );

  /** Garde une version du graphe (au plus 50). */
  const avecVersion = (wf: Workflow, raison: VersionWorkflow["raison"]): Workflow => ({
    ...wf,
    versions: [{ id: crypto.randomUUID(), at: new Date().toISOString(), raison, graphe: wf.graphe }, ...wf.versions].slice(0, 50),
  });

  const enregistrerWorkflow = useCallback((workflow: Workflow) => {
    const avant = stateRef.current.workflows.find((w) => w.id === workflow.id);
    const derniere = workflow.versions[0]?.at;
    const auto =
      avant &&
      avant.graphe !== workflow.graphe &&
      (!derniere || Date.now() - new Date(derniere).getTime() > 5 * 60_000);
    const suite = { ...(auto ? avecVersion({ ...workflow, graphe: avant.graphe }, "auto") : workflow), graphe: workflow.graphe, majLe: new Date().toISOString() };
    dispatch({ type: "workflow/enregistrer", workflow: suite });
    stateRef.current = {
      ...stateRef.current,
      workflows: stateRef.current.workflows.some((w) => w.id === suite.id)
        ? stateRef.current.workflows.map((w) => (w.id === suite.id ? suite : w))
        : [...stateRef.current.workflows, suite],
    };
  }, []);
  const supprimerWorkflow = useCallback((id: string) => {
    for (const e of stateRef.current.executions) if (e.workflowId === id) controleurs.current.get(e.id)?.abort();
    dispatch({ type: "workflow/supprimer", id });
  }, []);

  const lancerWorkflow = useCallback(
    (id: string, options: { declencheurId?: string | null; source?: SourceExecution; charge?: string; seule?: string } = {}) => {
      const trouve = stateRef.current.workflows.find((w) => w.id === id);
      if (!trouve) return null;
      const wf = options.seule ? trouve : avecVersion(trouve, "execution");
      if (wf !== trouve) {
        dispatch({ type: "workflow/enregistrer", workflow: wf });
        stateRef.current = { ...stateRef.current, workflows: stateRef.current.workflows.map((w) => (w.id === id ? wf : w)) };
      }
      const precedentes = stateRef.current.executions.filter((e) => e.workflowId === id);
      /* Pour une étape seule : la dernière sortie de chaque nœud. */
      const sortiesConnues: Record<string, { texte: string; fichiers?: string[] }> = {};
      for (const e of [...precedentes].reverse())
        for (const x of e.etapes) if (x.statut === "fait") sortiesConnues[x.noeudId] = { texte: x.sortie ?? "", fichiers: x.fichiers };
      const exec: ExecutionWorkflow = {
        id: crypto.randomUUID(),
        workflowId: id,
        numero: Math.max(0, ...precedentes.map((e) => e.numero)) + 1,
        declencheurId: options.declencheurId ?? null,
        seule: options.seule,
        source: options.source ?? "manuel",
        statut: "en-cours",
        erreur: null,
        debut: new Date().toISOString(),
        fin: null,
        etapes: [],
        chatId: `wf-${id}`,
      };
      const maj = (e: ExecutionWorkflow) => {
        dispatch({ type: "execution/enregistrer", execution: e });
        stateRef.current = {
          ...stateRef.current,
          executions: [e, ...stateRef.current.executions.filter((x) => x.id !== e.id)],
        };
      };
      maj(exec);
      const ctrl = new AbortController();
      controleurs.current.set(exec.id, ctrl);
      void executer(exec, { wf, outils: outilsPour(wf), maj, signal: ctrl.signal, charge: options.charge, sortiesConnues }).finally(() =>
        controleurs.current.delete(exec.id),
      );
      return exec.id;
    },
    [outilsPour],
  );
  const arreterExecution = useCallback((id: string) => {
    controleurs.current.get(id)?.abort();
    const e = stateRef.current.executions.find((x) => x.id === id);
    if (e?.chatId) arreter(e.chatId);
  }, [arreter]);
  const deciderApprobation = useCallback((etapeId: string, approuver: boolean) => {
    approbations.current.get(etapeId)?.(approuver);
    approbations.current.delete(etapeId);
  }, []);

  /* Les déclencheurs planifiés : toutes les 30 s, ceux dont l'heure est passée partent. */
  useEffect(() => {
    if (!state.charge) return;
    const verifier = () => {
      const maintenant = new Date();
      for (const wf of stateRef.current.workflows) {
        let prochaines = wf.prochaines ?? {};
        let change = false;
        for (const n of wf.graphe.noeuds) {
          if (n.type !== "declencheur" || n.champs.declencheur !== "planifie" || !n.frequence) continue;
          const due = prochaines[n.id];
          if (!due) {
            prochaines = { ...prochaines, [n.id]: prochainPassage(n.frequence, maintenant).toISOString() };
            change = true;
            continue;
          }
          if (new Date(due) > maintenant) continue;
          prochaines = { ...prochaines, [n.id]: prochainPassage(n.frequence, maintenant).toISOString() };
          change = true;
          lancerWorkflow(wf.id, { declencheurId: n.id, source: "planifie" });
        }
        if (change) {
          const suite = { ...(stateRef.current.workflows.find((w) => w.id === wf.id) ?? wf), prochaines };
          dispatch({ type: "workflow/enregistrer", workflow: suite });
          stateRef.current = { ...stateRef.current, workflows: stateRef.current.workflows.map((w) => (w.id === wf.id ? suite : w)) };
        }
      }
    };
    verifier();
    const id = setInterval(verifier, 30_000);
    return () => clearInterval(id);
  }, [state.charge, lancerWorkflow]);

  /* Les webhooks locaux : un appel sur l'adresse d'un déclencheur lance son workflow. */
  useEffect(() => {
    const ecouter = bridge?.webhooks?.onAppel;
    if (!ecouter) return;
    return ecouter((secret, corps) => {
      for (const wf of stateRef.current.workflows)
        for (const [noeudId, s] of Object.entries(wf.webhooks ?? {}))
          if (s === secret) lancerWorkflow(wf.id, { declencheurId: noeudId, source: "webhook", charge: corps });
    });
  }, [bridge, lancerWorkflow]);

  const value = useMemo(
    () => ({
      state,
      sendMessage,
      choisirModele,
      nouvelleConversation,
      creerFil,
      renommerChat,
      epinglerChat,
      archiverFil,
      rouvrirFil,
      startChat,
      reessayer,
      brancher,
      arreter,
      retirerDeLaFile,
      marquerLu,
      enregistrerRoutine,
      supprimerRoutine,
      lancerRoutine,
      ajouterArtefact,
      supprimerArtefact,
      modifierArtefact,
      synchroniserArtefacts,
      enregistrerProjet,
      retirerProjet,
      enregistrerProfil,
      modifierProfil,
      appliquerProfilCompte,
      moi,
      choisirAcces,
      repondreAutorisation,
      enregistrerTache,
      supprimerTache,
      restaurerTaches,
      oublierSuppressions,
      enregistrerEvenement,
      supprimerEvenement,
      changerCategories,
      enregistrerWorkflow,
      supprimerWorkflow,
      lancerWorkflow,
      arreterExecution,
      deciderApprobation,
    }),
    [
      state,
      moi,
      modifierProfil,
      appliquerProfilCompte,
      sendMessage,
      choisirModele,
      nouvelleConversation,
      creerFil,
      renommerChat,
      epinglerChat,
      archiverFil,
      rouvrirFil,
      startChat,
      reessayer,
      brancher,
      arreter,
      retirerDeLaFile,
      marquerLu,
      enregistrerRoutine,
      supprimerRoutine,
      lancerRoutine,
      ajouterArtefact,
      supprimerArtefact,
      modifierArtefact,
      synchroniserArtefacts,
      enregistrerProjet,
      retirerProjet,
      enregistrerProfil,
      choisirAcces,
      repondreAutorisation,
      enregistrerTache,
      supprimerTache,
      restaurerTaches,
      oublierSuppressions,
      enregistrerEvenement,
      supprimerEvenement,
      changerCategories,
      enregistrerWorkflow,
      supprimerWorkflow,
      lancerWorkflow,
      arreterExecution,
      deciderApprobation,
    ],
  );
  return <WorkspaceContext.Provider value={value}>{erreurChargement ? <section role="alert" className="m-5 rounded-xl border border-bordure-forte bg-fond-surface p-5 text-texte-principal"><h1 className="text-h4 font-semibold">Les conversations n’ont pas pu être chargées</h1><p className="text-ui-s">{erreurChargement}</p><p className="text-ui-s">Aucune donnée n’a été remplacée. Les routines attendent que les conversations soient disponibles.</p><Bouton onClick={() => window.location.reload()}>Réessayer</Bouton></section> : children}</WorkspaceContext.Provider>;
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  return (
    <AgentsProvider>
      <WorkspaceStore>{children}</WorkspaceStore>
    </AgentsProvider>
  );
}

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace doit être utilisé dans <WorkspaceProvider>");
  return ctx;
}

/* ─── Sélecteurs ───────────────────────────────────────────────── */

/** Les agents, lus dans leurs fiches (cf. src/lib/agents.tsx). */
export function useRoles(): Role[] {
  return useAgents().roles;
}

/** Un agent par son id, même désactivé (ses conversations restent lisibles, sous son nom). S'il a été
 *  supprimé ou n'est pas sur ce poste, un agent de remplacement (les anciens messages restent lisibles). */
export function useRole(id: RoleId): Role {
  const { roles, tous } = useAgents();
  return (
    roles.find((r) => r.id === id) ??
    tous.find((a) => a.role.id === id)?.role ?? {
      ...PRINCIPAL,
      id,
      name: id,
      tag: "Introuvable",
      title: "Agent introuvable sur ce poste",
      initial: id.charAt(0).toUpperCase(),
      teinte: "ocre",
    }
  );
}

export function useProjects(): Project[] {
  return useWorkspace().state.projects;
}

/** Une conversation par son id. Celle d'un agent (`dm-<agent>`) existe dès qu'on l'ouvre, même vide,
 *  y compris pour un agent hors de Mes agents (elle s'ouvre alors en lecture). */
export function useChat(id: string | null): Chat | undefined {
  const { chats } = useWorkspace().state;
  const { roles, tous } = useAgents();
  return useMemo(() => {
    const chat = chats.find((c) => c.id === id);
    if (chat || !id?.startsWith(DIRECT)) return chat;
    const roleId = id.slice(DIRECT.length);
    const role = roles.find((r) => r.id === roleId) ?? tous.find((a) => a.role.id === roleId)?.role;
    if (!role) return undefined;
    return {
      id,
      kind: "direct",
      projectId: null,
      title: role.name,
      roleIds: [role.id],
      updatedAt: new Date(0).toISOString(),
      sessions: {},
      luJusqua: null,
    };
  }, [chats, roles, tous, id]);
}

export function useChatMessages(chatId: string): Message[] {
  const { messages } = useWorkspace().state;
  return useMemo(() => messages.filter((m) => m.chatId === chatId), [messages, chatId]);
}

/** L'agent au travail dans cette conversation, s'il y en a un. */
export function useTravail(chatId: string): Travail | null {
  return useWorkspace().state.travail[chatId] ?? null;
}

/** Messages en attente dans cette conversation. */
export function useFile(chatId: string): EnAttente[] {
  return useWorkspace().state.file[chatId] ?? AUCUN;
}
const AUCUN: EnAttente[] = [];

/** Vrai si cet agent travaille en ce moment, dans n'importe quelle conversation. */
export function useAgentOccupe(roleId: RoleId): boolean {
  const { travail } = useWorkspace().state;
  return Object.values(travail).some((t) => t.roleId === roleId);
}

/** Réponses d'agents arrivées depuis la dernière visite de la conversation. */
export function useNonLus(chatId: string): number {
  const { messages, chats } = useWorkspace().state;
  return useMemo(() => {
    const lu = chats.find((c) => c.id === chatId)?.luJusqua ?? "";
    return messages.filter(
      (m) => m.chatId === chatId && m.author.kind === "role" && m.statut !== "en-cours" && m.createdAt > lu,
    ).length;
  }, [messages, chats, chatId]);
}

/** Conversations d'équipe : épinglées en tête, puis les plus récentes. */
export function useRecentChats(limit?: number): Chat[] {
  const { chats } = useWorkspace().state;
  return useMemo(() => {
    const sorted = trierConversations(chats.filter((c) => c.kind === "equipe"));
    return limit === undefined ? sorted : sorted.slice(0, limit);
  }, [chats, limit]);
}

export interface ChatPreview {
  /** Rôle à afficher en avatar : auteur du dernier message, ou le Principal. */
  roleId: RoleId;
  text: string;
  /** Date du dernier message, null si la conversation est vide. */
  at: string | null;
}

/** Aperçu de la liste : « Hugo : c’est visible sur l’aperçu… ». */
export function useChatPreview(chatId: string): ChatPreview {
  const { messages } = useWorkspace().state;
  const roles = useRoles();
  return useMemo(() => {
    const direct = chatId.startsWith(DIRECT);
    const last = messages.findLast((m) => m.chatId === chatId && (m.statut !== "en-cours" || texteDe(m)));
    if (!last) return { roleId: "principal", text: "", at: null };
    const text = texteDe(last).replace(/\s+/g, " ") || (last.statut === "erreur" ? "Arrêté sur une erreur" : "…");
    if (last.author.kind === "user") return { roleId: "principal", text: `Toi : ${text}`, at: last.createdAt };
    const { roleId } = last.author;
    const name = roles.find((r) => r.id === roleId)?.name ?? "";
    // Conversation directe : pas besoin de répéter le prénom de l'agent.
    return {
      roleId,
      text: direct ? text : `${name} : ${text}`,
      at: last.createdAt,
    };
  }, [messages, roles, chatId]);
}

export function useProject(id: string | null): Project | undefined {
  return useProjects().find((p) => p.id === id);
}

/** Fichiers modifiés par les agents dans les chats d'un projet, en chemins relatifs à son dossier. */
export function useModifiedFiles(projectId: string | null): Set<string> {
  const { chats, messages, projects } = useWorkspace().state;
  return useMemo(() => {
    const dossier = projects.find((p) => p.id === projectId)?.folder.replace(/\/$/, "") ?? null;
    const chatIds = new Set(chats.filter((c) => c.projectId === projectId).map((c) => c.id));
    const paths = new Set<string>();
    for (const message of messages) {
      if (!chatIds.has(message.chatId)) continue;
      for (const part of message.parts) {
        if (part.type === "worklog") part.files.forEach((f) => paths.add(f.path));
        if (part.type === "etapes" && dossier) {
          for (const e of part.etapes) {
            if (e.chemin && e.statut === "fait" && /Write|Edit/.test(e.outil) && e.chemin.startsWith(`${dossier}/`)) {
              paths.add(e.chemin.slice(dossier.length + 1));
            }
          }
        }
      }
    }
    return paths;
  }, [chats, messages, projects, projectId]);
}

/** Vrai si l'agent de cette conversation attend ton accord. */
export function useAttenteAccord(chatId: string): boolean {
  const { messages, travail } = useWorkspace().state;
  const t = travail[chatId];
  if (!t) return false;
  const m = messages.find((x) => x.id === t.messageId);
  return !!m?.parts.some((p) => p.type === "autorisation" && p.statut === "attente");
}
