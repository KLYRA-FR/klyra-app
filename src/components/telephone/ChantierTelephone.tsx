"use client";

import type { CSSProperties } from "react";
import { RondApercu } from "@/components/roles/AgentRond";
import { PixelCheck } from "@/components/ui/PixelCheck";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import { enTravaux, type ChantierLu } from "@/lib/telephone/workflow-etapes";
import type { RoleTeinte } from "@/types/domain";

/**
 * Un agent construit un workflow, vu du téléphone : la même scène que la pastille du bureau
 * (`components/workflows/Chantier.tsx`), en bandeau sous l'en-tête. Le téléphone ne connaît pas
 * l'équipe : le nom et la teinte de l'agent viennent de l'ordinateur, avec le chantier.
 */

/** La couleur de l'agent pour les classes `klyra-wf-*` (`--klyra-agent`), et ses pastels. */
export function couleurChantier(c: ChantierLu | null | undefined) {
  const pastel = AGENT_PASTELS[(c?.agent.teinte ?? "bleu-k1") as RoleTeinte] ?? AGENT_PASTELS["bleu-k1"];
  return { pastel, style: { "--klyra-agent": pastel.accent } as CSSProperties };
}

/** L'avatar de l'agent qui construit : un anneau de sa couleur tourne autour tant qu'il travaille. */
export function AvatarConstructeur({ chantier, taille = 28 }: { chantier: ChantierLu; taille?: number }) {
  return (
    <span
      className={cn("shrink-0", enTravaux(chantier) && "klyra-wf-anneau")}
      style={{ "--klyra-rayon": `${Math.round(taille * 0.25)}px` } as CSSProperties}
    >
      <RondApercu agentId={chantier.agent.id} nom={chantier.agent.name} teinte={chantier.agent.teinte as RoleTeinte} taille={taille} />
    </span>
  );
}

/** Ce que fait l'agent : « construit ce workflow », « a modifié ce workflow ». */
export function verbeChantier(c: ChantierLu): string {
  const fini = c.phase === "fini";
  return `${fini ? (c.nouveau ? "a construit" : "a modifié") : c.nouveau ? "construit" : "modifie"} ce workflow`;
}

/** Le bandeau d'un workflow qu'un agent construit : qui, ses derniers gestes, le compte, une barre qui luit. */
export function BandeauConstructionTelephone({ chantier }: { chantier: ChantierLu }) {
  const { pastel, style } = couleurChantier(chantier);
  const fini = chantier.phase === "fini";
  return (
    <div role="status" aria-live="polite" className="relative shrink-0 border-y border-bordure-subtile bg-fond-surface" style={style}>
      <div className="flex items-start gap-3 px-4 pt-2.5 pb-3">
        <AvatarConstructeur chantier={chantier} taille={32} />
        <div className="flex min-w-0 flex-1 flex-col">
          <p className="flex items-center gap-1.5 text-ui text-texte-principal">
            <span className="truncate">
              <span className="font-semibold">{chantier.agent.name}</span> {verbeChantier(chantier)}
            </span>
            {fini ? <PixelCheck className="h-[9px] w-3 shrink-0" /> : null}
          </p>
          <ol className="mt-0.5 flex flex-col" aria-label="Ce que l’agent vient de faire">
            {chantier.gestes.length === 0 ? <li className="text-ui-xs text-texte-tertiaire">Prépare les étapes…</li> : null}
            {chantier.gestes.map((g, i) => (
              <li
                key={`${i}-${g}`}
                className={cn(
                  "truncate text-ui-xs leading-[1.45]",
                  i === 0 ? "klyra-wf-geste text-texte-secondaire" : i === 1 ? "text-texte-tertiaire opacity-70" : "text-texte-tertiaire opacity-40",
                  i === 0 && chantier.phase === "ecrit" && "klyra-curseur-texte",
                )}
              >
                {g}
              </li>
            ))}
          </ol>
        </div>
        <span className="klyra-mono shrink-0 pt-0.5 text-ui-2xs text-texte-tertiaire tabular-nums">
          {chantier.etapes} étape{chantier.etapes > 1 ? "s" : ""} · {chantier.liens} lien{chantier.liens > 1 ? "s" : ""}
        </span>
      </div>
      <span aria-hidden="true" className="absolute inset-x-0 bottom-0 block h-[3px] overflow-hidden" style={{ background: pastel.bas }}>
        {fini ? <span className="absolute inset-0" style={{ background: pastel.accent }} /> : <span className="klyra-wf-luit absolute inset-0" />}
      </span>
    </div>
  );
}
