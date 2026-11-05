"use client";

import { useState } from "react";
import type { EvenementPush } from "../../../convex/model/push";
import { Icon } from "@/components/icons/Icon";
import { ancreReglage } from "@/components/reglages/ui";
import { Bouton } from "@/components/ui/Bouton";
import { majuscule } from "@/lib/poste-texte";
import { raisonSansNotifications } from "@/lib/push";
import { useReglages } from "@/lib/reglages";
import { apercu, essai } from "@/lib/sons/sons";
import { THEMES } from "@/lib/sons/themes";
import { useHorsLigne } from "./BandeauReseau";
import { Bandeau, CurseurVolume, MessageErreur } from "./Controles";
import { GroupeListe, LigneChoix, LigneInterrupteur, NoteListe, SectionListe, SousSection } from "./Liste";
import { useSupport } from "./poste";
import { usePushTelephone } from "./push";

/** Mêmes noms qu'au bureau (Réglages › Notifications), plus l'accord et l'ouverture du poste (spec mobile § 8). */
function evenements(sur: string): { cle: EvenementPush; libelle: string; description: string }[] {
  return [
    { cle: "accord", libelle: "Un agent demande ton accord", description: "La notification ouvre sa demande." },
    { cle: "agentFini", libelle: "Un agent a fini", description: "Sa réponse t’attend dans la conversation." },
    { cle: "agentErreur", libelle: "Un agent s’est arrêté sur une erreur", description: "La conversation dit pourquoi." },
    { cle: "workflow", libelle: "Un workflow te prévient", description: "Les étapes « Notification » de tes workflows." },
    { cle: "ouverture", libelle: `${majuscule(sur)} s’est ouvert`, description: "Après « Me prévenir à l’ouverture »." },
  ];
}

const TITRE = "Notifications de ce téléphone";

/**
 * Les notifications de ce téléphone (E8-19, E8-21, E8-23) : la phrase de l'app d'abord, la demande du
 * système seulement après « Activer » (jamais au montage, et jamais imitée ici) ; quand rien ne peut
 * arriver, un bandeau dit pourquoi et quoi faire, jamais un interrupteur mort.
 */
export function NotificationsTelephone() {
  const sur = useSupport();
  const push = usePushTelephone();
  const horsLigne = useHorsLigne();
  const { etat } = push;
  const [envoi, setEnvoi] = useState<EvenementPush | null>(null);

  if (etat.etat === "chargement") {
    return (
      <SectionListe titre={TITRE}>
        <div aria-busy="true" className="h-14 rounded-xl bg-fond-surface-grise motion-safe:animate-pulse" />
      </SectionListe>
    );
  }
  if (etat.etat === "a-demander" || etat.etat === "a-activer") {
    return (
      <SectionListe titre={TITRE}>
        <div className="rounded-xl border border-bordure-subtile bg-fond-surface p-4 shadow-ombre-ambiante">
          <div className="flex items-start gap-3">
            <span aria-hidden="true" className="flex size-10 shrink-0 items-center justify-center rounded-md bg-fond-teinte-bleue text-icone-accent">
              <Icon name="bell-01" size={20} />
            </span>
            <div className="min-w-0 flex-1">
              <h3 className="text-body-s font-semibold text-texte-principal">Être prévenu ici</h3>
              <p className="mt-1 text-ui text-texte-secondaire">Pour te prévenir quand un agent attend ton accord, autorise les notifications sur ce téléphone.</p>
            </div>
          </div>
          <Bouton variant="sombre" taille="md" className="mt-4 w-full" iconeGauche={push.occupe ? <Icon name="loader-01" size={20} /> : undefined} disabled={push.occupe || horsLigne} onClick={() => void push.activer()}>
            {push.occupe ? "Activation…" : "Activer les notifications"}
          </Bouton>
          {horsLigne ? <p className="mt-2 text-ui-xs text-texte-secondaire">Possible quand ce téléphone est en ligne.</p> : etat.etat === "a-demander" ? <p className="mt-2 text-ui-xs text-texte-secondaire">Ce téléphone va te demander ton accord juste après.</p> : null}
          {push.erreur ? <MessageErreur className="mt-2">{push.erreur}</MessageErreur> : null}
        </div>
      </SectionListe>
    );
  }
  if (etat.etat !== "active") {
    const iphone = etat.etat === "iphone-a-installer";
    return (
      <SectionListe titre={TITRE}>
        <Bandeau ton={iphone ? "info" : "attente"} icone={iphone ? "iphone-02" : etat.etat === "sans-cles" ? "clock-01" : "bell-01"}>
          {raisonSansNotifications(etat.etat)}
        </Bandeau>
        {iphone ? (
          <Bouton variant="blanc" taille="md" className="mt-2 w-full" onClick={() => window.dispatchEvent(new Event("klyra:proposer-installation"))}>
            Installer KLYRA sur l’écran d’accueil
          </Bouton>
        ) : null}
      </SectionListe>
    );
  }

  return (
    <>
      <SectionListe titre={TITRE}>
        <SousSection>Rien n’arrive ici quand KLYRA est au premier plan sur {sur} : il te prévient déjà.</SousSection>
        <GroupeListe>
          {evenements(sur).map((e) => (
            <LigneInterrupteur
              key={e.cle}
              nom={e.libelle}
              ligne2={e.description}
              uneLigne
              actif={etat.preferences[e.cle]}
              disabled={horsLigne}
              envoi={envoi === e.cle}
              onChange={(actif) => {
                setEnvoi(e.cle);
                void push.changer(e.cle, actif).finally(() => setEnvoi(null));
              }}
            />
          ))}
        </GroupeListe>
        {horsLigne ? <NoteListe>Possible quand ce téléphone est en ligne.</NoteListe> : null}
        {push.erreur ? <MessageErreur className="mx-1 mt-2">{push.erreur}</MessageErreur> : null}
      </SectionListe>
      <Bouton variant="blanc" taille="md" className="w-full" disabled={push.occupe || horsLigne} onClick={() => void push.couper()}>
        {push.occupe ? "Envoi…" : "Couper les notifications sur ce téléphone"}
      </Bouton>
    </>
  );
}

