"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from "react";
import { PRINCIPAL } from "@/data/agents";
import { createMockWorkspace, type MockWorkspace } from "@/data/mock";
import { AgentsProvider, useAgents } from "@/lib/agents";
import { getBridge, type AgentEvent } from "@/lib/bridge";
import { libelleEtape } from "@/lib/etapes";
import { prochainPassage } from "@/lib/planning";
import type {
  Artefact,
  Chat,
  Etape,
  Message,
  MessagePart,
  Project,
  Role,
  RoleId,
  Routine,
  TacheAgent,
} from "@/types/domain";

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
}

/** Un message envoyé pendant que l'agent travaille : il part dès qu'il a fini. */
export interface EnAttente {
  id: string;
  text: string;
  to: RoleId | null;
  fichiers: string[];
}

interface WorkspaceState extends MockWorkspace {
  /** Faux tant que les conversations ne sont pas lues sur le disque. */
  charge: boolean;
  travail: Record<string, Travail>;
  file: Record<string, EnAttente[]>;
  routines: Routine[];
  artefacts: Artefact[];
}

type WorkspaceAction =
  | { type: "charger"; chats: Chat[]; messages: Message[]; routines: Routine[]; artefacts: Artefact[] }
  | { type: "routine/enregistrer"; routine: Routine }
  | { type: "routine/supprimer"; id: string }
  | { type: "artefact/ajouter"; artefact: Artefact }
  | { type: "artefact/supprimer"; id: string }
  | { type: "chat/add"; chat: Chat }
  | { type: "chat/update"; id: string; patch: (chat: Chat) => Chat }
  | { type: "chat/vider"; id: string }
  | { type: "message/add"; message: Message }
  | { type: "message/update"; id: string; patch: (message: Message) => Message }
  | { type: "travail/debut"; chatId: string; travail: Travail }
  | { type: "travail/fin"; chatId: string }
  | { type: "file/ajouter"; chatId: string; message: EnAttente }
  | { type: "file/retirer"; chatId: string; id: string };

function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "charger":
      return {
        ...state,
        chats: action.chats,
        messages: action.messages,
        routines: action.routines,
        artefacts: action.artefacts,
        charge: true,
      };
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
        messages: [...state.messages, message],
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
    case "travail/fin": {
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
  // Toutes les étapes de la réponse vivent dans un seul bloc, en tête du message.
  const index = parts.findIndex((p) => p.type === "etapes");
  if (index === -1) return [{ type: "etapes", etapes: [etape] }, ...parts];
  return parts.map((p, i) => (i === index && p.type === "etapes" ? { ...p, etapes: [...p.etapes, etape] } : p));
}

