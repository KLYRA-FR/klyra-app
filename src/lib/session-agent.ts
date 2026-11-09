/**
 * Ce que l'écran fait des nouveautés d'une session de Claude Code (cf. electron/session-claude.ts) : la réflexion
 * repliée, le diff et la sortie des étapes, les modifications d'une réponse regroupées par fichier, et « Revenir à
 * avant ce message » (les modifications à annuler, la conversation à reprendre). Pur : testé seul.
 */
import type { Chat, Etape, Message, MessagePart, ModifEtape, RoleId } from "@/types/domain";

/* ─── Réflexion ───────────────────────────────────────────────── */

/** Ferme la dernière réflexion encore ouverte : la suite de la réponse commence. */
export function fermerReflexion(parts: MessagePart[], maintenant: number): MessagePart[] {
  const i = parts.findLastIndex((p) => p.type === "reflexion" && p.fin === undefined);
  if (i === -1) return parts;
  return parts.map((p, j) => (j === i && p.type === "reflexion" ? { ...p, fin: maintenant } : p));
}

/** Un morceau de réflexion : à la suite de la réflexion en cours, ou dans un nouveau bloc. */
export function ajouterReflexion(parts: MessagePart[], texte: string, nouveau: boolean, maintenant: number): MessagePart[] {
  const dernier = parts[parts.length - 1];
  if (!nouveau && dernier?.type === "reflexion" && dernier.fin === undefined) {
    return [...parts.slice(0, -1), { ...dernier, texte: dernier.texte + texte }];
  }
  return [...fermerReflexion(parts, maintenant), { type: "reflexion", texte, debut: maintenant }];
}

