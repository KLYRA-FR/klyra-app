"use client";

import { forwardRef, useCallback, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Textarea } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { useDictee } from "@/lib/dictee/useDictee";
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
 * Pendant une dictée, le texte s'écrit au curseur et le champ ne s'édite
 * pas ; Entrée ou Échap arrêtent la dictée, sans rien envoyer.
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
  const canSend = (value.trim().length > 0 || aDesPieces) && !enDictee;
  const peutArreter = occupe && !!onArreter;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSend) onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // En pleine dictée, Entrée n'envoie pas : elle arrête la dictée, comme Échap.
    if (enDictee) {
      if (event.key !== "Enter" && event.key !== "Escape") return;
      event.preventDefault();
      if (dictee.phase === "ecoute") void dictee.arreter();
      else if (event.key === "Escape") dictee.annulerPreparation();
      return;
    }
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
        "relative flex flex-col gap-2 rounded-xl border border-bordure-subtile bg-fond-surface p-3 shadow-ombre-ambiante",
        // Pendant qu'on écrit, rien ne s'allume : ni contour, ni bord de couleur.
        "transition-[border-color,box-shadow] duration-[220ms] ease-sortie",
        className,
      )}
    >
      {dictee.phase === "preparation" && <PreparationDictee progression={dictee.preparation} onFermer={dictee.annulerPreparation} />}
      {pieces}
      <div className="relative">
        <Textarea
          ref={relier}
          variant="ghost"
          size="sm"
          autoGrow
          value={value}
          readOnly={enDictee}
          onChange={(e) => {
            onChange(e.target.value);
            onCurseur?.(e.target.selectionStart);
          }}
          onSelect={(e) => onCurseur?.(e.currentTarget.selectionStart)}
          onKeyDown={onKeyDown}
          placeholder={dictee.phase === "ecoute" ? "Parle, le texte s’écrit ici…" : placeholder}
          aria-label="Message"
          className={cn(
            // Pas de contour propre au champ : c'est la carte arrondie autour qui s'éclaire.
            "max-h-[240px] border-0 px-1 outline-none focus:border-0 focus:shadow-none focus:[box-shadow:none] focus-visible:outline-none",
            taille === "grand" ? "min-h-[72px] text-body-s" : "min-h-[44px] text-ui",
            dictee.zones && "klyra-dictee-champ",
          )}
        />
        {dictee.zones && <MiroirDictee zones={dictee.zones} champ={champ} />}
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