function finirEtape(parts: MessagePart[], id: string, ok: boolean): MessagePart[] {
  const statut = ok ? "fait" : "erreur";
  return parts.map((p) => {
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
export const DIRECT = "dm-";

export function idDirect(roleId: RoleId): string {
  return `${DIRECT}${roleId}`;
}

/** Titre d'un nouveau chat : le début du premier message. */
function chatTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 40).trimEnd()}…` : clean;
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
  startChat: (projectId: string, text: string, to: RoleId | null) => string;
  /** Arrête l'agent qui travaille dans cette conversation. */
  arreter: (chatId: string) => void;
  retirerDeLaFile: (chatId: string, id: string) => void;
  marquerLu: (chatId: string) => void;
  /** Crée ou modifie une tâche planifiée. */
  enregistrerRoutine: (routine: Routine) => void;
  supprimerRoutine: (id: string) => void;
  /** Lance une tâche planifiée tout de suite, sans attendre son heure. */
  lancerRoutine: (id: string) => void;
  ajouterArtefact: (artefact: Omit<Artefact, "id" | "ajouteLe">) => void;
  supprimerArtefact: (id: string) => void;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

function WorkspaceStore({ children }: { children: ReactNode }) {
  const bridge = getBridge();
  const { roles } = useAgents();
  const [state, dispatch] = useReducer(reducer, undefined, (): WorkspaceState => {
    const mock = createMockWorkspace();
    // App de bureau : de vraies conversations, lues sur le disque juste après.
    return bridge
      ? {
          ...mock,
          chats: [],
          messages: [],
          charge: false,
          travail: {},
          file: {},
          routines: [],
          artefacts: [],
        }
      : { ...mock, charge: true, travail: {}, file: {}, routines: [], artefacts: ARTEFACTS_DE_DEPART };
  });

  /* Les fonctions ci-dessous lisent toujours l'état le plus récent. */
  const stateRef = useRef(state);
  const rolesRef = useRef(roles);
  useEffect(() => {
    stateRef.current = state;
    rolesRef.current = roles;
  });
  const ecouteurs = useRef(new Map<string, (event: AgentEvent) => void>());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  /* Lecture des conversations gardées sur le disque. */
  useEffect(() => {
    if (!bridge) return;
    let actif = true;
    void bridge.conversations.read().then((reponse) => {
      if (!actif) return;
      const data = reponse.ok
        ? (reponse.data as {
            version?: number;
            chats?: Chat[];
            messages?: Message[];
            routines?: Routine[];
            artefacts?: Artefact[];
          } | null)
        : null;
      const valide = data?.version === VERSION_STOCKAGE;
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
      });
    });
    return () => {
      actif = false;
    };
  }, [bridge]);

  /* Écriture sur le disque, regroupée, à chaque changement. */
  useEffect(() => {
    if (!bridge || !state.charge) return;
    const timer = setTimeout(() => {
      void bridge.conversations.write({
        version: VERSION_STOCKAGE,
        chats: state.chats,
        messages: state.messages,
        routines: state.routines,
        artefacts: state.artefacts,
      });
    }, 400);
    return () => clearTimeout(timer);
  }, [bridge, state.charge, state.chats, state.messages, state.routines, state.artefacts]);

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
    const { messages, currentUser, projects } = stateRef.current;
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
        const auteur = m.author.kind === "user" ? currentUser.name : nom(m.author.roleId);
        return `${auteur} : ${texte}`;
      })
      .filter(Boolean);

    const lignes: string[] = [];
    if (!chat.sessions[roleId]) {
      const project = projects.find((p) => p.id === chat.projectId);
      lignes.push(
        `[Contexte] Tu échanges avec ${currentUser.name} (${currentUser.title}) dans l’app de bureau KLYRA, comme dans une messagerie : réponds en français, court et direct, en Markdown simple.`,
      );
      if (chat.kind === "equipe" && project) {
        const autres = chat.roleIds.filter((id) => id !== roleId).map(nom);
        lignes.push(
          `Conversation d’équipe « ${chat.title} » du projet ${project.name} (${project.subtitle}). Tu travailles dans le dossier du projet : ${project.folder}.` +
            (autres.length ? ` Sont aussi dans la conversation : ${autres.join(", ")}.` : ""),
        );
      } else {
        lignes.push("Conversation en tête-à-tête, hors projet.");
      }
    }
    if (depuis.length) lignes.push(`[Depuis ta dernière réponse]\n${depuis.join("\n\n")}`);
    lignes.push(`${lignes.length ? `[Message de ${currentUser.name}]\n` : ""}${texteDe(messageUtilisateur)}`);
    const joints = messageUtilisateur.parts.find((p) => p.type === "fichiers");
    if (joints?.type === "fichiers" && joints.chemins.length) {
      lignes.push(`[Fichiers joints, à lire]\n${joints.chemins.map((c) => `- ${c}`).join("\n")}`);
    }
    return lignes.join("\n\n");
  }, []);

  const envoyerRef = useRef<
    (chatId: string, text: string, to: RoleId | null, fichiers: string[], horsFile?: boolean) => void
  >(() => {});

  /** La suite de la file d'attente, quand l'agent a fini. */
  const suivant = useCallback((chatId: string) => {
    const prochain = stateRef.current.file[chatId]?.[0];
    if (!prochain) return;
    dispatch({ type: "file/retirer", chatId, id: prochain.id });
    // L'état « travail » est libéré au rendu suivant : le message part juste après.
    timers.current.push(
      setTimeout(() => envoyerRef.current(chatId, prochain.text, prochain.to, prochain.fichiers, true), 0),
    );
  }, []);

  /** Fait répondre un agent à un message. */
  const lancer = useCallback(
    (chatId: string, roleId: RoleId, messageUtilisateur: Message) => {
      const chat = stateRef.current.chats.find((c) => c.id === chatId);
      if (!chat) return;
      const messageId = crypto.randomUUID();
      const reponse: Message = {
        id: messageId,
        chatId,
        author: { kind: "role", roleId },
        createdAt: new Date().toISOString(),
        parts: [],
        statut: "en-cours",
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
          case "etape-fin":
            maj((m) => ({
              ...m,
              parts: finirEtape(m.parts, event.id, event.ok),
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
            break;
        }
      });

      const project = stateRef.current.projects.find((p) => p.id === chat.projectId);
      void bridge.claude
        .stream(messageId, {
          agent: roleId === "principal" ? null : roleId,
          prompt: construirePrompt(chat, roleId, messageUtilisateur),
          dossier: chat.kind === "equipe" ? (project?.folder ?? null) : null,
          sessionId: chat.sessions[roleId] ?? null,
          modele: stateRef.current.chats.find((c) => c.id === chatId)?.modele ?? null,
          effort: stateRef.current.chats.find((c) => c.id === chatId)?.effort ?? null,
          fichiers: messageUtilisateur.parts.flatMap((p) => (p.type === "fichiers" ? p.chemins : [])),
        })
        .then((r) => {
          if (!r.ok)
            ecouteurs.current.get(messageId)?.({
              type: "fin",
              ok: false,
              texte: "",
              erreur: r.message,
            });
        });
    },
    [bridge, construirePrompt, suivant],
  );
  const lancerRef = useRef(lancer);
  useEffect(() => {
    lancerRef.current = lancer;
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
    (chatId: string, text: string, to: RoleId | null, fichiers: string[], horsFile = false) => {
      const chat = assurerChat(chatId);
      if (!chat) return;

      // L'agent travaille encore : le message attend son tour.
      if (stateRef.current.travail[chatId] && !horsFile) {
        dispatch({
          type: "file/ajouter",
          chatId,
          message: { id: crypto.randomUUID(), text, to, fichiers },
        });
        return;
      }

      const message: Message = {
        id: crypto.randomUUID(),
        chatId,
        author: { kind: "user" },
        createdAt: new Date().toISOString(),
        parts: fichiers.length
          ? [
              { type: "text", text },
              { type: "fichiers", chemins: fichiers },
            ]
          : [{ type: "text", text }],
      };
      dispatch({ type: "message/add", message });
      const roleId = chat.kind === "direct" ? chat.roleIds[0] : (to ?? "principal");
      // Le message est dans l'état au prochain rendu : l'agent part juste après.
      timers.current.push(setTimeout(() => lancerRef.current(chatId, roleId, message), 0));
    },
    [assurerChat],
  );
  useEffect(() => {
    envoyerRef.current = envoyer;
  });
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

  const startChat = useCallback((projectId: string, text: string, to: RoleId | null) => {
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
    envoyerRef.current(id, text, to, []);
    return id;
  }, []);

  const arreter = useCallback(
    (chatId: string) => {
      const travail = stateRef.current.travail[chatId];
      if (travail && bridge) void bridge.claude.cancel(travail.messageId);
    },
    [bridge],
  );

  const nouvelleConversation = useCallback((chatId: string) => {
    if (stateRef.current.travail[chatId]) return;
    dispatch({ type: "chat/vider", id: chatId });
  }, []);

  const retirerDeLaFile = useCallback(
    (chatId: string, id: string) => dispatch({ type: "file/retirer", chatId, id }),
    [],
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

  /** Lance une tâche planifiée : sa consigne part à l'agent, dans sa conversation. */
  const executerRoutine = useCallback((routine: Routine, rattrapee: boolean) => {
    let chatId = idDirect(routine.roleId);
    if (routine.projectId) {
      // Une conversation d'équipe par tâche planifiée, dans son projet.
      chatId = `routine-${routine.id}`;
      if (!stateRef.current.chats.some((c) => c.id === chatId)) {
        const chat: Chat = {
          id: chatId,
          kind: "equipe",
          projectId: routine.projectId,
          title: routine.nom,
          roleIds: ["principal", routine.roleId],
          updatedAt: new Date().toISOString(),
          sessions: {},
          luJusqua: null,
        };
        dispatch({ type: "chat/add", chat });
        stateRef.current = { ...stateRef.current, chats: [chat, ...stateRef.current.chats] };
      }
    }
    const maintenant = new Date();
    const suite: Routine = {
      ...routine,
      prochaine: prochainPassage(routine.frequence, maintenant).toISOString(),
      historique: [{ at: maintenant.toISOString(), chatId, rattrapee }, ...routine.historique].slice(0, 30),
    };
    dispatch({ type: "routine/enregistrer", routine: suite });
    stateRef.current = {
      ...stateRef.current,
      routines: stateRef.current.routines.map((r) => (r.id === suite.id ? suite : r)),
    };
    envoyerRef.current(chatId, `Tâche planifiée « ${routine.nom} »\n\n${routine.consigne}`, routine.roleId, []);
  }, []);

  /* Toutes les 30 s, les tâches dont l'heure est passée partent. Une heure
     passée pendant que l'app était fermée est rattrapée une seule fois. */
  useEffect(() => {
    if (!state.charge) return;
    const verifier = () => {
      const maintenant = Date.now();
      for (const r of stateRef.current.routines) {
        if (!r.active || new Date(r.prochaine).getTime() > maintenant) continue;
        executerRoutine(r, maintenant - new Date(r.prochaine).getTime() > 5 * 60_000);
      }
    };
    verifier();
    const id = setInterval(verifier, 30_000);
    return () => clearInterval(id);
  }, [state.charge, executerRoutine]);

  const enregistrerRoutine = useCallback((routine: Routine) => {
    dispatch({ type: "routine/enregistrer", routine });
  }, []);
  const supprimerRoutine = useCallback((id: string) => dispatch({ type: "routine/supprimer", id }), []);
  const lancerRoutine = useCallback(
    (id: string) => {
      const routine = stateRef.current.routines.find((r) => r.id === id);
      if (routine) executerRoutine(routine, false);
    },
    [executerRoutine],
  );

  const ajouterArtefact = useCallback((artefact: Omit<Artefact, "id" | "ajouteLe">) => {
    dispatch({
      type: "artefact/ajouter",
      artefact: { ...artefact, id: crypto.randomUUID(), ajouteLe: new Date().toISOString() },
    });
  }, []);
  const supprimerArtefact = useCallback((id: string) => dispatch({ type: "artefact/supprimer", id }), []);

  const value = useMemo(
    () => ({
      state,
      sendMessage,
      choisirModele,
      nouvelleConversation,
      startChat,
      arreter,
      retirerDeLaFile,
      marquerLu,
      enregistrerRoutine,
      supprimerRoutine,
      lancerRoutine,
      ajouterArtefact,
      supprimerArtefact,
    }),
    [
      state,
      sendMessage,
      choisirModele,
      nouvelleConversation,
      startChat,
      arreter,
      retirerDeLaFile,
      marquerLu,
      enregistrerRoutine,
      supprimerRoutine,
      lancerRoutine,
      ajouterArtefact,
      supprimerArtefact,
    ],
  );
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
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

/** Un agent par son id. S'il a été supprimé ou n'est pas installé sur ce
 *  poste, un agent de remplacement (les anciens messages restent lisibles). */
export function useRole(id: RoleId): Role {
  const roles = useRoles();
  return (
    roles.find((r) => r.id === id) ?? {
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

/** Une conversation par son id. Celle d'un agent (`dm-<agent>`) existe dès qu'on l'ouvre, même vide. */
export function useChat(id: string | null): Chat | undefined {
  const { chats } = useWorkspace().state;
  const roles = useRoles();
  return useMemo(() => {
    const chat = chats.find((c) => c.id === id);
    if (chat || !id?.startsWith(DIRECT)) return chat;
    const role = roles.find((r) => r.id === id.slice(DIRECT.length));
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
  }, [chats, roles, id]);
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

/** Conversations d'équipe, de la plus récente à la plus ancienne. */
export function useRecentChats(limit?: number): Chat[] {
  const { chats } = useWorkspace().state;
  return useMemo(() => {
    const sorted = chats.filter((c) => c.kind === "equipe").sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return limit ? sorted.slice(0, limit) : sorted;
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

/** Fichiers touchés par les agents dans les chats d'un projet (journaux de travail). */
export function useModifiedFiles(projectId: string | null): Set<string> {
  const { chats, messages } = useWorkspace().state;
  return useMemo(() => {
    const chatIds = new Set(chats.filter((c) => c.projectId === projectId).map((c) => c.id));
    const paths = new Set<string>();
    for (const message of messages) {
      if (!chatIds.has(message.chatId)) continue;
      for (const part of message.parts) if (part.type === "worklog") part.files.forEach((f) => paths.add(f.path));
    }
    return paths;
  }, [chats, messages, projectId]);
}
