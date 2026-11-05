"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { depuisCle, libelleJour } from "@/lib/dates";
import { joursSpeciauxEntre } from "@/lib/jours-speciaux";
import type { LecturePoste } from "@/lib/poste/client";
import {
  ajouterJours,
  decaler,
  grilleDuMois,
  joursDeLaSemaine,
  joursOccupes,
  placeMaintenant,
  rappelsDuJour,
  regrouperParJour,
  trierJour,
  type RappelTelephone,
  type VueAgenda,
} from "@/lib/telephone/planning";
import { useApres } from "./ChatsTelephone";
import { SectionPoste, usePlanningTelephone, type ElementAgenda } from "./ContextePlanningTelephone";
import { Puce } from "./Controles";
import { BandeauVueGardee, EtatEcran, NotePoste, Squelette } from "./etats";
import { Etiquette, GroupeListe, SectionListe } from "./Liste";
import { LigneRappel } from "./RappelsTelephone";

const fmtJourCourt = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtMois = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });
const INITIALES = ["L", "M", "M", "J", "V", "S", "D"];
const capitaliser = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** Une lecture de l'ordinateur dont on connaît tout : lue en direct, ou aucun ordinateur à lire. */
const lue = (lecture: LecturePoste<unknown>) => lecture.etat === "ok" || lecture.etat === "aucun";

const VUES: { id: VueAgenda; libelle: string }[] = [
  { id: "jour", libelle: "Jour" },
  { id: "semaine", libelle: "Semaine" },
  { id: "mois", libelle: "Mois" },
];

/**
 * T-05 Planning › Agenda. Pas de grille horaire : Jour = la liste du jour (événements, départs des
 * routines en pointillé, puis « À faire aujourd'hui ») ; Semaine = la même liste groupée par jour ;
 * Mois = une grille compacte, un point par jour occupé, un jour touché ouvre Jour.
 */
