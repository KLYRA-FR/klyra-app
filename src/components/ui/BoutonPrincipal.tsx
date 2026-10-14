"use client";

import { forwardRef, useId, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/**
 * Bouton Principal du design system KLYRA : noir à écran de points, repris
 * de klyra.fr (RefontePixelButton). Un seul par écran, sans icône.
 *
 * Au repos : le libellé, et au bout un petit écran de points qui affiche un
 * chevron en dégradé bleu. Au survol, l'écran s'étend à tout le bouton et le
 * libellé s'efface. Les chevrons défilent en permanence vers la droite.
 * L'écran est décoratif (aria-hidden) : le libellé reste lu.
 */

/** Largeur du dessin, plus large que n'importe quel bouton (calé à droite). */
const L = 400;
const H = 46;
const MARGE_Y = (H - 32) / 2;
const PAS = 4;
const POINT = 2;
const ORIGINE_X = (L - 39 + 4) % PAS;
const ORIGINE_Y = (MARGE_Y + 3) % PAS;
/** Un chevron occupe 7 colonnes (28 px) ; le motif se répète à ce pas. */
const MOTIF = 7 * PAS;

/** Points allumés d'un chevron : [colonne, rangée, teinte], du bleu très
 *  clair à la base au K1 à la pointe. */
const CHEVRON: [number, number, string][] = [
  [1, 1, "var(--color-bleu-k1-0)"],
  [1, 5, "var(--color-bleu-k1-0)"],
  [2, 1, "var(--color-bleu-k1-50)"],
  [2, 2, "var(--color-bleu-k1-50)"],
  [2, 4, "var(--color-bleu-k1-50)"],
  [2, 5, "var(--color-bleu-k1-50)"],
  [3, 1, "var(--color-bleu-k1-200)"],
  [3, 2, "var(--color-bleu-k1-200)"],
  [3, 3, "var(--color-bleu-k1-200)"],
  [3, 4, "var(--color-bleu-k1-200)"],
  [3, 5, "var(--color-bleu-k1-200)"],
  [4, 2, "var(--color-bleu-k1-400)"],
  [4, 3, "var(--color-bleu-k1-400)"],
  [4, 4, "var(--color-bleu-k1-400)"],
  [5, 3, "var(--color-bleu-k1-500)"],
];
const CHEVRON_Y = MARGE_Y + 3;
const CHEVRON_X = (L - 39 + 4) % MOTIF;

interface BoutonPrincipalProps {
  children: ReactNode;
  /** Lien interne : rendu en <Link>. Sinon, bouton natif. */
  href?: string;
  onClick?: () => void;
  type?: "button" | "submit" | "reset";
  disabled?: boolean;
  className?: string;
}

export const BoutonPrincipal = forwardRef<HTMLButtonElement & HTMLAnchorElement, BoutonPrincipalProps>(
  function BoutonPrincipal({ children, href, onClick, type = "button", disabled = false, className }, ref) {
    // Identifiants propres à chaque bouton : partagés, un bouton caché
    // priverait les autres de leurs motifs.
    const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
    const idGrille = `bouton-principal-grille-${uid}`;
    const idChevrons = `bouton-principal-chevrons-${uid}`;

    const contenu = (
      <>
        <span className="klyra-bouton-principal__libelle">{children}</span>
        {/* Place du petit écran dans le flux : la hauteur du bouton vient d'ici. */}
        <span aria-hidden className="block h-[32px] w-[35px] shrink-0" />
        <span aria-hidden className="klyra-bouton-principal__ecran">
          <svg width={L} height={H} viewBox={`0 0 ${L} ${H}`} className="absolute top-0 right-0">
            <defs>
              <pattern id={idGrille} x={ORIGINE_X} y={ORIGINE_Y} width={PAS} height={PAS} patternUnits="userSpaceOnUse">
                <rect width={POINT} height={POINT} rx="0.6" style={{ fill: "rgba(255, 255, 255, 0.1)" }} />
              </pattern>
              <pattern id={idChevrons} x={CHEVRON_X} y={CHEVRON_Y} width={MOTIF} height={H} patternUnits="userSpaceOnUse">
                {CHEVRON.map(([c, r, teinte]) => (
                  <rect key={`${c}-${r}`} x={c * PAS} y={r * PAS} width={POINT} height={POINT} style={{ fill: teinte }} />
                ))}
              </pattern>
            </defs>
            <rect width={L} height={H} fill={`url(#${idGrille})`} />
            <g className="klyra-bouton-principal__defile">
              <rect x={-MOTIF} width={L + MOTIF} height={H} fill={`url(#${idChevrons})`} />
            </g>
          </svg>
        </span>
      </>
    );

    const classes = cn(
      "group relative isolate inline-flex no-underline",
      "klyra-bouton-principal",
      disabled && "pointer-events-none cursor-not-allowed opacity-60",
      className,
    );

    if (href) {
      return (
        <Link ref={ref} href={href} onClick={onClick} className={classes}>
          {contenu}
        </Link>
      );
    }
    return (
      <button ref={ref} type={type} onClick={onClick} disabled={disabled} className={classes}>
        {contenu}
      </button>
    );
  },
);
