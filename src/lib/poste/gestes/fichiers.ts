"use client";

import { useMutation } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { getBridge } from "@/lib/bridge";
import { carteProjet } from "@/lib/copie-compte";
import { poste } from "@/lib/plateforme";
import { gestesFichiers } from "@/lib/telephone/gestes-fichiers";
import { fichiersModifies, useWorkspace } from "@/lib/workspace";
import type { Gestes } from "../types";

/**
 * Gestes « fichiers » et « projets » que l'ordinateur fait pour le téléphone (spec T-10 à T-13) :
 * `fichiers.arbre`, `fichiers.lire`, `fichiers.ouvrir`, `projets.lire`, `projets.modifier`.
 * Leur logique et leurs gardes sont dans `src/lib/telephone/gestes-fichiers.ts`.
 */
export function useGestesFichiers(): Gestes {
  const { state, enregistrerProjet } = useWorkspace();
  const importerProjets = useMutation(api.conversationsCompte.importerProjets);
  return gestesFichiers({
    projets: state.projects,
    pont: getBridge()?.projets ?? null,
    modifies: (projetId) => fichiersModifies(state, projetId),
    enregistrer: enregistrerProjet,
    publier: (projet) => importerProjets({ lot: [carteProjet(projet)] }),
    ton: poste.ton,
  });
}
