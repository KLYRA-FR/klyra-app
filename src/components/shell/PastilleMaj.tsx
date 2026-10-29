"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { useMaj } from "@/lib/maj";
import { apparition } from "@/lib/mouvement";

/**
 * Dans le rail, au-dessus de l'avatar : la pastille « Mettre à jour », dès
 * qu'une nouvelle version est téléchargée et vérifiée. Un clic l'installe et
 * relance l'app. La notification du système prévient aussi.
 */
export function PastilleMaj() {
  const { etat, installer, erreur } = useMaj();
  const [enCours, setEnCours] = useState(false);
  if (etat?.statut !== "prete" || !etat.nouvelle) return null;

  return (
    <button
      ref={apparition}
      type="button"
      disabled={enCours}
      onClick={() => {
        setEnCours(true);
        void installer().finally(() => setEnCours(false));
      }}
      title={erreur ?? `Installer KLYRA ${etat.nouvelle} et relancer l’app`}
      aria-label={`Mettre à jour KLYRA vers la version ${etat.nouvelle} : installe et relance l’app`}
      className="mb-1 flex w-14 cursor-pointer flex-col items-center gap-0.5 rounded-md border-0 bg-fond-accent px-1 pt-2 pb-1.5 text-texte-inverse shadow-ombre-survol transition-[background-color,transform] duration-[120ms] ease-sortie hover:bg-bleu-k1-400 active:scale-[0.97] disabled:cursor-wait disabled:opacity-70"
    >
      <Icon name="arrow-up" size={18} />
      {/* Deux lignes voulues : le rail fait 72 px. */}
      <span className="flex flex-col items-center text-ui-3xs leading-[1.15] font-semibold whitespace-nowrap">
        {enCours ? (
          "Installation…"
        ) : (
          <>
            <span>Mettre</span>
            <span>à jour</span>
          </>
        )}
      </span>
      <span className="klyra-mono text-ui-3xs leading-none text-texte-inverse-secondaire">{etat.nouvelle}</span>
    </button>
  );
}
