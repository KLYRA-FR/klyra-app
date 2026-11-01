import type { Chat, Message, MessagePart, Project, Role } from "@/types/domain";

const TEXTE_MAX = 8000;
const PARTIES_MAX = 20_000;

/** Parties gardées dans le compte : le texte, le nombre d'étapes, les tâches. Pas les chemins ni les secrets. */
export function partiesReduites(parts: MessagePart[]): string {
  const reduites = parts.map((part) => {
    if (part.type === "text") return { type: "text" as const, text: part.text.slice(0, TEXTE_MAX) };
    if (part.type === "etapes") return { type: "etapes" as const, n: part.etapes.length };
    if (part.type === "tasks") {
      return {
        type: "tasks" as const,
        tasks: part.tasks.slice(0, 40).map((tache) => ({ label: tache.label.slice(0, 120), status: tache.status })),
      };
    }
    if (part.type === "passation") return { type: "passation" as const, roleId: part.roleId, statut: part.statut };
    return { type: part.type };
  });
  const json = JSON.stringify(reduites);
  return json.length <= PARTIES_MAX ? json : JSON.stringify([{ type: "text", text: "" }]);
}

export function nonLusDe(chat: Chat, messages: Message[]): number {
  const seuil = chat.luJusqua;
  const n = messages.filter((m) => m.chatId === chat.id && m.author.kind === "role" && (!seuil || m.createdAt > seuil)).length;
  return Math.min(9999, n);
}

export function conversationCompte(chat: Chat, messages: Message[], projets: Project[]) {
  const duFil = messages.filter((m) => m.chatId === chat.id);
  const dernier = duFil.at(-1);
  const projet = projets.find((p) => p.id === chat.projectId);
  return {
    origine: chat.id,
    kind: chat.kind,
    titre: chat.title,
    projetId: chat.projectId,
    projetNom: projet?.name ?? null,
    roleIds: chat.roleIds.slice(0, 20),
    misAJour: chat.updatedAt,
    epingleLe: chat.epingleLe ?? null,
    extrait: (dernier ? dernier.parts.filter((p) => p.type === "text").map((p) => (p.type === "text" ? p.text : "")).join(" ") : "").slice(0, 240),
    extraitLe: dernier?.createdAt ?? null,
    nonLus: nonLusDe(chat, messages),
    taches: JSON.stringify((chat.taches ?? []).slice(0, 40).map((t) => ({ texte: t.texte.slice(0, 120), statut: t.statut }))).slice(0, 4000),
  };
}

export function messageCompte(message: Message) {
  const texte = message.parts
    .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
    .map((p) => p.text)
    .join("\n\n")
    .slice(0, TEXTE_MAX);
  return {
    conversationOrigine: message.chatId,
    origine: message.id,
    auteurKind: message.author.kind,
    auteurId: message.author.kind === "role" ? message.author.roleId : null,
    creeLe: message.createdAt,
    texte,
    parties: partiesReduites(message.parts),
    statut: message.statut ?? null,
  };
}

export function carteAgent(role: Role, actif: boolean) {
  return {
    origine: role.id,
    nom: role.name,
    teinte: role.teinte,
    roleCourt: role.tag || role.title,
    actif,
  };
}

export function carteProjet(projet: Project) {
  return {
    origine: projet.id,
    nom: projet.name,
    accroche: projet.subtitle,
    statut: projet.status,
    epingle: projet.pinned,
  };
}

export function decoupages<T>(liste: T[], taille: number): T[][] {
  const lots: T[][] = [];
  for (let i = 0; i < liste.length; i += taille) lots.push(liste.slice(i, i + taille));
  return lots;
}
