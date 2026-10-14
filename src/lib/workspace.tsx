"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  type ReactNode,
} from "react";
import { PRINCIPAL } from "@/data/agents";
import { createMockWorkspace, type MockWorkspace } from "@/data/mock";
import { AgentsProvider, useAgents } from "@/lib/agents";
import type { Chat, Message, Project, Role, RoleId } from "@/types/domain";

/**
 * État de l'espace de travail (chats, messages, projets, rôles).
 * Phase front : tout vit en mémoire et les réponses des rôles sont simulées.
 * Au branchement du back, seul ce fichier change : les écrans passent déjà
 * par les hooks ci-dessous.
 */

interface Typing {
  chatId: string;
  roleId: RoleId;
}

interface WorkspaceState extends MockWorkspace {
  typing: Typing | null;
}

type WorkspaceAction =
  | { type: "chat/add"; chat: Chat }
  | { type: "message/add"; message: Message }
  | { type: "typing/set"; typing: Typing | null };

function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
    case "chat/add":
      return { ...state, chats: [action.chat, ...state.chats] };
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
    case "typing/set":
      return { ...state, typing: action.typing };
  }
}

/* Réponses simulées, en attendant les vrais agents. */
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
const TYPING_DELAY_MS = 500;
const REPLY_DELAY_MS = 1900;

interface WorkspaceApi {
  state: WorkspaceState;
  /** Envoie un message ; sans destinataire, c’est le Principal qui répond. */
  sendMessage: (chatId: string, text: string, to: RoleId | null) => void;
  /** Ouvre un nouveau chat dans un projet avec ce premier message ; renvoie son id. */
  startChat: (projectId: string, text: string, to: RoleId | null) => string;
}

/** Titre d’un nouveau chat : le début du premier message. */
function chatTitle(text: string): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > 42 ? `${clean.slice(0, 40).trimEnd()}…` : clean;
}

const WorkspaceContext = createContext<WorkspaceApi | null>(null);

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    ...createMockWorkspace(),
    typing: null,
  }));
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    const pending = timers.current;
    return () => pending.forEach(clearTimeout);
  }, []);

  const sendMessage = useCallback((chatId: string, text: string, to: RoleId | null) => {
    dispatch({
      type: "message/add",
      message: {
        id: crypto.randomUUID(),
        chatId,
        author: { kind: "user" },
        createdAt: new Date().toISOString(),
        parts: [{ type: "text", text }],
      },
    });

    const roleId = to ?? "principal";
    timers.current.push(
      setTimeout(() => dispatch({ type: "typing/set", typing: { chatId, roleId } }), TYPING_DELAY_MS),
      setTimeout(() => {
        dispatch({ type: "typing/set", typing: null });
        dispatch({
          type: "message/add",
          message: {
            id: crypto.randomUUID(),
            chatId,
            author: { kind: "role", roleId },
            createdAt: new Date().toISOString(),
            parts: [{ type: "text", text: SIMULATED_REPLIES[roleId] ?? "Bien reçu, je m’en occupe et je te réponds ici." }],
          },
        });
      }, REPLY_DELAY_MS),
    );
  }, []);

  const startChat = useCallback(
    (projectId: string, text: string, to: RoleId | null) => {
      const id = crypto.randomUUID();
      const roleIds: RoleId[] = to && to !== "principal" ? ["principal", to] : ["principal"];
      dispatch({
        type: "chat/add",
        chat: { id, projectId, title: chatTitle(text), roleIds, updatedAt: new Date().toISOString() },
      });
      sendMessage(id, text, to);
      return id;
    },
    [sendMessage],
  );

  const value = useMemo(() => ({ state, sendMessage, startChat }), [state, sendMessage, startChat]);
  return (
    <AgentsProvider>
      <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>
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

export function useChat(id: string | null): Chat | undefined {
  const { chats } = useWorkspace().state;
  return chats.find((c) => c.id === id);
}

export function useChatMessages(chatId: string): Message[] {
  const { messages } = useWorkspace().state;
  return useMemo(() => messages.filter((m) => m.chatId === chatId), [messages, chatId]);
}

/** Chats triés du plus récent au plus ancien. */
export function useRecentChats(limit?: number): Chat[] {
  const { chats } = useWorkspace().state;
  return useMemo(() => {
    const sorted = [...chats].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return limit ? sorted.slice(0, limit) : sorted;
  }, [chats, limit]);
}

export interface ChatPreview {
  /** Rôle à afficher en avatar : auteur du dernier message, ou le Principal. */
  roleId: RoleId;
  text: string;
}

/** Aperçu de la liste : « Dev : c’est visible sur l’aperçu… ». */
export function useChatPreview(chatId: string): ChatPreview {
  const { messages } = useWorkspace().state;
  const roles = useRoles();
  return useMemo(() => {
    const last = messages.findLast((m) => m.chatId === chatId);
    const firstText = last?.parts.find((p) => p.type === "text");
    const text = firstText?.type === "text" ? firstText.text : "Nouveau chat";
    if (!last || last.author.kind === "user") return { roleId: "principal", text: last ? `Toi : ${text}` : text };
    const { roleId } = last.author;
    const name = roles.find((r) => r.id === roleId)?.name ?? "";
    return { roleId, text: `${name} : ${text}` };
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
