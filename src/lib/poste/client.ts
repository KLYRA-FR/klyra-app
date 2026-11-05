"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useConvex } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { messageErreur, useCompte } from "@/lib/compte";
import { usePostes } from "@/components/telephone/poste";
import { cleVue, garderVue, lireVue, type VueGardee } from "@/lib/telephone/vue-gardee";
import { DELAI_REPONSE_MS } from "./types";

/**
 * Le téléphone demande à l'ordinateur ouvert (spec mobile M-3) : « Demande à ton Mac… » (P-9),
 * puis la réponse, ou « Ton Mac ne répond pas » (P-10). La réponse est lue puis effacée du compte (M-7).
 */

export type ResultatPoste<T> = { ok: true; data: T } | { ok: false; code: string; message: string };

type Suivi = { statut: "attente" | "prise" | "faite" | "erreur"; reponse: string | null; url: string | null; erreur: { code: string; message: string } | null } | null;

/** Envoie une demande et attend sa réponse. `delai` : au-delà, « ne répond pas » et la demande est retirée. */
export function useDemandePoste() {
  const convex = useConvex();
  return useCallback(
    async <T>(type: string, args: unknown = {}, options: { delai?: number; posteCle?: string | null } = {}): Promise<ResultatPoste<T>> => {
      let id: Id<"demandesPoste">;
      try {
        id = await convex.mutation(api.demandesPoste.demander, { type, args: JSON.stringify(args ?? {}), posteCle: options.posteCle ?? null });
      } catch (err) {
        return { ok: false, code: "compte", message: messageErreur(err) };
      }
      const oublier = () => void convex.mutation(api.demandesPoste.oublier, { id }).catch(() => undefined);
      return await new Promise<ResultatPoste<T>>((resolve) => {
        const suivi = convex.watchQuery(api.demandesPoste.suivre, { id });
        let fini = false;
        const finir = (resultat: ResultatPoste<T>) => {
          if (fini) return;
          fini = true;
          clearTimeout(minuteur);
          desabonner();
          oublier();
          resolve(resultat);
        };
        const minuteur = setTimeout(() => finir({ ok: false, code: "delai", message: "" }), options.delai ?? DELAI_REPONSE_MS);
        const lire = () => {
          let etat: Suivi | undefined;
          try {
            etat = suivi.localQueryResult() as Suivi | undefined;
          } catch (err) {
            finir({ ok: false, code: "compte", message: messageErreur(err) });
            return;
          }
          if (etat === undefined) return;
          if (etat === null) {
            finir({ ok: false, code: "delai", message: "" });
            return;
          }
          if (etat.statut === "erreur") {
            finir({ ok: false, code: etat.erreur?.code ?? "erreur", message: etat.erreur?.message ?? "" });
            return;
          }
          if (etat.statut !== "faite") return;
          const { reponse, url } = etat;
          void (async () => {
            try {
              const brut = reponse ?? (url ? await (await fetch(url)).text() : "null");
              finir({ ok: true, data: JSON.parse(brut) as T });
            } catch {
              finir({ ok: false, code: "lecture", message: "La réponse n’a pas pu être lue." });
            }
          })();
        };
        const desabonner = suivi.onUpdate(lire);
        lire();
      });
    },
    [convex],
  );
}

export type LecturePoste<T> =
  | { etat: "aucun" }
  | { etat: "ferme"; gardee: VueGardee<T> | null }
  | { etat: "attente"; lent: boolean }
  | { etat: "delai" }
  | { etat: "erreur"; code: string; message: string }
  | { etat: "ok"; data: T };

/**
 * Une lecture sur l'ordinateur pour un écran (dossier, routines…). Aucun ordinateur relié au compte :
 * « aucun » (P-13), jamais « fermé ». Ordinateur fermé : « ferme » sans rien envoyer (P-6), avec la
 * dernière réponse lue sur ce téléphone s'il y en a une (vue gardée, socle § 5.4). Relue quand il se
 * rouvre, et par `relancer` (tirer vers le bas, Réessayer). `args` à null : rien à lire pour l'instant.
 * `garder: false` : une lecture qui ne vaut que sur le moment (un aperçu calculé), jamais gardée.
 * `horsLigne` : ce téléphone n'a plus le réseau : rien n'est demandé, la vue gardée se lit comme poste fermé.
 */
