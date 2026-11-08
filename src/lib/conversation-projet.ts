import type { Chat, RoleId } from "@/types/domain";

/**
 * Une conversation de projet se lit comme le chat d'un agent : elle a son agent, le premier de `roleIds`
 * (celui avec qui elle a commencé ; l'assistant pour les anciennes, qui l'avaient en tête). Un message sans
 * mention va à lui ; un agent mentionné rejoint la conversation à la suite, sans prendre sa place.
 */
export function agentDeConversation(chat: Pick<Chat, "roleIds">): RoleId {
  return chat.roleIds[0] ?? "principal";
}

/** Les conversations d'un projet, la plus récente d'abord (épinglées comprises : c'est l'ordre du travail). */
export function conversationsDuProjet<T extends Pick<Chat, "projectId" | "kind" | "updatedAt">>(chats: T[], projectId: string): T[] {
  return chats.filter((c) => c.kind === "equipe" && c.projectId === projectId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** La conversation qu'ouvre le projet : la dernière où l'on a travaillé, s'il y en a une. */
export function derniereConversation<T extends Pick<Chat, "id" | "projectId" | "kind" | "updatedAt">>(chats: T[], projectId: string): string | null {
  return conversationsDuProjet(chats, projectId)[0]?.id ?? null;
}
