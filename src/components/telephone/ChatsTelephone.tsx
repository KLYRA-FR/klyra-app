"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { EnteteTelephone } from "./EnteteTelephone";
import { usePostes } from "./poste";

/** T-01. Les conversations viennent du compte. La copie locale reste sur l'ordinateur. */
export function ChatsTelephone() {
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const agents = useQuery(api.conversationsCompte.agents, {});
  const { postes } = usePostes();
  const [nouveau, setNouveau] = useState(false);
  const liste = [...(conversations ?? [])].sort((a, b) => {
    if (a.epingleLe && !b.epingleLe) return -1;
    if (!a.epingleLe && b.epingleLe) return 1;
    return b.misAJour.localeCompare(a.misAJour);
  });
  const sansPoste = postes?.length === 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Chats" />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {conversations === undefined ? (
          <div className="mt-4 flex flex-col gap-3">
            {Array.from({ length: 6 }, (_, i) => (
              <div key={i} className="h-14 rounded-md bg-fond-surface-grise" />
            ))}
          </div>
        ) : liste.length === 0 && sansPoste ? (
          <div className="mt-8">
            <h2 className="text-body-s font-medium text-texte-principal">Aucun ordinateur relié</h2>
            <p className="mt-2 text-ui text-texte-secondaire">
              Connecte-toi à ton compte dans KLYRA sur ton ordinateur (Réglages › Équipe) pour retrouver tes conversations ici.
            </p>
          </div>
        ) : liste.length === 0 ? (
          <div className="mt-8">
            <p className="text-body-s text-texte-principal">Écris à un agent ou à ton assistant</p>
            <button type="button" className="mt-4 min-h-11 text-ui text-texte-principal" onClick={() => setNouveau(true)}>
              Nouveau chat
            </button>
          </div>
        ) : (
          <ul className="flex flex-col">
            {liste.map((conversation) => (
              <li key={conversation.origine}>
                <Link href={`/chat?id=${encodeURIComponent(conversation.origine)}`} className="flex min-h-16 flex-col justify-center gap-0.5 border-b border-bordure-subtile py-2">
                  <span className="truncate text-body-s text-texte-principal">{conversation.titre}</span>
                  {conversation.extrait ? <span className="truncate text-ui-xs text-texte-secondaire">{conversation.extrait}</span> : null}
                </Link>
              </li>
            ))}
          </ul>
        )}
        {liste.length > 0 ? (
          <button type="button" className="mt-4 min-h-11 text-ui text-texte-principal" onClick={() => setNouveau(true)}>
            Nouveau chat
          </button>
        ) : null}
      </div>
      {nouveau ? (
        <div className="fixed inset-0 z-30 flex items-end bg-black/20" onClick={() => setNouveau(false)}>
          <section role="dialog" aria-label="Nouveau chat" className="max-h-[70vh] w-full overflow-y-auto rounded-t-2xl bg-fond-surface p-4" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-body-s font-medium">Écrire à</h2>
            <ul className="mt-3">
              {(agents ?? [])
                .filter((agent) => agent.actif)
                .map((agent) => (
                  <li key={agent.origine}>
                    <Link href={`/chat?id=${encodeURIComponent(`dm-${agent.origine}`)}`} className="flex min-h-14 flex-col justify-center" onClick={() => setNouveau(false)}>
                      <span className="text-body-s text-texte-principal">{agent.nom}</span>
                      <span className="text-ui-xs text-texte-secondaire">{agent.roleCourt}</span>
                    </Link>
                  </li>
                ))}
            </ul>
          </section>
        </div>
      ) : null}
    </div>
  );
}
