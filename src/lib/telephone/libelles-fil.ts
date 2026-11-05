import { lireIdDirect } from "@/lib/lieux";
import type { ConversationLue } from "./chats";

/** Identité pour les libellés uniquement : le suffixe d’hôte reste dans l’origine d’envoi. */
export function agentPourLibelle(origine: string, conversation?: Pick<ConversationLue, "parent" | "roleIds">): string | null {
  return lireIdDirect(origine)?.roleId ?? lireIdDirect(conversation?.parent ?? "")?.roleId ?? conversation?.roleIds[0] ?? null;
}
