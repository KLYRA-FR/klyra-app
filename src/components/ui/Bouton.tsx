import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

/**
 * Bouton du design system KLYRA (composant Bouton, `k-btn`), version app.
 * Rayon 6 px pour tous, jamais de pilule ni de bleu plein.
 * - `sombre` : compact, l'action forte d'une barre ou d'une carte ;
 * - `blanc` : à côté d'une action forte ;
 * - `gris` : action secondaire sur fond clair (CTA de la navbar sur le site) ;
 * - `discret` : action d'outil, sans fond au repos ;
 * - `ghost` : sur fond sombre.
 * Le Principal (noir à écran de points) est BoutonPrincipal, un seul par écran.
 */
const boutonVariants = cva(
  [
    "inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 rounded-xs border font-medium whitespace-nowrap",
    "tracking-[-0.0125em] no-underline",
    "transition-[background-color,border-color,box-shadow,transform,color] duration-[220ms] ease-sortie",
    "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-60",
  ],
  {
    variants: {
      variant: {
        sombre: "klyra-surface-sombre border-transparent text-texte-inverse hover:-translate-y-px",
        blanc: "border-bordure-subtile bg-fond-surface text-texte-principal hover:border-bordure-forte",
        gris: "border-transparent bg-fond-surface-grise text-texte-principal hover:bg-bordure-forte",
        discret: "border-transparent bg-transparent text-texte-principal hover:bg-fond-survol",
        ghost: "border-bordure-inverse bg-white/8 text-texte-inverse hover:bg-white/14",
      },
      taille: {
        // 46 px : la hauteur du bouton Principal, à côté duquel il se pose souvent.
        md: "h-[46px] px-5 text-body-s",
        compact: "h-8 px-3 text-ui-s",
        mini: "h-7 px-2.5 text-ui-xs",
      },
      icone: { true: "px-0", false: "" },
      actif: { true: "", false: "" },
    },
    compoundVariants: [
      { icone: true, taille: "md", className: "w-[46px]" },
      { icone: true, taille: "compact", className: "w-8" },
      { icone: true, taille: "mini", className: "w-7" },
      { variant: "discret", actif: true, className: "bg-fond-surface-grise hover:bg-fond-surface-grise" },
    ],
    defaultVariants: { variant: "blanc", taille: "compact", icone: false, actif: false },
  },
);

export interface BoutonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    Omit<VariantProps<typeof boutonVariants>, "icone"> {
  /** Icône à gauche du libellé (composant Icon, 16 ou 20 px). */
  iconeGauche?: ReactNode;
  iconeDroite?: ReactNode;
}

export const Bouton = forwardRef<HTMLButtonElement, BoutonProps>(function Bouton(
  { variant, taille, actif, iconeGauche, iconeDroite, className, children, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(boutonVariants({ variant, taille, actif, icone: false }), className)}
      {...rest}
    >
      {iconeGauche}
      {children}
      {iconeDroite}
    </button>
  );
});

export interface BoutonIconeProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children">,
    Omit<VariantProps<typeof boutonVariants>, "icone"> {
  icone: ReactNode;
  /** Libellé lu par les lecteurs d'écran (et affiché au survol). */
  libelle: string;
}

/** Bouton carré à icône seule, mêmes variantes que Bouton. */
export const BoutonIcone = forwardRef<HTMLButtonElement, BoutonIconeProps>(function BoutonIcone(
  { variant = "discret", taille, actif, icone, libelle, className, type = "button", ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={libelle}
      title={libelle}
      className={cn(boutonVariants({ variant, taille, actif, icone: true }), className)}
      {...rest}
    >
      {icone}
    </button>
  );
});