export function useLecturePoste<T>(
  type: string,
  args: unknown | null,
  options: { delai?: number; garder?: boolean; horsLigne?: boolean } = {},
): LecturePoste<T> & { relancer: () => void } {
  const demander = useDemandePoste();
  const { etat: compte, moi } = useCompte();
  const { postes, principal, ouvert, charge } = usePostes();
  const cle = args === null ? null : JSON.stringify(args);
  const garder = options.garder ?? true;
  const membre = compte === "connecte" && moi ? (moi._id as string) : null;
  const vueDe = (poste: string | null | undefined) => (garder && membre && poste && cle !== null ? cleVue(membre, poste, type, cle) : null);
  /* La vue se range sous le poste qui a répondu (le premier ouvert), relue sous le dernier vu (`principal`). */
  const ouRanger = useRef<string | null>(null);
  const rangement = vueDe(postes?.find((p) => p.ouvert)?.cle);
  useEffect(() => {
    ouRanger.current = rangement;
  }, [rangement]);
  const horsLigne = options.horsLigne ?? false;
  const ferme = cle !== null && !charge && (!ouvert || horsLigne) && (postes?.length ?? 0) > 0;
  const ouRelire = ferme ? vueDe(principal?.cle) : null;
  const gardee = useMemo(() => (ouRelire ? lireVue<T>(ouRelire) : null), [ouRelire]);
  const [tour, setTour] = useState(0);
  /* La lecture vaut pour une demande (type, arguments, tour) : une autre demande repart de « attente ». */
  const demande = `${type}|${cle}|${tour}`;
  const [lu, setLu] = useState<{ demande: string; lecture: LecturePoste<T> } | null>(null);
  /* Une grande réponse (image d'un projet) peut demander plus que le délai de P-10. */
  const delai = options.delai;

  useEffect(() => {
    if (cle === null || compte !== "connecte" || charge || !ouvert || horsLigne) return;
    let actuelle = true;
    /* Le squelette n'apparaît qu'après 300 ms (spec § 5). */
    const lent = setTimeout(() => setLu((avant) => (avant?.demande === demande ? avant : { demande, lecture: { etat: "attente", lent: true } })), 300);
    void demander<T>(type, JSON.parse(cle), { delai }).then((r) => {
      clearTimeout(lent);
      if (!actuelle) return;
      const lecture: LecturePoste<T> = r.ok
        ? { etat: "ok", data: r.data }
        : r.code === "delai"
          ? { etat: "delai" }
          : { etat: "erreur", code: r.code, message: r.message };
      setLu({ demande, lecture });
      if (r.ok && ouRanger.current) garderVue(ouRanger.current, r.data, Date.now());
    });
    return () => {
      actuelle = false;
      clearTimeout(lent);
    };
  }, [type, cle, compte, ouvert, charge, demande, demander, delai, horsLigne]);

  const relancer = useCallback(() => setTour((n) => n + 1), []);
  if (cle !== null && !charge && postes?.length === 0) return { etat: "aucun", relancer };
  if (ferme) return { etat: "ferme", gardee, relancer };
  if (lu?.demande === demande) return { ...lu.lecture, relancer };
  return { etat: "attente", lent: false, relancer };
}

/** Cette lecture a-t-elle une vue gardée sur ce téléphone ? Sans rien demander à l'ordinateur (E5-39). */
export function useVueGardeePresente(type: string, args: unknown): boolean {
  const { etat: compte, moi } = useCompte();
  const { principal } = usePostes();
  const membre = compte === "connecte" && moi ? (moi._id as string) : null;
  const cle = membre && principal?.cle ? cleVue(membre, principal.cle, type, JSON.stringify(args)) : null;
  return useMemo(() => (cle ? lireVue(cle) !== null : false), [cle]);
}

/**
 * Un geste sur l'ordinateur (lancer, enregistrer…) : `faire` renvoie le résultat, `occupe` pendant
 * l'attente. Ordinateur fermé : le bouton est désactivé par l'écran (P-7), pas mis en attente (M-6).
 */
export function useGestePoste() {
  const demander = useDemandePoste();
  const [occupe, setOccupe] = useState(false);
  const faire = useCallback(
    async <T>(type: string, args: unknown = {}, options?: { delai?: number }): Promise<ResultatPoste<T>> => {
      setOccupe(true);
      try {
        return await demander<T>(type, args, options);
      } finally {
        setOccupe(false);
      }
    },
    [demander],
  );
  return { faire, occupe };
}
