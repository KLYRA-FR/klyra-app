"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { cn } from "@/lib/cn";
import {
  DELAI_FERMETURE_INFOBULLE,
  DELAI_OUVERTURE_INFOBULLE,
  placerInfobulle,
  type CoteInfobulle,
  type PlaceInfobulle,
} from "@/lib/infobulle";

/**
 * Infobulle du design system : fond surface, texte UI, rayon, ombre, flèche.
 * Au survol (délai court) et au focus clavier. Pas de `title` natif.
 * La bulle est en portail : le défilement du rail ne la coupe pas.
 */
export function Infobulle({
  texte,
  cote = "droite",
  children,
  className,
}: {
  texte: string;
  cote?: CoteInfobulle;
  children: ReactElement;
  className?: string;
}) {
  const id = useId();
  const ancre = useRef<HTMLSpanElement>(null);
  const bulle = useRef<HTMLDivElement>(null);
  const survol = useRef(false);
  const focus = useRef(false);
  const bloque = useRef(false);
  const ouvrirTimer = useRef<number | null>(null);
  const fermerTimer = useRef<number | null>(null);
  const [monte, setMonte] = useState(false);
  const [visible, setVisible] = useState(false);
  const [place, setPlace] = useState<PlaceInfobulle | null>(null);
  const libelle = texte.trim();

  const annuler = (timer: { current: number | null }) => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  };

  const vouloir = (toutDeSuite: boolean) => {
    if (!libelle || bloque.current) return;
    annuler(fermerTimer);
    if (monte) {
      setVisible(true);
      return;
    }
    annuler(ouvrirTimer);
    const delai = toutDeSuite || window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : DELAI_OUVERTURE_INFOBULLE;
    ouvrirTimer.current = window.setTimeout(() => setMonte(true), delai);
  };

  const lacher = () => {
    annuler(ouvrirTimer);
    if (!monte) return;
    setVisible(false);
    annuler(fermerTimer);
    fermerTimer.current = window.setTimeout(() => {
      setMonte(false);
      setPlace(null);
    }, DELAI_FERMETURE_INFOBULLE + 120);
  };

  useEffect(() => () => {
    annuler(ouvrirTimer);
    annuler(fermerTimer);
  }, []);

  useLayoutEffect(() => {
    if (!monte) return;
    const el = ancre.current;
    const tip = bulle.current;
    if (!el || !tip) return;
    const mesurer = () => {
      const a = el.getBoundingClientRect();
      if (a.width === 0 && a.height === 0) return;
      const b = tip.getBoundingClientRect();
      setPlace(placerInfobulle(
        { top: a.top, left: a.left, width: a.width, height: a.height, right: a.right, bottom: a.bottom },
        { width: b.width, height: b.height },
        cote,
        { width: window.innerWidth, height: window.innerHeight },
      ));
    };
    mesurer();
    const cadre = requestAnimationFrame(() => setVisible(true));
    const suivre = () => mesurer();
    window.addEventListener("scroll", suivre, true);
    window.addEventListener("resize", suivre);
    const echap = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      bloque.current = true;
      setVisible(false);
      setMonte(false);
      setPlace(null);
    };
    window.addEventListener("keydown", echap);
    return () => {
      cancelAnimationFrame(cadre);
      window.removeEventListener("scroll", suivre, true);
      window.removeEventListener("resize", suivre);
      window.removeEventListener("keydown", echap);
    };
  }, [monte, cote, libelle]);

  if (!libelle) return children;

  const bulleNode: ReactNode = monte && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={bulle}
          id={id}
          role="tooltip"
          data-cote={place?.cote ?? cote}
          data-visible={visible && place ? "true" : "false"}
          style={place ? { top: place.top, left: place.left } : undefined}
          className={cn(
            "klyra-infobulle pointer-events-none fixed z-50 max-w-56 rounded-sm border border-bordure-subtile bg-fond-surface px-2 py-1 text-center text-ui-xs font-medium text-texte-principal shadow-ombre-md",
            !place && "invisible",
          )}
        >
          {libelle}
          {place && (
            <span
              aria-hidden
              className={cn(
                "absolute size-2 rotate-45 border border-bordure-subtile bg-fond-surface",
                (place.cote === "droite" || place.cote === "gauche") && "top-(--fleche) -translate-y-1/2",
                place.cote === "droite" && "-left-1 border-t-0 border-r-0",
                place.cote === "gauche" && "-right-1 border-b-0 border-l-0",
                (place.cote === "haut" || place.cote === "bas") && "left-(--fleche) -translate-x-1/2",
                place.cote === "haut" && "-bottom-1 border-t-0 border-l-0",
                place.cote === "bas" && "-top-1 border-b-0 border-r-0",
              )}
              style={{ "--fleche": `${place.fleche}px` } as CSSProperties}
            />
          )}
        </div>,
        document.body,
      )
    : null;

  return (
    <span
      ref={ancre}
      className={cn("inline-flex", className)}
      onMouseEnter={() => {
        survol.current = true;
        vouloir(focus.current);
      }}
      onMouseLeave={() => {
        survol.current = false;
        bloque.current = false;
        if (!focus.current) lacher();
      }}
      onFocusCapture={() => {
        focus.current = true;
        vouloir(true);
      }}
      onBlurCapture={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        focus.current = false;
        bloque.current = false;
        if (!survol.current) lacher();
      }}
      onPointerDown={() => {
        bloque.current = true;
        annuler(ouvrirTimer);
        annuler(fermerTimer);
        setVisible(false);
        setMonte(false);
        setPlace(null);
      }}
    >
      {children}
      {bulleNode}
    </span>
  );
}
