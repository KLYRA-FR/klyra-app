"use client";

import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { countChanges, diffLines, type DiffLine } from "@/lib/diff";

/** Lignes inchangées gardées autour d'un changement ; le reste est replié. */
const CONTEXTE = 2;

/** Un bloc : les lignes d'un côté, celles qui changent marquées, les longues parties inchangées repliées. */
function Bloc({ titre, lignes, marque }: { titre: string; lignes: DiffLine[]; marque: "del" | "add" }) {
  const visibles = lignes.map((_, i) => lignes.slice(Math.max(0, i - CONTEXTE), i + CONTEXTE + 1).some((l) => l.kind === marque));
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-ui font-medium text-texte-principal">{titre}</h3>
      <div className="overflow-hidden rounded-md border border-bordure-subtile text-body-s leading-[1.5]">
        {lignes.map((ligne, i) => {
          if (!visibles[i]) {
            return visibles[i - 1] ? (
              <p key={i} aria-hidden="true" className="bg-fond-page px-3 py-0.5 text-texte-secondaire">
                ⋯
              </p>
            ) : null;
          }
          const change = ligne.kind === marque;
          return (
            <p
              key={i}
              className={cn(
                "px-3 break-words whitespace-pre-wrap",
                change && marque === "del" && "bg-fond-tag-orange text-texte-principal line-through decoration-orange-k1-500/60",
                change && marque === "add" && "bg-fond-teinte-bleue text-texte-principal",
                !change && "text-texte-secondaire",
              )}
            >
              {change ? <span className="sr-only">{marque === "del" ? "Retiré : " : "Ajouté : "}</span> : null}
              {ligne.text || " "}
            </p>
          );
        })}
      </div>
    </section>
  );
}

/**
 * « Avant / après » sur le téléphone (spec T-09) : deux blocs empilés, l'avant puis l'après,
 * jamais côte à côte. Seules les parties qui changent et leurs voisines s'affichent.
 */
export function AvantApresFiche({ avant, apres, titreAvant = "Avant", titreApres = "Après" }: { avant: string; apres: string; titreAvant?: string; titreApres?: string }) {
  const lignes = useMemo(() => diffLines(avant, apres), [avant, apres]);
  const { added, removed } = countChanges(lignes);
  if (!added && !removed) return <p className="text-ui text-texte-secondaire">Aucun changement.</p>;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-ui-xs text-texte-secondaire">
        {removed} ligne{removed > 1 ? "s" : ""} retirée{removed > 1 ? "s" : ""} · {added} ligne{added > 1 ? "s" : ""} ajoutée{added > 1 ? "s" : ""}
      </p>
      <Bloc titre={titreAvant} lignes={lignes.filter((l) => l.kind !== "add")} marque="del" />
      <Bloc titre={titreApres} lignes={lignes.filter((l) => l.kind !== "del")} marque="add" />
    </div>
  );
}
