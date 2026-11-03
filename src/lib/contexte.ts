import type { Chat, RoleId } from "@/types/domain";

/**
 * La taille d'une conversation pour Claude Code : chaque appel au modèle (chaque étape d'une
 * réponse, pas seulement chaque message) relit tout ce qui précède (consignes, outils, échanges).
 * Relu depuis le cache, c'est environ dix fois moins cher ; le cache dure une heure (abonnement,
 * mesuré le 03/11/2026).
 * - Conversation lourde : l'app propose de la résumer (`/compact`). Le résumé coûte une relecture
 *   et sa rédaction, vite rattrapées par les étapes suivantes, qui relisent bien moins.
 * - Reprise après la durée du cache : le prochain message relira tout au prix fort, résumé ou non.
 *   Pour un nouveau sujet, un fil neuf repart léger : c'est ce que l'app propose (là où il y a des fils).
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