export function AgendaPlanningTelephone({
  vue,
  jour,
  onVue,
  onJour,
  elements,
  rappels,
  charge,
  departs,
  poste,
}: {
  vue: VueAgenda;
  jour: string;
  onVue: (vue: VueAgenda) => void;
  onJour: (jour: string) => void;
  /** Les événements de la fenêtre lue et les départs des routines. */
  elements: ElementAgenda[];
  /** Tous les rappels à moi (compte et ordinateur). */
  rappels: RappelTelephone[];
  charge: boolean;
  departs: LecturePoste<unknown> & { relancer: () => void };
  poste: LecturePoste<unknown> & { relancer: () => void };
}) {
  const { sur, aujourdhui, gardeeLe } = usePlanningTelephone();
  const occupes = useMemo(() => joursOccupes(elements.filter((e) => e.genre === "evenement"), rappels), [elements, rappels]);
  const semaine = joursDeLaSemaine(jour);
  /* D-8 (C-1c) : tant que l'ordinateur n'a pas répondu, le compte et lui restent séparés, sans conclure. */
  const toutLu = lue(poste) && (vue === "mois" || lue(departs));
  const compteSeul = (e: ElementAgenda) => e.origine === "compte";
  const rappelsCompte = rappels.filter((r) => r.source === "compte");
  const fermePhrase = (surQui: string) => `tes rendez-vous, les départs des routines et les rappels gardés sur ${surQui} s’afficheront ici quand KLYRA y est ouverte.`;
  const hors = !semaine.includes(aujourdhui);
  const chargement = useApres(300, !charge);

  /* Ce que l'ordinateur doit encore dire, ou sa vue gardée datée, dans sa propre section. */
  const surPoste = (lignes: ReactNode) => (
    <SectionListe titre={`Sur ${sur}`} className="mt-6">
      {gardeeLe !== null ? <BandeauVueGardee lu={gardeeLe} mot="Vus" className="mb-2" /> : null}
      {lue(poste) ? null : <SectionPoste lecture={poste} ferme={fermePhrase} />}
      {gardeeLe !== null ? lignes : null}
      {gardeeLe !== null ? <NotePoste className="mt-2 px-1 text-ui-xs text-texte-secondaire" /> : null}
    </SectionListe>
  );

  return (
    <>
      <div className="flex items-center gap-1.5 px-4">
        <div role="group" aria-label="Vue" className="flex gap-1.5">
          {VUES.map(({ id, libelle }) => (
            <Puce key={id} choisie={vue === id} onClick={() => onVue(id)}>
              {libelle}
            </Puce>
          ))}
        </div>
        <span className="flex-1" />
        {hors && vue !== "mois" ? (
          <button type="button" className="min-h-11 px-1.5 text-ui font-medium text-texte-principal" onClick={() => onJour(aujourdhui)}>
            Aujourd’hui
          </button>
        ) : null}
        <BoutonIcone
          variant="discret"
          className="size-11"
          libelle={vue === "mois" ? "Mois précédent" : "Semaine précédente"}
          icone={<Icon name="chevron-left" size={20} />}
          onClick={() => onJour(decaler(jour, vue, -1))}
        />
        <BoutonIcone
          variant="discret"
          className="size-11"
          libelle={vue === "mois" ? "Mois suivant" : "Semaine suivante"}
          icone={<Icon name="chevron-right" size={20} />}
          onClick={() => onJour(decaler(jour, vue, 1))}
        />
      </div>

      {vue === "mois" ? (
        <GrilleMoisTelephone jour={jour} occupes={occupes} aujourdhui={aujourdhui} onAujourdhui={() => onJour(aujourdhui)} onChoisir={(cle) => {
          onJour(cle);
          onVue("jour");
        }} />
      ) : (
        <ol aria-label={`Semaine du ${libelleJour(semaine[0])}`} className="grid shrink-0 grid-cols-7 gap-1 px-3 pt-2 pb-3">
          {semaine.map((cle) => {
            const choisi = cle === jour;
            return (
              <li key={cle}>
                <button
                  type="button"
                  aria-pressed={choisi}
                  aria-current={cle === aujourdhui ? "date" : undefined}
                  aria-label={`${libelleJour(cle)}${occupes.has(cle) ? ", occupé" : ""}`}
                  onClick={() => {
                    onJour(cle);
                    if (vue === "semaine") document.getElementById(`jour-${cle}`)?.scrollIntoView({ block: "start" });
                  }}
                  className={cn(
                    "flex min-h-[60px] w-full flex-col items-center justify-center gap-0.5 rounded-md",
                    choisi ? "klyra-surface-sombre text-texte-inverse" : "text-texte-principal active:bg-fond-survol",
                    !choisi && cle === aujourdhui && "border border-bordure-forte",
                  )}
                >
                  <span className={cn("text-ui-xs", choisi ? "text-texte-inverse" : "text-texte-secondaire")}>{fmtJourCourt.format(depuisCle(cle))}</span>
                  <span className="text-body-s font-medium">{Number(cle.slice(8))}</span>
                  <span aria-hidden="true" className={cn("size-1 rounded-full", occupes.has(cle) ? (choisi ? "bg-texte-inverse" : "bg-texte-principal") : "")} />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24">
        {!charge ? (
          chargement ? (
            <div aria-busy="true" className="mt-2">
              <Squelette lignes={4} />
            </div>
          ) : null
        ) : vue === "jour" ? (
          lue(poste) ? (
            <>
              <VueJour cle={jour} elements={elements} rappels={rappels} toutLu={toutLu && poste.etat !== "aucun"} titre={jour === aujourdhui ? "Ta journée" : libelleJour(jour)} />
              {poste.etat === "aucun" ? (
                <div className="mt-4">
                  <SectionPoste lecture={poste} ferme={fermePhrase} />
                </div>
              ) : null}
            </>
          ) : (
            <>
              <VueJour cle={jour} elements={elements.filter(compteSeul)} rappels={rappelsCompte} toutLu={false} titre="Dans ton compte" videAussi />
              {surPoste(
                <VueJour
                  cle={jour}
                  elements={elements.filter((e) => !compteSeul(e))}
                  rappels={rappels.filter((r) => r.source === "poste")}
                  toutLu={false}
                  sansTitre
                />,
              )}
            </>
          )
        ) : vue === "semaine" ? (
          <>
            {!lue(poste) && gardeeLe === null ? <div className="mb-4">{surPoste(null)}</div> : null}
            {gardeeLe !== null ? <BandeauVueGardee lu={gardeeLe} mot="Vus" className="mb-3" /> : null}
            {regrouperParJour(elements, semaine).map(({ cle, elements: duJour }) => {
              const rappelsJour = rappelsDuJour(rappels, cle, aujourdhui);
              return (
                <section key={cle} id={`jour-${cle}`} aria-label={libelleJour(cle)} className="scroll-mt-0 pb-4">
                  <h2 className="sticky top-0 z-10 bg-fond-page">
                    <button
                      type="button"
                      onClick={() => {
                        onJour(cle);
                        onVue("jour");
                      }}
                      className="flex min-h-11 w-full flex-wrap items-center gap-x-2 text-left text-ui font-semibold text-texte-principal"
                    >
                      {capitaliser(libelleJour(cle))}
                      {duJour.length + rappelsJour.length > 0 ? <span className="font-normal text-texte-secondaire">{duJour.length + rappelsJour.length}</span> : null}
                      {cle === aujourdhui ? <Etiquette ton="bleue">Aujourd’hui</Etiquette> : null}
                      <JoursSpeciaux cle={cle} />
                    </button>
                  </h2>
                  <ListeDuJour elements={duJour} rappels={rappelsJour} vide={toutLu ? "Rien de prévu." : null} />
                </section>
              );
            })}
          </>
        ) : (
          <>
            <p className="px-1 pt-1 text-ui-xs text-texte-secondaire">Touche un jour pour voir sa journée.</p>
            {lue(poste) ? null : gardeeLe !== null ? <BandeauVueGardee lu={gardeeLe} mot="Vus" className="mt-3" /> : <div className="mt-3"><SectionPoste lecture={poste} ferme={fermePhrase} /></div>}
          </>
        )}
      </div>
    </>
  );
}

/** Jour : les événements et départs dans l'ordre des heures, la ligne « maintenant » aujourd'hui, puis « À faire ». */
function VueJour({
  cle,
  elements,
  rappels,
  toutLu,
  titre,
  videAussi = false,
  sansTitre = false,
}: {
  cle: string;
  elements: ElementAgenda[];
  rappels: RappelTelephone[];
  toutLu: boolean;
  titre?: string;
  /** Une section qui reste même vide, sans conclure sur le reste. */
  videAussi?: boolean;
  sansTitre?: boolean;
}) {
  const { aujourdhui } = usePlanningTelephone();
  const duJour = trierJour(elements.filter((e) => e.jour === cle));
  const aFaire = rappelsDuJour(rappels, cle, aujourdhui);
  const estAujourdhui = cle === aujourdhui;
  const vide = duJour.length === 0 && aFaire.length === 0;
  const heure = useHeure();
  const place = estAujourdhui ? placeMaintenant(duJour, heure) : -1;
  if (sansTitre && vide) return null;
  return (
    <section aria-label={titre ?? libelleJour(cle)}>
      {sansTitre ? null : (
        <h2 className="flex min-h-11 flex-wrap items-center gap-x-1.5 px-1 text-ui font-semibold text-texte-principal">
          {titre}
          {duJour.length > 0 ? <span className="font-normal text-texte-secondaire">{duJour.length}</span> : null}
          <JoursSpeciaux cle={cle} />
        </h2>
      )}
      {duJour.length > 0 ? (
        <GroupeListe>
          {duJour.map((element, i) => (
            <Fragment key={element.cle}>
              {i === place ? <LigneMaintenant heure={heure} /> : null}
              <LigneAgenda element={element} />
            </Fragment>
          ))}
          {place === duJour.length ? <LigneMaintenant heure={heure} /> : null}
        </GroupeListe>
      ) : vide && toutLu ? (
        <EtatEcran
          forme="encadre"
          icone="calendar-01"
          titre={estAujourdhui ? "Rien d’imposé aujourd’hui" : "Rien de prévu ce jour-là"}
          texte={estAujourdhui ? "La journée est à toi." : undefined}
        />
      ) : vide && videAussi ? (
        <p className="px-1 py-2 text-ui text-texte-secondaire">Rien dans ton compte ce jour-là.</p>
      ) : null}
      {aFaire.length > 0 ? (
        <>
          <h3 className="mt-3 flex min-h-11 items-center gap-1.5 px-1 text-ui font-semibold text-texte-principal">
            {estAujourdhui ? "À faire aujourd’hui" : "À faire"}
            <span className="font-normal text-texte-secondaire">{aFaire.length}</span>
          </h3>
          <GroupeListe>
            {aFaire.map((rappel) => (
              <LigneRappel key={`${rappel.source}-${rappel.id}`} rappel={rappel} avecCategorie />
            ))}
          </GroupeListe>
        </>
      ) : null}
    </section>
  );
}

/** L'heure de ce téléphone, à la minute. */
function useHeure(): string {
  const lire = () => fmtHeure.format(new Date());
  const [heure, setHeure] = useState(lire);
  useEffect(() => {
    const minuteur = setInterval(() => setHeure(lire()), 30_000);
    return () => clearInterval(minuteur);
  }, []);
  return heure;
}

function LigneMaintenant({ heure }: { heure: string }) {
  return (
    <li aria-label={`Maintenant, ${heure}`} className="relative flex h-5 items-center">
      <span className="z-[1] ml-1.5 rounded-pill bg-bleu-k1-500 px-1.5 text-ui-xs leading-[18px] font-semibold text-texte-inverse tabular-nums">{heure}</span>
      <span aria-hidden="true" className="h-0.5 flex-1 bg-bleu-k1-500" />
    </li>
  );
}

/** Un jour de la semaine : ses événements et départs, puis ses rappels, dans une même carte. */
function ListeDuJour({ elements, rappels, vide }: { elements: ElementAgenda[]; rappels: RappelTelephone[]; vide: string | null }) {
  if (elements.length === 0 && rappels.length === 0) return vide ? <p className="px-1 pb-1 text-ui-xs text-texte-secondaire">{vide}</p> : null;
  return (
    <GroupeListe>
      {elements.map((element) => (
        <LigneAgenda key={element.cle} element={element} />
      ))}
      {rappels.map((rappel) => (
        <LigneRappel key={`${rappel.source}-${rappel.id}`} rappel={rappel} avecCategorie />
      ))}
    </GroupeListe>
  );
}

/**
 * Un événement ou un départ de routine (filet pointillé, « Routine de … », jamais un rendez-vous
 * modifiable). Ce qui s'ouvre porte un chevron ; le Weekly et l'événement d'un autre se lisent seulement.
 */
function LigneAgenda({ element }: { element: ElementAgenda }) {
  const { ouvrirEvenement } = usePlanningTelephone();
  const depart = element.genre === "depart";
  const contenu = (
    <>
      <span className="flex w-11 shrink-0 flex-col pt-0.5 text-ui tabular-nums">
        <span className="font-medium text-texte-principal">{element.debut ?? "Jour"}</span>
        {element.fin ? <span className="text-ui-xs text-texte-secondaire">{element.fin}</span> : null}
      </span>
      <span className={cn("flex min-w-0 flex-1 flex-col gap-0.5 border-l pl-3", depart ? "border-dashed border-bordure-forte" : "border-bordure-forte")}>
        <span className="text-body-s text-texte-principal [overflow-wrap:anywhere]">
          {depart ? <span className="sr-only">Départ de routine : </span> : null}
          {element.titre}
        </span>
        {element.detail ? <span className="text-ui text-texte-secondaire">{element.detail}</span> : null}
      </span>
      {element.evenement ? <Icon name="chevron-right" size={20} className="mt-2 shrink-0 text-icone-secondaire" /> : null}
    </>
  );
  const ligne = "flex min-h-14 w-full items-start gap-1 px-4 py-2.5 text-left";
  return (
    <li data-echeance={element.eclairage ?? undefined} className="border-b border-bordure-subtile last:border-b-0">
      {element.evenement ? (
        <button type="button" onClick={() => ouvrirEvenement(element.evenement)} className={cn(ligne, "active:bg-fond-survol")}>
          {contenu}
        </button>
      ) : (
        <div className={ligne}>{contenu}</div>
      )}
    </li>
  );
}

/** Les jours fériés, fêtes et changements d'heure, comme les pastilles du calendrier du bureau. */
function JoursSpeciaux({ cle }: { cle: string }) {
  const speciaux = joursSpeciauxEntre(depuisCle(cle), depuisCle(ajouterJours(cle, 1))).get(cle) ?? [];
  if (speciaux.length === 0) return null;
  return <span className="text-ui-xs font-normal text-texte-secondaire">{speciaux.map((j) => j.nom).join(" · ")}</span>;
}

/** La grille compacte du mois : chaque jour est une cible de 44 px, un point s'il est occupé. */
function GrilleMoisTelephone({
  jour,
  occupes,
  aujourdhui,
  onAujourdhui,
  onChoisir,
}: {
  jour: string;
  occupes: ReadonlySet<string>;
  aujourdhui: string;
  onAujourdhui: () => void;
  onChoisir: (cle: string) => void;
}) {
  const cases = grilleDuMois(jour, occupes);
  const titre = capitaliser(fmtMois.format(depuisCle(jour)));
  return (
    <div className="mx-4 mt-2 mb-2 shrink-0 rounded-xl border border-bordure-subtile bg-fond-surface px-0.5 pb-1 shadow-ombre-xs">
      <div className="flex min-h-11 items-center px-2">
        <h2 className="min-w-0 flex-1 text-ui font-semibold text-texte-principal">{titre}</h2>
        <button type="button" className="relative text-ui text-texte-secondaire after:absolute after:-inset-3" onClick={onAujourdhui}>
          Aujourd’hui
        </button>
      </div>
      <div aria-hidden="true" className="grid grid-cols-7 pb-1">
        {INITIALES.map((initiale, i) => (
          <span key={i} className="text-center text-ui-xs text-texte-secondaire">
            {initiale}
          </span>
        ))}
      </div>
      <ol aria-label={titre} className="grid grid-cols-7">
        {cases.map((c) => {
          const choisi = c.cle === jour;
          return (
            <li key={c.cle}>
              <button
                type="button"
                aria-label={`${libelleJour(c.cle)}${c.occupe ? ", occupé" : ""}`}
                aria-current={c.cle === aujourdhui ? "date" : undefined}
                onClick={() => onChoisir(c.cle)}
                className={cn(
                  "flex min-h-11 w-full flex-col items-center justify-center rounded-md text-ui",
                  choisi ? "klyra-surface-sombre text-texte-inverse" : c.dansLeMois ? "text-texte-principal" : "text-texte-secondaire",
                  !choisi && c.cle === aujourdhui && "border border-bordure-forte font-medium",
                  !choisi && "active:bg-fond-survol",
                )}
              >
                {c.numero}
                <span aria-hidden="true" className={cn("size-1 rounded-full", c.occupe ? (choisi ? "bg-texte-inverse" : "bg-texte-principal") : "")} />
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
