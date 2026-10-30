import { nomFichier } from "@/lib/fichiers";

/** Pastille d'extension : « TSX », « PDF », « MD ». */
export function PastilleExtension({ chemin }: { chemin: string }) {
  const nom = nomFichier(chemin);
  const ext = nom.includes(".") ? (nom.split(".").pop() ?? "").slice(0, 4).toUpperCase() : "—";
  return (
    <span
      aria-hidden="true"
      className="klyra-mono flex size-9 shrink-0 items-center justify-center rounded-sm bg-fond-surface-grise text-ui-3xs font-semibold text-texte-secondaire"
    >
      {ext}
    </span>
  );
}
