"use client";

import { useMemo, type ReactNode } from "react";
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
  rappelsDuJour,
  regrouperParJour,
  trierJour,
  type RappelTelephone,
  type VueAgenda,
} from "@/lib/telephone/planning";
import { LignePoste, usePlanningTelephone, type ElementAgenda } from "./ContextePlanningTelephone";
import { LigneRappel } from "./RappelsTelephone";

const fmtJourCourt = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
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
  const { sur, aujourdhui } = usePlanningTelephone();
  const occupes = useMemo(() => joursOccupes(elements.filter((e) => e.genre === "evenement"), rappels), [elements, rappels]);
  const semaine = joursDeLaSemaine(jour);
  /* D-8 (C-1c) : « rien de prévu » seulement si l'ordinateur aussi a été lu (ou s'il n'y en a aucun). */
  const toutLu = lue(poste) && (vue === "mois" || lue(departs));
  /* Les deux lectures gardées : un seul bandeau « Vus à… ». */
  const deuxVues = departs.etat === "ferme" && !!departs.gardee && poste.etat === "ferme" && !!poste.gardee;
  const lignesPoste = (
    <>
      {vue !== "mois" && !deuxVues ? <LignePoste lecture={departs} ferme={`Départs des routines : visibles quand ${sur} est ouvert`} sur={sur} mot="Vus" /> : null}
      <LignePoste lecture={poste} ferme={`Événements gardés sur ${sur} : visibles quand il est ouvert`} sur={sur} mot="Vus" />
    </>
  );

  return (
    <>
      <div className="flex items-center gap-2 px-4">
        <div role="radiogroup" aria-label="Vue" className="flex gap-1">
          {VUES.map(({ id, libelle }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={vue === id}
              onClick={() => onVue(id)}
              className={cn(
                "min-h-11 rounded-full px-3 text-ui",
                vue === id ? "bg-fond-surface-grise font-medium text-texte-principal" : "text-texte-secondaire active:bg-fond-survol",
              )}
            >
              {libelle}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        <BoutonIcone
          taille="md"
          libelle={vue === "mois" ? "Mois précédent" : "Semaine précédente"}
          icone={<Icon name="chevron-left" size={20} />}
          onClick={() => onJour(decaler(jour, vue, -1))}
        />
        <BoutonIcone
          taille="md"
          libelle={vue === "mois" ? "Mois suivant" : "Semaine suivante"}
          icone={<Icon name="chevron-right" size={20} />}
          onClick={() => onJour(decaler(jour, vue, 1))}
        />
      </div>

      {vue === "mois" ? (
        <GrilleMoisTelephone jour={jour} occupes={occupes} aujourdhui={aujourdhui} onChoisir={(cle) => {
          onJour(cle);
          onVue("jour");
        }} />
      ) : (
        <ol aria-label={`Semaine du ${libelleJour(semaine[0])}`} className="grid shrink-0 grid-cols-7 gap-1 px-3 pt-1 pb-2">
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
                    "flex min-h-[52px] w-full flex-col items-center justify-center rounded-md",
                    choisi ? "bg-texte-principal text-texte-inverse" : "text-texte-principal active:bg-fond-survol",
                    !choisi && cle === aujourdhui && "border border-bordure-forte",
                  )}
                >
                  <span className={cn("text-ui-xs", choisi ? "text-texte-inverse" : "text-texte-secondaire")}>{fmtJourCourt.format(depuisCle(cle))}</span>
                  <span className="text-ui font-medium">{Number(cle.slice(8))}</span>
                  <span aria-hidden="true" className={cn("size-1 rounded-full", occupes.has(cle) ? (choisi ? "bg-texte-inverse" : "bg-texte-principal") : "")} />
                </button>
              </li>
            );
          })}
        </ol>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24">
        {!charge ? (
          <ul className="mt-2 flex flex-col gap-2" aria-busy="true">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="h-12 rounded-md bg-fond-surface-grise" />
            ))}
          </ul>
        ) : vue === "jour" ? (
          <VueJour cle={jour} elements={elements} rappels={rappels} lignesPoste={lignesPoste} toutLu={toutLu} />
        ) : vue === "semaine" ? (
          <>
            {regrouperParJour(elements, semaine).map(({ cle, elements: duJour }) => (
              <section key={cle} id={`jour-${cle}`} aria-label={libelleJour(cle)} className="scroll-mt-0">
                <h2 className="sticky top-0 z-10 bg-fond-page">
                  <button
                    type="button"
                    onClick={() => {
                      onJour(cle);
                      onVue("jour");
                    }}
                    className={cn("flex min-h-11 w-full items-center gap-2 text-left text-ui font-medium", cle === aujourdhui ? "text-texte-principal" : "text-texte-secondaire")}
                  >
                    {libelleJour(cle)}
                    <JoursSpeciaux cle={cle} />
                  </button>
                </h2>
                <ListeDuJour cle={cle} elements={duJour} rappels={rappelsDuJour(rappels, cle, aujourdhui)} vide={toutLu ? "Rien de prévu." : null} />
              </section>
            ))}
            <div className="pt-2">{lignesPoste}</div>
          </>
        ) : (
          <div className="pt-2">{lignesPoste}</div>
        )}
      </div>
    </>
  );
}

