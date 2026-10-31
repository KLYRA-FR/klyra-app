/** La mise en page commune aux documents lus dans la visionneuse (Markdown, Word). */

/** La colonne de lecture : centrée, une mesure confortable. */
export const PAGE = "mx-auto flex w-full max-w-3xl flex-col gap-4 px-10 pt-10 pb-16 text-body-s leading-[1.7] text-texte-principal";

/** Titres 1 à 6 : l'échelle de l'app (h3, h4, body…), resserrée comme ses titres d'écran. */
export const TITRES = [
  "mt-8 text-h3 leading-[1.15] font-semibold tracking-[-0.03em]",
  "mt-8 text-h4 leading-[1.2] font-semibold tracking-[-0.02em]",
  "mt-6 text-body leading-[1.35] font-semibold tracking-[-0.0125em]",
  "mt-5 text-body-s leading-[1.4] font-semibold",
  "mt-4 text-ui leading-[1.45] font-semibold",
  "mt-4 text-ui leading-[1.45] font-semibold text-texte-secondaire",
];

export const TITRE_BASE = "m-0 scroll-mt-6 text-texte-principal first:mt-0";

export const CODE_EN_LIGNE = "klyra-mono rounded-2xs bg-fond-surface-grise px-1 py-px text-[0.88em] text-texte-principal [overflow-wrap:anywhere]";

export const TABLEAU = {
  cadre: "overflow-x-auto rounded-md border border-bordure-subtile",
  table: "w-full border-collapse text-ui-s leading-[1.5]",
  entete: "border-b border-bordure-defaut bg-fond-page px-3 py-2 text-left align-bottom font-semibold text-texte-principal",
  rangee: "border-b border-bordure-subtile last:border-0 hover:bg-fond-survol",
  cellule: "px-3 py-2 align-top text-texte-principal",
};

/** Puce carrée et numéro accent : les marques des listes de l'app (cf. ui/Markdown). */
export const PUCE = "mt-[0.7em] size-1.5 shrink-0 bg-gris-k1-300";
export const NUMERO = "klyra-mono min-w-6 shrink-0 pt-[0.3em] text-ui-xs leading-[1.4] font-medium text-texte-accent";
