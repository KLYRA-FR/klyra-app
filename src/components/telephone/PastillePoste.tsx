"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { libellePastille, majuscule, texteFeuille, type PosteLu } from "@/lib/poste-texte";
import { useServeursRelies, useSondes } from "@/lib/lieux";
import { raisonSansNotifications } from "@/lib/push";
import { phrasePoste } from "@/lib/telephone/carte-ordinateur";
import { useATraiterParEspace } from "@/lib/telephone/espace";
import { ligneServeur } from "@/lib/telephone/serveurs";
import { useHorsLigne } from "./BandeauReseau";
import { useEspaceAffiche } from "./EspaceTelephone";
import { Feuille, useFermerFeuille } from "./Feuille";
import { CompteEspace, Etiquette, GroupeListe, LigneChoix, NoteListe, SectionListe, TuileIcone } from "./Liste";
import { usePostes, useSupport } from "./poste";
import { usePushTelephone } from "./push";

/** Le nom complet de la pastille pour les lecteurs d'écran : le serveur affiché, la première phrase de P-3, ou P-13, ce qui attend ailleurs. */
function nomComplet(poste: PosteLu | null, plusieurs: boolean, serveur: string | null, ailleurs: number, sur: string): string {
  const fin = serveur ? "Ordinateurs et serveurs." : "État des ordinateurs.";
  const aTraiter = ailleurs > 0 ? `${ailleurs === 1 ? "Une conversation" : `${ailleurs} conversations`} à traiter ${serveur ? `sur ${sur}` : "sur un serveur"}. ` : "";
  const debut = serveur ? `Serveur affiché : ${serveur}. ` : "";
  if (!poste) return `${debut}Aucun ordinateur relié. ${aTraiter}${fin}`;
  const phrase = texteFeuille(poste, plusieurs);
  const point = phrase.indexOf(". ");
  return `${debut}${point === -1 ? phrase : phrase.slice(0, point + 1)} ${aTraiter}${fin}`;
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
 * Pastille de l'ordinateur (socle § 2.3, P-1, P-2, E8-10) : « Mac », « PC », « Mac fermé », « Aucun
 * ordinateur » ; le nom du poste seulement s'il y en a plusieurs ; le serveur affiché quand ce n'est pas
 * l'ordinateur. Le point bleu : quelque chose attend sur l'autre espace, dit aussi dans son nom complet.
 * 32 px dans une cible de 44. Ouvre la feuille des ordinateurs (T-23, S-06).
 */
export function PastillePoste() {
  const { postes, principal } = usePostes();
  const [ouverte, setOuverte] = useState(false);
  const { lieu, serveur, adresses } = useEspaceAffiche();
  const aTraiter = useATraiterParEspace(adresses);
  const sur = useSupport();
  if (!postes) return <span aria-hidden="true" className="h-8 w-[72px] shrink-0 rounded-pill bg-fond-surface-grise" />;
  const plusieurs = postes.length > 1;
  const poste = principal as PosteLu | null;
  const ailleurs = [null, ...adresses].reduce((somme, l) => (l === lieu ? somme : somme + aTraiter(l)), 0);

  return (
    <>
      <button
        type="button"
        aria-label={nomComplet(poste, plusieurs, serveur?.nom ?? null, ailleurs, sur)}
        aria-haspopup="dialog"
        onClick={() => setOuverte(true)}
        className={cn(
          "relative inline-flex h-8 max-w-[260px] shrink-0 items-center gap-2 rounded-pill px-3 text-ui font-medium text-texte-principal",
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
        <span className={cn("truncate", serveur ? "max-w-[84px]" : "max-w-[112px]")}>{libellePastille(poste, plusieurs)}</span>
        {serveur ? (
          <>
            <span aria-hidden="true" className="h-4 w-px shrink-0 bg-gris-k2-600" />
            <Icon name="globe-01" size={16} className="shrink-0 text-icone-defaut" />
            <span className="max-w-[96px] truncate">{serveur.nom}</span>
          </>
        ) : null}
        {ailleurs > 0 ? <span aria-hidden="true" className="absolute -top-[3px] -right-[3px] size-2.5 rounded-full bg-fond-accent shadow-[0_0_0_2px_var(--color-fond-page)]" /> : null}
      </button>
      {ouverte ? <FeuilleOrdinateurs onFermer={() => setOuverte(false)} /> : null}
    </>
  );
}

/**
 * Le choix du serveur affiché (E8-07, E8-08, E8-12) : la coche suit le toucher (120 ms), puis le filtre
 * change et la feuille descend après 180 ms, sans jamais mélanger les deux espaces. Hors ligne, un
 * serveur attend le réseau ; l'ordinateur reste possible. Une absence de réponse n'empêche pas de choisir.
 */
function ServeurAffiche() {
  const { lieu, serveurs, adresses, choisir } = useEspaceAffiche();
  const { postes, principal } = usePostes();
  const sur = useSupport();
  const sondes = useSondes(serveurs);
  const horsLigne = useHorsLigne();
  const aTraiter = useATraiterParEspace(adresses);
  const fermer = useFermerFeuille();
  const [coche, setCoche] = useState(lieu);
  const compte = (l: string | null, nom: string) => {
    const n = aTraiter(l);
    return n > 0 ? <CompteEspace valeur={n} libelle={`${n} à traiter sur ${nom}`} /> : undefined;
  };
  const toucher = (l: string | null) => {
    if (l === coche) return fermer();
    setCoche(l);
    setTimeout(() => {
      choisir(l);
      fermer();
    }, 180);
  };
  const lignePoste = !postes?.length ? "Aucun ordinateur relié" : principal?.ouvert ? `Tes agents tournent sur ${sur}` : "Fermé : ses conversations se lisent";
  return (
    <SectionListe titre="Serveur affiché">
      <div role="radiogroup" aria-label="Serveur affiché">
        <GroupeListe>
          <LigneChoix debut={<TuileIcone icone="computer" />} nom={majuscule(sur)} ligne2={lignePoste} choisi={coche === null} finSiPasChoisi={compte(null, sur)} onChoisir={() => toucher(null)} />
          {serveurs.map((s) => {
            const ligne = ligneServeur({ etat: s.etat, sonde: sondes[s.id]?.sonde, agents: sondes[s.id]?.agents, retard: sondes[s.id]?.retard, sur, horsLigne });
            return (
              <LigneChoix
                key={s.id}
                debut={<TuileIcone icone="globe-01" />}
                nom={s.nom}
                etiquette={ligne.etiquette ? <Etiquette ton={ligne.ton}>{ligne.etiquette}</Etiquette> : null}
                ligne2={ligne.phrase}
                choisi={coche === s.adresse}
                inactive={horsLigne && coche !== s.adresse}
                raison="Possible quand ce téléphone est en ligne"
                finSiPasChoisi={compte(s.adresse, s.nom)}
                onChoisir={() => toucher(s.adresse)}
              />
            );
          })}
        </GroupeListe>
      </div>
      <NoteListe>Le téléphone montre les chats, les projets, les agents et les routines du serveur choisi. Ton planning et tes réglages ne changent pas.</NoteListe>
      {lieu && !principal?.ouvert ? <NoteListe className="mt-1.5">Ses fichiers et la liste de ses routines se lisent par {sur} : ils reviennent avec lui.</NoteListe> : null}
    </SectionListe>
  );
}

/**
 * La feuille Ordinateurs (S-06, T-23, E8-07, E8-11) : le serveur affiché s'il y en a à choisir, puis les
 * ordinateurs du compte, « Me prévenir » sous celui qui est fermé.
 */
export function FeuilleOrdinateurs({ onFermer }: { onFermer: () => void }) {
  const { postes } = usePostes();
  const serveurs = useServeursRelies();
  const [maintenant] = useState(() => Date.now());
  return (
    <Feuille titre="Ordinateurs" sousTitre="Ce que voit ce téléphone" onFermer={onFermer}>
      <div className="flex flex-col gap-5">
        {serveurs.length ? <ServeurAffiche /> : null}
        {postes?.length === 0 ? (
          /* P-13. */
          <div className="pt-2">
            <p className="text-body-s font-medium text-texte-principal">Aucun ordinateur relié</p>
            <p className="mt-2 text-ui text-texte-secondaire">Connecte-toi à ton compte dans KLYRA sur ton ordinateur (Réglages › Équipe) pour retrouver tes conversations ici.</p>
          </div>
        ) : (
          <SectionListe titre="Ordinateurs">
            <GroupeListe>
              {postes?.map((p) => (
                <li key={p.cle} className="relative flex gap-3 px-4 py-3.5 [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-16 [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:bg-bordure-defaut [&:not(:first-child)]:before:content-['']">
                  <TuileIcone icone="computer" />
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-body-s font-medium text-texte-principal">
                      <span className="min-w-0 truncate">{p.nom}</span>
                      <Etiquette ton={p.ouvert ? "bleue" : "neutre"}>{p.ouvert ? "Ouvert" : "Fermé"}</Etiquette>
                    </p>
                    <p className="mt-0.5 text-ui leading-[1.35] text-texte-secondaire">{phrasePoste(p as PosteLu, maintenant)}</p>
                    {p.ouvert ? null : <PrevenirOuverture cle={p.cle} />}
                  </div>
                </li>
              ))}
            </GroupeListe>
          </SectionListe>
        )}
      </div>
      <p className="mx-1 mt-3 text-ui-xs text-texte-secondaire">Ce téléphone ne réveille pas un ordinateur à distance.</p>
    </Feuille>
  );
}
