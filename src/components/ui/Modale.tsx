"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Bouton } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { apparition } from "@/lib/mouvement";

const FOCUSABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface ModaleProps {
  titre: string;
  /** Le texte sous le titre. */
  children?: ReactNode;
  /** Les boutons, alignés à droite. */
  actions: ReactNode;
  onFermer: () => void;
  /** `alertdialog` quand la fenêtre demande une décision (confirmation). */
  role?: "dialog" | "alertdialog";
  className?: string;
}

/**
 * Fenêtre de l'app, à la place des `alert` et `confirm` du système : voile
 * sombre, carte blanche au rayon des cartes, léger zoom à l'ouverture. Le
 * focus reste dedans (Tab tourne), Échap ou un clic sur le voile la ferment,
 * et le focus revient où il était.
 */
export function Modale({ titre, children, actions, onFermer, role = "dialog", className }: ModaleProps) {
  const id = useId();
  const carte = useRef<HTMLDivElement | null>(null);
  /* Ref stable : recréée, elle relancerait l'animation à chaque rendu. */
  const refCarte = useCallback((el: HTMLDivElement | null) => {
    carte.current = el;
    apparition(el);
  }, []);

  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null;
    /* Le bouton marqué `data-autofocus`, sinon le premier. */
    const el = carte.current;
    const cible = el?.querySelector<HTMLElement>("[data-autofocus]") ?? el?.querySelector<HTMLElement>(FOCUSABLES);
    cible?.focus();
    return () => avant?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      /* Échap ferme cette fenêtre, pas l'écran qui est derrière. */
      e.preventDefault();
      e.stopPropagation();
      onFermer();
      return;
    }
    if (e.key !== "Tab" || !carte.current) return;
    const focusables = Array.from(carte.current.querySelectorAll<HTMLElement>(FOCUSABLES));
    if (!focusables.length) return;
    const premier = focusables[0];
    const dernier = focusables[focusables.length - 1];
    if (e.shiftKey && document.activeElement === premier) {
      e.preventDefault();
      dernier.focus();
    } else if (!e.shiftKey && document.activeElement === dernier) {
      e.preventDefault();
      premier.focus();
    }
  };

  /* Rendue à la racine de la page : dans une carte « @container », une fenêtre
     fixe resterait enfermée (et rognée) dans la carte. */
  return createPortal(
    <div
      role="presentation"
      onMouseDown={(e) => e.target === e.currentTarget && onFermer()}
      className="klyra-voile fixed inset-0 z-[60] flex items-center justify-center bg-fond-inverse-fort/40 p-4"
    >
      <div
        ref={refCarte}
        role={role}
        aria-modal="true"
        aria-labelledby={`${id}-titre`}
        aria-describedby={children ? `${id}-texte` : undefined}
        onKeyDown={onKeyDown}
        className={cn(
          "flex w-[400px] max-w-full flex-col gap-5 rounded-xl border border-bordure-subtile bg-fond-surface p-6 shadow-ombre-lg",
          className,
        )}
      >
        <div className="flex flex-col gap-2">
          <h2 id={`${id}-titre`} className="m-0 text-ui font-semibold text-texte-principal">
            {titre}
          </h2>
          {children && (
            <div id={`${id}-texte`} className="text-ui-s leading-[1.5] text-texte-secondaire">
              {children}
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">{actions}</div>
      </div>
    </div>,
    document.body,
  );
}

export interface DemandeConfirmation {
  titre: string;
  texte?: ReactNode;
  /** Libellé du bouton qui confirme (« Abandonner », « Supprimer »). */
  confirmer: string;
  /** Libellé du bouton qui renonce. Par défaut : « Annuler ». */
  annuler?: string;
}

/**
 * Remplace `window.confirm` : `demander(…)` ouvre une fenêtre de l'app et
 * renvoie une promesse, vraie si la personne confirme. Poser `fenetre` dans le
 * rendu du composant.
 *
 *   const [demander, fenetre] = useConfirmation();
 *   if (!(await demander({ titre: "Abandonner les modifications ?", confirmer: "Abandonner" }))) return;
 */
export function useConfirmation(): [(demande: DemandeConfirmation) => Promise<boolean>, ReactNode] {
  const [encours, setEncours] = useState<(DemandeConfirmation & { repondre: (oui: boolean) => void }) | null>(null);

  const demander = useCallback(
    (demande: DemandeConfirmation) =>
      new Promise<boolean>((resoudre) => {
        setEncours({
          ...demande,
          repondre: (oui) => {
            setEncours(null);
            resoudre(oui);
          },
        });
      }),
    [],
  );

  /* Renoncer a le focus à l'ouverture : Entrée par réflexe ne perd rien. */
  const fenetre = encours && (
    <Modale
      role="alertdialog"
      titre={encours.titre}
      onFermer={() => encours.repondre(false)}
      actions={
        <>
          <Bouton type="button" variant="blanc" taille="md" data-autofocus onClick={() => encours.repondre(false)}>
            {encours.annuler ?? "Annuler"}
          </Bouton>
          <Bouton type="button" variant="sombre" taille="md" onClick={() => encours.repondre(true)}>
            {encours.confirmer}
          </Bouton>
        </>
      }
    >
      {encours.texte}
    </Modale>
  );

  return [demander, fenetre];
}
