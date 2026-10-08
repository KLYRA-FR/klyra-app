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
import { createMockWorkspace, type MockWorkspace } from "@/data/mock";
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
  | { type: "message/add"; message: Message }
  | { type: "typing/set"; typing: Typing | null };

function reducer(state: WorkspaceState, action: WorkspaceAction): WorkspaceState {
  switch (action.type) {
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
const SIMULATED_REPLIES: Record<RoleId, string> = {
  principal: "Bien reçu. Je regarde qui s’en occupe et je reviens vers toi ici.",
  dev: "Je m’en occupe. Je te montre le résultat sur l’aperçu dès que c’est prêt.",
  uxui: "Ok, je te prépare deux options et je les poste ici.",
  da: "Je regarde ça et je te propose une piste visuelle.",
};
const TYPING_DELAY_MS = 500;
const REPLY_DELAY_MS = 1900;

interface WorkspaceApi {
  state: WorkspaceState;
  /** Envoie un message ; sans destinataire, c’est le Principal qui répond. */
  sendMessage: (chatId: string, text: string, to: RoleId | null) => void;
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
            parts: [{ type: "text", text: SIMULATED_REPLIES[roleId] }],
          },
        });
      }, REPLY_DELAY_MS),
    );
  }, []);

  const value = useMemo(() => ({ state, sendMessage }), [state, sendMessage]);
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): WorkspaceApi {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) throw new Error("useWorkspace doit être utilisé dans <WorkspaceProvider>");
  return ctx;
}

/* ─── Sélecteurs ───────────────────────────────────────────────── */

export function useRoles(): Role[] {
  return useWorkspace().state.roles;
}

export function useRole(id: RoleId): Role {
  const role = useRoles().find((r) => r.id === id);
  if (!role) throw new Error(`Rôle inconnu : ${id}`);
  return role;
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
  const { messages, roles } = useWorkspace().state;
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
