import type { Chat, Message, RoleId } from "@/types/domain";

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

/** Une conversation tenue par l'app pour une routine ou un workflow, pas par la personne. */
export const estAutomatique = (id: string) => id.startsWith("routine-") || id.startsWith("wf-");
const automatique = estAutomatique;

/**
 * Les agents d'une conversation de routine ou de workflow : celui qui travaille d'abord (c'est l'agent de la
 * conversation, à qui va un message sans mention, dont l'en-tête montre le visage), puis ceux qui y sont déjà,
 * puis les nouveaux. L'assistant n'y entre que s'il travaille ou qu'on le mentionne.
 */
export function agentsAutomatisation(agent: RoleId, autres: RoleId[], existants: RoleId[] = []): RoleId[] {
  return [...new Set<RoleId>([...(existants.length ? existants : [agent]), agent, ...autres])];
}

/**
 * Les conversations de routine et de workflow d'avant le 09/11/2026 avaient l'assistant en tête sans qu'il y
 * travaille : un message sans mention allait à lui, l'en-tête montrait son visage. S'il n'y a jamais répondu,
 * il en sort, et le premier agent qui y a répondu prend la tête. Les autres conversations ne bougent pas.
 */
export function sansAssistantImpose(chats: Chat[], messages: Pick<Message, "chatId" | "author">[]): Chat[] {
  const aRepondu = new Map<string, RoleId[]>();
  for (const m of messages) {
    if (m.author.kind !== "role") continue;
    const liste = aRepondu.get(m.chatId) ?? [];
    if (!liste.includes(m.author.roleId)) aRepondu.set(m.chatId, [...liste, m.author.roleId]);
  }
  return chats.map((c) => {
    if (c.kind !== "equipe" || !estAutomatique(c.id) || c.roleIds[0] !== "principal" || c.roleIds.length < 2) return c;
    const repondu = aRepondu.get(c.id) ?? [];
    if (repondu.includes("principal")) return c;
    const tete = repondu.find((r) => c.roleIds.includes(r)) ?? c.roleIds[1];
    return { ...c, roleIds: [tete, ...c.roleIds.filter((r) => r !== tete && r !== "principal")] };
  });
}

/**
 * La conversation qu'ouvre le projet : la dernière où l'on a travaillé, s'il y en a une. Celles d'une routine
 * ou d'un workflow passent après : une routine horaire ne doit pas prendre la place de la conversation de la personne.
 */
export function derniereConversation<T extends Pick<Chat, "id" | "projectId" | "kind" | "updatedAt">>(chats: T[], projectId: string): string | null {
  const liste = conversationsDuProjet(chats, projectId);
  return (liste.find((c) => !automatique(c.id)) ?? liste[0])?.id ?? null;
}
