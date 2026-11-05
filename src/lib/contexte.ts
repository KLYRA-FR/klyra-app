import type { Chat, Message, RoleId } from "@/types/domain";

/**
 * La taille d'une conversation pour Claude Code : chaque appel au modèle (chaque étape d'une
 * réponse, pas seulement chaque message) relit tout ce qui précède (consignes, outils, échanges).
 * Relu depuis le cache, c'est environ dix fois moins cher ; le cache dure une heure (abonnement,
 * mesuré le 03/11/2026).
 * - Conversation lourde : l'app propose de la résumer (`/compact`). Le résumé coûte une relecture
 *   et sa rédaction, vite rattrapées par les étapes suivantes, qui relisent bien moins.
 * - Reprise après la durée du cache : le prochain message relira tout au prix fort, résumé ou non.
 *   Pour un nouveau sujet, on repart léger : à zéro dans le chat d'un agent, un fil neuf dans un fil.
 */

/** La commande de Claude Code qui résume la conversation et garde l'essentiel. */
export const COMMANDE_COMPACTER = "/compact";

/*
 * Les seuils portent sur les échanges (taille moins socle) : le socle (consignes, outils, agents
 * listés : ~15 k jetons avant ces réglages, ~12 k après, mesurés par `pnpm mesure:socle`) est le même
 * pour un fil neuf, et un résumé ne le réduit pas.
 */
/** Au-delà, chaque étape relit beaucoup d'échanges : on propose de résumer. */
export const SEUIL_LOURD = 50_000;
/** Après la durée du cache, autant d'échanges seraient relus au prix fort au prochain message. */
export const SEUIL_REPRISE = 30_000;
export const DUREE_CACHE_MS = 60 * 60 * 1000;
/** « Plus tard » : le conseil revient quand la conversation a encore grossi d'autant. */
export const MARGE_PLUS_TARD = 20_000;

export interface MesureContexte {
  /** Ce que relit chaque appel : socle et échanges. */
  jetons: number;
  /** Le premier appel de la session : son socle (consignes, outils, premier message). */
  base?: number;
  /** Date de la mesure (ISO) : le cache court depuis le dernier appel. */
  le: string;
  /** La session mesurée : une session neuve (autre lieu, autre moteur) repart de zéro. */
  session: string | null;
}

/** La part des échanges : ce qu'un résumé ou un fil neuf allégerait. */
export const echanges = (mesure: MesureContexte): number => Math.max(0, mesure.jetons - (mesure.base ?? 0));

/**
 * La mesure suivante d'une session : le socle est pris au premier appel. Après un résumé, `apres`
 * ne compte que le résumé : la taille est estimée (socle + résumé) jusqu'à la mesure suivante.
 */
export function nouvelleMesure(
  precedente: MesureContexte | undefined,
  session: string | null,
  mesure: { jetons: number } | { resume: number },
  le: string,
): MesureContexte {
  const memeSession = !!precedente && precedente.session === session;
  const base = memeSession ? (precedente.base ?? precedente.jetons) : "jetons" in mesure ? mesure.jetons : 0;
  const jetons = "jetons" in mesure ? mesure.jetons : base + mesure.resume;
  return { jetons, base, le, session };
}

export interface ConseilContexte {
  roleId: RoleId;
  jetons: number;
  /** `lourde` : chaque étape relit beaucoup, résumer allège la suite ; `pause` : un fil neuf pour un nouveau sujet. */
  raison: "lourde" | "pause";
  /** Le cache a expiré : le prochain message relira tout au prix fort. */
  cacheExpire: boolean;
  /** Un fil neuf avec cet agent est possible (conversation directe ou fil). */
  filPossible: boolean;
}

/* ─── Repartir à zéro ──────────────────────────────────────────────── */

/** Le chat d'un agent, celui qui reste toujours là : ni un fil (une tâche), ni une conversation d'équipe. */
export const estChatPrincipal = (chat: Pick<Chat, "kind" | "fil">): boolean => chat.kind === "direct" && !chat.fil;

/** Ce message précède le dernier départ : il reste lisible, l'agent ne le relit plus. */
export function estAvantDepart(chat: Pick<Chat, "departs">, message: Pick<Message, "createdAt">): boolean {
  const dernier = chat.departs?.at(-1);
  return !!dernier && message.createdAt <= dernier;
}

/** Repartir n'a de sens que s'il y a quelque chose depuis le dernier départ. */
export const peutRepartir = (chat: Pick<Chat, "departs">, messages: Pick<Message, "createdAt">[]): boolean => messages.some((m) => !estAvantDepart(chat, m));

/** Les départs à montrer juste avant ce message (`suivant` absent : à la fin du fil). */
export function departsAvant(chat: Pick<Chat, "departs">, precedent?: Pick<Message, "createdAt">, suivant?: Pick<Message, "createdAt">): string[] {
  return (chat.departs ?? []).filter((d) => (!precedent || d >= precedent.createdAt) && (!suivant || d < suivant.createdAt));
}

