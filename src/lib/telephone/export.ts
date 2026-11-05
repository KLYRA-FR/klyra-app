import { preparerExport, type DocumentConversation } from "@/lib/export-conversation";
import { lireParties, type PartieCompte } from "@/lib/copie-compte";
import type { Chat, Message, MessagePart } from "@/types/domain";
import { parentDe, type CarteAgentLue, type ConversationLue } from "./chats";

/** Un message tel que le compte le garde (`conversationsCompte.messages`). */
export interface MessageLu {
  origine: string;
  auteurKind: "user" | "role";
  auteurId: string | null;
  creeLe: string;
  texte: string;
  parties: string;
  statut: "en-cours" | "fait" | "erreur" | null;
  reactions: string[];
  compaction: boolean;
}

/** Les parties du compte ramenées aux blocs que l'export du bureau sait écrire. */
function versParties(parties: PartieCompte[], texte: string): MessagePart[] {
  const blocs: MessagePart[] = [];
  for (const p of parties) {
    if (p.type === "text") blocs.push({ type: "text", text: p.text });
    else if (p.type === "fichiers" && p.fichiers?.length) blocs.push({ type: "fichiers", chemins: p.fichiers.map((f) => f.chemin ?? f.nom) });
    else if (p.type === "passation") blocs.push({ type: "passation", etapeId: "", roleId: p.roleId, consigne: p.consigne ?? "", statut: p.statut });
    else if (p.type === "proposition-agent") {
      blocs.push({ type: "proposition-agent", etapeId: p.etapeId, proposition: { id: "", nom: p.nom, role: p.role, description: p.description, consignes: "" } });
    }
  }
  /* Une copie d'une version d'avant, sans parties lisibles : le texte seul. */
  return blocs.some((b) => b.type === "text") || !texte ? blocs : [{ type: "text", text: texte }, ...blocs];
}

/**
 * « Exporter en Markdown… » sur le téléphone (T-03) : le même document qu'au bureau, préparé à partir
 * de la copie du compte, puis remis à la feuille de partage du système.
 */
export function exporterDepuisLeCompte({
  conversation,
  origine,
  messages,
  cartes,
  moi,
  maintenant,
}: {
  conversation: ConversationLue | undefined;
  origine: string;
  messages: MessageLu[];
  cartes: CarteAgentLue[];
  moi: string;
  maintenant: Date;
}): DocumentConversation | null {
  const agent = origine.startsWith("dm-") ? origine.slice(3) : null;
  const fil = conversation ? parentDe(conversation) : null;
  const chat: Chat = {
    id: origine,
    kind: conversation?.kind ?? "direct",
    projectId: conversation?.projetId ?? null,
    title: conversation?.titre ?? "Conversation",
    roleIds: conversation?.roleIds ?? (agent ? [agent] : []),
    updatedAt: conversation?.misAJour ?? maintenant.toISOString(),
    sessions: {},
    luJusqua: null,
    ...(fil ? { fil: { roleId: fil.slice(3), statut: "ouvert" as const, creeLe: conversation?.misAJour ?? "" } } : {}),
  };
  const lus: Message[] = messages.map((m) => ({
    id: m.origine,
    chatId: origine,
    author: m.auteurKind === "role" && m.auteurId ? { kind: "role", roleId: m.auteurId } : { kind: "user" },
    createdAt: m.creeLe,
    parts: versParties(lireParties(m.parties), m.texte),
    ...(m.statut ? { statut: m.statut } : {}),
  }));
  return preparerExport({
    chat,
    messages: lus,
    moi: { name: moi },
    roles: cartes.map((c) => ({ id: c.origine, name: c.nom, title: c.roleCourt })),
    project: conversation?.projetNom ? { name: conversation.projetNom } : undefined,
    maintenant,
  });
}

/**
 * Remet le document à la feuille de partage du téléphone (un fichier .md si le système l'accepte,
 * sinon le texte), ou le copie à défaut. Renvoie ce qui s'est passé, pour le bandeau.
 */
export async function partagerDocument(document: DocumentConversation): Promise<"partage" | "copie" | "annule" | "impossible"> {
  const fichier = typeof File !== "undefined" ? new File([document.contenu], document.nomPropose, { type: "text/markdown" }) : null;
  try {
    if (fichier && navigator.canShare?.({ files: [fichier] })) {
      await navigator.share({ files: [fichier], title: document.nomPropose });
      return "partage";
    }
    if (navigator.share) {
      await navigator.share({ title: document.nomPropose, text: document.contenu });
      return "partage";
    }
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") return "annule";
  }
  try {
    await navigator.clipboard.writeText(document.contenu);
    return "copie";
  } catch {
    return "impossible";
  }
}
