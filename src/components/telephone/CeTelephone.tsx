"use client";

import { useState } from "react";
import { ancreReglage } from "@/components/reglages/ui";
import { useCompte } from "@/lib/compte";
import { useLieuActif, useServeursRelies, useSondes } from "@/lib/lieux";
import { cheminTelephone, type PosteLu } from "@/lib/poste-texte";
import { phrasePoste } from "@/lib/telephone/carte-ordinateur";
import { ligneServeur } from "@/lib/telephone/serveurs";
import { useHorsLigne } from "./BandeauReseau";
import { ConfirmationFeuille } from "./Feuille";
import { Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { NotificationsTelephone, SonsTelephone } from "./NotificationsTelephone";
import { usePostes, useSupport } from "./poste";
import { Pile, RondPersonne } from "./ReglagesCommun";

/**
 * « Ce téléphone » (la section Mobile, E8-19 à E8-24) : le compte et son chemin, les notifications et
 * les sons de ce téléphone, ses ordinateurs et ses serveurs, sa déconnexion confirmée. Elle ne ferme
 * que cette session : les autres appareils restent connectés.
 */
export function CeTelephone() {
  const { seDeconnecter, moi } = useCompte();
  const { postes, principal } = usePostes();
  const sur = useSupport();
  const serveurs = useServeursRelies();
  const lieu = useLieuActif();
  const sondes = useSondes(serveurs);
  const horsLigne = useHorsLigne();
  const [confirmer, setConfirmer] = useState(false);
  const [maintenant] = useState(() => Date.now());
  return (
    <Pile>
      <div id={ancreReglage("mobile-chemin")} className="klyra-reglage flex scroll-mt-4 items-center gap-3 rounded-xl border border-bordure-subtile bg-fond-surface px-3.5 py-3.5 shadow-ombre-ambiante">
        <RondPersonne nom={moi?.nom ?? ""} couleur={moi?.couleur} taille={44} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-body-s font-semibold text-texte-principal">{moi?.email}</p>
          <p className="mt-0.5 text-ui text-texte-secondaire">{cheminTelephone(principal)}</p>
        </div>
      </div>

      <NotificationsTelephone />
      <SonsTelephone />

      <SectionListe titre="Ordinateurs et serveurs">
        <div id={ancreReglage("mobile-telephones")} className="klyra-reglage scroll-mt-4">
          {postes === undefined ? (
            <div aria-busy="true" className="h-14 rounded-xl bg-fond-surface-grise motion-safe:animate-pulse" />
          ) : (
            <GroupeListe>
              {postes.length === 0 && !serveurs.length ? <LigneListe debut={<TuileIcone icone="computer" />} retrait="tuile" nom="Aucun ordinateur relié" ligne2="Aucun ordinateur ne s’est encore signalé sur ton compte." /> : null}
              {postes.map((p) => (
                <LigneListe key={p.cle} debut={<TuileIcone icone="computer" />} retrait="tuile" nom={p.nom} etiquette={<Etiquette ton={p.ouvert ? "bleue" : "neutre"}>{p.ouvert ? "Ouvert" : "Fermé"}</Etiquette>} ligne2={phrasePoste(p as PosteLu, maintenant)} />
              ))}
              {serveurs.map((s) => {
                const ligne = ligneServeur({ etat: s.etat, sonde: sondes[s.id]?.sonde, agents: sondes[s.id]?.agents, retard: sondes[s.id]?.retard, sur, horsLigne });
                return (
                  <LigneListe key={s.id} id={ancreReglage("mobile-vps")} href="/serveurs" debut={<TuileIcone icone="globe-01" />} retrait="tuile" nom={s.nom} etiquette={ligne.etiquette ? <Etiquette ton={ligne.ton}>{ligne.etiquette}</Etiquette> : null} ligne2={lieu === s.adresse ? "Relié à ce téléphone · affiché ici" : "Relié à ce téléphone"} fin="chevron" />
                );
              })}
            </GroupeListe>
          )}
        </div>
      </SectionListe>

      <GroupeListe>
        <LigneListe nom="Se déconnecter de ce téléphone" danger onClick={() => setConfirmer(true)} />
      </GroupeListe>

      {confirmer ? (
        <ConfirmationFeuille
          titre="Se déconnecter de ce téléphone ?"
          texte={`Tes conversations restent dans ton compte. Ce téléphone oublie ce qu’il gardait (dernières vues, brouillons) et ne te prévient plus. Pour revenir, il faudra un nouveau lien envoyé à ${moi?.email ?? "ton adresse"}.`}
          confirmer="Se déconnecter"
          onConfirmer={() => void seDeconnecter()}
          onFermer={() => setConfirmer(false)}
        />
      ) : null}
    </Pile>
  );
}
