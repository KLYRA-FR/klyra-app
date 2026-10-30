import type { Chat } from "@/types/domain";

/** Une ancienne préférence abîmée ne doit ni bloquer la liste ni devenir une épingle. */
export function estEpinglee(chat: Chat): boolean {
  return typeof chat.epingleLe === "string" && Number.isFinite(Date.parse(chat.epingleLe));
}

/** Nouvelle liste : épingles par date de pose, puis activité. Les égalités restent stables. */
export function trierConversations(chats: Chat[]): Chat[] {
  return [...chats].sort((a, b) => {
    const aEpinglee = estEpinglee(a);
    const bEpinglee = estEpinglee(b);
    if (aEpinglee !== bEpinglee) return aEpinglee ? -1 : 1;
    if (aEpinglee && bEpinglee) {
      const ordre = Date.parse(b.epingleLe!) - Date.parse(a.epingleLe!);
      if (ordre) return ordre;
    }
    return b.updatedAt.localeCompare(a.updatedAt);
  });
}

/** Patch d'un seul champ, également appliqué au chat courant par le reducer. */
export function avecEpingle(chat: Chat, epingler: boolean, maintenant: string): Chat {
  if (chat.kind !== "equipe" || chat.fil || estEpinglee(chat) === epingler) return chat;
  if (epingler) return { ...chat, epingleLe: maintenant };
  const suivant = { ...chat };
  delete suivant.epingleLe;
  return suivant;
}

/** Jamais d'ajout et aucune modification des messages, de l'activité ou des autres conversations. */
export function basculerEpingle(chats: Chat[], id: string, epingler: boolean, maintenant: string): Chat[] {
  const chat = chats.find((c) => c.id === id);
  if (!chat) return chats;
  const suivant = avecEpingle(chat, epingler, maintenant);
  return suivant === chat ? chats : chats.map((c) => c === chat ? suivant : c);
}
