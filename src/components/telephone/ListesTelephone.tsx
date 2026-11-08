"use client";

import type { IconName } from "@/components/icons/Icon";
import { majuscule, texteRoutines } from "@/lib/poste-texte";
import { nombreAValider } from "@/lib/telephone/tickets";
import { EnteteTelephone, PageOnglet } from "./EnteteTelephone";
import { EtatEcran } from "./etats";
import { Etiquette, GroupeListe, LigneListe, TuileIcone } from "./Liste";
import { usePostes, useSupport } from "./poste";
import { useConversationsEspace } from "@/lib/telephone/espace";
import { CarteOrdinateur } from "./CarteOrdinateur";
import { useEspaceAffiche } from "./EspaceTelephone";
import { PiedPlus } from "./PiedPlus";

/**
 * T-21 Plus : Tickets, Automatisations, Artefacts, Mémoire, Rechercher, Réglages, puis les serveurs reliés.
 * Le compte de Tickets ne dit que les tickets confirmés à valider ; inconnu ou zéro, rien (E4-01).
 * « Rechercher » mène à `/chats?vue=recherche` (T-04).
 */
export function PlusTelephone() {
  const { ouvert } = usePostes();
  const sur = useSupport();
  const { serveur } = useEspaceAffiche();
  const aValider = nombreAValider(useConversationsEspace(), ouvert);
  return (
    <PageOnglet titre="Plus">
      {/* Lot 8 : une ligne par destination (la ligne 2 coupée, E8-01), la carte de l'ordinateur en tête. */}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6 [&_.line-clamp-2]:line-clamp-1">
        <CarteOrdinateur />
        <div className="h-5" />
        <GroupeListe>
          <LigneListe href="/tickets" debut={<TuileIcone icone="list" bleue />} retrait="tuile" nom="Tickets" etiquette={aValider ? <Etiquette ton="bleue">{aValider} à valider</Etiquette> : undefined} ligne2="Le travail de tes agents, par étape" fin="chevron" />
          <LigneListe href="/routines" debut={<TuileIcone icone="lightning-01" />} retrait="tuile" nom="Automatisations" ligne2={texteRoutines(serveur ? { nom: serveur.nom, sur } : null)} fin="chevron" />
          <LigneListe href="/artefacts" debut={<TuileIcone icone="artefacts-forme" />} retrait="tuile" nom="Artefacts" ligne2="Les pages et les liens de tes agents" fin="chevron" />
          <LigneListe href="/memoire" debut={<TuileIcone icone="git-branch-01" />} retrait="tuile" nom="Mémoire" ligne2="Notes, documents et souvenirs des agents" fin="chevron" />
          <LigneListe href="/chats?vue=recherche" debut={<TuileIcone icone="search-01" />} retrait="tuile" nom="Rechercher" ligne2="Dans tes conversations et leurs messages" fin="chevron" />
        </GroupeListe>
        <PiedPlus sur={sur} />
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
