/**
 * La conversation où ouvrir une réponse : celle d'une routine (serveur/routines.mjs), celle d'un
 * message écrit sur le téléphone pendant que le PC était fermé (son texte vient avec), un fil que le
 * serveur tient lui-même (`fil`), ou la conversation à qui le serveur rapporte la réponse d'un fil
 * (`retour` : le message, avant la réponse de l'agent ; cf. serveur/fils.mjs).
 */
/** L'id d'un compte Claude supplémentaire (cf. comptes-claude.ts). */
const ID_COMPTE = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export interface ContexteReponse {
  chatId: string;
  agentId: string;
  titre: string;
  telephone?: { messageId: string; texte: string; creeLe: string };
  /** `compteClaude` : le compte Claude qui a répondu (null : celui des agents) ; absent d'un serveur ancien. */
  choix?: { fournisseur: string; modele: string | null; effort: string | null; compteClaude?: string | null };
  fil?: FilDistant;
  retour?: { messageId: string; roleId: string; texte: string; creeLe: string };
}

/** Un fil tenu par un VPS, tel que l'app le range (`Fil` de src/types/domain.ts). */
export interface FilDistant {
  roleId: string;
  statut: "ouvert" | "archive";
  creeLe: string;
  lancePar: { roleId: string; chatId: string } | null;
  retourAttendu?: boolean;
  etape: "a-faire" | "en-cours" | "bloque" | "a-valider";
  raison: string | null;
  priorite: 0 | 1 | 2 | 3;
  echeance: string | null;
  projetId: string | null;
  suspendu?: boolean;
}

const ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const CHAT = /^[A-Za-z0-9_.:@-]{1,120}$/;
const ETAPES = ["a-faire", "en-cours", "bloque", "a-valider"] as const;

/** Le fil reçu du VPS, champ par champ : sinon null. */
export function filDistantDe(brut: unknown): FilDistant | null {
  const f = (brut ?? null) as Record<string, unknown> | null;
  if (!f || typeof f !== "object") return null;
  if (typeof f.roleId !== "string" || !ID.test(f.roleId)) return null;
  if (typeof f.creeLe !== "string" || Number.isNaN(Date.parse(f.creeLe))) return null;
  const l = f.lancePar as Record<string, unknown> | null | undefined;
  const lancePar = l && typeof l.roleId === "string" && ID.test(l.roleId) && typeof l.chatId === "string" && CHAT.test(l.chatId) ? { roleId: l.roleId, chatId: l.chatId } : null;
  const etape = ETAPES.find((e) => e === f.etape) ?? "a-faire";
  const priorite = [0, 1, 2, 3].includes(f.priorite as number) ? (f.priorite as 0 | 1 | 2 | 3) : 0;
  return {
    roleId: f.roleId,
    statut: f.statut === "archive" ? "archive" : "ouvert",
    creeLe: f.creeLe,
    lancePar,
    ...(f.retourAttendu === true && lancePar ? { retourAttendu: true } : {}),
    etape,
    raison: typeof f.raison === "string" ? f.raison.slice(0, 300) : null,
    priorite,
    echeance: typeof f.echeance === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f.echeance) ? f.echeance : null,
    projetId: typeof f.projetId === "string" && CHAT.test(f.projetId) ? f.projetId : null,
    ...(f.suspendu === true ? { suspendu: true } : {}),
  };
}

/** Le contexte reçu du VPS, vérifié : sinon null, et la réponse s'ouvre par sa session seulement. */
export function contexteDe(origine: string, c: Partial<ContexteReponse> | undefined): (ContexteReponse & { lieu: string }) | null {
  if (!c || typeof c.chatId !== "string" || typeof c.agentId !== "string") return null;
  const titre = typeof c.titre === "string" ? c.titre.slice(0, 200) : "Routine";
  /* Une routine, ou l'étape d'un workflow qui tourne sur le serveur. */
  if (/^(routine|wf)-[A-Za-z0-9_-]{1,80}$/.test(c.chatId)) return { chatId: c.chatId, agentId: c.agentId, titre, lieu: origine };
  /* Un fil tenu par le serveur : l'app le crée s'il n'est pas encore là. */
  if (/^klyra-fil-[A-Za-z0-9_-]{1,80}$/.test(c.chatId) && ID.test(c.agentId)) {
    const fil = filDistantDe(c.fil);
    return { chatId: c.chatId, agentId: c.agentId, titre, lieu: origine, ...(fil ? { fil } : {}) };
  }
  /* La réponse d'un fil rapportée à la conversation qui l'a lancé : son message vient avec. */
  const r = c.retour;
  if (r && CHAT.test(c.chatId) && ID.test(c.agentId)) {
    if (typeof r.messageId !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(r.messageId) || typeof r.roleId !== "string" || !ID.test(r.roleId)) return null;
    if (typeof r.texte !== "string" || typeof r.creeLe !== "string" || Number.isNaN(Date.parse(r.creeLe))) return null;
    return { chatId: c.chatId, agentId: c.agentId, titre, lieu: origine, retour: { messageId: r.messageId, roleId: r.roleId, texte: r.texte.slice(0, 200_000), creeLe: r.creeLe } };
  }
  const t = c.telephone;
  if (!/^[A-Za-z0-9_.:@-]{1,120}$/.test(c.chatId) || !t || typeof t.messageId !== "string" || typeof t.texte !== "string" || typeof t.creeLe !== "string") return null;
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(t.messageId) || Number.isNaN(Date.parse(t.creeLe))) return null;
  const choix = c.choix;
  const valide = choix && ["claude", "codex", "grok"].includes(choix.fournisseur)
    && (choix.modele === null || typeof choix.modele === "string" && /^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(choix.modele))
    && (choix.effort === null || typeof choix.effort === "string" && /^[a-z]{1,12}$/.test(choix.effort));
  const compte = valide && choix.compteClaude !== undefined ? (choix.compteClaude === null ? null : typeof choix.compteClaude === "string" && ID_COMPTE.test(choix.compteClaude) ? choix.compteClaude : undefined) : undefined;
  const lu = valide ? { fournisseur: choix.fournisseur, modele: choix.modele, effort: choix.effort, ...(compte !== undefined ? { compteClaude: compte } : {}) } : null;
  return { chatId: c.chatId, agentId: c.agentId, titre, lieu: origine, telephone: { messageId: t.messageId, texte: t.texte.slice(0, 8000), creeLe: t.creeLe }, ...(lu ? { choix: lu } : {}) };
}
