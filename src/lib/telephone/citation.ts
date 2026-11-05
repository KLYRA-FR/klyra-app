import { texteExtrait } from "@/lib/apercu/extrait";

/**
 * La citation en attente dans le brouillon d'une conversation (E2-40, E2-41), gardée sur ce téléphone
 * comme le brouillon lui-même. La retirer ne touche pas au texte libre ; elle ne part qu'avec le message.
 */

export interface CitationBrouillon {
  messageId: string;
  roleId: string;
  extrait: string;
}

const CLE = "klyra-telephone-citations";
const EXTRAIT_MAX = 280;

function lireTout(): Record<string, CitationBrouillon> {
  try {
    const v = JSON.parse(localStorage.getItem(CLE) ?? "{}") as unknown;
    return v && typeof v === "object" ? (v as Record<string, CitationBrouillon>) : {};
  } catch {
    return {};
  }
}

export function lireCitation(origine: string): CitationBrouillon | null {
  return lireTout()[origine] ?? null;
}

export function garderCitation(origine: string, citation: CitationBrouillon | null): void {
  try {
    const tout = lireTout();
    if (citation) tout[origine] = citation;
    else delete tout[origine];
    localStorage.setItem(CLE, JSON.stringify(tout));
  } catch {
    /* stockage indisponible : la citation ne survit pas à la page */
  }
}

/** La citation d'une réponse d'agent : le début de son texte, sans Markdown. Rien à citer : null. */
export function citationDuMessage(message: { origine: string; auteurId: string | null; texte: string }): CitationBrouillon | null {
  if (!message.auteurId) return null;
  const extrait = texteExtrait(message.texte);
  if (!extrait) return null;
  return {
    messageId: message.origine,
    roleId: message.auteurId,
    extrait: extrait.length > EXTRAIT_MAX ? `${extrait.slice(0, EXTRAIT_MAX - 1).trimEnd()}…` : extrait,
  };
}
