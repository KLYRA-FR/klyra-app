"use client";

import { teinteNouvelAgent, useAgents } from "@/lib/agents";
import { getBridge } from "@/lib/bridge";
import { gestesAtelier } from "@/lib/telephone/gestes-atelier";
import { useWorkspace } from "@/lib/workspace";
import type { Gestes } from "../types";

/** Gestes « atelier » que l'ordinateur fait pour le téléphone : la carte d'un agent en préparation (cf. gestes-atelier.ts). */
export function useGestesAtelier(): Gestes {
  const { state, marquerAtelier } = useWorkspace();
  const { roles, create, identifiantLibre } = useAgents();
  return gestesAtelier({
    messages: (conversation) => (state.chats.some((c) => c.id === conversation) ? state.messages.filter((m) => m.chatId === conversation) : null),
    lieu: (conversation) => state.chats.find((c) => c.id === conversation)?.lieu ?? null,
    roles,
    identifiantLibre,
    create,
    marquer: marquerAtelier,
    essayer: getBridge()?.claude.essayer ?? null,
    teinteDe: teinteNouvelAgent,
  });
}
