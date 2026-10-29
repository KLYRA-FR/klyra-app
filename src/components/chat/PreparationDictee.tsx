"use client";

import type { CSSProperties } from "react";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { PixelCheck } from "@/components/ui/PixelCheck";
import type { ProgressionDictee } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { apparition } from "@/lib/mouvement";

const MO = 1_000_000;

/** Neuf pixels K1 qui gonflent en vague, en diagonale : l'attente, aux couleurs de KLYRA. */
function PixelAttente() {
  return (
    <svg aria-hidden width="19" height="19" viewBox="0 0 19 19" className="shrink-0 overflow-visible text-bleu-k1-500">
      {[0, 1, 2].flatMap((ligne) =>
        [0, 1, 2].map((colonne) => (
          <rect
            key={`${ligne}-${colonne}`}
            x={colonne * 7 + 1}
            y={ligne * 7 + 1}
            width="3"
            height="3"
            fill="currentColor"
            className="klyra-pixel-vague"
            style={{ "--delai": `${(ligne + colonne) * 120}ms` } as CSSProperties}
          />
        )),
      )}
    </svg>
  );
}

/**
 * La première dictée sur l'ordinateur : le modèle se télécharge (progression
 * réelle), se charge en mémoire, puis la dictée est prête. Fermer la carte
 * n'arrête pas le téléchargement : la prochaine dictée le trouvera.
 */
export function PreparationDictee({ progression, onFermer }: { progression: ProgressionDictee | null; onFermer: () => void }) {
  const pourcent = progression?.etape === "telechargement" ? Math.floor((progression.recu / Math.max(1, progression.total)) * 100) : null;
  const prete = progression?.etape === "prete";
  const titre = prete ? "Dictée prête" : "Préparation de la dictée";
  const detail = prete
    ? "Tu peux parler, le texte s’écrit dans le champ."
    : pourcent !== null
      ? `Téléchargement du modèle · ${pourcent} %`
      : progression?.etape === "chargement"
        ? "Préparation du modèle…"
        : "Un instant…";

  return (
    <div
      ref={apparition}
      role="status"
      aria-live="polite"
      onKeyDown={(e) => e.key === "Escape" && onFermer()}
      className="klyra-carte-flottante absolute right-0 bottom-full z-20 mb-2 flex w-[320px] flex-col gap-3 rounded-lg p-4"
    >
      <div className="flex items-start gap-3">
        <span className="mt-0.5 flex size-5 items-center justify-center">{prete ? <PixelCheck /> : <PixelAttente />}</span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-ui-s font-semibold text-texte-principal">{titre}</span>
          <span className={cn("text-ui-xs text-texte-secondaire tabular-nums", !prete && "klyra-respire")}>{detail}</span>
        </div>
        {!prete && <BoutonIcone taille="mini" icone={<Icon name="x-01" size={16} />} libelle="Fermer" onClick={onFermer} />}
      </div>
      {pourcent !== null && progression?.etape === "telechargement" && (
        <>
          <div className="h-1 overflow-hidden rounded-full bg-fond-surface-grise" aria-hidden="true">
            <div
              className="h-full rounded-full bg-fond-accent transition-[width] duration-300 ease-sortie"
              style={{ width: `${pourcent}%` }}
            />
          </div>
          <span className="text-ui-2xs text-texte-tertiaire tabular-nums">
            {Math.round(progression.recu / MO)} Mo sur {Math.round(progression.total / MO)} Mo · une seule fois. Ta voix reste sur l’ordinateur.
          </span>
        </>
      )}
    </div>
  );
}
