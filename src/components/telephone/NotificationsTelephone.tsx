"use client";

import { useState, type CSSProperties } from "react";
import type { EvenementPush } from "../../../convex/model/push";
import { Bouton } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { majuscule } from "@/lib/poste-texte";
import { raisonSansNotifications } from "@/lib/push";
import { useReglages } from "@/lib/reglages";
import { apercu, essai } from "@/lib/sons/sons";
import { THEMES } from "@/lib/sons/themes";
import { useSupport } from "./poste";
import { usePushTelephone } from "./push";

/** Mêmes noms qu'au bureau (Réglages › Notifications), plus l'accord et l'ouverture du poste (spec mobile § 8). */
function evenements(sur: string): { cle: EvenementPush; libelle: string; description: string }[] {
  return [
    { cle: "accord", libelle: "Un agent demande ton accord", description: "Il attend ta réponse pour continuer : la notification ouvre sa demande." },
    { cle: "agentFini", libelle: "Un agent a fini", description: "Sa réponse t’attend dans la conversation." },
    { cle: "agentErreur", libelle: "Un agent s’est arrêté sur une erreur", description: "Il n’a pas pu finir : la conversation dit pourquoi." },
    { cle: "workflow", libelle: "Un workflow te prévient", description: "Les étapes « Notification » de tes workflows." },
    { cle: "ouverture", libelle: `${majuscule(sur)} s’est ouvert`, description: "Seulement après « Me prévenir à l’ouverture »." },
  ];
}

/** Une ligne entière qui bascule (48 px) : l'interrupteur du bureau est trop petit pour le pouce. */
function LigneInterrupteur({ libelle, description, actif, onChange }: { libelle: string; description: string; actif: boolean; onChange: (actif: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={actif}
      onClick={() => onChange(!actif)}
      className="flex min-h-12 w-full items-center gap-3 py-2 text-left active:bg-fond-survol"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-body-s text-texte-principal">{libelle}</span>
        <span className="mt-0.5 block text-ui-xs text-texte-secondaire">{description}</span>
      </span>
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 items-center rounded-pill transition-colors duration-[220ms] ease-sortie",
          actif ? "bg-fond-accent" : "bg-gris-k2-500",
        )}
      >
        <span className={cn("absolute top-0.5 left-0.5 size-4 rounded-full bg-fond-surface shadow-ombre-sm transition-transform duration-[220ms] ease-sortie", actif && "translate-x-4")} />
      </span>
    </button>
  );
}

function Notifications() {
  const sur = useSupport();
  const push = usePushTelephone();
  const { etat } = push;

  if (etat.etat === "chargement") return <p className="mt-2 h-11 rounded-md bg-fond-surface-grise" aria-busy="true" />;
  if (etat.etat === "a-demander" || etat.etat === "a-activer") {
    return (
      <div className="mt-2">
        <p className="text-ui text-texte-secondaire">Pour te prévenir quand un agent attend ton accord, autorise les notifications sur ce téléphone.</p>
        <Bouton variant="sombre" taille="md" className="mt-3" disabled={push.occupe} onClick={() => void push.activer()}>
          Activer les notifications
        </Bouton>
        {push.erreur ? (
          <p role="alert" className="mt-2 text-ui-xs text-texte-erreur">
            {push.erreur}
          </p>
        ) : null}
      </div>
    );
  }
  if (etat.etat !== "active") return <p className="mt-2 text-ui text-texte-secondaire">{raisonSansNotifications(etat.etat)}</p>;

  return (
    <>
      <p className="mt-1 text-ui-xs text-texte-secondaire">Rien n’arrive ici quand KLYRA est au premier plan sur {sur} : il te prévient déjà.</p>
      <div className="mt-1 divide-y divide-bordure-subtile">
        {evenements(sur).map((e) => (
          <LigneInterrupteur key={e.cle} libelle={e.libelle} description={e.description} actif={etat.preferences[e.cle]} onChange={(actif) => void push.changer(e.cle, actif)} />
        ))}
      </div>
      {push.erreur ? (
        <p role="alert" className="mt-2 text-ui-xs text-texte-erreur">
          {push.erreur}
        </p>
      ) : null}
      <Bouton variant="blanc" taille="md" className="mt-3" disabled={push.occupe} onClick={() => void push.couper()}>
        Couper les notifications sur ce téléphone
      </Bouton>
    </>
  );
}

/** Le thème des sons des actions et leur volume : gardés sur ce téléphone, pas sur l'ordinateur. */
function Sons() {
  const { reglages, changerSons } = useReglages();
  const sons = reglages?.sons;
  const [volume, setVolume] = useState<number | null>(null);
  const affiche = Math.round((volume ?? sons?.volume ?? 0) * 100);
  const valider = () => {
    if (volume === null) return;
    void changerSons({ volume });
    essai("validation", volume);
    setVolume(null);
  };

  return (
    <>
      <div role="radiogroup" aria-label="Sons des actions" className="mt-1 divide-y divide-bordure-subtile">
        {THEMES.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={sons?.theme === t.id}
            disabled={!sons}
            onClick={() => {
              void changerSons({ theme: t.id });
              apercu(t.id);
            }}
            className="flex min-h-12 w-full items-center gap-3 py-2 text-left active:bg-fond-survol"
          >
            <span className="min-w-0 flex-1">
              <span className="block text-body-s text-texte-principal">{t.titre}</span>
              <span className="block text-ui-xs text-texte-secondaire">{t.matiere}</span>
            </span>
            <span aria-hidden="true" className={cn("size-4 shrink-0 rounded-full border", sons?.theme === t.id ? "border-[5px] border-fond-accent" : "border-bordure-forte")} />
          </button>
        ))}
      </div>
      <label className="mt-3 flex min-h-11 items-center gap-3">
        <span className="text-body-s text-texte-principal">Volume</span>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={affiche}
          disabled={!sons || sons.theme === "silence"}
          aria-valuetext={`${affiche} %`}
          onChange={(e) => setVolume(Number(e.target.value) / 100)}
          onPointerUp={valider}
          onKeyUp={valider}
          onBlur={valider}
          className="klyra-curseur min-w-0 flex-1"
          style={{ "--valeur": `${affiche}%` } as CSSProperties}
        />
        <span className="klyra-mono w-11 text-right text-ui-xs text-texte-secondaire">{affiche} %</span>
      </label>
    </>
  );
}

/**
 * Réglages › Ce téléphone : les notifications de ce téléphone par événement (spec mobile § 8),
 * puis les sons des actions et leur volume, propres au téléphone.
 */
export function NotificationsTelephone() {
  return (
    <>
      <h2 className="mt-6 text-ui text-texte-secondaire">Notifications</h2>
      <Notifications />
      <h2 className="mt-6 text-ui text-texte-secondaire">Sons des actions</h2>
      <Sons />
    </>
  );
}
