import { useSyncExternalStore } from "react";
import type { AgentEvent } from "@/lib/bridge";

export { resumeFond } from "./fond-resume";

/**
 * Ce que chaque agent fait encore en arrière-plan une fois sa réponse rendue : les commandes et agents
 * lancés en fond, et sa reprise quand l'un d'eux revient (cf. electron/taches-fond.ts, PC et VPS).
 * Sous la conversation : « Iris continue en arrière-plan · Capture de la vidéo · 2 min ».
 * Gardé hors de l'état enregistré, en mémoire seulement : une commande de fond ne survit pas à Claude
 * Code, et Claude Code redit toute la liste à chaque changement.
 */

export type EvenementFond = Extract<AgentEvent, { type: "fond" }>;
export type TacheFond = EvenementFond["taches"][number];

export interface FondAgent {
  roleId: string;
  taches: TacheFond[];
  reprise: boolean;
}

/** Par conversation, un agent par ligne : une liste stable tant qu'elle ne change pas (useSyncExternalStore). */
let fonds: Readonly<Record<string, readonly FondAgent[]>> = {};
const abonnes = new Set<() => void>();
const AUCUN: readonly FondAgent[] = [];

/** Les réponses rendues : leur conversation et leur agent, pour ranger ce qui arrive après leur fin. */
const reponses = new Map<string, { chatId: string; roleId: string }>();
const MAX_REPONSES = 500;

function avertir() {
  for (const f of abonnes) f();
}

/** Ce que l'agent a en fond dans cette conversation : remplace ce qu'on en savait. */
export function poserFond(chatId: string, roleId: string, evenement: Pick<EvenementFond, "taches" | "reprise">): void {
  const avant = fonds[chatId] ?? AUCUN;
  const vide = !evenement.taches.length && !evenement.reprise;
  if (vide && !avant.some((f) => f.roleId === roleId)) return;
  const nouveau: FondAgent = { roleId, taches: evenement.taches, reprise: evenement.reprise };
  const suite = vide
    ? avant.filter((f) => f.roleId !== roleId)
    : avant.some((f) => f.roleId === roleId)
      ? avant.map((f) => (f.roleId === roleId ? nouveau : f))
      : [...avant, nouveau];
  const tout = { ...fonds };
  if (suite.length) tout[chatId] = suite;
  else delete tout[chatId];
  fonds = tout;
  avertir();
}

/** Une réponse ouverte : ce qui arrivera par elle après sa fin ira à sa conversation et à son agent. */
export function noterReponse(requestId: string, chatId: string, roleId: string): void {
  reponses.delete(requestId);
  reponses.set(requestId, { chatId, roleId });
  if (reponses.size > MAX_REPONSES) reponses.delete(reponses.keys().next().value!);
}

/** Un événement « fond » d'une réponse déjà rendue. Faux si la réponse est inconnue (app relancée). */
export function poserFondParReponse(requestId: string, evenement: EvenementFond): boolean {
  const r = reponses.get(requestId);
  if (!r) return false;
  poserFond(r.chatId, r.roleId, evenement);
  return true;
}

export function fondsDe(chatId: string): readonly FondAgent[] {
  return fonds[chatId] ?? AUCUN;
}

/** Pour les tests. */
export function viderFonds(): void {
  fonds = {};
  reponses.clear();
  avertir();
}

function abonner(f: () => void) {
  abonnes.add(f);
  return () => abonnes.delete(f);
}

/** Tout ce qui tourne en fond, par conversation : la copie pour le téléphone le lit. */
export function lireFonds(): Readonly<Record<string, readonly FondAgent[]>> {
  return fonds;
}

/** Pour recopier le compte quand ce qui tourne en fond change. */
export function useTousFonds(): Readonly<Record<string, readonly FondAgent[]>> {
  return useSyncExternalStore(abonner, lireFonds, lireFonds);
}

/** Les agents de cette conversation qui ont quelque chose en fond (ou qui reprennent). */
export function useFonds(chatId: string): readonly FondAgent[] {
  return useSyncExternalStore(abonner, () => fondsDe(chatId), () => AUCUN);
}
