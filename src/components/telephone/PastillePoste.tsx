"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { libellePastille, texteFeuille, type PosteLu } from "@/lib/poste-texte";
import { raisonSansNotifications } from "@/lib/push";
import { Feuille } from "./Feuille";
import { usePostes } from "./poste";
import { usePushTelephone } from "./push";

/** Le nom complet de la pastille pour les lecteurs d'écran : la première phrase de P-3, ou P-13. */
function nomComplet(poste: PosteLu | null): string {
  if (!poste) return "Aucun ordinateur relié";
  const phrase = texteFeuille(poste);
  const fin = phrase.indexOf(". ");
  return fin === -1 ? phrase : phrase.slice(0, fin + 1);
}

/**
 * « Me prévenir à l'ouverture » (P-6, T-23) : une notification « Ton Mac s'est ouvert », une seule
 * fois, au retour de ce poste. Le téléphone s'abonne au premier appui (l'autorisation du système
 * est demandée à ce moment, après la phrase qui l'annonce). Aucun réveil à distance.
 */
export function PrevenirOuverture({ cle }: { cle: string }) {
  const push = usePushTelephone();
  const { etat } = push;
  if (etat.etat === "active" && etat.ouverturesAttendues.includes(cle)) {
    return (
      <p className="mt-2 flex min-h-11 items-center gap-2 text-ui text-texte-principal">
        <Icon name="check-01" size={16} />
        On te prévient à l’ouverture
      </p>
    );
  }
  const raison = etat.etat === "chargement" || etat.etat === "a-demander" || etat.etat === "a-activer" || etat.etat === "active" ? null : raisonSansNotifications(etat.etat);
  return (
    <div className="mt-2">
      <Bouton variant="blanc" taille="md" disabled={raison !== null || etat.etat === "chargement" || push.occupe} onClick={() => void push.attendreOuverture(cle)}>
        Me prévenir à l’ouverture
      </Bouton>
      {raison ? <p className="mt-1 text-ui-xs text-texte-secondaire">{raison}</p> : null}
      {etat.etat === "a-demander" ? <p className="mt-1 text-ui-xs text-texte-secondaire">Ce téléphone va te demander d’autoriser les notifications de KLYRA.</p> : null}
      {push.erreur ? (
        <p role="alert" className="mt-1 text-ui-xs text-texte-erreur">
          {push.erreur}
        </p>
      ) : null}
    </div>
  );
}

/** Pastille d'en-tête (P-1, P-2). Ouvre la feuille des ordinateurs (T-23). */
export function PastillePoste() {
  const { postes, principal } = usePostes();
  const [ouverte, setOuverte] = useState(false);
  if (!postes) return <span className="h-8 w-16 shrink-0 rounded-full bg-fond-surface-grise" />;

  return (
    <>
      <button
        type="button"
        aria-label={nomComplet(principal as PosteLu | null)}
        aria-haspopup="dialog"
        onClick={() => setOuverte(true)}
        className="inline-flex h-11 max-w-[140px] shrink-0 items-center rounded-full px-3 text-ui-xs text-texte-principal active:bg-fond-survol"
      >
        <span className="truncate">{libellePastille(principal as PosteLu | null)}</span>
      </button>
      {ouverte ? (
        <Feuille titre="Ordinateurs" onFermer={() => setOuverte(false)}>
          {postes.length === 0 ? (
            /* P-13. */
            <div className="pt-2">
              <p className="text-body-s font-medium text-texte-principal">Aucun ordinateur relié</p>
              <p className="mt-2 text-ui text-texte-secondaire">
                Connecte-toi à ton compte dans KLYRA sur ton ordinateur (Réglages › Équipe) pour retrouver tes conversations ici.
              </p>
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-bordure-subtile">
              {postes.map((poste) => (
                <li key={poste.cle} className="py-3">
                  <p className="text-body-s font-medium text-texte-principal">{poste.nom}</p>
                  <p className="mt-1 text-ui text-texte-secondaire">{texteFeuille(poste as PosteLu)}</p>
                  {poste.ouvert ? null : <PrevenirOuverture cle={poste.cle} />}
                </li>
              ))}
            </ul>
          )}
        </Feuille>
      ) : null}
    </>
  );
}