/** « 12 s », « 1 min 04 » : le temps passé à réfléchir (ou à faire tourner une commande). */
export function duree(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${String(s % 60).padStart(2, "0")}`;
}

/* ─── Étapes ──────────────────────────────────────────────────── */

/** Change une étape de la réponse (par son id d'appel d'outil). */
export function majEtape(parts: MessagePart[], id: string, patch: (e: Etape) => Etape): MessagePart[] {
  return parts.map((p) => (p.type === "etapes" && p.etapes.some((e) => e.id === id) ? { ...p, etapes: p.etapes.map((e) => (e.id === id ? patch(e) : e)) } : p));
}

/** Ce que l'écran garde de la sortie d'une commande dans la conversation enregistrée. */
export const SORTIE_GARDEE = 4096;
export const sortieGardee = (texte: string) => (texte.length > SORTIE_GARDEE ? `…\n${texte.slice(-SORTIE_GARDEE)}` : texte);

/* ─── Modifications de fichiers ───────────────────────────────── */

export interface FichierModifie {
  chemin: string;
  /** Les étapes (appels d'outil) qui l'ont modifié dans la réponse, dans l'ordre. */
  ids: string[];
  ajouts: number;
  retraits: number;
  cree: boolean;
  /** Toutes ses modifications sont annulables depuis l'app. */
  annulable: boolean;
  /** Le diff de chaque modification, dans l'ordre. */
  diffs: { id: string; modif: ModifEtape }[];
  etat: "a-revoir" | "gardee" | "annulee";
}

/** Les fichiers modifiés par une réponse (sous-agents compris), avec leurs diffs et ce que la personne en a fait. */
export function fichiersModifies(message: Message): FichierModifie[] {
  const etapes = message.parts.flatMap((p) => (p.type === "etapes" ? p.etapes : []));
  const parChemin = new Map<string, FichierModifie>();
  for (const e of etapes) {
    if (!e.modif || !e.chemin || e.statut === "erreur") continue;
    const f = parChemin.get(e.chemin) ?? { chemin: e.chemin, ids: [], ajouts: 0, retraits: 0, cree: false, annulable: true, diffs: [], etat: "a-revoir" as const };
    f.ids.push(e.id);
    f.ajouts += e.modif.ajouts;
    f.retraits += e.modif.retraits;
    f.cree ||= e.modif.cree && f.ids.length === 1;
    f.annulable &&= e.modif.annulable;
    f.diffs.push({ id: e.id, modif: e.modif });
    parChemin.set(e.chemin, f);
  }
  return [...parChemin.values()].map((f) => {
    const etats = f.diffs.map((d) => d.modif.etat);
    const etat = etats.every((x) => x === "annulee") ? "annulee" : etats.every((x) => x === "gardee" || x === "annulee") ? "gardee" : "a-revoir";
    return { ...f, etat };
  });
}

/** Marque les étapes d'une réponse : gardées, ou annulées (seulement celles dont le fichier est revenu comme avant). */
export function marquerModifs(parts: MessagePart[], ids: Set<string>, etat: "gardee" | "annulee", le: string): MessagePart[] {
  return parts.map((p) =>
    p.type === "etapes" && p.etapes.some((e) => ids.has(e.id) && e.modif)
      ? { ...p, etapes: p.etapes.map((e) => (ids.has(e.id) && e.modif && e.modif.etat !== "annulee" ? { ...e, modif: { ...e.modif, etat, le } } : e)) }
      : p,
  );
}

/** Le nom d'un fichier et son dossier relatif au projet (affichage). */
export function cheminAffiche(chemin: string, dossier: string | null): string {
  if (dossier && chemin.startsWith(`${dossier.replace(/\/+$/, "")}/`)) return chemin.slice(dossier.replace(/\/+$/, "").length + 1);
  return chemin.replace(/^\/(Users|home)\/[^/]+/, "~");
}

/* ─── Revenir à avant un message ──────────────────────────────── */

/** Les modifications faites depuis ce message (inclus) dans la conversation, pas encore annulées. */
export function modificationsDepuis(messages: Message[], messageId: string): { ids: string[]; chemins: string[] } {
  const depart = messages.findIndex((m) => m.id === messageId);
  if (depart === -1) return { ids: [], chemins: [] };
  const ids: string[] = [];
  const chemins = new Set<string>();
  for (const m of messages.slice(depart)) {
    for (const p of m.parts) {
      if (p.type !== "etapes") continue;
      for (const e of p.etapes) {
        if (!e.modif || !e.chemin || e.statut === "erreur" || e.modif.etat === "annulee") continue;
        ids.push(e.id);
        chemins.add(e.chemin);
      }
    }
  }
  return { ids, chemins: [...chemins] };
}

/**
 * Revenir à avant un message de la personne : les messages à retirer (lui et la suite), son texte (remis dans le
 * champ), et pour chaque agent qui avait déjà répondu, d'où sa session reprend (`uuidFin` de sa dernière réponse
 * d'avant) ; null : il n'avait rien dit avant, sa session repart de zéro. Un agent dont la dernière réponse d'avant
 * n'a pas de repère (moteur sans `uuidFin`) repart aussi de zéro.
 */
export function retourAvant(chat: Chat, messages: Message[], messageId: string): { retires: string[]; texte: string; reprises: Record<RoleId, string | null> } | null {
  const fil = messages.filter((m) => m.chatId === chat.id);
  const depart = fil.findIndex((m) => m.id === messageId);
  const cible = fil[depart];
  if (depart === -1 || cible.author.kind !== "user") return null;
  const avant = fil.slice(0, depart);
  const apres = fil.slice(depart);
  const reprises: Record<RoleId, string | null> = {};
  const touches = new Set(apres.flatMap((m) => (m.author.kind === "role" ? [m.author.roleId] : [])));
  for (const roleId of touches) {
    const derniere = avant.findLast((m) => m.author.kind === "role" && m.author.roleId === roleId && m.statut !== "en-cours");
    reprises[roleId] = derniere?.uuidFin && chat.sessions[roleId] ? derniere.uuidFin : null;
  }
  const texte = cible.parts.flatMap((p) => (p.type === "text" ? [p.text] : [])).join("\n\n");
  return { retires: apres.map((m) => m.id), texte, reprises };
}

/** Les sessions et reprises de la conversation après un retour : une session reprise à son repère, ou oubliée. */
export function sessionsApresRetour(chat: Chat, reprises: Record<RoleId, string | null>): Pick<Chat, "sessions" | "reprises"> {
  const sessions = { ...chat.sessions };
  const suite = { ...(chat.reprises ?? {}) };
  for (const [roleId, uuid] of Object.entries(reprises)) {
    if (uuid) suite[roleId] = uuid;
    else {
      delete sessions[roleId];
      delete suite[roleId];
    }
  }
  return { sessions, reprises: suite };
}

/** Ce qu'un agent doit savoir des annulations faites depuis sa dernière réponse (null : rien). */
export function noteAnnulations(chat: Chat, depuis: string | null): string | null {
  const recentes = (chat.annulations ?? []).filter((a) => !depuis || a.le > depuis);
  const fichiers = [...new Set(recentes.flatMap((a) => a.fichiers))];
  if (!fichiers.length) return null;
  return `[La personne a annulé des modifications : ${fichiers.slice(0, 30).join(", ")}${fichiers.length > 30 ? "…" : ""} ${fichiers.length > 1 ? "sont revenus" : "est revenu"} comme avant. Relis-les avant d'y toucher.]`;
}
