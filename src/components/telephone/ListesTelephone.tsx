"use client";

import Link from "next/link";
import { Icon, type IconName } from "@/components/icons/Icon";
import { majuscule, texteRoutines } from "@/lib/poste-texte";
import { EnteteTelephone } from "./EnteteTelephone";
import { usePostes, useSupport } from "./poste";

/**
 * T-21 Plus : Automatisations, Artefacts, Rechercher, Réglages, puis les serveurs reliés.
 * « Rechercher » mène à `/recherche` (T-04, au chantier du fil).
 */
export function PlusTelephone() {
  const { principal } = usePostes();
  const sur = useSupport();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Plus" />
      <ul className="min-h-0 flex-1 overflow-y-auto px-4">
        <Ligne href="/routines" icone="lightning-01" titre="Automatisations" detail={texteRoutines(principal)} />
        <Ligne href="/artefacts" icone="artefacts-forme" titre="Artefacts" detail={`Les pages publiées par Claude. La liste est sur ${sur}.`} />
        <Ligne href="/recherche" icone="search-01" titre="Rechercher" detail="Dans tes conversations et leurs messages." />
        <Ligne href="/reglages" icone="reglages-engrenage" titre="Réglages" detail={`Ce téléphone, ton compte, et les réglages de ${sur}.`} />
        <Ligne href="/serveurs" icone="computer" titre="Serveurs" detail={`Voir si ton VPS répond. Tes messages passent par ${sur}.`} />
      </ul>
    </div>
  );
}

/** Un écran dont le contenu reste sur l'ordinateur : « Sur ton PC », « Sur ton Mac », jamais deviné. */
export function EcranPoste({ titre, phrase }: { titre: string; phrase: (sur: string) => string }) {
  const sur = useSupport();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={titre} />
      <div className="px-4 pt-6">
        <h2 className="text-body-s font-medium text-texte-principal">Sur {sur}</h2>
        <p className="mt-2 text-ui text-texte-secondaire">{majuscule(phrase(sur))}</p>
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
