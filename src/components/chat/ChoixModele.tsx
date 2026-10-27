"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { apparition } from "@/lib/mouvement";
import { useRole, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat } from "@/types/domain";

/** Les modèles Claude, du plus récent au plus léger (alias de Claude Code). */
export const MODELES = [
  { id: "fable", nom: "Claude Fable 5.1" },
  { id: "opus", nom: "Claude Opus 5.5" },
  { id: "sonnet", nom: "Claude Sonnet 5.5" },
  { id: "haiku", nom: "Claude Haiku 5.5" },
] as const;

/** Niveaux d'effort de réflexion. Haiku n'en a qu'un : la ligne est masquée. */
const EFFORTS = [
  { id: "low", nom: "Bas" },
  { id: "medium", nom: "Moyen" },
  { id: "high", nom: "Élevé" },
  { id: "xhigh", nom: "Très élevé" },
  { id: "max", nom: "Max" },
] as const;

/** Le nom court d'un modèle (« Opus 5.5 »), d'après l'alias ou l'id complet de la fiche. */
export function nomModele(id: string | null | undefined): string {
  if (!id) return "Claude Opus 5.5";
  const m = MODELES.find((x) => x.id === id || id.includes(x.id));
  return m?.nom ?? id;
}

/** Le modèle et l'effort qui serviront vraiment : ceux de la conversation, sinon ceux de la fiche. */
export function useModeleEffectif(chat: Chat) {
  const role = useRole(chat.roleIds[0] ?? "principal");
  const modeleFiche = MODELES.find((m) => role.model && role.model.includes(m.id))?.id ?? "opus";
  const modele = chat.modele ?? modeleFiche;
  const effort = chat.effort ?? "high";
  return { modele, effort, modeleFiche };
}

/**
 * Choix du modèle et de l'effort pour une conversation, dans l'en-tête (ou
 * en champ dans les réglages). Bloqué pendant que l'agent travaille.
 */
export function ChoixModele({ chat, variante = "entete" }: { chat: Chat; variante?: "entete" | "champ" }) {
  const { choisirModele } = useWorkspace();
  const travail = useTravail(chat.id);
  const { modele, effort, modeleFiche } = useModeleEffectif(chat);
  const [ouvert, setOuvert] = useState(false);
  const zone = useRef<HTMLDivElement>(null);
  const actuel = MODELES.find((m) => m.id === modele);
  const avecEffort = modele !== "haiku";
  const nomEffort = EFFORTS.find((e) => e.id === effort)?.nom;

  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => {
      if (!zone.current?.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  const bloque = !!travail;
  const libelle = `${actuel?.nom.replace("Claude ", "") ?? modele}${avecEffort && nomEffort ? ` · ${nomEffort}` : ""}`;

  return (
    <div ref={zone} className={cn("relative", variante === "champ" && "w-full")}>
      <button
        type="button"
        onClick={() => setOuvert((v) => !v)}
        disabled={bloque}
        aria-expanded={ouvert}
        aria-haspopup="dialog"
        title={bloque ? "Attends la fin du travail en cours pour changer de modèle." : `Claude · ${actuel?.nom ?? modele}${avecEffort ? ` · effort ${nomEffort}` : ""}`}
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded-xs border border-bordure-subtile bg-fond-surface text-texte-principal transition-[border-color,scale] duration-[120ms] ease-sortie hover:border-bordure-forte active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60",
          variante === "entete" ? "h-8 max-w-[240px] px-2.5 text-ui-s" : "h-11 w-full px-3 text-ui",
        )}
      >
        <span className="truncate font-medium">{libelle}</span>
        <Icon
          name="chevron-down"
          size={14}
          className={cn("ml-auto shrink-0 text-icone-secondaire transition-transform duration-[220ms] ease-sortie", ouvert && "rotate-180")}
        />
      </button>

      {ouvert && (
        <div
          ref={apparition}
          role="dialog"
          aria-label="Modèle et effort"
          className={cn(
            "absolute top-full z-50 mt-2 flex w-[320px] flex-col rounded-lg border border-bordure-subtile bg-fond-surface shadow-ombre-flottante",
            variante === "entete" ? "right-0" : "left-0",
          )}
        >
          <div className="flex flex-col gap-0.5 p-1.5">
            <span className="px-2 pt-1 pb-1.5 text-ui-xs font-medium text-texte-tertiaire">Modèle</span>
            {MODELES.map((m) => {
              const choisi = m.id === modele;
              return (
                <button
                  key={m.id}
                  type="button"
                  role="radio"
                  aria-checked={choisi}
                  onClick={() => {
                    choisirModele(chat.id, m.id === modeleFiche && !chat.modele ? null : m.id, m.id === "haiku" ? null : effort);
                    if (m.id === "haiku") setOuvert(false);
                  }}
                  className="flex h-9 cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent px-2 text-left hover:bg-fond-survol"
                >
                  {/* Rond plein et coche quand c'est le modèle choisi. */}
                  <span
                    aria-hidden="true"
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-full border",
                      choisi ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte",
                    )}
                  >
                    {choisi && <Icon name="check-01" size={12} />}
                  </span>
                  <span className="flex-1 text-ui-s text-texte-principal">{m.nom}</span>
                  {m.id === modeleFiche && (
                    <span className="rounded-2xs bg-fond-surface-grise px-1.5 py-px text-ui-3xs font-medium text-texte-secondaire">
                      fiche
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {avecEffort && (
            <div className="flex flex-col gap-1.5 border-t border-bordure-subtile p-3">
              <span className="text-ui-xs font-medium text-texte-tertiaire">Effort de réflexion</span>
              <div role="radiogroup" aria-label="Effort" className="grid grid-cols-5 gap-0.5 rounded-sm bg-fond-surface-grise p-0.5">
                {EFFORTS.map((e) => {
                  const choisi = e.id === effort;
                  return (
                    <button
                      key={e.id}
                      type="button"
                      role="radio"
                      aria-checked={choisi}
                      onClick={() => choisirModele(chat.id, chat.modele ?? null, e.id)}
                      className={cn(
                        "h-7 cursor-pointer truncate rounded-2xs border-0 px-1 text-ui-2xs font-medium transition-colors duration-[220ms] ease-sortie",
                        choisi ? "bg-fond-surface text-texte-principal shadow-ombre-xs" : "bg-transparent text-texte-secondaire hover:text-texte-principal",
                      )}
                    >
                      {e.nom}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
