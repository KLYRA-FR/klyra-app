import type { CSSProperties } from "react";
import Link from "next/link";
import { cn } from "@/lib/cn";

/** Le « + » en carrés pixel (cases de 7 px) : [colonne, ligne]. */
const PLUS = [
  [2, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
  [3, 2],
  [4, 2],
  [2, 3],
  [2, 4],
] as const;
const PAS = 7;
/** Taille d'un carré selon sa distance au centre : grand au milieu, petit aux
 *  bouts, centré dans sa case (comme la flèche pixel du site). */
const TAILLES = [6, 4.5, 3];

/** Couleur d'un carré selon sa distance au centre, comme les bleus du chevron
 *  pixel de klyra.fr : K1 au centre, plus clair vers les bouts. */
const BLEUS = ["var(--color-bleu-k1-500)", "var(--color-bleu-k1-400)", "var(--color-bleu-k1-300)"];

/**
 * La place du prochain agent, à la suite des cartes de l'équipe : le gris du
 * bloc des circuits (fond-page), et un « + » en pixels, dans les bleus de
 * son chevron : une onde brève part du centre, et ses branches s'écartent au
 * survol.
 * Désactivée hors de l'app de bureau.
 */
export function CarteNouvelAgent({ actif, delai = 0 }: { actif: boolean; /** Moment de son entrée, après les cartes d'agents. */ delai?: number }) {
  const contenu = (
    <>
      <svg aria-hidden="true" width="35" height="35" viewBox="0 0 35 35" className="overflow-visible">
        {PLUS.map(([c, l]) => {
          const distance = Math.abs(c - 2) + Math.abs(l - 2);
          const taille = TAILLES[distance];
          return (
            <rect
              key={`${c}-${l}`}
              x={c * PAS + (PAS - taille) / 2}
              y={l * PAS + (PAS - taille) / 2}
              width={taille}
              height={taille}
              rx="0.6"
              className="klyra-plus-carre"
              // L'onde part du centre vers les bouts ; au survol, chaque carré
              // s'écarte dans la direction de sa branche (--dx, --dy).
              style={
                {
                  fill: BLEUS[distance],
                  "--delai": `${distance * 120}ms`,
                  "--dx": Math.sign(c - 2) * (distance === 2 ? 2 : 1),
                  "--dy": Math.sign(l - 2) * (distance === 2 ? 2 : 1),
                } as CSSProperties
              }
            />
          );
        })}
      </svg>
      <span className="flex flex-col items-center gap-0.5 text-center">
        <span className="text-ui font-semibold text-texte-principal">Nouvel agent</span>
        <span className="text-ui-xs text-texte-tertiaire">{actif ? "Créer sa fiche" : "Dans l’app de bureau"}</span>
      </span>
    </>
  );

  const classes = cn(
    // Même gris que le bloc « Qui passe la main à qui » et ses étapes (fond-page).
    "klyra-entree flex h-[192px] flex-col items-center justify-center gap-4 rounded-2xl border border-bordure-subtile bg-fond-page no-underline",
    "transition-[background-color,transform] duration-[220ms] ease-sortie",
    actif ? "hover:-translate-y-0.5 hover:bg-fond-survol" : "cursor-not-allowed opacity-60",
  );

  if (!actif) {
    return (
      <div aria-disabled="true" title="Ouvre l’app de bureau pour créer un agent." className={classes} style={{ "--delai": `${delai}ms` } as CSSProperties}>
        {contenu}
      </div>
    );
  }
  return (
    <Link href="/equipe?nouveau=1" className={classes} style={{ "--delai": `${delai}ms` } as CSSProperties}>
      {contenu}
    </Link>
  );
}
