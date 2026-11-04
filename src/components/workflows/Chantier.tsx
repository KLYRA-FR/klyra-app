"use client";

import type { CSSProperties } from "react";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import type { Chantier } from "@/lib/workflows/chantiers";
import { useRole } from "@/lib/workspace";

/**
 * Un agent construit le workflow ouvert : une pastille flotte en haut du canevas (qui, ce qu'il
 * vient de faire, le compte des étapes), et son curseur glisse d'une carte à l'autre, comme un
 * collègue sur un tableau partagé. La couleur est celle de l'agent (`--klyra-agent`).
 */

/** La couleur d'un agent pour le canevas : l'accent de sa teinte, et ses pastels. */
export function useCouleurAgent(roleId: string) {
  const role = useRole(roleId);
  const pastel = AGENT_PASTELS[role.teinte] ?? AGENT_PASTELS["bleu-k1"];
  return { role, pastel, style: { "--klyra-agent": pastel.accent } as CSSProperties };
}

export function BandeauConstruction({ chantier, suivre, onSuivre }: { chantier: Chantier; suivre: boolean; onSuivre: () => void }) {
  const { role, pastel, style } = useCouleurAgent(chantier.roleId);
  const fini = chantier.phase === "fini";
  const etapes = chantier.nouveaux.length;
  const liens = chantier.liensNouveaux.length;
  const gestes = chantier.gestes.slice(-3).reverse();
  const verbe = fini ? (chantier.nouveau ? "a construit ce workflow" : "a modifié ce workflow") : chantier.nouveau ? "construit ce workflow" : "modifie ce workflow";
  return (
    <div
      role="status"
      aria-live="polite"
      onPointerDown={(e) => e.stopPropagation()}
      className="klyra-wf-geste pointer-events-auto absolute top-3 left-1/2 z-30 flex w-[min(440px,calc(100%-32px))] -translate-x-1/2 flex-col overflow-hidden rounded-2xl border border-bordure-subtile bg-fond-surface/90 shadow-ombre-levee backdrop-blur-md"
      style={style}
    >
      <div className="flex items-center gap-3 px-3.5 pt-3 pb-2.5">
        <span className={cn("shrink-0", !fini && "klyra-wf-anneau")}>
          <AgentRond roleId={chantier.roleId} taille={30} fondPastille="surface" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="flex items-center gap-1.5 text-ui-s text-texte-principal">
            <span className="truncate">
              <span className="font-semibold">{role.name}</span> {verbe}
            </span>
            {fini && <PixelCheck className="h-[9px] w-3 shrink-0" />}
          </span>
          {/* Ce qu'il vient de faire ; les deux gestes d'avant s'effacent dessous. */}
          <ol className="m-0 mt-0.5 flex list-none flex-col p-0" aria-label="Ce que l’agent vient de faire">
            {gestes.length === 0 && <li className="text-ui-xs text-texte-tertiaire">Prépare les étapes…</li>}
            {gestes.map((g, i) => (
              <li
                key={`${chantier.gestes.length - i}-${g.texte}`}
                className={cn(
                  "truncate text-ui-xs leading-[1.45]",
                  i === 0 ? "klyra-wf-geste text-texte-secondaire" : i === 1 ? "text-texte-tertiaire opacity-70" : "text-texte-tertiaire opacity-40",
                  i === 0 && !fini && chantier.phase === "ecrit" && "klyra-curseur-texte",
                )}
              >
                {g.texte}
              </li>
            ))}
          </ol>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="klyra-mono text-ui-2xs text-texte-tertiaire tabular-nums">
            {etapes} étape{etapes > 1 ? "s" : ""} · {liens} lien{liens > 1 ? "s" : ""}
          </span>
          {!fini && !suivre && (
            <button
              type="button"
              onClick={onSuivre}
              className="flex h-6 cursor-pointer items-center gap-1 rounded-xs border-0 px-2 text-ui-2xs font-medium"
              style={{ background: pastel.bas, color: pastel.encre }}
            >
              <Icon name="cursor-01" size={12} /> Suivre {role.name}
            </button>
          )}
        </div>
      </div>
      {/* Une barre qui luit tant qu'il travaille ; pleine quand c'est enregistré. */}
      <span className="relative block h-[3px] overflow-hidden" style={{ background: pastel.bas }}>
        {fini ? <span className="absolute inset-0" style={{ background: pastel.accent }} /> : <span className="klyra-wf-luit absolute inset-0" />}
      </span>
    </div>
  );
}

/** Le curseur de l'agent, posé à l'écran (il ne grossit pas avec le zoom). */
export function CurseurAgent({ roleId, x, y, visible }: { roleId: string; x: number; y: number; visible: boolean }) {
  const { role, pastel } = useCouleurAgent(roleId);
  return (
    <div
      aria-hidden="true"
      className="klyra-wf-curseur pointer-events-none absolute top-0 left-0 z-20 flex items-start"
      style={{ transform: `translate(${Math.round(x)}px, ${Math.round(y)}px)`, opacity: visible ? 1 : 0 }}
    >
      <svg width="18" height="20" viewBox="0 0 18 20" className="drop-shadow-sm">
        <path d="M2 1.5 L16 9.2 L9.4 10.6 L6.2 17.6 Z" fill={pastel.accent} stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
      </svg>
      <span
        className="mt-3 -ml-1 flex items-center gap-1 rounded-full py-0.5 pr-2 pl-0.5 text-ui-2xs font-semibold whitespace-nowrap shadow-ombre-sm"
        style={{ background: pastel.accent, color: "#fff" }}
      >
        <AgentRond roleId={roleId} taille={16} />
        {role.name}
      </span>
    </div>
  );
}
