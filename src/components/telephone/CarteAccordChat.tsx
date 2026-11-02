"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { Icon } from "@/components/icons/Icon";
import { useGestePoste } from "@/lib/poste/client";
import { cn } from "@/lib/cn";
import { majuscule } from "@/lib/poste-texte";
import { MenuFeuille } from "./Feuille";
import { usePostes, useSupport } from "./poste";
import { RondAgent, useCartes } from "./AgentsChat";

type Decision = "oui" | "toujours" | "non";

function Entete({ href, children }: { href: string | null; children: ReactNode }) {
  const classe = "flex min-w-0 items-start gap-3 text-left no-underline";
  return href ? (
    <Link href={href} className={classe}>
      {children}
    </Link>
  ) : (
    <div className={classe}>{children}</div>
  );
}

export interface DemandeAccord {
  conversationOrigine: string;
  roleId: string;
  messageId: string;
  accord: { id: string; libelle: string; detail: string; description: string };
}

/**
 * « {agent} demande ton accord » (spec mobile T-01, T-02). La réponse va à l'ordinateur ouvert, qui
 * la donne à l'agent (Poste) ; ordinateur fermé, la demande a expiré avec lui (P-11).
 * `compacte` : la carte de « À traiter », Refuser et Autoriser côte à côte, « Toujours, dans ce projet »
 * dans « ⋯ » ; sinon trois boutons empilés, dans le fil.
 */
export function CarteAccordChat({ demande, compacte = false, titre }: { demande: DemandeAccord; compacte?: boolean; titre?: string }) {
  /* Dans « À traiter », toucher la carte ouvre le fil sur elle ; dans le fil, elle y est déjà. */
  const { nom } = useCartes();
  const { ouvert } = usePostes();
  const sur = useSupport();
  const { faire, occupe } = useGestePoste();
  const [reponse, setReponse] = useState<{ decision: Decision } | { erreur: string; delai: boolean } | null>(null);
  const [menu, setMenu] = useState(false);
  const agent = nom(demande.roleId);

  const repondre = async (decision: Decision) => {
    setReponse(null);
    const r = await faire("fil.autoriser", {
      conversation: demande.conversationOrigine,
      messageId: demande.messageId,
      demandeId: demande.accord.id,
      decision,
    });
    setReponse(r.ok ? { decision } : { erreur: r.code === "delai" ? `${majuscule(sur)} ne répond pas.` : r.message || "La réponse n’a pas pu partir.", delai: r.code === "delai" });
  };

  const lien = `/chat?id=${encodeURIComponent(demande.conversationOrigine)}&message=${encodeURIComponent(demande.messageId)}`;

  return (
    <div role="group" aria-label={`${agent} demande ton accord`} className="flex flex-col gap-3 rounded-xl border border-bordure-forte bg-fond-surface p-4 shadow-ombre-xs">
      <Entete href={compacte ? lien : null}>
        <RondAgent id={demande.roleId} taille={36} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body-s font-medium text-texte-principal">{agent} demande ton accord</span>
          {titre ? <span className="truncate text-ui-xs text-texte-secondaire">{titre}</span> : null}
          <span className="text-ui text-texte-secondaire [overflow-wrap:anywhere]">« {demande.accord.description || demande.accord.libelle} »</span>
        </span>
      </Entete>
      {demande.accord.detail && !compacte ? (
        <pre className="klyra-mono m-0 overflow-x-auto rounded-md border border-bordure-subtile bg-fond-page px-3 py-2 text-ui-xs whitespace-pre-wrap text-texte-principal [overflow-wrap:anywhere]">
          {demande.accord.detail}
        </pre>
      ) : null}

      {reponse && "decision" in reponse ? (
        <p role="status" className="flex items-center gap-1.5 text-ui text-texte-secondaire">
          <Icon name={reponse.decision === "non" ? "x-01" : "check-01"} size={16} />
          {reponse.decision === "non" ? "Refusé" : "Accordé"} : {demande.accord.libelle}
        </p>
      ) : !ouvert ? (
        <p className="text-ui text-texte-secondaire">Demande expirée : KLYRA s’est fermée sur {sur}.</p>
      ) : (
        <>
          {reponse && "erreur" in reponse ? (
            <p role="alert" className="text-ui text-texte-erreur">
              {reponse.erreur}
            </p>
          ) : null}
          <div className={cn("flex gap-2", compacte ? "items-center" : "flex-col")}>
            {compacte ? (
              <>
                <Bouton variant="blanc" className="h-11 flex-1 text-ui" disabled={occupe} onClick={() => void repondre("non")}>
                  Refuser
                </Bouton>
                <Bouton variant="sombre" className="h-11 flex-1 text-ui" disabled={occupe} onClick={() => void repondre("oui")}>
                  {reponse && "delai" in reponse && reponse.delai ? "Réessayer" : "Autoriser"}
                </Bouton>
                <BoutonIcone
                  variant="discret"
                  className="size-11"
                  libelle="Plus de réponses"
                  icone={<Icon name="dot-horizontal" size={20} />}
                  aria-haspopup="dialog"
                  onClick={() => setMenu(true)}
                />
              </>
            ) : (
              <>
                <Bouton variant="sombre" className="h-11 w-full text-body-s" disabled={occupe} onClick={() => void repondre("oui")}>
                  Autoriser
                </Bouton>
                <Bouton variant="blanc" className="h-11 w-full text-body-s" disabled={occupe} onClick={() => void repondre("toujours")}>
                  Toujours, dans ce projet
                </Bouton>
                <Bouton variant="blanc" className="h-11 w-full text-body-s" disabled={occupe} onClick={() => void repondre("non")}>
                  Refuser
                </Bouton>
              </>
            )}
          </div>
        </>
      )}
      {menu ? (
        <MenuFeuille
          titre={`${agent} demande ton accord`}
          onFermer={() => setMenu(false)}
          actions={[
            { libelle: "Toujours, dans ce projet", onChoisir: () => void repondre("toujours") },
            { libelle: "Refuser", onChoisir: () => void repondre("non") },
            { libelle: "Autoriser", onChoisir: () => void repondre("oui") },
          ]}
        />
      ) : null}
    </div>
  );
}
