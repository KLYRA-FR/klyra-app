"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { ZonesDictee } from "@/lib/dictee/useDictee";

/** Ce qui place le texte dans le champ : le miroir les reprend tels quels. */
const PROPRIETES = [
  "box-sizing",
  "font-family",
  "font-size",
  "font-weight",
  "font-style",
  "font-variation-settings",
  "line-height",
  "letter-spacing",
  "word-spacing",
  "text-transform",
  "text-indent",
  "tab-size",
  "padding-top",
  "padding-bottom",
  "padding-left",
  "border-top-width",
  "border-right-width",
  "border-bottom-width",
  "border-left-width",
];

/**
 * Pendant la dictée, le champ garde le vrai texte (curseur, hauteur, retour
 * à la ligne) mais l'affiche transparent ; ce miroir, posé exactement
 * dessus, l'écrit à sa place avec le texte provisoire en gris clair.
 */
export function MiroirDictee({ zones, champ }: { zones: ZonesDictee; champ: RefObject<HTMLTextAreaElement | null> }) {
  const miroir = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const el = champ.current;
    const m = miroir.current;
    if (!el || !m) return;
    const style = getComputedStyle(el);
    for (const p of PROPRIETES) m.style.setProperty(p, style.getPropertyValue(p));
    // Une barre de défilement prend de la largeur au champ : le miroir la garde en marge.
    const bordures = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
    m.style.paddingRight = `${parseFloat(style.paddingRight) + Math.max(0, el.offsetWidth - el.clientWidth - bordures)}px`;
    m.scrollTop = el.scrollTop;
  });

  useEffect(() => {
    const el = champ.current;
    if (!el) return;
    const suivre = () => miroir.current && (miroir.current.scrollTop = el.scrollTop);
    el.addEventListener("scroll", suivre);
    return () => el.removeEventListener("scroll", suivre);
  }, [champ]);

  return (
    <div
      ref={miroir}
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden border-solid border-transparent break-words whitespace-pre-wrap text-texte-principal"
    >
      {zones.avant}
      <span className="text-texte-tertiaire">{zones.provisoire}</span>
      {zones.apres}
      {/* Un saut de ligne final compte dans la hauteur, comme dans le champ. */}
      {"​"}
    </div>
  );
}
