"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { Icon } from "@/components/icons/Icon";
import { useGestePoste } from "@/lib/poste/client";
import { cn } from "@/lib/cn";
import { majuscule } from "@/lib/poste-texte";
import { useHorsLigne } from "./BandeauReseau";
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

type Reponse = { etat: "accuse"; decision: Decision } | { etat: "erreur"; message: string; delai: boolean; decision: Decision };

/**
 * « {agent} demande ton accord » (E2-10, E2-18, E2-19). La réponse va à l'ordinateur ouvert, qui la donne
 * à l'agent (Poste) : jamais en file. Pendant la réponse, les trois boutons sont bloqués ; « Accordé » ou
 * « Refusé » se figent sur l'accusé de l'ordinateur, un délai propose « Réessayer » sans rien affirmer.
 * Ordinateur fermé : la demande a expiré avec lui (P-11). Réseau absent : la raison, aucune tentative.
 * `compacte` : la carte de « À traiter », Refuser et Autoriser côte à côte, le reste dans « ⋯ » ;
 * sinon trois boutons empilés et le détail technique replié, dans le fil.
 */
export function CarteAccordChat({ demande, compacte = false, titre }: { demande: DemandeAccord; compacte?: boolean; titre?: string }) {
  const router = useRouter();
  const { nom } = useCartes();
  const { ouvert } = usePostes();
  const sur = useSupport();
  const horsLigne = useHorsLigne();
  const { faire, occupe } = useGestePoste();
  const [reponse, setReponse] = useState<Reponse | null>(null);
  const [menu, setMenu] = useState(false);
  const [detail, setDetail] = useState(false);
  const agent = nom(demande.roleId);
  const fige = reponse?.etat === "accuse";
  const impossible = !ouvert || horsLigne;
  const bloque = occupe || impossible;

  const repondre = async (decision: Decision) => {
    if (occupe || impossible || fige) return;
    setReponse(null);
    /* La décision vise cette demande-ci (conversation, message, demande), jamais « le dernier message » de l'agent. */
    const r = await faire("fil.autoriser", {
      conversation: demande.conversationOrigine,
      messageId: demande.messageId,
      demandeId: demande.accord.id,
      decision,
    });
    setReponse(
      r.ok
        ? { etat: "accuse", decision }
        : { etat: "erreur", decision, delai: r.code === "delai", message: r.code === "delai" ? `${majuscule(sur)} n’a pas répondu : rien n’est confirmé.` : r.message || "La réponse n’a pas pu partir." },
    );
  };

  const lien = `/chat?id=${encodeURIComponent(demande.conversationOrigine)}&message=${encodeURIComponent(demande.messageId)}`;
  const raison = !ouvert ? `Demande expirée : KLYRA s’est fermée sur ${sur}.` : horsLigne ? "Possible quand ce téléphone est en ligne" : null;

  return (
    <div role="group" aria-label={`${agent} demande ton accord`} className="flex flex-col gap-3 rounded-xl border border-bordure-forte bg-fond-surface p-4 shadow-ombre-xs">
      <Entete href={compacte ? lien : null}>
        <RondAgent id={demande.roleId} taille={36} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-body-s font-semibold text-texte-principal">{agent} {ouvert ? "demande" : "demandait"} ton accord</span>
          {titre ? <span className="truncate text-ui-xs text-texte-secondaire">{titre}</span> : null}
          <span className="text-ui text-texte-secondaire [overflow-wrap:anywhere]">« {demande.accord.description || demande.accord.libelle} »</span>
        </span>
      </Entete>
      {demande.accord.detail && !compacte ? (
        <div>
          <button type="button" aria-expanded={detail} onClick={() => setDetail((v) => !v)} className="flex min-h-11 items-center gap-1 text-ui text-texte-secondaire">
            <Icon name="chevron-right" size={16} className={cn("shrink-0 transition-transform duration-[220ms] ease-sortie", detail && "rotate-90")} />
            {detail ? "Masquer le détail" : "Voir le détail"}
          </button>
          {detail ? (
            <pre className="klyra-mono m-0 overflow-x-auto rounded-md border border-bordure-subtile bg-fond-page px-3 py-2 text-ui-xs whitespace-pre-wrap text-texte-principal [overflow-wrap:anywhere]">
              {demande.accord.detail}
            </pre>
          ) : null}
        </div>
      ) : null}

      {fige ? (
        <p role="status" className="flex items-center gap-1.5 text-ui text-texte-secondaire">
          <Icon name={reponse.decision === "non" ? "x-01" : "check-01"} size={16} />
          {reponse.decision === "non" ? "Refusé" : reponse.decision === "toujours" ? "Accordé, toujours dans ce projet" : "Accordé"} : {demande.accord.libelle}
        </p>
      ) : !ouvert ? (
        <p className="flex items-start gap-1.5 text-ui text-texte-secondaire">
          <Icon name="clock-01" size={16} className="mt-0.5 shrink-0" />
          {raison}
        </p>
      ) : (
        <>
          {reponse?.etat === "erreur" ? (
            <div role="alert" className="flex flex-col gap-2">
              <p className="text-ui text-texte-erreur">{reponse.message}</p>
              {reponse.delai ? (
                <Bouton variant="blanc" className="h-11 w-full text-ui" disabled={bloque} onClick={() => void repondre(reponse.decision)}>
                  Réessayer
                </Bouton>
              ) : null}
            </div>
          ) : null}
          {occupe ? (
            <p role="status" className="text-ui text-texte-secondaire">
              Réponse…
            </p>
          ) : null}
          <div className={cn("flex gap-2", compacte ? "items-center" : "flex-col")}>
            {compacte ? (
              <>
                <Bouton variant="blanc" className="h-11 flex-1 text-ui" disabled={bloque} onClick={() => void repondre("non")}>
                  Refuser
                </Bouton>
                <Bouton variant="sombre" className="h-11 flex-1 text-ui" disabled={bloque} onClick={() => void repondre("oui")}>
                  Autoriser
                </Bouton>
                <BoutonIcone variant="discret" className="size-11" libelle="Plus de réponses" icone={<Icon name="dot-horizontal" size={20} />} aria-haspopup="dialog" onClick={() => setMenu(true)} />
              </>
            ) : (
              <>
                <Bouton variant="sombre" className="h-11 w-full text-body-s" disabled={bloque} onClick={() => void repondre("oui")}>
                  Autoriser
                </Bouton>
                <Bouton variant="blanc" className="h-11 w-full text-body-s" disabled={bloque} onClick={() => void repondre("toujours")}>
                  Toujours, dans ce projet
                </Bouton>
                <Bouton variant="blanc" className="h-11 w-full text-body-s" disabled={bloque} onClick={() => void repondre("non")}>
                  Refuser
                </Bouton>
              </>
            )}
          </div>
          {horsLigne ? <p className="text-ui-xs text-texte-secondaire">{raison}</p> : null}
        </>
      )}
      {menu ? (
        <MenuFeuille
          titre={`${agent} demande ton accord`}
          objet={{ visuel: <RondAgent id={demande.roleId} taille={36} />, sous: titre ?? (demande.accord.description || demande.accord.libelle) }}
          onFermer={() => setMenu(false)}
          actions={[
            { libelle: "Autoriser", icone: "check-01", desactivee: bloque, note: raison ?? undefined, onChoisir: () => void repondre("oui") },
            { libelle: "Toujours, dans ce projet", icone: "shield-check", desactivee: bloque, note: `${agent} ne te le demandera plus ici`, onChoisir: () => void repondre("toujours") },
            { libelle: "Refuser", icone: "x-01", desactivee: bloque, onChoisir: () => void repondre("non") },
            { libelle: "Ouvrir le fil sur la demande", icone: "message-square", separateurAvant: true, onChoisir: () => router.push(lien) },
          ]}
        />
      ) : null}
    </div>
  );
}
