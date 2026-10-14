"use client";

import { useId, type ReactNode } from "react";
import { cn } from "@/lib/cn";

/**
 * Formes blanches translucides propres à chaque agent, posées sur le fond
 * pastel de sa carte (d'après les cartes « Product Design / English for IT »
 * de la maquette Figma IA, 60:4723). Chaque forme est un dégradé du blanc
 * vers le transparent ; elles se chevauchent, ce qui donne les superpositions.
 * Dessinées dans un cadre de 160 × 200, calé en haut à droite de la carte.
 */

type Dessin = (blanc: string) => ReactNode;

/** Étoile ou badge à n branches, centré en (cx, cy). */
function etoile(cx: number, cy: number, branches: number, rExt: number, rInt: number, rotation = 0): string {
  const points: string[] = [];
  for (let i = 0; i < branches * 2; i++) {
    const r = i % 2 === 0 ? rExt : rInt;
    const a = ((Math.PI * i) / branches) + (rotation * Math.PI) / 180 - Math.PI / 2;
    points.push(`${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`);
  }
  return points.join(" ");
}

/** Hexagone à plat de rayon r. */
function hexagone(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 3) * i;
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
}

const DESSINS: Record<string, Dessin> = {
  /* Hugo, dev : des capsules empilées, comme des blocs de code. */
  dev: (f) => (
    <>
      {[30, 90, 150].map((y) => (
        <g key={y}>
          <circle cx="44" cy={y} r="27" fill={f} />
          <rect x="80" y={y - 27} width="110" height="54" rx="27" fill={f} />
        </g>
      ))}
    </>
  ),
  /* Iris, design : une fleur à quatre pétales. */
  designer: (f) => (
    <>
      {[0, 45, 90, 135].map((r) => (
        <ellipse key={r} cx="108" cy="92" rx="30" ry="72" fill={f} transform={`rotate(${r} 108 92)`} />
      ))}
    </>
  ),
  /* Jules, motion : des ondes qui s'éloignent. */
  motion: (f) => (
    <>
      {[96, 66, 36].map((r) => (
        <circle key={r} cx="132" cy="96" r={r} fill={f} />
      ))}
    </>
  ),
  /* Agathe, QA : un badge en étoile, le sceau du contrôle. */
  qa: (f) => (
    <>
      <polygon points={etoile(106, 88, 12, 78, 62)} fill={f} />
      <circle cx="106" cy="88" r="36" fill={f} />
    </>
  ),
  /* Thomas, ventes : des barres qui montent. */
  commercial: (f) => (
    <>
      {[
        [26, 120],
        [64, 88],
        [102, 52],
        [140, 16],
      ].map(([x, y]) => (
        <rect key={x} x={x} y={y} width="30" height={210 - y} rx="15" fill={f} />
      ))}
    </>
  ),
  /* Mathilde, stratégie : une étincelle, le cap. */
  stratege: (f) => (
    <>
      <path d="M108 6 C116 62 134 80 190 88 C134 96 116 114 108 170 C100 114 82 96 26 88 C82 80 100 62 108 6 Z" fill={f} />
      <path d="M40 132 C43 152 50 159 70 162 C50 165 43 172 40 192 C37 172 30 165 10 162 C30 159 37 152 40 132 Z" fill={f} />
    </>
  ),
  /* Sacha, growth : des marches qui grimpent. */
  growth: (f) => (
    <>
      {[0, 1, 2, 3].map((i) => (
        <rect key={i} x={24 + i * 36} y={140 - i * 40} width="150" height="34" rx="17" fill={f} />
      ))}
    </>
  ),
  /* Olivier, plume : des feuilles, comme « English for IT ». */
  redacteur: (f) => (
    <>
      {[
        [76, 52, -35],
        [150, 40, 35],
        [76, 136, -35],
        [150, 124, 35],
      ].map(([x, y, r]) => (
        <path key={`${x}-${y}`} d={`M${x} ${y - 46} C${x + 34} ${y - 46} ${x + 34} ${y + 10} ${x} ${y + 46} C${x - 34} ${y + 10} ${x - 34} ${y - 46} ${x} ${y - 46} Z`} fill={f} transform={`rotate(${r} ${x} ${y})`} />
      ))}
    </>
  ),
  /* Val, mails : des enveloppes qui se chevauchent. */
  val: (f) => (
    <>
      <rect x="30" y="34" width="130" height="92" rx="18" fill={f} transform="rotate(-12 95 80)" />
      <rect x="54" y="88" width="130" height="92" rx="18" fill={f} transform="rotate(8 119 134)" />
      <path d="M58 98 L119 140 L180 98" stroke={f} strokeWidth="10" strokeLinecap="round" strokeLinejoin="round" fill="none" transform="rotate(8 119 134)" />
    </>
  ),
  /* Diego, ops : des hexagones en nid d'abeille. */
  "diego-discord-ops": (f) => (
    <>
      <polygon points={hexagone(80, 56, 44)} fill={f} />
      <polygon points={hexagone(146, 94, 44)} fill={f} />
      <polygon points={hexagone(80, 132, 44)} fill={f} />
    </>
  ),
  /* Lou, prompts : des bulles de dialogue. */
  prompty: (f) => (
    <>
      <path d="M40 20 H170 a24 24 0 0 1 24 24 V96 a24 24 0 0 1 -24 24 H86 L58 146 V120 H40 a24 24 0 0 1 -24 -24 V44 a24 24 0 0 1 24 -24 Z" fill={f} />
      <path d="M96 112 H178 a20 20 0 0 1 20 20 V166 a20 20 0 0 1 -20 20 H170 V206 L148 186 H96 a20 20 0 0 1 -20 -20 V132 a20 20 0 0 1 20 -20 Z" fill={f} />
    </>
  ),
  /* Principal : des orbites, il relie tout le monde. */
  principal: (f) => (
    <>
      <circle cx="112" cy="92" r="80" fill={f} />
      <circle cx="112" cy="92" r="46" fill={f} />
      <circle cx="40" cy="40" r="14" fill={f} />
      <circle cx="176" cy="172" r="10" fill={f} />
    </>
  ),
};

/** Pour un agent sans dessin à lui (créé dans l'app) : un dessin de l'équipe, stable. */
const DE_SECOURS = ["principal", "motion", "designer", "diego-discord-ops", "qa"];
function dessinPour(id: string): Dessin {
  if (DESSINS[id]) return DESSINS[id];
  const hash = [...id].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return DESSINS[DE_SECOURS[hash % DE_SECOURS.length]];
}

export function AgentFormes({ agentId, className }: { agentId: string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, "");
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 200 200"
      className={cn("pointer-events-none", className)}
    >
      <defs>
        <linearGradient id={`blanc-${uid}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="white" stopOpacity="0.72" />
          <stop offset="1" stopColor="white" stopOpacity="0.18" />
        </linearGradient>
      </defs>
      {dessinPour(agentId)(`url(#blanc-${uid})`)}
    </svg>
  );
}
