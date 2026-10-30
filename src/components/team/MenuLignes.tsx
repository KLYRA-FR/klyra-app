"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { apparition } from "@/lib/mouvement";

export interface LigneMenu {
  id: string;
  icone: IconName;
  titre: string;
  /** Sous-texte : ce que fait la ligne, ou pourquoi elle est grisée. */
  detail?: string;
  desactivee?: boolean;
  /** Un trait au-dessus de la ligne. */
  separee?: boolean;
  onChoisir: () => void;
}

export interface Declencheur {
  ref: RefObject<HTMLButtonElement | null>;
  ouvert: boolean;
  basculer: () => void;
  /** À poser sur le bouton : rôle, état et clavier (↓ ouvre). */
  attributs: {
    "aria-haspopup": "menu";
    "aria-expanded": boolean;
    "aria-controls": string | undefined;
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => void;
  };
}

/**
 * Un menu d'actions au style de `MenuConversation` : flèches en boucle, Début et Fin, Échap et Tab
 * ferment et rendent le focus au déclencheur, un clic ailleurs ferme. Il s'ouvre vers le haut si la
 * place manque en bas. Le déclencheur est rendu par l'appelant (`declencheur`).
 */
export function MenuLignes({
  libelle,
  lignes,
  declencheur,
  alignement = "droite",
  className,
}: {
  libelle: string;
  lignes: LigneMenu[];
  declencheur: (d: Declencheur) => ReactNode;
  alignement?: "gauche" | "droite";
  className?: string;
}) {
  const [ouvert, setOuvert] = useState(false);
  const [versLeHaut, setVersLeHaut] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const idMenu = useId();
  const items = () => [...(zone.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];

  const fermer = (rendreFocus: boolean) => {
    setOuvert(false);
    if (rendreFocus) bouton.current?.focus();
  };

  const ouvrir = () => {
    const bas = bouton.current?.getBoundingClientRect().bottom ?? 0;
    setVersLeHaut(window.innerHeight - bas < 64 + lignes.length * 52);
    setOuvert(true);
  };

  useEffect(() => {
    if (!ouvert) return;
    items()[0]?.focus();
    const dehors = (e: MouseEvent) => {
      if (!zone.current?.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: globalThis.KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setOuvert(false);
      bouton.current?.focus();
    };
    document.addEventListener("mousedown", dehors);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", dehors);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  const parcourir = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      fermer(true);
      return;
    }
    const liste = items();
    const rang = liste.indexOf(document.activeElement as HTMLElement);
    const cible = { ArrowDown: (rang + 1) % liste.length, ArrowUp: (rang - 1 + liste.length) % liste.length, Home: 0, End: liste.length - 1 }[e.key];
    if (cible === undefined) return;
    e.preventDefault();
    liste[cible]?.focus();
  };

  return (
    <div ref={zone} className={cn("relative", className)}>
      {declencheur({
        ref: bouton,
        ouvert,
        basculer: () => (ouvert ? setOuvert(false) : ouvrir()),
        attributs: {
          "aria-haspopup": "menu",
          "aria-expanded": ouvert,
          "aria-controls": ouvert ? idMenu : undefined,
          onKeyDown: (e) => {
            if (e.key !== "ArrowDown" || ouvert) return;
            e.preventDefault();
            ouvrir();
          },
        },
      })}
      {ouvert && (
        <div
          ref={apparition}
          id={idMenu}
          role="menu"
          aria-label={libelle}
          onKeyDown={parcourir}
          className={cn(
            "absolute z-50 flex w-max max-w-[320px] min-w-[240px] flex-col gap-0.5 rounded-lg border border-bordure-subtile bg-fond-surface p-1.5 shadow-ombre-flottante",
            versLeHaut ? "bottom-full mb-1" : "top-full mt-1",
            alignement === "droite" ? "right-0" : "left-0",
          )}
        >
          {lignes.map((l) => (
            <div key={l.id} className={cn(l.separee && "mt-1 border-t border-bordure-subtile pt-1")}>
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                aria-disabled={l.desactivee || undefined}
                onClick={() => {
                  if (l.desactivee) return;
                  // Le focus revient au déclencheur : une fenêtre ouverte par la ligne l'y rendra en se fermant.
                  fermer(true);
                  l.onChoisir();
                }}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left focus-visible:-outline-offset-2",
                  l.desactivee ? "cursor-not-allowed" : "cursor-pointer hover:bg-fond-survol focus-visible:bg-fond-survol",
                )}
              >
                <Icon name={l.icone} size={16} className={cn("mt-0.5 shrink-0", l.desactivee ? "text-icone-secondaire opacity-60" : "text-icone-secondaire")} />
                <span className="flex min-w-0 flex-col gap-0.5">
                  <span className={cn("text-ui-s", l.desactivee ? "text-texte-tertiaire" : "text-texte-principal")}>{l.titre}</span>
                  {l.detail && <span className="text-ui-xs leading-[1.35] text-texte-tertiaire">{l.detail}</span>}
                </span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
