"use client";

import { useCallback, useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";

const FOCUSABLES = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Feuille qui monte du bas (spec mobile M-10) : `role="dialog"`, un titre, le focus dedans, fermée
 * par « Fermer », par le voile et par Échap. `haute` : 90 % de l'écran (Exécutions, Détails).
 */
export function Feuille({
  titre,
  onFermer,
  haute = false,
  role = "dialog",
  children,
  pied,
}: {
  titre: string;
  onFermer: () => void;
  haute?: boolean;
  role?: "dialog" | "alertdialog";
  children: ReactNode;
  /** Boutons collés en bas de la feuille. */
  pied?: ReactNode;
}) {
  const id = useId();
  const carte = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const avant = document.activeElement as HTMLElement | null;
    const premier = carte.current?.querySelector<HTMLElement>("[data-autofocus]") ?? carte.current?.querySelector<HTMLElement>(FOCUSABLES);
    premier?.focus();
    return () => avant?.focus?.();
  }, []);

  const touche = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onFermer();
        return;
      }
      if (e.key !== "Tab" || !carte.current) return;
      const liste = [...carte.current.querySelectorAll<HTMLElement>(FOCUSABLES)];
      if (!liste.length) return;
      const [premier, dernier] = [liste[0], liste[liste.length - 1]];
      if (e.shiftKey && document.activeElement === premier) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && document.activeElement === dernier) {
        e.preventDefault();
        premier.focus();
      }
    },
    [onFermer],
  );

  return createPortal(
    /* À la tablette (`data-composition`, posé par la coque), la feuille devient une fenêtre centrée (spec § 9). */
    <div className="fixed inset-0 z-40 flex items-end bg-black/20 in-data-[composition=tablette]:items-center in-data-[composition=tablette]:justify-center in-data-[composition=tablette]:p-6" onClick={onFermer} onKeyDown={touche}>
      <section
        ref={carte}
        role={role}
        aria-modal="true"
        aria-labelledby={id}
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "flex w-full flex-col rounded-t-3xl bg-fond-surface shadow-ombre-levee motion-safe:animate-[feuille_220ms_cubic-bezier(0.16,1,0.3,1)]",
          "in-data-[composition=tablette]:max-w-[520px] in-data-[composition=tablette]:rounded-3xl",
          haute ? "h-[90vh]" : "max-h-[85vh]",
        )}
      >
        <header className="flex shrink-0 items-center gap-2 px-4 pt-3">
          <h2 id={id} className="min-w-0 flex-1 truncate text-body-s font-medium text-texte-principal">
            {titre}
          </h2>
          <button type="button" className="min-h-11 px-2 text-ui text-texte-secondaire" onClick={onFermer}>
            Fermer
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</div>
        {pied ? <div className="shrink-0 border-t border-bordure-subtile px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">{pied}</div> : <div className="pb-[env(safe-area-inset-bottom)]" />}
      </section>
    </div>,
    document.body,
  );
}

export interface ActionMenu {
  libelle: string;
  onChoisir: () => void;
  /** Désactivée : la raison dessous (P-7, P-8), jamais un bouton gris sans raison. */
  desactivee?: boolean;
  note?: ReactNode;
  danger?: boolean;
}

/** Le menu « ⋯ », aussi ouvert par l'appui long (M-9). Chaque ligne fait 48 px. */
export function MenuFeuille({ titre, actions, onFermer }: { titre: string; actions: ActionMenu[]; onFermer: () => void }) {
  return (
    <Feuille titre={titre} onFermer={onFermer}>
      <ul className="flex flex-col">
        {actions.map((action) => (
          <li key={action.libelle} className="border-b border-bordure-subtile last:border-b-0">
            <button
              type="button"
              disabled={action.desactivee}
              onClick={() => {
                onFermer();
                action.onChoisir();
              }}
              className={cn(
                "flex min-h-12 w-full items-center text-left text-body-s active:bg-fond-survol disabled:opacity-60",
                action.danger ? "text-texte-erreur" : "text-texte-principal",
              )}
            >
              {action.libelle}
            </button>
            {action.note ? <div className="-mt-2 pb-2">{action.note}</div> : null}
          </li>
        ))}
      </ul>
    </Feuille>
  );
}

/** Confirmation en feuille : mêmes mots qu'au bureau, deux boutons de 44 px empilés. */
export function ConfirmationFeuille({
  titre,
  texte,
  confirmer,
  onConfirmer,
  onFermer,
  danger = false,
}: {
  titre: string;
  texte?: string;
  confirmer: string;
  onConfirmer: () => void;
  onFermer: () => void;
  danger?: boolean;
}) {
  return (
    <Feuille titre={titre} onFermer={onFermer} role="alertdialog">
      {texte ? <p className="text-ui text-texte-secondaire">{texte}</p> : null}
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          data-autofocus
          onClick={() => {
            onFermer();
            onConfirmer();
          }}
          className={cn("min-h-11 rounded-xs px-4 text-body-s", danger ? "bg-texte-erreur text-texte-inverse" : "klyra-surface-sombre text-texte-inverse")}
        >
          {confirmer}
        </button>
        <button type="button" onClick={onFermer} className="min-h-11 rounded-xs border border-bordure-subtile px-4 text-body-s text-texte-principal">
          Annuler
        </button>
      </div>
    </Feuille>
  );
}

/** Appui long (500 ms) : ouvre le même menu que « ⋯ » (M-9). Un déplacement l'annule. */
export function useAppuiLong(onAppui: () => void) {
  const minuteur = useRef<ReturnType<typeof setTimeout> | null>(null);
  const depart = useRef<{ x: number; y: number } | null>(null);
  const annuler = () => {
    if (minuteur.current) clearTimeout(minuteur.current);
    minuteur.current = null;
  };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      depart.current = { x: e.clientX, y: e.clientY };
      annuler();
      minuteur.current = setTimeout(onAppui, 500);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (depart.current && Math.hypot(e.clientX - depart.current.x, e.clientY - depart.current.y) > 10) annuler();
    },
    onPointerUp: annuler,
    onPointerCancel: annuler,
    onContextMenu: (e: React.MouseEvent) => {
      e.preventDefault();
      annuler();
      onAppui();
    },
  };
}
