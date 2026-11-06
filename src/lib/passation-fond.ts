import type { Message, MessagePart } from "@/types/domain";

/**
 * Un agent confié en arrière-plan (outil Agent avec `run_in_background`) : Claude Code répond « lancé » tout
 * de suite, la passation reste donc « Confié à » jusqu'à la notification de sa fin (`tache-fond`, lue par
 * electron/claude.ts et serveur/agents.mjs). Avant, elle passait « Rendu par » dès le lancement.
 */

/** La passation d'un agent lancé en arrière-plan, quand il revient. */
export function finTacheDeFond(parts: MessagePart[], id: string, statut: "fait" | "erreur"): MessagePart[] {
  return parts.map((p) => (p.type === "passation" && p.etapeId === id ? { ...p, statut } : p));
}

/**
 * Au chargement : un agent d'arrière-plan de ce PC est mort avec l'app ; sa passation n'attend plus.
 * Sur un VPS, il a pu continuer : sa fin arrivera par le journal.
 */
export function sansFondOrphelin(m: Message, local: boolean): Message {
  if (!local || !m.parts.some((p) => p.type === "passation" && p.fond && p.statut === "en-cours")) return m;
  return { ...m, parts: m.parts.map((p) => (p.type === "passation" && p.fond && p.statut === "en-cours" ? { ...p, statut: "erreur" as const } : p)) };
}

