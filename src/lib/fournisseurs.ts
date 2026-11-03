import type { Chat, Message, RoleId } from "@/types/domain";

/**
 * Les fournisseurs qui font travailler les agents (cf. electron/moteurs) : ce que tu choisis
 * (« ChatGPT »), et le moteur que l'app lance (« codex »). Claude Code reste celui par défaut.
 */
export const FOURNISSEURS = [
  { id: "claude", nom: "Claude", moteur: "Claude Code", initiale: "C" },
  { id: "codex", nom: "ChatGPT", moteur: "Codex", initiale: "G" },
] as const;

export type IdFournisseur = (typeof FOURNISSEURS)[number]["id"];

export const PAR_DEFAUT: IdFournisseur = "claude";

export function fournisseur(id: string | null | undefined) {
  return FOURNISSEURS.find((f) => f.id === id) ?? FOURNISSEURS[0];
}

/** Le moteur qui répond dans cette conversation. Sur un VPS, Claude Code seul pour l'instant. */
export function moteurDe(chat: Pick<Chat, "fournisseur" | "lieu">): string {
  return chat.lieu ? PAR_DEFAUT : chat.fournisseur || PAR_DEFAUT;
}

/**
 * La conversation passe sur un autre moteur. Une session n'existe que dans le moteur qui l'a créée :
 * celles d'ici restent de côté, celles que la conversation avait laissées là-bas reviennent
 * (comme `changerDeLieu`). Ce que l'agent n'a pas vu lui est redonné avec le message (cf. `aReprendre`).
 */
export function changerDeMoteur(chat: Chat, moteur: string): Chat {
  const avant = chat.fournisseur || PAR_DEFAUT;
  if (avant === moteur) return chat;
  const { [moteur]: reprises = {}, ...autres } = chat.sessionsParMoteur ?? {};
  const laissees = Object.keys(chat.sessions).length ? { ...autres, [avant]: chat.sessions } : autres;
  const suivant: Chat = { ...chat, fournisseur: moteur, sessions: reprises, sessionsParMoteur: laissees };
  if (moteur === PAR_DEFAUT) delete suivant.fournisseur;
  if (!Object.keys(laissees).length) delete suivant.sessionsParMoteur;
  return suivant;
}

/** Le moteur qui a écrit un message d'agent. */
export const moteurDuMessage = (m: Message) => m.moteur || PAR_DEFAUT;

/**
 * Ce que l'agent n'a pas encore vu avec ce moteur : tout ce qui suit sa dernière réponse écrite
 * avec lui. Jamais répondu avec ce moteur : toute la conversation, pour qu'il la reprenne.
 */
export function aReprendre(fil: Message[], roleId: RoleId, moteur: string): Message[] {
  const derniere = fil.findLastIndex((m) => m.author.kind === "role" && m.author.roleId === roleId && moteurDuMessage(m) === moteur);
  return fil.slice(derniere + 1);
}

/** Au-delà, les plus anciens messages repris sont laissés de côté. */
export const REPRISE_MAX = 30_000;

/** Garde les dernières lignes dans la limite, et dit combien sont laissées. */
export function limiterReprise(lignes: string[], max = REPRISE_MAX): string[] {
  let total = 0;
  let debut = lignes.length;
  while (debut > 0 && total + lignes[debut - 1].length <= max) total += lignes[--debut].length;
  if (debut === 0) return lignes;
  return [`[… ${debut} message${debut > 1 ? "s" : ""} plus ancien${debut > 1 ? "s" : ""} non repris]`, ...lignes.slice(debut)];
}

/** Les efforts de réflexion, du plus léger au plus poussé (Codex en a plus que Claude Code). */
export const EFFORTS: { id: string; nom: string }[] = [
  { id: "none", nom: "Aucun" },
  { id: "minimal", nom: "Minimal" },
  { id: "low", nom: "Bas" },
  { id: "medium", nom: "Moyen" },
  { id: "high", nom: "Élevé" },
  { id: "xhigh", nom: "Très élevé" },
  { id: "max", nom: "Max" },
  { id: "ultra", nom: "Ultra" },
];

export const nomEffort = (id: string | null | undefined) => EFFORTS.find((e) => e.id === id)?.nom ?? id ?? "";
