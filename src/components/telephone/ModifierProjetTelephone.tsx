"use client";

import { useId, useRef, useState, type ReactNode } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { useGestePoste, useLecturePoste } from "@/lib/poste/client";
import { majuscule, texteErreurPoste } from "@/lib/poste-texte";
import { projetModifie } from "@/lib/telephone/fiche-projet";
import { STATUTS, type ProjetModifiable } from "@/lib/telephone/dossiers";
import { CHAMP_KLYRA_UI, CHAMP_TELEPHONE, CocheChoix, MessageErreur, PisteInterrupteur } from "./Controles";
import { Bandeau, useGestePossible, VueLecture } from "./etats";
import { Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { PagePleine } from "./PagePleine";
import { useSupport } from "./poste";

/**
 * Modifier un projet (E6-33 à E6-36) : nom, ligne, brief, statut, épingle, un geste sur le poste (M-6).
 * Les valeurs initiales viennent du poste et le formulaire reste monté une fois lues : si le poste se
 * ferme ou répond mal, aucune saisie n'est perdue. Rien ne se dit enregistré avant sa réponse.
 */

const TITRE = "Modifier le projet";
const RAISON_DOSSIER = "Le dossier d’un projet se choisit sur l’ordinateur.";

export function PageModifierProjet({ projetId, onFermer, onEnregistre }: { projetId: string; onFermer: () => void; onEnregistre: () => void }) {
  const lecture = useLecturePoste<ProjetModifiable>("projets.lire", { projetId }, { garder: false });
  const [initial, setInitial] = useState<ProjetModifiable | null>(null);
  if (lecture.etat === "ok" && !initial) setInitial(lecture.data);
  if (initial) return <FormulaireProjet projetId={projetId} initial={initial} onFermer={onFermer} onEnregistre={onEnregistre} />;
  return (
    <PagePleine titre={TITRE} onFermer={onFermer} libre>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <VueLecture lecture={lecture} ferme={(sur) => `ce projet est enregistré sur ${sur}. Il se modifie quand KLYRA y est ouverte.`} lignes={3} sansRecours>
          {() => null}
        </VueLecture>
      </div>
    </PagePleine>
  );
}

function Champ({ libelle, aide, erreur, children }: { libelle: string; aide?: string; erreur?: string | null; children: (id: string, decrit: string | undefined) => ReactNode }) {
  const id = useId();
  const decrit = `${id}-aide`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-ui font-medium text-texte-principal">
        {libelle}
      </label>
      {children(id, aide || erreur ? decrit : undefined)}
      {erreur ? <MessageErreur id={decrit}>{erreur}</MessageErreur> : aide ? <span id={decrit} className="text-ui-xs text-texte-secondaire">{aide}</span> : null}
    </div>
  );
}

