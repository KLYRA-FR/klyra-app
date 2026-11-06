"use client";

import { forwardRef, useCallback, useEffect, useRef, type ClipboardEvent, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Textarea } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { useDictee } from "@/lib/dictee/useDictee";
import { jouer } from "@/lib/sons/sons";
import { BoutonDictee } from "./BoutonDictee";
import { MiroirDictee } from "./MiroirDictee";
import { PreparationDictee } from "./PreparationDictee";

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
  /** Ce qui suit le texte sur sa ligne (les puces des images jointes). */
  apresTexte?: ReactNode;
  /** Le trombone : joindre des fichiers. */
  onJoindre?: () => void;
  /** Un collage dans le champ (Ctrl/Cmd+V) : le parent y prend une image ; sinon, le texte se colle normalement. */
  onColler?: (event: ClipboardEvent<HTMLTextAreaElement>) => void;
  /** Il y a des pièces jointes : on peut envoyer sans texte. */
  aDesPieces?: boolean;
  className?: string;
}

/**
 * Zone de saisie de l'IA, commune à l'accueil et au chat : une carte blanche,
 * le texte en haut, et en bas les pièces jointes, les puces de choix et
 * l'envoi (bouton Sombre). Entrée envoie, Maj + Entrée va à la ligne.
 * Pendant une dictée, le texte s'écrit au curseur, le champ reste modifiable
 * (la dictée suit le curseur) ; Entrée envoie, Échap arrête la dictée.
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
    apresTexte,
    onJoindre,
    onColler,
    aDesPieces = false,
    className,
  },
  ref,
) {
  /* Le champ, pour la dictée, et pour le parent qui le demande (focus, mentions). */
  const champ = useRef<HTMLTextAreaElement | null>(null);
  const relier = useCallback(
    (el: HTMLTextAreaElement | null) => {
      champ.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const dictee = useDictee({ valeur: value, onChange, champRef: champ });
  const enDictee = dictee.phase !== "repos";
  /* Pendant l'écoute, le champ reste libre et on peut envoyer ; seuls la préparation et les derniers mots le figent. */
  const fige = dictee.phase === "preparation" || dictee.phase === "finalisation";
  const canSend = (value.trim().length > 0 || aDesPieces) && !fige;
  const peutArreter = occupe && !!onArreter;

  /** Envoie, avec le son de l'envoi. */
  const envoyer = () => {
    if (!canSend) return;
    // En pleine dictée : on termine d'abord (derniers mots compris), l'envoi suit.
    if (dictee.phase === "ecoute") {
      envoiApres.current = true;
      void dictee.arreter();
      return;
    }
    jouer("envoi");
    onSubmit();
  };
  const envoiApres = useRef(false);
  useEffect(() => {
    if (dictee.phase !== "repos" || !envoiApres.current) return;
    envoiApres.current = false;
    envoyer();
  });

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    envoyer();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (fige) {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      if (event.key === "Escape") dictee.annulerPreparation();
      return;
    }
    if (onToucheAvant?.(event)) return;
    // Échap arrête la dictée ; Entrée envoie (la dictée se termine d'abord).
    if (event.key === "Escape" && dictee.phase === "ecoute") {
      event.preventDefault();
      void dictee.arreter();
      return;
    }
    // Échap arrête l'agent qui travaille.
    if (event.key === "Escape" && peutArreter) {
      event.preventDefault();
      onArreter?.();
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      envoyer();
    }
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "relative flex flex-col gap-2 rounded-xl border border-bordure-subtile bg-fond-surface p-3 shadow-ombre-ambiante",
        // Pendant qu'on écrit, rien ne s'allume : ni contour, ni bord de couleur.
        "transition-[border-color,box-shadow] duration-[220ms] ease-sortie",
        className,
      )}
    >
      {dictee.phase === "preparation" && <PreparationDictee progression={dictee.preparation} onFermer={dictee.annulerPreparation} />}
      {pieces}
      {/* Avec des puces, le champ prend la largeur de son texte, et elles le suivent. Un clic à côté revient au champ. */}
      <div
        className={cn(apresTexte && "flex cursor-text flex-wrap items-start gap-x-1.5")}
        onMouseDown={(e) => {
          if (!apresTexte || e.target !== e.currentTarget) return;
          e.preventDefault();
          champ.current?.focus();
        }}
      >
        <div className="relative max-w-full">
          <Textarea
            ref={relier}
            variant="ghost"
            size="sm"
            autoGrow
            value={value}
            readOnly={fige}
            onChange={(e) => {
              onChange(e.target.value);
              dictee.suivre(e.target.value, e.target.selectionStart);
              onCurseur?.(e.target.selectionStart);
            }}
            onSelect={(e) => {
              dictee.suivre(e.currentTarget.value, e.currentTarget.selectionStart);
              onCurseur?.(e.currentTarget.selectionStart);
            }}
            onKeyDown={onKeyDown}
            onPaste={fige ? undefined : onColler}
            placeholder={dictee.phase === "ecoute" ? "Parle, le texte s’écrit ici…" : placeholder}
            aria-label="Message"
            className={cn(
              // Pas de contour propre au champ : c'est la carte arrondie autour qui s'éclaire.
              "max-h-[240px] border-0 px-1 outline-none focus:border-0 focus:shadow-none focus:[box-shadow:none] focus-visible:outline-none",
              taille === "grand" ? "min-h-[72px] text-body-s" : "min-h-[44px] text-ui",
              apresTexte && "w-auto! max-w-full [field-sizing:content]",
              dictee.zones && "klyra-dictee-champ",
            )}
          />
          {dictee.zones && <MiroirDictee zones={dictee.zones} champ={champ} />}
        </div>
        {apresTexte}
      </div>

      <div className="flex min-w-0 items-center gap-1.5">
        <BoutonIcone
          variant="blanc"
          taille="compact"
          icone={<Icon name="paperclip" size={16} />}
          libelle="Joindre des fichiers"
          onClick={onJoindre}
        />
        {puces}
        <BoutonDictee dictee={dictee} />
        {/* Pendant que l'agent travaille : le Stop reste là, même si tu as commencé à écrire.
            Pendant une dictée, il s'efface : un seul carré, celui qui arrête la dictée. */}
        {peutArreter && !enDictee && (
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
