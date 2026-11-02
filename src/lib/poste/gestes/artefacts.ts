"use client";

import { getBridge } from "@/lib/bridge";
import { poste } from "@/lib/plateforme";
import { gestesArtefacts } from "@/lib/telephone/gestes-artefacts";
import { useWorkspace } from "@/lib/workspace";
import type { Gestes } from "../types";

/** Gestes « artefacts » que l'ordinateur fait pour le téléphone (T-20) : voir `gestesArtefacts`. */
export function useGestesArtefacts(): Gestes {
  const { state, synchroniserArtefacts, modifierArtefact, supprimerArtefact, ajouterArtefact } = useWorkspace();
  const bridge = getBridge();
  return gestesArtefacts({
    ton: poste.ton,
    artefacts: () => state.artefacts,
    projets: () => state.projects,
    synchroniser: synchroniserArtefacts,
    modifier: modifierArtefact,
    supprimer: supprimerArtefact,
    ajouter: ajouterArtefact,
    session: async () => {
      const r = await bridge?.artefacts.etatSession();
      return !!r?.ok && r.data;
    },
    vignette: async (url) => {
      const r = await bridge?.artefacts.vignette(url, true);
      return r?.ok ? r.data : null;
    },
  });
}