function FormulaireProjet({ projetId, initial, onFermer, onEnregistre }: { projetId: string; initial: ProjetModifiable; onFermer: () => void; onEnregistre: () => void }) {
  const { faire, occupe } = useGestePoste();
  const { possible, raison } = useGestePossible();
  const sur = useSupport();
  const [valeurs, setValeurs] = useState(initial);
  const [erreurNom, setErreurNom] = useState<string | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const champNom = useRef<HTMLInputElement>(null);
  const change = projetModifie(initial, valeurs);
  const changer = <K extends keyof ProjetModifiable>(cle: K, valeur: ProjetModifiable[K]) => setValeurs((v) => ({ ...v, [cle]: valeur }));

  const enregistrer = async () => {
    if (occupe || !possible || !change) return;
    if (!valeurs.nom.trim()) {
      setErreurNom("Donne-lui un nom.");
      champNom.current?.focus();
      return;
    }
    setErreurNom(null);
    setErreur(null);
    const r = await faire<ProjetModifiable>("projets.modifier", { projetId, ...valeurs });
    if (r.ok) {
      onEnregistre();
      return;
    }
    setErreur(r.code === "delai" ? `${majuscule(sur)} ne répond pas. Tes changements sont gardés sur cette page.` : `${texteErreurPoste(r, sur)} Tes changements sont gardés sur cette page.`);
  };

  return (
    <PagePleine
      titre={TITRE}
      /* Pendant l'envoi, ✕ attend sa réponse : « Abandonner » ne doit pas promettre qu'il n'y aura pas d'écriture. */
      modifie={change && !occupe}
      onFermer={() => {
        if (!occupe) onFermer();
      }}
      onEnvoyer={() => void enregistrer()}
      pied={
        <div className="flex flex-col gap-2">
          {erreur ? (
            <Bandeau ton="erreur" icone="help-circle-contained">
              {erreur}
            </Bandeau>
          ) : null}
          <Bouton type="submit" variant="sombre" taille="md" className="w-full" disabled={!possible || !change || occupe}>
            {occupe ? "Enregistrement…" : erreur ? "Réessayer" : "Enregistrer"}
          </Bouton>
          {raison ? <p className="px-1 text-ui-xs text-texte-secondaire">{raison}</p> : null}
        </div>
      }
    >
      <Champ libelle="Nom" erreur={erreurNom}>
        {(id, decrit) => (
          <input
            id={id}
            ref={champNom}
            value={valeurs.nom}
            maxLength={120}
            aria-invalid={erreurNom ? true : undefined}
            aria-describedby={decrit}
            onChange={(e) => {
              setErreurNom(null);
              changer("nom", e.target.value);
            }}
            className={CHAMP_TELEPHONE}
          />
        )}
      </Champ>
      <Champ libelle="En une ligne">{(id) => <input id={id} value={valeurs.accroche} maxLength={200} onChange={(e) => changer("accroche", e.target.value)} className={CHAMP_TELEPHONE} />}</Champ>
      <Champ libelle="Brief" aide="Ce que les agents doivent savoir du projet : le client, l’objectif, l’échéance.">
        {(id, decrit) => (
          <textarea
            id={id}
            value={valeurs.brief}
            aria-describedby={decrit}
            onChange={(e) => changer("brief", e.target.value)}
            className={cn(CHAMP_KLYRA_UI, "min-h-[120px] w-full resize-none px-3.5 py-3 leading-[1.45]")}
          />
        )}
      </Champ>
      <SectionListe titre="Statut">
        <div role="radiogroup" aria-label="Statut" className="overflow-hidden rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-xs">
          {STATUTS.map((s, i) => (
            <button
              key={s.valeur}
              type="button"
              role="radio"
              aria-checked={valeurs.statut === s.valeur}
              onClick={() => changer("statut", s.valeur)}
              className={cn(
                "relative flex min-h-14 w-full items-center gap-3 py-2.5 pr-3 pl-4 text-left text-body-s font-medium text-texte-principal transition-colors duration-[120ms] ease-sortie active:bg-fond-survol",
                i > 0 && "before:absolute before:top-0 before:right-0 before:left-4 before:h-px before:bg-bordure-defaut before:content-['']",
              )}
            >
              <span className="min-w-0 flex-1">{s.libelle}</span>
              <CocheChoix choisi={valeurs.statut === s.valeur} />
            </button>
          ))}
        </div>
      </SectionListe>
      <GroupeListe>
        <LigneListe
          role="switch"
          coche={valeurs.epingle}
          onClick={() => changer("epingle", !valeurs.epingle)}
          debut={<TuileIcone icone="pin-01" />}
          retrait="tuile"
          nom="Épingler"
          ligne2="En tête de la liste des projets"
          fin={<PisteInterrupteur actif={valeurs.epingle} />}
        />
        <LigneListe debut={<TuileIcone icone="folder" />} retrait="tuile" nom="Dossier" etiquette={<Etiquette>{`Sur ${sur}`}</Etiquette>} ligne2={RAISON_DOSSIER} />
      </GroupeListe>
    </PagePleine>
  );
}