/** Jour : « Ta journée », les événements et départs dans l'ordre des heures, puis « À faire aujourd'hui ». */
function VueJour({
  cle,
  elements,
  rappels,
  lignesPoste,
  toutLu,
}: {
  cle: string;
  elements: ElementAgenda[];
  rappels: RappelTelephone[];
  lignesPoste: ReactNode;
  toutLu: boolean;
}) {
  const { aujourdhui } = usePlanningTelephone();
  const duJour = trierJour(elements.filter((e) => e.jour === cle));
  const aFaire = rappelsDuJour(rappels, cle, aujourdhui);
  const estAujourdhui = cle === aujourdhui;
  const vide = duJour.length === 0 && aFaire.length === 0;
  return (
    <section aria-label={libelleJour(cle)}>
      <h2 className="flex min-h-11 flex-wrap items-center gap-x-2 text-ui font-medium text-texte-principal">
        {estAujourdhui ? "Ta journée" : libelleJour(cle)}
        <JoursSpeciaux cle={cle} />
      </h2>
      {vide ? (
        toutLu ? (
          <p className="py-2 text-body-s text-texte-secondaire">
            {estAujourdhui ? "Rien d’imposé aujourd’hui : la journée est à toi." : "Rien de prévu ce jour-là."}
          </p>
        ) : null
      ) : (
        <ul className="flex flex-col">
          {duJour.map((element) => (
            <LigneAgenda key={element.cle} element={element} />
          ))}
        </ul>
      )}
      {lignesPoste}
      {aFaire.length > 0 ? (
        <>
          <h3 className="mt-3 flex min-h-11 items-center text-ui font-medium text-texte-principal">{estAujourdhui ? "À faire aujourd’hui" : "À faire"}</h3>
          <ul className="flex flex-col">
            {aFaire.map((rappel) => (
              <LigneRappel key={`${rappel.source}-${rappel.id}`} rappel={rappel} avecCategorie />
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}

/** Un jour de la semaine : ses événements et départs, puis ses rappels. */
function ListeDuJour({ cle, elements, rappels, vide }: { cle: string; elements: ElementAgenda[]; rappels: RappelTelephone[]; vide: string | null }) {
  if (elements.length === 0 && rappels.length === 0) return vide ? <p className="pb-2 text-ui text-texte-secondaire">{vide}</p> : null;
  return (
    <ul className="flex flex-col pb-2" aria-label={libelleJour(cle)}>
      {elements.map((element) => (
        <LigneAgenda key={element.cle} element={element} />
      ))}
      {rappels.map((rappel) => (
        <LigneRappel key={`${rappel.source}-${rappel.id}`} rappel={rappel} avecCategorie />
      ))}
    </ul>
  );
}

/** Un événement (touché : T-07 rempli, sauf le Weekly et ceux des autres) ou un départ de routine, en pointillé. */
function LigneAgenda({ element }: { element: ElementAgenda }) {
  const { ouvrirEvenement } = usePlanningTelephone();
  const depart = element.genre === "depart";
  const details = [element.fin ? `→ ${element.fin}` : null, element.detail].filter(Boolean).join(" · ");
  const contenu = (
    <>
      <span className="klyra-mono w-12 shrink-0 pt-0.5 text-ui-xs font-medium text-texte-secondaire">{element.debut ?? "Jour"}</span>
      <span className={cn("flex min-w-0 flex-1 flex-col gap-0.5", depart && "border-l-2 border-dashed border-bordure-forte pl-3")}>
        <span className="text-body-s text-texte-principal [overflow-wrap:anywhere]">
          {depart ? <span className="sr-only">Départ de routine : </span> : null}
          {element.titre}
        </span>
        {details ? <span className="text-ui-xs text-texte-secondaire">{details}</span> : null}
      </span>
    </>
  );
  const ligne = "flex min-h-12 w-full items-start gap-3 py-2 text-left";
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
  onChoisir,
}: {
  jour: string;
  occupes: ReadonlySet<string>;
  aujourdhui: string;
  onChoisir: (cle: string) => void;
}) {
  const cases = grilleDuMois(jour, occupes);
  const titre = capitaliser(fmtMois.format(depuisCle(jour)));
  return (
    <div className="shrink-0 px-3 pb-2">
      <h2 className="flex min-h-11 items-center px-1 text-ui font-medium text-texte-principal">{titre}</h2>
      <div aria-hidden="true" className="grid grid-cols-7 gap-1 pb-1">
        {INITIALES.map((initiale, i) => (
          <span key={i} className="text-center text-ui-xs text-texte-secondaire">
            {initiale}
          </span>
        ))}
      </div>
      <ol aria-label={titre} className="grid grid-cols-7 gap-1">
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
                  choisi ? "bg-texte-principal text-texte-inverse" : c.dansLeMois ? "text-texte-principal" : "text-texte-secondaire",
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
