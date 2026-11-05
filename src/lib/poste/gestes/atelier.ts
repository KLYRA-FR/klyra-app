"use client";

import { teinteNouvelAgent, useAgents } from "@/lib/agents";
import { getBridge } from "@/lib/bridge";
import { gestesAtelier } from "@/lib/telephone/gestes-atelier";
import { gestesEquipe } from "@/lib/telephone/gestes-equipe";
import { useWorkspace } from "@/lib/workspace";
import type { Gestes } from "../types";

/**
 * Gestes « atelier » que l'ordinateur fait pour le téléphone : la carte d'un agent en préparation
 * (cf. gestes-atelier.ts) et celle d'une équipe (cf. gestes-equipe.ts).
 */
export function useGestesAtelier(): Gestes {
  const { state, marquerAtelier, marquerEquipe } = useWorkspace();
  const { roles, create, identifiantLibre } = useAgents();
  const messages = (conversation: string) => (state.chats.some((c) => c.id === conversation) ? state.messages.filter((m) => m.chatId === conversation) : null);
  return {
    ...gestesAtelier({
      messages,
      lieu: (conversation) => state.chats.find((c) => c.id === conversation)?.lieu ?? null,
      roles,
      identifiantLibre,
      create,
      marquer: marquerAtelier,
      essayer: getBridge()?.claude.essayer ?? null,
      teinteDe: teinteNouvelAgent,
    }),
    ...gestesEquipe({ messages, roles, identifiantLibre, create, marquer: marquerEquipe, teinteDe: teinteNouvelAgent }),
  };
}
