"use client";

import { useSearchParams } from "next/navigation";
import { FilAriane } from "@/components/shell/FilAriane";

/** Sur une fiche (ou la création d'un agent) : « Équipe › Hugo › Modifier », pour revenir en arrière. */
export function FilEquipe() {
  const params = useSearchParams();
  if (!params.get("agent") && !params.get("nouveau")) return null;
  return (
    <div className="flex h-11 shrink-0 items-center border-b border-bordure-subtile px-5">
      <FilAriane />
    </div>
  );
}
