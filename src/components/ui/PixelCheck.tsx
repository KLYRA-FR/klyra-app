import type { CSSProperties } from "react";
import { cn } from "@/lib/cn";

/* Repris de klyra.fr (src/components/refonte/ui/pixel-check.tsx) : le check
   KLYRA, cinq carrés K1 pour la coche et neuf éclats en vague autour.
   Coordonnées en px, dans un cadre de 26 × 19. */
const COCHE = [
  [3, 11],
  [7, 15],
  [11, 11],
  [15, 7],
  [19, 3],
] as const;

const ECLATS = [
  [0, 8],
  [4, 4],
  [8, 0],
  [8, 8],
  [12, 4],
  [16, 0],
  [16, 16],
  [20, 12],
  [24, 8],
] as const;

const ECLAT_RAYON = 0.5;
const PAS_VAGUE_MS = 18;

interface PixelCheckProps {
  className?: string;
  /** Décalage de départ de la vague, pour enchaîner plusieurs checks. */
  delai?: number;
}

/** Le check officiel KLYRA (picto pixel CochePixel). */
export function PixelCheck({ className, delai = 0 }: PixelCheckProps) {
  const style = (x: number): CSSProperties => ({ "--delai": `${delai + x * PAS_VAGUE_MS}ms` }) as CSSProperties;
  return (
    <svg aria-hidden width="26" height="19" viewBox="0 0 26 19" className={cn("shrink-0 overflow-visible", className)}>
      {ECLATS.map(([x, y]) => (
        <rect
          key={`e${x}-${y}`}
          x={x}
          y={y}
          width="2"
          height="2"
          rx={ECLAT_RAYON}
          className="klyra-pixel-vague fill-bleu-k2-500"
          style={style(x)}
        />
      ))}
      {COCHE.map(([x, y]) => (
        <rect key={`c${x}-${y}`} x={x} y={y} width="4" height="4" className="fill-bleu-k1-500" />
      ))}
    </svg>
  );
}
