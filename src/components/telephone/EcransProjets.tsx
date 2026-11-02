"use client";

import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { EnteteTelephone } from "./EnteteTelephone";
import { EcranPoste } from "./ListesTelephone";
import { useSupport } from "./poste";

/** Projets, projet, dossier et visionneuse (T-10 à T-13). Routes : /projets, /projet, /fichiers. */

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

/** T-11 à T-13 : à venir. */
export function ProjetTelephone() {
  return <EcranPoste titre="Projet" phrase={(sur) => `les fichiers de ce projet sont sur ${sur}. Ils s’affichent quand KLYRA y est ouverte.`} />;
}
