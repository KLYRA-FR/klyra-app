"use client";

import { useState } from "react";
import { Bouton } from "@/components/ui/Bouton";

/** Une commande à copier, sur une ligne qui peut se couper. */
export function Commande({ texte }: { texte: string }) {
  const [copie, setCopie] = useState(false);
  const copier = () => {
    void navigator.clipboard?.writeText(texte).then(() => {
      setCopie(true);
      setTimeout(() => setCopie(false), 2000);
    });
  };
  return (
    <div className="flex items-start gap-2 rounded-md border border-bordure-subtile bg-fond-page p-3">
      <code className="min-w-0 flex-1 text-ui-xs leading-[1.6] [overflow-wrap:anywhere] text-texte-principal">{texte}</code>
      <Bouton variant="blanc" taille="compact" onClick={copier} className="relative after:absolute after:inset-x-0 after:-inset-y-1.5">
        {copie ? "Copiée" : "Copier"}
      </Bouton>
    </div>
  );
}
