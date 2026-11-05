"use client";

import { Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";

/** Le bas de Plus (lot 8, E8-01, E8-02) : les réglages, les serveurs, et ce qui s'utilise sur l'ordinateur. */
export function PiedPlus({ sur }: { sur: string }) {
  return (
    <SectionListe titre="Réglages et serveurs" className="mt-5">
      <GroupeListe>
        <LigneListe href="/reglages" debut={<TuileIcone icone="reglages-engrenage" />} retrait="tuile" nom="Réglages" ligne2={`Ce téléphone, ton compte et ${sur}`} fin="chevron" />
        <LigneListe href="/serveurs" debut={<TuileIcone icone="globe-01" />} retrait="tuile" nom="Serveurs" ligne2="Tes VPS : s’ils répondent, leur écrire" fin="chevron" />
        <LigneListe href="/marketplace" debut={<TuileIcone icone="boutique-01" />} retrait="tuile" nom="Marketplace" etiquette={<Etiquette>{`Sur ${sur}`}</Etiquette>} ligne2="Les apps que tes agents utilisent" fin="chevron" />
      </GroupeListe>
    </SectionListe>
  );
}

