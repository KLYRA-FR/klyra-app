"use client";

import { useRef, type KeyboardEvent } from "react";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { cn } from "@/lib/cn";
import { ROLE_TEINTES, type RoleTeinte } from "@/types/domain";

/** Le nom de chaque teinte, lu par les lecteurs d'écran et affiché au survol. */
export const NOMS_TEINTES: Record<RoleTeinte, string> = {
  "bleu-k1": "Bleu KLYRA",
  "bleu-k2": "Bleu ciel",
  "bleu-k3": "Sarcelle",
  violet: "Violet",
  rose: "Rose",
  rouge: "Rouge",
  orange: "Orange",
  "orange-k2": "Pêche",
  jaune: "Jaune",
  ocre: "Ocre",
  vert: "Vert",
  "vert-k2": "Tilleul",
};

/**
 * Les pastilles de couleur d'un agent (toutes les teintes, K1 compris) : un
 * groupe de boutons radio, un seul arrêt de tabulation, les flèches pour
 * changer, Début et Fin pour aller aux bouts.
 */
export function ChoixTeinte({
  valeur,
  onChange,
  libelle,
  libelleId,
}: {
  valeur: RoleTeinte;
  onChange: (teinte: RoleTeinte) => void;
  /** Le nom du groupe, s'il n'a pas de titre visible (sinon `libelleId`). */
  libelle?: string;
  libelleId?: string;
}) {
  const groupe = useRef<HTMLDivElement>(null);
  const rang = ROLE_TEINTES.indexOf(valeur);

  const deplacer = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = ROLE_TEINTES.length;
    const depart = Math.max(0, rang);
    const cible =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? (depart + 1) % n
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? (depart - 1 + n) % n
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : null;
    if (cible === null) return;
    e.preventDefault();
    onChange(ROLE_TEINTES[cible]);
    groupe.current?.querySelectorAll<HTMLElement>('[role="radio"]')[cible]?.focus();
  };

  return (
    <div
      ref={groupe}
      role="radiogroup"
      aria-label={libelleId ? undefined : libelle}
      aria-labelledby={libelleId}
      onKeyDown={deplacer}
      className="flex flex-wrap gap-2"
    >
      {ROLE_TEINTES.map((t, i) => {
        const choisie = t === valeur;
        return (
          <button
            key={t}
            type="button"
            role="radio"
            aria-checked={choisie}
            aria-label={NOMS_TEINTES[t]}
            title={NOMS_TEINTES[t]}
            tabIndex={choisie || (rang === -1 && i === 0) ? 0 : -1}
            onClick={() => onChange(t)}
            className={cn(
              "flex size-8 cursor-pointer items-center justify-center rounded-xs border bg-fond-surface p-0",
              choisie ? "border-focus" : "border-bordure-subtile hover:border-bordure-forte",
            )}
          >
            <span aria-hidden="true" className="size-4 rounded-[3px]" style={{ background: AGENT_PASTELS[t].haut }} />
          </button>
        );
      })}
    </div>
  );
}
