"use client";

import { useMemo } from "react";
import { colorer, type Jeton, type Langage } from "@/lib/apercu/coloration";

/** Les couleurs du design system pour chaque sorte de mot (thème clair, contraste lisible). */
const COULEURS: Record<Jeton, string> = {
  motcle: "text-bleu-k1-500",
  chaine: "text-vert-k1-400",
  nombre: "text-violet-500",
  commentaire: "text-texte-tertiaire italic",
  type: "text-bleu-k1-600",
  balise: "text-bleu-k1-500",
  attribut: "text-rouge-700",
  cle: "text-rouge-700",
  variable: "text-violet-500",
  titre: "font-semibold text-bleu-k1-500",
  gras: "font-semibold",
  lien: "text-bleu-k1-600",
};

/**
 * Le texte d'un fichier lu comme dans un éditeur, sans pouvoir le modifier :
 * numéros de ligne figés à gauche, coloration selon le langage, longues lignes
 * en défilement horizontal, texte sélectionnable (sans les numéros).
 */
export function VueSource({ texte, langage }: { texte: string; langage: Langage | null }) {
  const lignes = useMemo(() => colorer(texte, langage), [texte, langage]);
  return (
    <div data-vue="source" data-langage={langage ?? ""} className="klyra-mono flex w-max min-w-full py-2 text-ui-xs leading-[1.6]">
      <div aria-hidden="true" className="sticky left-0 z-10 shrink-0 bg-fond-surface pr-3 pl-4 text-right text-texte-tertiaire select-none">
        {lignes.map((_, i) => (
          <div key={i}>{i + 1}</div>
        ))}
      </div>
      <pre className="m-0 flex-1 pr-6 font-[inherit] whitespace-pre text-texte-principal select-text">
        {lignes.map((ligne, i) => (
          <div key={i} data-ligne={i + 1} className="min-h-[1.6em]">
            {ligne.map((m, k) =>
              m.jeton ? (
                <span key={k} data-jeton={m.jeton} className={COULEURS[m.jeton]}>
                  {m.texte}
                </span>
              ) : (
                m.texte
              ),
            )}
          </div>
        ))}
      </pre>
    </div>
  );
}
