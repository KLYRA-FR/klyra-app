"use client";

import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import type { Dictee } from "@/lib/dictee/useDictee";

/** Le poids de chaque barre du niveau sonore : la voix fait bouger le milieu. */
const BARRES = [0.45, 0.8, 1, 0.7, 0.4];

/** Le niveau du micro, en cinq barres. */
function Niveau({ niveau }: { niveau: number }) {
  return (
    <span aria-hidden="true" className="flex h-4 items-center gap-[2px]">
      {BARRES.map((poids, i) => (
        <span
          key={i}
          className="h-full w-[3px] origin-center rounded-full bg-texte-principal transition-transform duration-100 ease-sortie"
          style={{ transform: `scaleY(${0.2 + Math.min(1, niveau * poids) * 0.8})` }}
        />
      ))}
    </span>
  );
}

/**
 * Le micro de la zone de saisie : un clic pour parler, un clic (ou Entrée)
 * pour arrêter. Pendant l'écoute : point rouge, niveau sonore, durée, et
 * le moteur (ElevenLabs ou l'ordinateur). Rien ne s'enregistre tant qu'on
 * n'a pas cliqué.
 */
export function BoutonDictee({ dictee }: { dictee: Dictee }) {
  const { phase, moteur, niveau, secondes, message } = dictee;
  const ecoute = phase === "ecoute";
  const occupe = phase === "preparation" || phase === "finalisation";
  const duree = `${Math.floor(secondes / 60)}:${String(secondes % 60).padStart(2, "0")}`;

  return (
    <span className="ml-auto flex min-w-0 items-center gap-1.5">
      {ecoute && (
        <span aria-live="polite" className="flex items-center gap-2 text-ui-xs text-texte-secondaire tabular-nums">
          <span aria-hidden="true" className="size-2 animate-pulse rounded-full bg-texte-erreur motion-reduce:animate-none" />
          <Niveau niveau={niveau} />
          {duree}
          <span className="text-texte-tertiaire">{moteur === "elevenlabs" ? "ElevenLabs" : "Sur l’ordinateur"}</span>
        </span>
      )}
      {phase === "finalisation" && <span className="klyra-respire text-ui-xs text-texte-tertiaire">Derniers mots…</span>}
      {message && !ecoute && !occupe && (
        <span
          role={message.ton === "erreur" ? "alert" : "status"}
          title={message.texte}
          className={cn("max-w-[320px] truncate text-ui-xs", message.ton === "erreur" ? "text-texte-erreur" : "text-texte-secondaire")}
        >
          {message.texte}
        </span>
      )}
      {message && ecoute && message.ton === "info" && (
        <span role="status" title={message.texte} className="max-w-[220px] truncate text-ui-xs text-texte-secondaire">
          {message.texte}
        </span>
      )}
      <BoutonIcone
        taille="compact"
        variant={ecoute ? "blanc" : undefined}
        icone={
          <Icon
            name={ecoute ? "stop-01" : occupe ? "loader-01" : "microphone-01"}
            size={ecoute ? 16 : 20}
            className={cn(occupe && "animate-spin motion-reduce:animate-none")}
          />
        }
        libelle={ecoute ? "Arrêter la dictée (Entrée)" : phase === "preparation" ? "Préparation de la dictée" : phase === "finalisation" ? "Derniers mots" : "Dicter"}
        aria-pressed={ecoute}
        disabled={occupe}
        onClick={dictee.basculer}
        onPointerEnter={dictee.prechauffer}
        onFocus={dictee.prechauffer}
        className={cn(phase === "repos" && "text-icone-secondaire hover:text-icone-defaut")}
      />
    </span>
  );
}
