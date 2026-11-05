"use client";

import { useConvex } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useAgents } from "@/lib/agents";
import { getBridge } from "@/lib/bridge";
import { messageErreur } from "@/lib/compte";
import { poste } from "@/lib/plateforme";
import { gestesArtefacts } from "@/lib/telephone/gestes-artefacts";
import { useWorkspace } from "@/lib/workspace";
import { ErreurPoste, type Gestes } from "../types";

/** Gestes « artefacts » que l'ordinateur fait pour le téléphone (lot 7) : voir `gestesArtefacts`. */
export function useGestesArtefacts(): Gestes {
  const { state, synchroniserArtefacts, modifierArtefact, supprimerArtefact, ajouterArtefact, retirerRendu } = useWorkspace();
  const { roles, tous } = useAgents();
  const convex = useConvex();
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
    rendus: () => state.rendus,
    claude: () => state.artefactsClaude,
    nomAgent: (id) => (roles.find((r) => r.id === id) ?? tous.find((a) => a.role.id === id)?.role)?.name ?? null,
    vignetteRendu: async (chemin, forcer) => {
      const r = await bridge?.rendus.vignette(chemin, forcer);
      return r?.ok ? r.data : null;
    },
    ouvrirRendu: async (chemin) => {
      const r = await bridge?.rendus.ouvrir(chemin);
      if (!r?.ok) throw new Error(r?.message ?? "Ouverture impossible.");
    },
    /* Comme la carte du bureau : un rendu partagé quitte le compte avec sa copie. */
    retirerPartage: async (origine) => {
      try {
        const { documents } = await convex.query(api.documentsKlyra.lister, { lieu: null });
        const partage = documents.find((doc) => doc.deMoi && doc.origine === origine);
        if (partage) await convex.mutation(api.documentsKlyra.supprimer, { documentId: partage._id as Id<"documentsKlyra">, lieu: null });
      } catch (e) {
        throw new ErreurPoste("compte", messageErreur(e));
      }
    },
    retirerRendu,
  });
}
