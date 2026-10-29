"use client";

import { useEffect, useRef } from "react";
import type { ThemeSons } from "@/lib/sons/themes";

/**
 * L'aperçu d'un thème de sons, en grille de pixels KLYRA : des carrés à
 * coins à peine arrondis, plus grands quand ils sont plus allumés (comme le
 * « + » de l'équipe). Chaque thème dessine sa matière : grain du bois et
 * reflet du verre, crémaillère qui avance d'un cran, bulles qui montent,
 * touches qui s'enfoncent. L'image bouge seulement quand `anime` (survol,
 * thème choisi, aperçu qui sonne), et jamais si le système demande moins
 * d'animations.
 */

const PAS = 5;
/** Côté d'un carré selon son niveau : éteint, puis trois niveaux d'allumage. */
const TAILLES = [1.5, 2.5, 3.3, 4];
/** Un cran d'animation : l'image avance par à-coups, comme un écran de points. */
const CRAN_MS = 110;

/** Les teintes de chaque thème, du plus discret au plus allumé (tokens de globals.css). */
const TEINTES: Record<ThemeSons, [string, string, string]> = {
  silence: ["--color-gris-k1-50", "--color-gris-k1-100", "--color-gris-k1-300"],
  chaleureux: ["--color-ocre-500", "--color-orange-k2-500", "--color-orange-k1-500"],
  mecanique: ["--color-gris-k1-100", "--color-gris-k1-300", "--color-gris-k1-500"],
  petillant: ["--color-bleu-k3-500", "--color-bleu-k2-500", "--color-bleu-k1-400"],
  clavier: ["--color-bleu-k1-100", "--color-bleu-k1-300", "--color-bleu-k1-500"],
};

/** Niveau d'allumage (0 à 3) d'un carré, colonne `c`, rangée `r`, au cran `n`. */
type Motif = (c: number, r: number, n: number, colonnes: number, rangees: number) => number;

const niveau = (v: number) => (v > 0.82 ? 3 : v > 0.6 ? 2 : v > 0.38 ? 1 : 0);

/** Petit hasard stable : le même carré a toujours la même valeur. */
const hasard = (a: number, b: number) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43_758.5453;
  return x - Math.floor(x);
};

const MOTIFS: Record<ThemeSons, Motif> = {
  // Presque rien : quelques points dans les coins.
  silence: (c, r, _n, colonnes) => ((c < 2 && r < 2 && (c + r) % 2 === 0) || (c > colonnes - 4 && r < 3 && hasard(c, r) > 0.55) ? 1 : 0),
  // Le bois en bas, en veines qui ondulent ; un reflet de verre passe en diagonale.
  chaleureux: (c, r, n, colonnes, rangees) => {
    const reflet = ((n * 0.6) % (colonnes + rangees + 12)) - 6;
    if (Math.abs(c - reflet - r * 0.7) < 0.9 && r < rangees * 0.55) return 3;
    if (r < rangees * 0.4) return 0;
    const veine = 0.5 + 0.5 * Math.sin(r * 1.25 + 1.1 * Math.sin(c * 0.32 + n * 0.08));
    return niveau(0.25 + veine * 0.7);
  },
  // Une crémaillère qui avance d'un cran, et le loquet qui retombe dessus.
  mecanique: (c, r, n, colonnes, rangees) => {
    const dent = (c + Math.floor(n / 3)) % 6;
    const hauteur = 3 + (dent < 3 ? dent : 5 - dent);
    const depuisLeBas = rangees - 1 - r;
    if (depuisLeBas < hauteur) return depuisLeBas < 2 ? 3 : 2;
    const centre = Math.floor(colonnes / 2);
    const leve = Math.floor(n / 3) % 2 === 0 ? 0 : 1;
    if (Math.abs(c - centre) <= 1 && r >= 1 + leve && r <= 3 + leve) return 3;
    return 0;
  },
  // Des bulles qui montent, en anneaux.
  petillant: (c, r, n, colonnes, rangees) => {
    let meilleur = 0;
    for (let i = 0; i < 6; i++) {
      const rayon = 1 + hasard(i, 1) * 1.6;
      const x = hasard(i, 2) * colonnes;
      const y = rangees + 3 - ((n * (0.25 + hasard(i, 3) * 0.3) + hasard(i, 4) * 40) % (rangees + 6));
      const d = Math.hypot(c - x, (r - y) * 1.1);
      if (d < rayon - 0.6) meilleur = Math.max(meilleur, 1);
      else if (d < rayon + 0.5) meilleur = Math.max(meilleur, d < rayon ? 3 : 2);
    }
    return meilleur;
  },
  // Des rangées de touches ; quelques-unes s'enfoncent.
  clavier: (c, r, n) => {
    const largeur = 4;
    const ligne = Math.floor(r / 3);
    const decalage = ligne % 2 === 0 ? 0 : 2;
    const touche = Math.floor((c + decalage) / largeur);
    if ((c + decalage) % largeur === largeur - 1 || r % 3 === 2) return 0;
    const frappee = Math.floor(hasard(Math.floor(n / 2), 9) * 40);
    const voisine = Math.floor(hasard(Math.floor(n / 2), 7) * 40);
    const id = ligne * 13 + touche;
    if (id % 40 === frappee) return 3;
    if (id % 40 === voisine) return 2;
    return 1;
  },
};

