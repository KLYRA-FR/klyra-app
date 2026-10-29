"use client";

import { forwardRef, useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Textarea } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { BoutonDictee } from "./BoutonDictee";

interface PromptBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** Puces posées dans la barre du bas, à gauche (rôle, projet…). */
  puces?: ReactNode;
  /** `grand` pour l'accueil, `compact` sous un fil de chat. */
  taille?: "grand" | "compact";
  /** Un agent travaille : sans texte, le bouton d'envoi devient Stop. */
  occupe?: boolean;
  onArreter?: () => void;
  /** Touche gérée avant l'envoi (liste des mentions) : renvoie vrai si elle est prise. */
  onToucheAvant?: (event: KeyboardEvent<HTMLTextAreaElement>) => boolean;
  /** Suit la position du curseur (pour les mentions). */
  onCurseur?: (position: number) => void;
  /** Pièces jointes, au-dessus du texte. */
  pieces?: ReactNode;
  /** Le trombone : joindre des fichiers. */
  onJoindre?: () => void;
  /** Il y a des pièces jointes : on peut envoyer sans texte. */
  aDesPieces?: boolean;
  className?: string;
}

/**
 * Zone de saisie de l'IA, commune à l'accueil et au chat : une carte blanche,
 * le texte en haut, et en bas les pièces jointes, les puces de choix et
 * l'envoi (bouton Sombre). Entrée envoie, Maj + Entrée va à la ligne.
 */
export const PromptBox = forwardRef<HTMLTextAreaElement, PromptBoxProps>(function PromptBox(
  {
    value,
    onChange,
    onSubmit,
    placeholder,
    puces,
    taille = "compact",
    occupe = false,
    onArreter,
    onToucheAvant,
    onCurseur,
    pieces,
    onJoindre,
    aDesPieces = false,
    className,
  },
  ref,
) {
  const canSend = value.trim().length > 0 || aDesPieces;
  /* Le texte à jour quand la dictée revient : on a pu écrire pendant la transcription. */
  const valeur = useRef(value);
  useEffect(() => {
    valeur.current = value;
  });
  const peutArreter = occupe && !!onArreter;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSend) onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (onToucheAvant?.(event)) return;
    // Échap arrête l'agent qui travaille.
    if (event.key === "Escape" && peutArreter) {
      event.preventDefault();
      onArreter?.();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      if (canSend) onSubmit();
    }
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-bordure-subtile bg-fond-surface p-3 shadow-ombre-ambiante",
        // Pendant qu'on écrit, rien ne s'allume : ni contour, ni bord de couleur.
        "transition-[border-color,box-shadow] duration-[220ms] ease-sortie",
        className,
      )}
    >
      {pieces}
      <Textarea
        ref={ref}
        variant="ghost"
        size="sm"
        autoGrow
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          onCurseur?.(e.target.selectionStart);
        }}
        onSelect={(e) => onCurseur?.(e.currentTarget.selectionStart)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Message"
        className={cn(
          // Pas de contour propre au champ : c'est la carte arrondie autour qui s'éclaire.
          "max-h-[240px] border-0 px-1 outline-none focus:border-0 focus:shadow-none focus:[box-shadow:none] focus-visible:outline-none",
          taille === "grand" ? "min-h-[72px] text-body-s" : "min-h-[44px] text-ui",
        )}
      />

      <div className="flex min-w-0 items-center gap-1.5">
        <BoutonIcone
          variant="blanc"
          taille="compact"
          icone={<Icon name="paperclip" size={16} />}
          libelle="Joindre des fichiers"
          onClick={onJoindre}
        />
        {puces}
        <BoutonDictee onTexte={(texte) => onChange(valeur.current.trim() ? `${valeur.current.trimEnd()} ${texte}` : texte)} />
        {/* Pendant que l'agent travaille : le Stop reste là, même si tu as commencé à écrire. */}
        {peutArreter && (
          <BoutonIcone
            variant="blanc"
            taille="compact"
            icone={<Icon name="stop-01" size={16} />}
            libelle="Arrêter l’agent (Échap)"
            onClick={onArreter}
          />
        )}
        {(!occupe || canSend) && (
          <BoutonIcone
            type="submit"
            variant="sombre"
            taille="compact"
            disabled={!canSend}
            icone={<Icon name="arrow-up" size={16} />}
            libelle={occupe ? "Mettre en attente" : "Envoyer"}
          />
        )}
      </div>
    </form>
  );
});
