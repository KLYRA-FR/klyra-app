"use client";

import { useAgents } from "@/lib/agents";
import { appelerCerveau } from "@/lib/cerveau-pont";
import { gestesMemoire } from "@/lib/telephone/gestes-memoire";
import type { Gestes } from "../types";

/** Gestes « mémoire » que l'ordinateur fait pour le téléphone : voir `gestesMemoire` (lecture seule). */
export function useGestesMemoire(): Gestes {
  const { roles, tous } = useAgents();
  return gestesMemoire({
    appeler: appelerCerveau,
    nomAgent: (id) => (roles.find((r) => r.id === id) ?? tous.find((a) => a.role.id === id)?.role)?.name ?? null,
  });
}
