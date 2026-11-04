"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icons/Icon";
import { majuscule, texteRoutines } from "@/lib/poste-texte";
import { EnteteTelephone } from "./EnteteTelephone";
import { EtatEcran } from "./etats";
import { usePostes, useSupport } from "./poste";

/**
 * T-21 Plus : Automatisations, Artefacts, Rechercher, Réglages, puis les serveurs reliés.
 * « Rechercher » mène à `/chats?vue=recherche` (T-04).
 */
export function PlusTelephone() {
  const { principal } = usePostes();
  const sur = useSupport();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Plus" />
      <ul className="min-h-0 flex-1 overflow-y-auto px-4">
        <Ligne href="/routines" icone="lightning-01" titre="Automatisations" detail={texteRoutines(principal)} />
        <Ligne href="/artefacts" icone="artefacts-forme" titre="Artefacts" detail={`Les pages et liens d’artefacts. La liste est sur ${sur}.`} />
        <Ligne href="/chats?vue=recherche" icone="search-01" titre="Rechercher" detail="Dans tes conversations et leurs messages." />
        <Ligne href="/reglages" icone="reglages-engrenage" titre="Réglages" detail={`Ce téléphone, ton compte, et les réglages de ${sur}.`} />
        <Ligne href="/serveurs" icone="computer" titre="Serveurs" detail={`Voir si ton VPS répond. Tes messages passent par ${sur}.`} />
      </ul>
    </div>
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

function Ligne({ href, icone, titre, detail }: { href: string; icone: IconName; titre: string; detail: string }) {
  return (
    <li className="border-b border-bordure-subtile">
      <Link href={href} className="flex min-h-16 items-center gap-3 py-2 active:bg-fond-survol">
        <Icon name={icone} size={24} className="shrink-0 text-icone-secondaire" />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="text-body-s text-texte-principal">{titre}</span>
          <span className="text-ui-xs text-texte-secondaire">{detail}</span>
        </span>
        <Icon name="chevron-right" size={20} className="shrink-0 text-icone-secondaire" />
      </Link>
    </li>
  );
}
