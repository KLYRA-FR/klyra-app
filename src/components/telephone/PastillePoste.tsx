"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { libellePastille, texteFeuille, type PosteLu } from "@/lib/poste-texte";
import { raisonSansNotifications } from "@/lib/push";
import { Feuille } from "./Feuille";
import { usePostes } from "./poste";
import { usePushTelephone } from "./push";

/** Le nom complet de la pastille pour les lecteurs d'écran : la première phrase de P-3, ou P-13, puis « État des ordinateurs ». */
function nomComplet(poste: PosteLu | null, plusieurs: boolean): string {
  if (!poste) return "Aucun ordinateur relié. État des ordinateurs.";
  const phrase = texteFeuille(poste, plusieurs);
  const fin = phrase.indexOf(". ");
  return `${fin === -1 ? phrase : phrase.slice(0, fin + 1)} État des ordinateurs.`;
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
      <p className="mt-2 flex min-h-11 items-center gap-2 text-ui font-medium text-texte-accent">
        <Icon name="check-01" size={16} />
        On te prévient à l’ouverture
      </p>
    );
  }
  const raison = etat.etat === "chargement" || etat.etat === "a-demander" || etat.etat === "a-activer" || etat.etat === "active" ? null : raisonSansNotifications(etat.etat);
  return (
    <div className="mt-2">
      <Bouton
        variant="blanc"
        taille="md"
        iconeGauche={<Icon name="bell-01" size={20} />}
        disabled={raison !== null || etat.etat === "chargement" || push.occupe}
        onClick={() => void push.attendreOuverture(cle)}
      >
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

/**
 * Pastille de l'ordinateur (socle § 2.3, P-1, P-2) : « Mac », « PC », « Mac fermé », « Aucun
 * ordinateur » ; le nom du poste seulement s'il y en a plusieurs. 32 px dans une cible de 44. Ouvre la
 * feuille des ordinateurs (T-23, S-06).
 */
export function PastillePoste() {
  const { postes, principal } = usePostes();
  const [ouverte, setOuverte] = useState(false);
  if (!postes) return <span aria-hidden="true" className="h-8 w-[72px] shrink-0 rounded-pill bg-fond-surface-grise" />;
  const plusieurs = postes.length > 1;
  const poste = principal as PosteLu | null;

  return (
    <>
      <button
        type="button"
        aria-label={nomComplet(poste, plusieurs)}
        aria-haspopup="dialog"
        onClick={() => setOuverte(true)}
        className={cn(
          "relative inline-flex h-8 max-w-[160px] shrink-0 items-center gap-2 rounded-pill px-3 text-ui font-medium text-texte-principal",
          "transition-colors duration-[120ms] ease-sortie after:absolute after:-inset-y-1.5 after:inset-x-0",
          poste?.ouvert ? "border border-bordure-defaut bg-fond-surface active:bg-fond-survol" : "bg-fond-surface-grise active:bg-fond-survol",
        )}
      >
        {!poste ? (
          <Icon name="computer" size={16} className="shrink-0" />
        ) : poste.ouvert ? (
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-fond-accent" />
        ) : (
          <span aria-hidden="true" className="size-2 shrink-0 rounded-full border-[1.5px] border-texte-secondaire" />
        )}
        <span className="max-w-[112px] truncate">{libellePastille(poste, plusieurs)}</span>
      </button>
      {ouverte ? (
        <Feuille titre="Ordinateurs" onFermer={() => setOuverte(false)}>
          <p className="-mt-1 pb-3 text-ui-xs text-texte-secondaire">Ce que voit ce téléphone</p>
          {postes.length === 0 ? (
            /* P-13. */
            <div className="pt-2">
              <p className="text-body-s font-medium text-texte-principal">Aucun ordinateur relié</p>
              <p className="mt-2 text-ui text-texte-secondaire">
                Connecte-toi à ton compte dans KLYRA sur ton ordinateur (Réglages › Équipe) pour retrouver tes conversations ici.
              </p>
            </div>
          ) : (
            <ul className="overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-xs">
              {postes.map((p) => (
                <li key={p.cle} className="flex gap-3 border-b border-bordure-defaut px-4 py-3 last:border-b-0">
                  <span aria-hidden="true" className="flex size-9 shrink-0 items-center justify-center rounded-md-moins bg-fond-surface-grise text-icone-defaut">
                    <Icon name="computer" size={20} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-body-s font-medium text-texte-principal">
                      <span className="min-w-0 truncate">{p.nom}</span>
                      <span
                        className={cn(
                          "inline-flex h-5 items-center rounded-sm px-1.5 text-ui-xs font-medium",
                          p.ouvert ? "bg-fond-teinte-bleue text-texte-accent" : "bg-fond-surface-grise text-texte-principal",
                        )}
                      >
                        {p.ouvert ? "Ouvert" : "Fermé"}
                      </span>
                    </p>
                    <p className="mt-0.5 text-ui text-texte-secondaire">{texteFeuille(p as PosteLu, plusieurs)}</p>
                    {p.ouvert ? null : <PrevenirOuverture cle={p.cle} />}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="pt-3 text-ui-xs text-texte-secondaire">Ce téléphone ne réveille pas un ordinateur à distance.</p>
        </Feuille>
      ) : null}
    </>
  );
}