/** La conversation sans ce que l'agent en retient : ses sessions partout, sa taille mesurée, ce qu'elle reprenait. */
function sansMemoire(chat: Chat): Chat {
  const suivant: Chat = { ...chat, sessions: {}, taches: [], sessionNeuve: true };
  delete suivant.sessionsParLieu;
  delete suivant.sessionsParMoteur;
  delete suivant.contexte;
  delete suivant.contexteMasqueJusqua;
  delete suivant.amorce;
  delete suivant.departs;
  return suivant;
}

/** « Repartir à zéro » : les messages restent, l'agent les oublie. */
export const repartirAZero = (chat: Chat, le: string): Chat => ({ ...sansMemoire(chat), departs: [...(chat.departs ?? []), le] });

/** « Effacer et repartir » : les messages partent aussi (la conversation les retire de son côté). */
export const viderConversation = (chat: Chat): Chat => ({ ...sansMemoire(chat), luJusqua: null });

/** « /compact », seul ou suivi de consignes pour le résumé. */
export function estCommandeCompacter(texte: string): boolean {
  const t = texte.trim();
  return t === COMMANDE_COMPACTER || t.startsWith(`${COMMANDE_COMPACTER} `);
}

/** La mesure de l'agent, si elle vaut pour sa session actuelle. */
export function mesureActuelle(chat: Chat, roleId: RoleId): MesureContexte | null {
  const mesure = chat.contexte?.[roleId];
  const session = chat.sessions[roleId] ?? null;
  if (!mesure || !session || mesure.session !== session) return null;
  return mesure;
}

/** Le conseil à montrer au-dessus du composeur, pour l'agent dont la conversation pèse le plus. */
export function conseilContexte(chat: Chat, maintenant: number): ConseilContexte | null {
  let plusLourd: { roleId: RoleId; mesure: MesureContexte } | null = null;
  for (const roleId of chat.roleIds) {
    const mesure = mesureActuelle(chat, roleId);
    if (mesure && (!plusLourd || echanges(mesure) > echanges(plusLourd.mesure))) plusLourd = { roleId, mesure };
  }
  if (!plusLourd) return null;
  const { roleId, mesure } = plusLourd;
  if (mesure.jetons <= (chat.contexteMasqueJusqua ?? 0)) return null;
  const cacheExpire = maintenant - Date.parse(mesure.le) > DUREE_CACHE_MS;
  const filPossible = chat.kind === "direct" || !!chat.fil;
  const conseil = { roleId, jetons: mesure.jetons, cacheExpire, filPossible };
  if (echanges(mesure) >= SEUIL_LOURD) return { ...conseil, raison: "lourde" };
  // Résumer ne rattraperait pas la relecture : seul un fil neuf l'évite, là où il y en a.
  if (cacheExpire && filPossible && echanges(mesure) >= SEUIL_REPRISE) return { ...conseil, raison: "pause" };
  return null;
}

/** 82 400 → « 82 k ». */
export function formaterJetons(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)} k` : String(n);
}

/* ─── Résumé automatique (configuration KLYRA, `resumeAuto`) ───────────── */

/**
 * La commande envoyée pour un résumé automatique : `/compact` et ce qu'il doit garder.
 * Jamais pendant qu'un agent travaille : avant un message, ou pendant une pause.
 */
export const COMMANDE_RESUME_AUTO = `${COMMANDE_COMPACTER} Garde les décisions prises, les chemins des fichiers, les tâches en cours et les accords donnés par la personne.`;
/** Pendant une pause : autant d'échanges, résumés tant que le cache est chaud, épargnent une relecture au prix fort au retour. */
export const SEUIL_RESUME_PAUSE = 40_000;
/** Avant un message : au-delà, le résumé passe d'abord (chaque étape de la réponse relira bien moins). */
export const SEUIL_RESUME_ENVOI = 80_000;
/** La pause qui déclenche le résumé : avant que l'app ne ferme la session (30 min) et que le cache n'expire (1 h). */
export const PAUSE_AVANT_RESUME_MS = 25 * 60 * 1000;
/** Au-delà, le cache a sans doute expiré (poste en veille…) : le résumé coûterait autant que la relecture. */
export const PAUSE_MAX_RESUME_MS = 55 * 60 * 1000;

/** L'agent dont la conversation, en pause, est à résumer maintenant ; null sinon. */
export function resumePause(chat: Chat, maintenant: number): RoleId | null {
  if (chat.fil?.statut === "archive") return null;
  let choisi: { roleId: RoleId; echanges: number } | null = null;
  for (const roleId of chat.roleIds) {
    const mesure = mesureActuelle(chat, roleId);
    if (!mesure) continue;
    const pause = maintenant - Date.parse(mesure.le);
    if (pause < PAUSE_AVANT_RESUME_MS || pause > PAUSE_MAX_RESUME_MS || echanges(mesure) < SEUIL_RESUME_PAUSE) continue;
    if (!choisi || echanges(mesure) > choisi.echanges) choisi = { roleId, echanges: echanges(mesure) };
  }
  return choisi?.roleId ?? null;
}

/** Résumer avant d'envoyer ce message à cet agent ? */
export function resumeAvantEnvoi(chat: Chat, roleId: RoleId): boolean {
  const mesure = mesureActuelle(chat, roleId);
  return !!mesure && echanges(mesure) >= SEUIL_RESUME_ENVOI;
}