/** Un cran fixe, joli à l'arrêt. */
const CRAN_FIXE = 24;

export function ApercuSons({ theme, anime }: { theme: ThemeSons; anime: boolean }) {
  const toile = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = toile.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const styles = getComputedStyle(document.documentElement);
    const eteint = styles.getPropertyValue("--color-gris-k2-500").trim();
    const teintes = TEINTES[theme].map((v) => styles.getPropertyValue(v).trim());
    const moinsDeMouvement = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let largeur = 0;
    let hauteur = 0;
    const dessiner = (n: number) => {
      const echelle = window.devicePixelRatio || 1;
      const l = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (l !== largeur || h !== hauteur) {
        largeur = l;
        hauteur = h;
        canvas.width = Math.round(l * echelle);
        canvas.height = Math.round(h * echelle);
      }
      ctx.setTransform(echelle, 0, 0, echelle, 0, 0);
      ctx.clearRect(0, 0, l, h);
      const colonnes = Math.floor(l / PAS);
      const rangees = Math.floor(h / PAS);
      const marge = { x: (l - colonnes * PAS) / 2, y: (h - rangees * PAS) / 2 };
      for (let r = 0; r < rangees; r++) {
        for (let c = 0; c < colonnes; c++) {
          const v = MOTIFS[theme](c, r, n, colonnes, rangees);
          const cote = TAILLES[v];
          ctx.fillStyle = v === 0 ? eteint : teintes[v - 1];
          const x = marge.x + c * PAS + (PAS - cote) / 2;
          const y = marge.y + r * PAS + (PAS - cote) / 2;
          ctx.beginPath();
          ctx.roundRect(x, y, cote, cote, 0.6);
          ctx.fill();
        }
      }
    };

    if (!anime || moinsDeMouvement) {
      dessiner(CRAN_FIXE);
      const taille = new ResizeObserver(() => dessiner(CRAN_FIXE));
      taille.observe(canvas);
      return () => taille.disconnect();
    }
    let cran = CRAN_FIXE;
    let dernier = 0;
    let image = 0;
    const tourner = (t: number) => {
      if (t - dernier >= CRAN_MS) {
        dernier = t;
        dessiner(cran++);
      }
      image = requestAnimationFrame(tourner);
    };
    image = requestAnimationFrame(tourner);
    return () => cancelAnimationFrame(image);
  }, [theme, anime]);

  return <canvas ref={toile} aria-hidden="true" className="block h-14 w-full rounded-md bg-fond-page" />;
}
