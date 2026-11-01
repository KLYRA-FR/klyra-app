"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useCompte } from "@/lib/compte";

/** Les ordinateurs du compte. Le téléphone ne s'y signale pas. */
export function usePostes() {
  const { etat } = useCompte();
  const postes = useQuery(api.postes.etat, etat === "connecte" ? {} : "skip");
  const principal = postes?.[0] ?? null;
  return {
    postes,
    principal,
    ouvert: postes?.some((poste) => poste.ouvert) ?? false,
    charge: etat === "connecte" && postes === undefined,
  };
}
