import { useMemo } from "react";
import { cn } from "@/lib/cn";
import { countChanges, diffLines } from "@/lib/diff";

/** Lignes inchangées gardées autour d'un changement ; le reste est replié. */
const CONTEXTE = 2;

/**
 * Avant / après d'un texte, ligne à ligne : retirées en orange barré,
 * ajoutées en bleu. Les longues parties inchangées sont repliées.
 */
export function DiffView({ before, after, className }: { before: string; after: string; className?: string }) {
  const lines = useMemo(() => diffLines(before, after), [before, after]);
  const { added, removed } = countChanges(lines);

  // Lignes à montrer : chaque changement et ses voisines.
  const visible = lines.map((_, i) =>
    lines.slice(Math.max(0, i - CONTEXTE), i + CONTEXTE + 1).some((l) => l.kind !== "same"),
  );

  if (added === 0 && removed === 0) {
    return <p className="m-0 text-ui text-texte-tertiaire">Aucun changement.</p>;
  }

  return (
    <div className={cn("flex flex-col overflow-hidden rounded-md border border-bordure-subtile", className)}>
      <div className="flex items-center gap-3 border-b border-bordure-subtile bg-fond-page px-3 py-2 text-ui-xs">
        <span className="klyra-mono font-medium text-texte-accent">+{added}</span>
        <span className="klyra-mono font-medium text-texte-accent-orange">−{removed}</span>
        <span className="text-texte-tertiaire">lignes</span>
      </div>
      <div className="klyra-mono max-h-[460px] overflow-auto text-ui-xs leading-[1.6]">
        {lines.map((line, i) => {
          if (!visible[i]) {
            return visible[i - 1] ? (
              <div key={i} className="bg-fond-page px-3 py-0.5 text-texte-tertiaire">
                ⋯
              </div>
            ) : null;
          }
          return (
            <div
              key={i}
              className={cn(
                "flex gap-3 px-3 whitespace-pre-wrap",
                line.kind === "add" && "bg-fond-teinte-bleue text-texte-principal",
                line.kind === "del" && "bg-fond-tag-orange text-texte-secondaire line-through decoration-orange-k1-500/60",
                line.kind === "same" && "text-texte-secondaire",
              )}
            >
              <span aria-hidden="true" className="w-3 shrink-0 select-none text-texte-tertiaire">
                {line.kind === "add" ? "+" : line.kind === "del" ? "−" : ""}
              </span>
              <span className="min-w-0 flex-1">{line.text || " "}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
