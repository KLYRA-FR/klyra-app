"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { useCompte } from "@/lib/compte";
import { useServeursRelies, useSondes } from "@/lib/lieux";
import { cheminTelephone, majuscule, texteFeuille, texteRoutines, type PosteLu } from "@/lib/poste-texte";
import { libelleServeur } from "@/lib/serveur-vps";
import { EnteteTelephone } from "./EnteteTelephone";
import { usePostes, useSupport } from "./poste";

/** T-08. Cartes d'identité du compte. La fiche reste sur l'ordinateur. */
export function AgentsTelephone() {
  const agents = useQuery(api.conversationsCompte.agents, {});
  const sur = useSupport();
  const liste = agents ?? [];
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Agents" />
      <ul className="min-h-0 flex-1 overflow-y-auto px-4">
        {agents === undefined ? <li className="mt-4 h-16 rounded-md bg-fond-surface-grise" /> : null}
        {liste.length === 0 && agents ? <li className="mt-8 text-body-s text-texte-principal">Aucun agent pour l’instant</li> : null}
        {liste.map((agent) => (
          <li key={agent.origine}>
            <Link href={`/chat?id=${encodeURIComponent(`dm-${agent.origine}`)}`} className="flex min-h-16 flex-col justify-center border-b border-bordure-subtile">
              <span className="text-body-s text-texte-principal">{agent.nom}</span>
              <span className="text-ui-xs text-texte-secondaire">{agent.roleCourt}{agent.actif ? "" : " · Hors de Mes agents"}</span>
            </Link>
          </li>
        ))}
        <li className="py-4 text-ui text-texte-secondaire">Sur {sur} : la fiche d’un agent est sur l’ordinateur.</li>
      </ul>
    </div>
  );
}

/** T-10. Cartes de projets, sans leur dossier. */
export function ProjetsTelephone() {
  const projets = useQuery(api.conversationsCompte.projets, {});
  const sur = useSupport();
  const liste = [...(projets ?? [])].sort((a, b) => Number(b.epingle) - Number(a.epingle));
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Projets" />
      <ul className="min-h-0 flex-1 overflow-y-auto px-4">
        {liste.map((projet) => (
          <li key={projet.origine} className="flex min-h-16 flex-col justify-center border-b border-bordure-subtile">
            <span className="text-body-s text-texte-principal">{projet.nom}</span>
            <span className="text-ui-xs text-texte-secondaire">{projet.accroche}</span>
          </li>
        ))}
        <li className="py-4 text-ui text-texte-secondaire">Sur {sur} : le dossier d’un projet se choisit sur l’ordinateur.</li>
      </ul>
    </div>
  );
}

/** T-21. */
export function PlusTelephone() {
  const { principal } = usePostes();
  const sur = useSupport();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Plus" />
      <ul className="px-4">
        <Ligne href="/serveurs" titre="Serveurs" detail={`Voir si ton VPS répond. Tes messages passent par ${sur}.`} />
        <Ligne href="/routines" titre="Automatisations" detail={texteRoutines(principal)} />
        <Ligne href="/artefacts" titre="Artefacts" detail={`Sur ${sur} : la liste est sur l’ordinateur.`} />
        <Ligne href="/reglages" titre="Réglages" detail="Ce téléphone : son chemin, ses ordinateurs, sa déconnexion." />
      </ul>
    </div>
  );
}

/** « Ce téléphone » (brief Réglages › Mobile, § 6) : le pendant de la page Mobile du PC, à 375 px. */
export function ReglagesTelephone() {
  const router = useRouter();
  const { seDeconnecter, moi } = useCompte();
  const { postes, principal } = usePostes();
  const sur = useSupport();
  const serveurs = useServeursRelies();
  const sondes = useSondes(serveurs);
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Réglages" retour={() => router.push("/plus")} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-6">
        <h2 className="mt-2 text-body-s font-medium text-texte-principal">Ce téléphone</h2>
        <p className="mt-2 text-body-s text-texte-principal">{moi?.email}</p>
        <p className="mt-1 text-ui text-texte-secondaire">{cheminTelephone(principal)}</p>
        <button type="button" className="mt-3 min-h-11 text-ui text-texte-principal" onClick={() => void seDeconnecter()}>
          Se déconnecter de ce téléphone
        </button>

        <h2 className="mt-6 text-ui text-texte-secondaire">Ordinateurs</h2>
        {postes === undefined ? <p className="mt-2 h-11 rounded-md bg-fond-surface-grise" /> : null}
        {postes?.length === 0 ? <p className="mt-2 text-ui text-texte-secondaire">Aucun ordinateur ne s’est encore signalé sur ton compte.</p> : null}
        <ul className="mt-1">
          {postes?.map((poste) => (
            <li key={poste.cle} className="border-b border-bordure-subtile py-3">
              <p className="text-ui font-medium text-texte-principal">{poste.nom}</p>
              <p className="mt-0.5 text-ui-xs text-texte-secondaire">{texteFeuille(poste as PosteLu)}</p>
            </li>
          ))}
        </ul>

        {serveurs.length ? (
          <>
            <h2 className="mt-6 text-ui text-texte-secondaire">Serveurs reliés à ce téléphone</h2>
            <ul className="mt-1">
              {serveurs.map((s) => (
                <li key={s.id} className="border-b border-bordure-subtile">
                  <Link href="/serveurs" className="flex min-h-11 items-center justify-between gap-3 py-2">
                    <span className="min-w-0">
                      <span className="block truncate text-ui text-texte-principal">{s.nom}</span>
                      <span className="block text-ui-xs text-texte-secondaire">{libelleServeur(s.etat, sondes[s.id]?.sonde, sondes[s.id]?.agents)}</span>
                    </span>
                    <Icon name="chevron-right" size={16} className="shrink-0 text-icone-secondaire" />
                  </Link>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-ui-xs text-texte-secondaire">Ce téléphone vérifie seulement qu’il répond. Tes messages passent par {sur}.</p>
          </>
        ) : null}

        <p className="mt-6 text-ui text-texte-secondaire">Sur {sur} : les autres réglages sont sur l’ordinateur.</p>
      </div>
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

function Ligne({ href, titre, detail }: { href: string; titre: string; detail: string }) {
  return (
    <li className="border-b border-bordure-subtile py-3">
      <Link href={href} className="flex min-h-11 flex-col justify-center">
        <span className="text-body-s text-texte-principal">{titre}</span>
        <span className="text-ui-xs text-texte-secondaire">{detail}</span>
      </Link>
    </li>
  );
}
