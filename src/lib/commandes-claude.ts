"use client";

/**
 * Les commandes « / » que Claude Code annonce pour une conversation (réponse à son initialisation, puis
 * `commands_changed`) : gardées en mémoire, par machine et par dossier de travail, pour le menu « / » du composeur.
 * Rien sur le disque : elles reviennent avec la prochaine session.
 */
import { useSyncExternalStore } from "react";
import type { CommandeClaude } from "@/lib/bridge";

const parCle = new Map<string, CommandeClaude[]>();
const abonnes = new Set<() => void>();
const VIDE: CommandeClaude[] = [];

/** Où une conversation travaille : sa machine, et son projet (ou l'agent, hors projet). */
export function cleCommandes(lieu: string | null | undefined, dossier: string | null | undefined, roleId: string): string {
  return `${lieu || "pc"}|${dossier || `agent:${roleId}`}`;
}

export function noterCommandes(cle: string, commandes: CommandeClaude[]): void {
  parCle.set(cle, commandes);
  for (const a of abonnes) a();
}

export function useCommandesClaude(cle: string): CommandeClaude[] {
  return useSyncExternalStore(
    (cb) => {
      abonnes.add(cb);
      return () => abonnes.delete(cb);
    },
    () => parCle.get(cle) ?? VIDE,
    () => VIDE,
  );
}
