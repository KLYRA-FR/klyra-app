"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { idDirect } from "@/lib/telephone/chats";
import { Feuille } from "./Feuille";
import { SurLePoste } from "./etats";
import { useSupport } from "./poste";
import { RondAgent, useCartes } from "./AgentsChat";

const LIGNE = "flex min-h-14 w-full items-center gap-3 border-b border-bordure-subtile py-2 text-left no-underline last:border-b-0 active:bg-fond-survol";

/**
 * « Nouveau chat » (spec T-01) : « Écrire à qui ? » — l'assistant, un agent actif, ou une conversation
 * d'équipe dans un projet. Le fil s'ouvre vide, avec les suggestions de l'accueil ; le premier message
 * part par la file (File), comme tout message.
 */
export function NouveauChat({ onFermer }: { onFermer: () => void }) {
  const { cartes } = useCartes();
  const projets = useQuery(api.conversationsCompte.projets, {});
  const sur = useSupport();
  const [equipe, setEquipe] = useState(false);
  const agents = (cartes ?? [])
    .filter((c) => c.actif || c.origine === "principal")
    .sort((a, b) => (a.origine === "principal" ? -1 : b.origine === "principal" ? 1 : a.nom.localeCompare(b.nom, "fr")));

  if (equipe) {
    const liste = [...(projets ?? [])].sort((a, b) => Number(b.epingle) - Number(a.epingle) || a.nom.localeCompare(b.nom, "fr"));
    return (
      <Feuille titre="Dans quel projet ?" onFermer={onFermer}>
        <button type="button" className="mb-1 flex min-h-11 items-center gap-1 text-ui text-texte-secondaire" onClick={() => setEquipe(false)}>
          <Icon name="chevron-left" size={18} />
          Écrire à qui ?
        </button>
        {projets !== undefined && liste.length === 0 ? (
          <>
            <p className="pt-2 text-body-s text-texte-principal">Ajoute un projet sur {sur}</p>
            <SurLePoste raison="le dossier d’un projet se choisit sur l’ordinateur." />
          </>
        ) : (
          <ul>
            {liste.map((projet) => (
              <li key={projet.origine}>
                <Link href={`/chat?id=${crypto.randomUUID()}&nouveau=${encodeURIComponent(projet.origine)}`} className={LIGNE} onClick={onFermer}>
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-fond-surface-grise text-icone-secondaire">
                    <Icon name="projets-dossier" size={20} />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-body-s text-texte-principal">{projet.nom}</span>
                    {projet.accroche ? <span className="truncate text-ui text-texte-secondaire">{projet.accroche}</span> : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Feuille>
    );
  }

  return (
    <Feuille titre="Écrire à qui ?" onFermer={onFermer}>
      <ul>
        {agents.map((agent) => (
          <li key={agent.origine}>
            <Link href={`/chat?id=${encodeURIComponent(idDirect(agent.origine))}`} className={LIGNE} onClick={onFermer}>
              <RondAgent id={agent.origine} />
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-body-s text-texte-principal">{agent.nom}</span>
                <span className="truncate text-ui text-texte-secondaire">{agent.origine === "principal" ? "Ton assistant · il répartit le travail" : agent.roleCourt}</span>
              </span>
            </Link>
          </li>
        ))}
        <li>
          <button type="button" className={LIGNE} onClick={() => setEquipe(true)}>
            <span className="flex size-9 shrink-0 items-center justify-center rounded-sm bg-fond-surface-grise text-icone-secondaire">
              <Icon name="users-profiles-01" size={20} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="text-body-s text-texte-principal">Conversation d’équipe</span>
              <span className="truncate text-ui text-texte-secondaire">Dans un projet, avec plusieurs agents</span>
            </span>
            <Icon name="chevron-right" size={18} className="text-icone-secondaire" />
          </button>
        </li>
      </ul>
    </Feuille>
  );
}
