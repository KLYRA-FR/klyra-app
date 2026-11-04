"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { lireClePoste } from "./SignalPoste";
import { ErreurPoste, type Gestes } from "@/lib/poste/types";
import { useGestesAgents } from "@/lib/poste/gestes/agents";
import { useGestesArtefacts } from "@/lib/poste/gestes/artefacts";
import { useGestesAtelier } from "@/lib/poste/gestes/atelier";
import { useGestesAutomatisations } from "@/lib/poste/gestes/automatisations";
import { useGestesFichiers } from "@/lib/poste/gestes/fichiers";
import { useGestesFil } from "@/lib/poste/gestes/fil";
import { useGestesPlanning } from "@/lib/poste/gestes/planning";
import { useGestesReglages } from "@/lib/poste/gestes/reglages";

/** Une réponse plus grande part dans le stockage du compte (un document tient 1 Mo). */
const REPONSE_DOCUMENT_MAX = 700_000;
/** Un geste qui ne finit pas : le téléphone a déjà dit « ne répond pas », on libère la demande. */
const GESTE_MAX_MS = 90_000;

function avecDelai<T>(promesse: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const minuteur = setTimeout(() => reject(new ErreurPoste("delai", "Le geste a pris trop de temps.")), ms);
    promesse.then(
      (valeur) => {
        clearTimeout(minuteur);
        resolve(valeur);
      },
      (err: unknown) => {
        clearTimeout(minuteur);
        reject(err);
      },
    );
  });
}

/** La clé de cet ordinateur, une fois que `SignalPoste` l'a créée (premier lancement). */
function useClePoste(actif: boolean): string | null {
  const [cle, setCle] = useState<string | null>(() => lireClePoste());
  useEffect(() => {
    if (cle) return;
    const minuteur = setInterval(() => {
      const lue = lireClePoste();
      if (lue) setCle(lue);
    }, 1000);
    return () => clearInterval(minuteur);
  }, [cle]);
  return actif ? cle : null;
}

/**
 * L'ordinateur répond aux demandes du téléphone (spec mobile M-3) : il prend chaque demande
 * qui l'attend, fait le geste demandé, et rend la réponse au compte. Le téléphone ne monte pas
 * ce composant. Les gestes vivent par domaine dans `src/lib/poste/gestes/`.
 */
export function ServicePoste({ actif }: { actif: boolean }) {
  const posteCle = useClePoste(actif);
  const aTraiter = useQuery(api.demandesPoste.aTraiter, posteCle ? { posteCle } : "skip");
  const prendre = useMutation(api.demandesPoste.prendre);
  const repondre = useMutation(api.demandesPoste.repondre);
  const adresseDepot = useMutation(api.demandesPoste.adresseDepot);

  const gestes: Gestes = {
    "poste.ping": async () => ({ ok: true }),
    ...useGestesFichiers(),
    ...useGestesAutomatisations(),
    ...useGestesFil(),
    ...useGestesAgents(),
    ...useGestesAtelier(),
    ...useGestesArtefacts(),
    ...useGestesReglages(),
    ...useGestesPlanning(),
  };
  /* Les gestes changent à chaque rendu (ils lisent l'état) : la boucle lit toujours les derniers. */
  const courants = useRef(gestes);
  useEffect(() => {
    courants.current = gestes;
  });
  const vus = useRef(new Set<string>());

  useEffect(() => {
    if (!posteCle || !aTraiter) return;
    for (const { _id } of aTraiter) {
      if (vus.current.has(_id)) continue;
      vus.current.add(_id);
      void traiter(_id);
    }

    async function traiter(id: Id<"demandesPoste">) {
      const prise = await prendre({ id, posteCle: posteCle! }).catch(() => null);
      if (!prise) return;
      const geste = courants.current[prise.type];
      try {
        if (!geste) throw new ErreurPoste("inconnu", "Cette version de KLYRA sur l’ordinateur ne sait pas encore le faire. Mets-la à jour.");
        const donnees = await avecDelai(geste(JSON.parse(prise.args) as unknown), GESTE_MAX_MS);
        const json = JSON.stringify(donnees ?? null);
        if (json.length <= REPONSE_DOCUMENT_MAX) {
          await repondre({ id, reponse: json });
          return;
        }
        const adresse = await adresseDepot();
        const envoi = await fetch(adresse, { method: "POST", headers: { "Content-Type": "application/json" }, body: json });
        if (!envoi.ok) throw new ErreurPoste("depot", "La réponse n’a pas pu partir vers ton compte.");
        const { storageId } = (await envoi.json()) as { storageId: Id<"_storage"> };
        await repondre({ id, fichier: storageId });
      } catch (err) {
        const erreur =
          err instanceof ErreurPoste
            ? { code: err.code, message: err.message }
            : { code: "erreur", message: err instanceof Error && err.message ? err.message.slice(0, 300) : "Le geste a échoué sur l’ordinateur." };
        await repondre({ id, erreur }).catch(() => {
          /* Demande expirée entre-temps. */
        });
      }
    }
  }, [posteCle, aTraiter, prendre, repondre, adresseDepot]);

  return null;
}
