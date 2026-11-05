"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useDirectEspace, useProjetsEspace } from "@/lib/telephone/espace";
import { Feuille } from "./Feuille";
import { SurLePoste } from "./etats";
import { Etiquette, GroupeListe, LigneListe, TuileIcone } from "./Liste";
import { useSupport } from "./poste";
import { RondAgent, useCartes } from "./AgentsChat";

/**
 * « Nouveau chat » (E2-11, E2-12) : « Écrire à qui ? » — l'assistant, un agent actif, ou une conversation
 * d'équipe dans un projet. Le fil s'ouvre vide, avec les suggestions de l'accueil, sans rien envoyer ; le
 * premier message crée la conversation et part par la file, comme tout message. La création d'un projet
 * reste sur l'ordinateur.
 */
export function NouveauChat({ onFermer }: { onFermer: () => void }) {
  const router = useRouter();
  const { cartes } = useCartes();
  const projets = useProjetsEspace();
  const direct = useDirectEspace();
  const sur = useSupport();
  const [equipe, setEquipe] = useState(false);
  const agents = (cartes ?? [])
    .filter((c) => c.actif || c.origine === "principal")
    .sort((a, b) => (a.origine === "principal" ? -1 : b.origine === "principal" ? 1 : a.nom.localeCompare(b.nom, "fr")));
  const aller = (chemin: string) => {
    onFermer();
    router.push(chemin);
  };

  if (equipe) {
    const liste = [...(projets ?? [])].sort((a, b) => Number(b.epingle) - Number(a.epingle) || a.nom.localeCompare(b.nom, "fr"));
    return (
      <Feuille titre="Dans quel projet ?" sousTitre="Conversation d’équipe" retour={() => setEquipe(false)} onFermer={onFermer}>
        {projets !== undefined && liste.length === 0 ? (
          <>
            <p className="pt-2 text-body-s text-texte-principal">Ajoute un projet sur {sur}</p>
            <SurLePoste raison="le dossier d’un projet se choisit sur l’ordinateur." />
          </>
        ) : (
          <>
            <GroupeListe>
              {liste.map((projet) => (
                <LigneListe
                  key={projet.origine}
                  retrait="tuile"
                  debut={<TuileIcone icone="projets-dossier" />}
                  nom={projet.nom}
                  etiquette={projet.epingle ? <Etiquette>Épinglé</Etiquette> : null}
                  ligne2={projet.accroche || undefined}
                  uneLigne
                  onClick={() => aller(`/chat?nouveau=${encodeURIComponent(projet.origine)}`)}
                />
              ))}
            </GroupeListe>
            <GroupeListe className="mt-3">
              <LigneListe retrait="tuile" debut={<TuileIcone icone="folder-plus-01" />} nom="Nouveau projet" etiquette={<Etiquette>Sur {sur}</Etiquette>} ligne2="Le dossier d’un projet se choisit sur l’ordinateur." uneLigne inactive />
            </GroupeListe>
          </>
        )}
      </Feuille>
    );
  }

  return (
    <Feuille titre="Écrire à qui ?" onFermer={onFermer}>
      <GroupeListe>
        {agents.map((agent) => (
          <LigneListe
            key={agent.origine}
            retrait="avatar"
            debut={<RondAgent id={agent.origine} taille={40} />}
            nom={agent.nom}
            ligne2={agent.origine === "principal" ? "Ton assistant · il répartit le travail" : agent.roleCourt}
            uneLigne
            onClick={() => aller(`/chat?id=${encodeURIComponent(direct(agent.origine))}`)}
          />
        ))}
      </GroupeListe>
      <GroupeListe className="mt-3">
        <LigneListe retrait="tuile" debut={<TuileIcone icone="users-profiles-01" />} nom="Conversation d’équipe" ligne2="Dans un projet, avec plusieurs agents" uneLigne fin="chevron" onClick={() => setEquipe(true)} />
      </GroupeListe>
    </Feuille>
  );
}
