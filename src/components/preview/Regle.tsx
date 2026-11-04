"use client";

import { cn } from "@/lib/cn";

/** Les paliers du responsive (ceux de Tailwind) : à partir de cette largeur, la classe s'applique. */
const PALIERS = [
  { nom: "sm", px: 640 },
  { nom: "md", px: 768 },
  { nom: "lg", px: 1024 },
  { nom: "xl", px: 1280 },
  { nom: "2xl", px: 1536 },
];

/** Le palier actif pour cette largeur (« base » sous 640). */
export const palierActif = (largeur: number) => [...PALIERS].reverse().find((p) => largeur >= p.px)?.nom ?? "base";

/**
 * Règle graduée au-dessus de l'aperçu, à l'échelle 1:1 de la page : un trait tous les 50 px,
 * une valeur tous les 100 px, les paliers sm/md/lg/xl/2xl repérés, et la largeur réelle à droite.
 */
export function Regle({ largeur }: { largeur: number }) {
  if (!largeur) return <div className="h-7 w-full" />;
  const traits = Array.from({ length: Math.floor(largeur / 50) }, (_, i) => (i + 1) * 50);
  const palier = palierActif(largeur);

  return (
    <div aria-label={`Largeur de la page : ${largeur} px, palier ${palier}`} className="relative h-7 w-full shrink-0 overflow-hidden border-b border-bordure-subtile text-ui-2xs tabular-nums select-none">
      {traits.map((x) => {
        const centaine = x % 100 === 0;
        return (
          <div key={x} className="absolute bottom-0" style={{ left: x }}>
            <span className={cn("absolute bottom-0 w-px bg-bordure-subtile", centaine ? "h-2" : "h-1")} />
            {centaine && x < largeur - 40 && (
              <span className="absolute bottom-0.5 left-1 leading-none text-texte-tertiaire">{x}</span>
            )}
          </div>
        );
      })}

      {PALIERS.filter((p) => p.px < largeur).map((p) => (
        <div key={p.nom} className="absolute top-0 bottom-0" style={{ left: p.px }}>
          <span className="absolute top-0 bottom-0 w-px bg-bleu-k1-500" />
          <span className={cn("absolute top-0.5 left-1 leading-none font-medium", p.nom === palier ? "text-bleu-k1-500" : "text-texte-secondaire")}>
            {p.nom} {p.px}
          </span>
        </div>
      ))}

      <span className="absolute top-0.5 right-1 rounded-2xs bg-fond-surface-grise px-1 py-px leading-none font-medium text-texte-principal">
        {largeur} px · {palier}
      </span>
    </div>
  );
}
