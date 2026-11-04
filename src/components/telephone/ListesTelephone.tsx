"use client";

import type { IconName } from "@/components/icons/Icon";
import { majuscule, texteRoutines } from "@/lib/poste-texte";
import { EnteteTelephone, PageOnglet } from "./EnteteTelephone";
import { EtatEcran } from "./etats";
import { GroupeListe, LigneListe, TuileIcone } from "./Liste";
import { usePostes, useSupport } from "./poste";

/**
 * T-21 Plus : Automatisations, Artefacts, Rechercher, Réglages, puis les serveurs reliés.
 * « Rechercher » mène à `/chats?vue=recherche` (T-04).
 */
export function PlusTelephone() {
  const { principal } = usePostes();
  const sur = useSupport();
  return (
    <PageOnglet titre="Plus">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <GroupeListe>
          <LigneListe href="/routines" debut={<TuileIcone icone="lightning-01" />} retrait="tuile" nom="Automatisations" ligne2={texteRoutines(principal)} fin="chevron" />
          <LigneListe href="/artefacts" debut={<TuileIcone icone="artefacts-forme" />} retrait="tuile" nom="Artefacts" ligne2={`Les pages et liens d’artefacts. La liste est sur ${sur}.`} fin="chevron" />
          <LigneListe href="/chats?vue=recherche" debut={<TuileIcone icone="search-01" />} retrait="tuile" nom="Rechercher" ligne2="Dans tes conversations et leurs messages." fin="chevron" />
        </GroupeListe>
        <GroupeListe className="mt-6">
          <LigneListe href="/reglages" debut={<TuileIcone icone="reglages-engrenage" />} retrait="tuile" nom="Réglages" ligne2={`Ce téléphone, ton compte, et les réglages de ${sur}.`} fin="chevron" />
          <LigneListe href="/serveurs" debut={<TuileIcone icone="computer" />} retrait="tuile" nom="Serveurs" ligne2={`Voir si ton VPS répond. Tes messages passent par ${sur}.`} fin="chevron" />
        </GroupeListe>
      </div>
    </PageOnglet>
  );
}

/**
 * Un écran qui s'utilise sur l'ordinateur (P-8, S-29, C-3) : jamais une impasse, « ‹ » vers Plus. Il
 * dit où le faire (« sur ton Mac », jamais deviné) et pourquoi.
 */
export function EcranPoste({
  titre,
  icone,
  phrase,
  raison,
}: {
  titre: string;
  icone: IconName;
  /** « Le Marketplace s'utilise sur ton Mac ». */
  phrase: (sur: string) => string;
  raison: string;
}) {
  const sur = useSupport();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={titre} parent="/plus" pastille={false} />
      <div className="min-h-0 flex-1 overflow-y-auto">
        <EtatEcran icone={icone} titre={majuscule(phrase(sur))} texte={raison} />
      </div>
    </div>
  );
}
