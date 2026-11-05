/**
 * La conversation où ouvrir une réponse : celle d'une routine (serveur/routines.mjs), ou celle d'un
 * message écrit sur le téléphone pendant que le PC était fermé (son texte vient avec).
 */
export interface ContexteReponse {
  chatId: string;
  agentId: string;
  titre: string;
  telephone?: { messageId: string; texte: string; creeLe: string };
}

/** Le contexte reçu du VPS, vérifié : sinon null, et la réponse s'ouvre par sa session seulement. */
export function contexteDe(origine: string, c: Partial<ContexteReponse> | undefined): (ContexteReponse & { lieu: string }) | null {
  if (!c || typeof c.chatId !== "string" || typeof c.agentId !== "string") return null;
  const titre = typeof c.titre === "string" ? c.titre.slice(0, 200) : "Routine";
  if (/^routine-[A-Za-z0-9_-]{1,80}$/.test(c.chatId)) return { chatId: c.chatId, agentId: c.agentId, titre, lieu: origine };
  const t = c.telephone;
  if (!/^[A-Za-z0-9_.:@-]{1,120}$/.test(c.chatId) || !t || typeof t.messageId !== "string" || typeof t.texte !== "string" || typeof t.creeLe !== "string") return null;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(t.messageId) || Number.isNaN(Date.parse(t.creeLe))) return null;
  return { chatId: c.chatId, agentId: c.agentId, titre, lieu: origine, telephone: { messageId: t.messageId, texte: t.texte.slice(0, 8000), creeLe: t.creeLe } };
}
