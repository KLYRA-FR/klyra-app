/**
 * Les entrées en mouvement de l'app, en Web Animations (rien à ajouter à
 * globals.css). Courbe et durées du design system ; rien ne bouge si le poste
 * demande moins d'animations.
 */
const COURBE = "cubic-bezier(0.22, 1, 0.36, 1)";

type Entree = { x?: number; y?: number; echelle?: number; duree?: number; delai?: number };

function reduit(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function entrer(el: HTMLElement | null, { x = 0, y = 8, echelle = 1, duree = 300, delai = 0 }: Entree = {}) {
  if (!el || reduit()) return;
  el.animate(
    [
      { opacity: 0, transform: `translate(${x}px, ${y}px) scale(${echelle})` },
      { opacity: 1, transform: "none" },
    ],
    { duration: duree, delay: delai, easing: COURBE, fill: "backwards" },
  );
}

/** Une page qui arrive : elle monte de 8 px en apparaissant (300 ms). */
export const entreePage = (el: HTMLElement | null) => entrer(el, { y: 8, duree: 300 });

/** Un menu ou une fenêtre qui s'ouvre : léger zoom depuis 98 % (220 ms). */
export const apparition = (el: HTMLElement | null) => entrer(el, { y: 4, echelle: 0.98, duree: 220 });

/** Un panneau latéral qui s'ouvre : il glisse depuis le rail (300 ms). */
export const glissement = (el: HTMLElement | null) => entrer(el, { x: -12, y: 0, duree: 300 });

/** Des blocs l'un après l'autre : le n-ième part 80 ms après le précédent (480 ms). */
export const enCascade = (rang: number) => (el: HTMLElement | null) => entrer(el, { y: 12, duree: 480, delai: rang * 80 });

/* Refs stables d'un rendu à l'autre (une ref recréée relancerait l'animation). */
export const premierBloc = enCascade(0);
export const deuxiemeBloc = enCascade(1);
