import type { Chat, Message } from "@/types/domain";

/**
 * Supprimer une conversation d'équipe (clic droit dans le panneau des conversations) : la conversation et
 * tous ses messages quittent l'état, donc `conversations.json`, l'espace de son VPS (`aRetirer` de
 * `espace-sync.ts`) et la copie du téléphone (`alignerConversations`). Les livrables publiés restent dans
 * Artefacts. Une conversation directe d'agent et un fil ne se suppriment pas ici (un fil se ferme).
 */

/** La raison du refus, ou null si la conversation peut être supprimée. */
export function refusSuppression(chat: Chat | undefined, travaille: boolean): string | null {
  if (!chat) return "Cette conversation n’existe plus.";
  if (chat.fil) return "Un fil ne se supprime pas ici : ferme-le depuis ses onglets.";
  if (chat.kind !== "equipe") return "La conversation d’un agent ne se supprime pas.";
  if (travaille) return "Un agent travaille dans cette conversation : arrête-le avant de la supprimer.";
  return null;
}

/** L'état sans la conversation : ses messages et les messages qui attendaient d'y partir s'en vont avec elle. */
export function sansConversation<E extends { chats: Chat[]; messages: Message[]; file: Record<string, unknown[]> }>(etat: E, chatId: string): E {
  const file = { ...etat.file };
  delete file[chatId];
  return {
    ...etat,
    chats: etat.chats.filter((c) => c.id !== chatId),
    messages: etat.messages.filter((m) => m.chatId !== chatId),
    file,
  };
}
