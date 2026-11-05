import { texteExtrait } from "@/lib/apercu/extrait";
import type { Citation, Message } from "@/types/domain";

/** Les réactions proposées sous une réponse d'agent, pour le plaisir (rien n'est envoyé à l'agent). */
export const REACTIONS = ["👍", "👎", "❤️", "😂", "🎉", "😮"] as const;

/** Longueur de l'extrait gardé avec une réponse : ce qu'il faut pour savoir de quoi on parle. */
const EXTRAIT_MAX = 280;

/** Un passage cité en Markdown, prêt pour le composeur. */
export const citer = (texte: string) => `${texte.trim().split("\n").map((l) => `> ${l}`).join("\n")}\n\n`;

/** Un titre de fil tiré du passage : sa première ligne, raccourcie. */
export const titreDuPassage = (texte: string) => {
  const ligne = texte.replace(/[#*_`>]/g, "").trim().split("\n")[0] ?? "";
  return ligne.length > 60 ? `${ligne.slice(0, 57).trimEnd()}…` : ligne;
};

const EVENEMENT = "klyra:repondre";

interface DemandeReponse {
  chatId: string;
  citation: Citation;
}

/** La citation d'une réponse d'agent : son id, son auteur et le début de son texte, sans Markdown. */
export function citationDe(message: Message, texte: string): Citation | null {
  if (message.author.kind !== "role") return null;
  const extrait = texteExtrait(texte);
  if (!extrait) return null;
  return {
    messageId: message.id,
    roleId: message.author.roleId,
    extrait: extrait.length > EXTRAIT_MAX ? `${extrait.slice(0, EXTRAIT_MAX - 1).trimEnd()}…` : extrait,
  };
}

/** « Répondre » sous une réponse : le composeur de la conversation la reprend au-dessus du champ. */
export function repondreA(chatId: string, citation: Citation) {
  window.dispatchEvent(new CustomEvent<DemandeReponse>(EVENEMENT, { detail: { chatId, citation } }));
}

export function surRepondre(chatId: string, faire: (citation: Citation) => void): () => void {
  const ecouter = (e: Event) => {
    const { detail } = e as CustomEvent<DemandeReponse>;
    if (detail.chatId === chatId) faire(detail.citation);
  };
  window.addEventListener(EVENEMENT, ecouter);
  return () => window.removeEventListener(EVENEMENT, ecouter);
}
