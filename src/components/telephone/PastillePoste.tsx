"use client";

import { useState } from "react";
import { libellePastille, texteFeuille, type PosteLu } from "@/lib/poste-texte";
import { cn } from "@/lib/cn";
import { usePostes } from "./poste";

const CLE_PREVENIR = "klyra:poste:prevenir";

function lireSouhaits(): string[] {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_PREVENIR) ?? "[]") as unknown;
    return Array.isArray(brut) ? brut.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

/** Pastille d'en-tête. Ouvre la feuille des postes (T-23). Aucun réveil à distance. */
export function PastillePoste() {
  const { postes, principal } = usePostes();
  const [ouverte, setOuverte] = useState(false);
  const [souhaits, setSouhaits] = useState<string[]>(() => (typeof window === "undefined" ? [] : lireSouhaits()));
  if (!postes) return <span className="h-8 w-16 shrink-0 rounded-full bg-fond-surface-grise" />;

  const vouloir = (cle: string) => {
    const suite = souhaits.includes(cle) ? souhaits : [...souhaits, cle];
    setSouhaits(suite);
    localStorage.setItem(CLE_PREVENIR, JSON.stringify(suite));
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOuverte(true)}
        className="inline-flex h-11 max-w-[140px] shrink-0 items-center rounded-full px-3 text-ui-xs text-texte-principal"
      >
        <span className="truncate">{libellePastille(principal)}</span>
      </button>
      {ouverte ? (
        <div className="fixed inset-0 z-30 flex items-end bg-black/20" onClick={() => setOuverte(false)}>
          <section
            role="dialog"
            aria-label="État du poste"
            className="max-h-[80vh] w-full overflow-y-auto rounded-t-2xl bg-fond-surface p-4 pb-[calc(16px+env(safe-area-inset-bottom))] shadow-ombre-levee"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="text-body-s font-medium text-texte-principal">État du poste</h2>
            {postes.length === 0 ? (
              <div className="mt-4">
                <p className="text-body-s text-texte-principal">Aucun ordinateur relié</p>
                <p className="mt-2 text-ui text-texte-secondaire">
                  Connecte-toi à ton compte dans KLYRA sur ton ordinateur (Réglages › Équipe) pour retrouver tes conversations ici.
                </p>
              </div>
            ) : (
              <ul className="mt-3 flex flex-col gap-4">
                {postes.map((poste) => (
                  <li key={poste.cle}>
                    <p className="text-ui font-medium text-texte-principal">{poste.nom}</p>
                    <p className="mt-1 text-ui text-texte-secondaire">{texteFeuille(poste as PosteLu)}</p>
                    {!poste.ouvert ? (
                      <button type="button" className="mt-2 min-h-11 text-ui text-texte-principal" onClick={() => vouloir(poste.cle)}>
                        {souhaits.includes(poste.cle) ? "On te prévient à l’ouverture" : "Me prévenir à l’ouverture"}
                      </button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            <button type="button" className={cn("mt-4 min-h-11 text-ui text-texte-secondaire")} onClick={() => setOuverte(false)}>
              Fermer
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