/** Le thème des sons des actions et leur volume (E8-20) : gardés sur ce téléphone, un aperçu joue au toucher. */
export function SonsTelephone() {
  const { reglages, changerSons } = useReglages();
  const sons = reglages?.sons;
  const [volume, setVolume] = useState<number | null>(null);
  const affiche = Math.round((volume ?? sons?.volume ?? 0) * 100);
  const silence = sons?.theme === "silence";
  const valider = () => {
    if (volume === null) return;
    void changerSons({ volume });
    essai("validation", volume);
    setVolume(null);
  };

  return (
    <SectionListe titre="Sons des actions">
      <div id={ancreReglage("sons-actions")} className="klyra-reglage scroll-mt-4">
        <div role="radiogroup" aria-label="Sons des actions">
          <GroupeListe>
            {THEMES.map((t) => (
              <LigneChoix
                key={t.id}
                nom={t.titre}
                meta={t.matiere}
                choisi={sons?.theme === t.id}
                inactive={!sons}
                onChoisir={() => {
                  void changerSons({ theme: t.id });
                  apercu(t.id);
                }}
              />
            ))}
            <li id={ancreReglage("volume-sons")} className="klyra-reglage relative flex min-h-14 scroll-mt-4 items-center gap-3 py-1.5 pr-4 pl-4 before:absolute before:top-0 before:right-0 before:left-4 before:h-px before:bg-bordure-defaut before:content-['']">
              <Icon name="volume-01" size={20} className="shrink-0 text-icone-defaut" />
              <label htmlFor="klyra-volume" className="text-body-s font-medium text-texte-principal">
                Volume
              </label>
              <CurseurVolume
                id="klyra-volume"
                valeur={affiche}
                disabled={!sons || silence}
                onChange={(e) => setVolume(Number(e.target.value) / 100)}
                onPointerUp={valider}
                onKeyUp={valider}
                onBlur={valider}
              />
              <span className="klyra-mono w-9 shrink-0 text-right text-ui-xs text-texte-secondaire">{affiche} %</span>
            </li>
          </GroupeListe>
        </div>
      </div>
      {silence ? <NoteListe>Le volume se règle quand un thème de sons est choisi.</NoteListe> : null}
    </SectionListe>
  );
}
