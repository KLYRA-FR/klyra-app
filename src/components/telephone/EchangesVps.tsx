"use client";

import { useState } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { Markdown } from "@/components/ui/Markdown";
import { nomLieu, useServeursRelies } from "@/lib/lieux";
import { arreterVps, autoriserVps, type EchangeDirect } from "@/lib/telephone/vps-direct";
import { RondAgent, useCartes } from "./AgentsChat";
import { AvecLiensFilsTelephone } from "./LienFilTelephone";
import { useSupport } from "./poste";

/**
 * Les messages envoyés au VPS par ce téléphone pendant que l'ordinateur était fermé, avec leur réponse
 * qui s'écrit. Ils s'effacent d'ici dès que l'ordinateur, rouvert, les a rangés dans la conversation
 * et recopiés dans le compte. L'accord demandé par l'agent se donne ici, directement au VPS.
 */
export function EchangesVps({ echanges }: { echanges: EchangeDirect[] }) {
  const serveurs = useServeursRelies();
  const sur = useSupport();
  const { nom } = useCartes();
  const [occupe, setOccupe] = useState<string | null>(null);

  const agir = async (cle: string, geste: () => Promise<boolean>) => {
    setOccupe(cle);
    try {
      await geste();
    } finally {
      setOccupe(null);
    }
  };

  return (
    <>
      {echanges.map((e) => (
        <div key={e.requestId} className="mt-4 flex flex-col gap-3">
          <div className="flex flex-col items-end gap-1">
            <div className="w-fit max-w-[85%] rounded-xl bg-fond-inverse px-3.5 py-2 text-body-s leading-[1.5] whitespace-pre-wrap text-texte-inverse [overflow-wrap:anywhere]">
              {e.texte}
            </div>
            <p className="text-ui-xs text-texte-secondaire">
              Envoyé à {nomLieu(e.adresse, serveurs)} · rangé dans la conversation à l’ouverture de {sur}
            </p>
          </div>
          <div className="grid grid-cols-[32px_minmax(0,1fr)] gap-x-2.5">
            <div className="pt-0.5">
              <RondAgent id={e.agentId} taille={32} />
            </div>
            <div className="flex min-w-0 flex-col items-start gap-2">
              {e.reponse ? (
                <AvecLiensFilsTelephone>
                  <Markdown source={e.reponse} className="min-w-0 gap-2 text-body-s leading-[1.55] text-texte-principal" />
                </AvecLiensFilsTelephone>
              ) : e.statut === "en-cours" ? (
                <p className="text-ui text-texte-secondaire">{nom(e.agentId)} réfléchit…</p>
              ) : null}
              {e.statut === "erreur" ? (
                <p role="alert" className="text-ui text-texte-erreur">
                  {e.erreur}
                </p>
              ) : null}
              {e.autorisation ? (
                <div className="w-full rounded-xl border border-bordure-subtile bg-fond-surface p-3">
                  <p className="text-body-s font-medium text-texte-principal">{nom(e.agentId)} demande ton accord</p>
                  <p className="mt-1 text-ui text-texte-secondaire [overflow-wrap:anywhere]">
                    {e.autorisation.description || e.autorisation.outil}
                  </p>
                  <div className="mt-3 flex flex-col gap-2">
                    <Bouton variant="sombre" taille="md" disabled={occupe !== null} onClick={() => void agir(`${e.requestId}:oui`, () => autoriserVps(e, "oui"))}>
                      Autoriser
                    </Bouton>
                    <Bouton variant="blanc" taille="md" disabled={occupe !== null} onClick={() => void agir(`${e.requestId}:non`, () => autoriserVps(e, "non"))}>
                      Refuser
                    </Bouton>
                  </div>
                </div>
              ) : null}
              {e.statut === "en-cours" ? (
                <Bouton variant="blanc" className="min-h-11" disabled={occupe !== null} onClick={() => void agir(`${e.requestId}:stop`, () => arreterVps(e))}>
                  Arrêter
                </Bouton>
              ) : null}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}
