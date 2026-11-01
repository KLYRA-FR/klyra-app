"use client";

import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useCompte } from "@/lib/compte";
import { EnteteTelephone } from "./EnteteTelephone";

/** T-08. Cartes d'identité du compte. La fiche reste sur l'ordinateur. */
export function AgentsTelephone() {
  const agents = useQuery(api.conversationsCompte.agents, {});
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
        <li className="py-4 text-ui text-texte-secondaire">Sur ton Mac : la fiche d’un agent est sur l’ordinateur.</li>
      </ul>
    </div>
  );
}

/** T-10. Cartes de projets, sans leur dossier. */
export function ProjetsTelephone() {
  const projets = useQuery(api.conversationsCompte.projets, {});
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
        <li className="py-4 text-ui text-texte-secondaire">Sur ton Mac : le dossier d’un projet se choisit sur l’ordinateur.</li>
      </ul>
    </div>
  );
}

/** T-21 et le minimum de T-22 : se déconnecter de ce téléphone. */
export function PlusTelephone() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Plus" />
      <ul className="px-4">
        <Ligne href="/routines" titre="Automatisations" detail="Sur ton Mac : les routines ne partent que quand KLYRA y est ouverte." />
        <Ligne href="/artefacts" titre="Artefacts" detail="Sur ton Mac : la liste est sur l’ordinateur." />
        <Ligne href="/reglages" titre="Réglages" detail="Se déconnecter de ce téléphone." />
      </ul>
    </div>
  );
}

export function ReglagesTelephone() {
  const { seDeconnecter, moi } = useCompte();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Réglages" />
      <div className="px-4">
        <h2 className="mt-2 text-ui text-texte-secondaire">Ce téléphone</h2>
        <p className="mt-2 text-body-s text-texte-principal">{moi?.email}</p>
        <button type="button" className="mt-3 min-h-11 text-ui text-texte-principal" onClick={() => void seDeconnecter()}>
          Se déconnecter de ce téléphone
        </button>
        <p className="mt-6 text-ui text-texte-secondaire">Sur ton Mac : réglage de cet ordinateur.</p>
      </div>
    </div>
  );
}

export function EcranMac({ titre, phrase }: { titre: string; phrase: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre={titre} />
      <div className="px-4 pt-6">
        <h2 className="text-body-s font-medium text-texte-principal">Sur ton Mac</h2>
        <p className="mt-2 text-ui text-texte-secondaire">{phrase}</p>
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
