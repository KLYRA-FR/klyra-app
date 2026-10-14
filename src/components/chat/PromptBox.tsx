"use client";

import { forwardRef, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { Textarea } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";

interface PromptBoxProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  placeholder: string;
  /** Puces posées dans la barre du bas, à gauche (rôle, projet…). */
  puces?: ReactNode;
  /** `grand` pour l'accueil, `compact` sous un fil de chat. */
  taille?: "grand" | "compact";
  className?: string;
}

/**
 * Zone de saisie de l'IA, commune à l'accueil et au chat : une carte blanche,
 * le texte en haut, et en bas les pièces jointes, les puces de choix et
 * l'envoi (bouton Sombre). Entrée envoie, Maj + Entrée va à la ligne.
 */
export const PromptBox = forwardRef<HTMLTextAreaElement, PromptBoxProps>(function PromptBox(
  { value, onChange, onSubmit, placeholder, puces, taille = "compact", className },
  ref,
) {
  const canSend = value.trim().length > 0;

  const submit = (event?: FormEvent) => {
    event?.preventDefault();
    if (canSend) onSubmit();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form
      onSubmit={submit}
      className={cn(
        "flex flex-col gap-2 rounded-xl border border-bordure-subtile bg-fond-surface p-3 shadow-ombre-ambiante",
        "transition-[border-color,box-shadow] duration-[220ms] ease-sortie focus-within:border-bordure-champ-survol",
        className,
      )}
    >
      <Textarea
        ref={ref}
        variant="ghost"
        size="sm"
        autoGrow
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        aria-label="Message"
        className={cn(
          "max-h-[240px] border-0 px-1 focus:border-0",
          taille === "grand" ? "min-h-[72px] text-body-s" : "min-h-[44px] text-ui",
        )}
      />

      <div className="flex min-w-0 items-center gap-1.5">
        <BoutonIcone
          variant="blanc"
          taille="compact"
          icone={<Icon name="paperclip" size={16} />}
          libelle="Joindre un fichier"
        />
        {puces}
        <BoutonIcone
          taille="compact"
          icone={<Icon name="microphone-01" size={20} />}
          libelle="Dicter"
          className="ml-auto text-icone-secondaire hover:text-icone-defaut"
        />
        <BoutonIcone
          type="submit"
          variant="sombre"
          taille="compact"
          disabled={!canSend}
          icone={<Icon name="arrow-up" size={16} />}
          libelle="Envoyer"
        />
      </div>
    </form>
  );
});
