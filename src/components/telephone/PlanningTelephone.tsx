"use client";

import { useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { messageErreur, useCompte } from "@/lib/compte";
import { aujourdhui, cleJour, depuisCle, libelleJour } from "@/lib/dates";
import { debutMsEvenement } from "@/components/planning/AgendaCompte";
import { supportOuOrdinateur } from "@/lib/poste-texte";
import { cn } from "@/lib/cn";
import { EnteteTelephone } from "./EnteteTelephone";
import { usePostes } from "./poste";

type Vue = "jour" | "semaine" | "mois";

function ajouterJours(cle: string, n: number): string {
  const d = depuisCle(cle);
  d.setDate(d.getDate() + n);
  return cleJour(d);
}

function lundiDe(cle: string): string {
  const d = depuisCle(cle);
  const decalage = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - decalage);
  return cleJour(d);
}

/** T-05. Liste du jour, lue dans le calendrier du compte. Pas de grille horaire. */
export function PlanningTelephone() {
  const [vue, setVue] = useState<Vue>("jour");
  const [jour, setJour] = useState(aujourdhui);
  const [creation, setCreation] = useState(false);
  const { principal, ouvert } = usePostes();
  const compte = useCompte();
  const fenetre = useMemo(() => {
    if (vue === "mois") {
      const d = depuisCle(jour);
      const debut = cleJour(new Date(d.getFullYear(), d.getMonth(), 1));
      const fin = cleJour(new Date(d.getFullYear(), d.getMonth() + 1, 1));
      return { debut, fin, finMs: depuisCle(fin).getTime() };
    }
    if (vue === "semaine") {
      const debut = lundiDe(jour);
      const fin = ajouterJours(debut, 7);
      return { debut, fin, finMs: depuisCle(fin).getTime() };
    }
    const fin = ajouterJours(jour, 1);
    return { debut: jour, fin, finMs: depuisCle(fin).getTime() };
  }, [jour, vue]);
  const evenements = useQuery(api.evenements.entre, compte.etat === "connecte" ? fenetre : "skip");
  const rappels = useQuery(api.rappels.mes, compte.etat === "connecte" ? {} : "skip");
  const jours = vue === "semaine" ? Array.from({ length: 7 }, (_, i) => ajouterJours(fenetre.debut, i)) : [jour];
  const sur = supportOuOrdinateur(principal);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Planning" />
      <div className="flex gap-2 px-4 pb-2">
        {(["jour", "semaine", "mois"] as const).map((nom) => (
          <button
            key={nom}
            type="button"
            aria-pressed={vue === nom}
            onClick={() => setVue(nom)}
            className={cn("min-h-11 rounded-full px-3 text-ui capitalize", vue === nom ? "bg-fond-surface-grise text-texte-principal" : "text-texte-secondaire")}
          >
            {nom === "jour" ? "Jour" : nom === "semaine" ? "Semaine" : "Mois"}
          </button>
        ))}
      </div>
      {vue !== "mois" ? (
        <div className="flex gap-1 overflow-x-auto px-3 pb-2">
          {Array.from({ length: 7 }, (_, i) => ajouterJours(lundiDe(jour), i)).map((cle) => (
            <button
              key={cle}
              type="button"
              onClick={() => {
                setJour(cle);
                setVue("jour");
              }}
              className={cn("min-h-11 min-w-11 rounded-md px-2 text-ui-xs", cle === jour ? "bg-texte-principal text-texte-inverse" : "text-texte-secondaire")}
            >
              {cle.slice(8)}
            </button>
          ))}
        </div>
      ) : (
        <GrilleMois jour={jour} evenements={evenements ?? []} rappelsJours={new Set((rappels ?? []).map((r) => r.jour).filter((j): j is string => !!j))} onChoisir={(cle) => { setJour(cle); setVue("jour"); }} />
      )}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-20">
        {vue !== "mois"
          ? jours.map((cle) => (
              <section key={cle} className="mb-4">
                {vue === "semaine" ? <h2 className="sticky top-0 bg-fond-page py-2 text-ui text-texte-secondaire">{libelleJour(cle)}</h2> : <h2 className="py-2 text-ui text-texte-secondaire">Ta journée</h2>}
                <ListeJour
                  cle={cle}
                  evenements={(evenements ?? []).filter((e) => e.jour === cle)}
                  rappels={(rappels ?? []).filter((r) => r.jour === cle && r.statut !== "fait")}
                  ouvert={ouvert}
                  sur={sur}
                />
              </section>
            ))
          : null}
      </div>
      <button type="button" onClick={() => setCreation(true)} className="absolute right-4 bottom-[calc(72px+env(safe-area-inset-bottom))] min-h-11 rounded-full bg-texte-principal px-4 text-ui text-texte-inverse shadow-ombre-levee">
        + Événement
      </button>
      {creation ? <FormulaireEvenement jour={jour} onFermer={() => setCreation(false)} /> : null}
    </div>
  );
}

function ListeJour({
  cle,
  evenements,
  rappels,
  ouvert,
  sur,
}: {
  cle: string;
  evenements: { id: string; titre: string; debut: string | null; jourEntier: boolean; modifiable: boolean }[];
  rappels: { _id: string; titre: string; heure: string | null }[];
  ouvert: boolean;
  sur: string;
}) {
  const vide = evenements.length === 0 && rappels.length === 0;
  return (
    <div>
      {evenements.map((evenement) => (
        <p key={evenement.id} className="flex min-h-11 items-center gap-3 text-body-s text-texte-principal">
          <span className="w-12 shrink-0 text-ui-xs text-texte-secondaire">{evenement.jourEntier ? "Jour" : (evenement.debut ?? "")}</span>
          {evenement.titre}
          {!evenement.modifiable ? <span className="text-ui-xs text-texte-secondaire">Lecture</span> : null}
        </p>
      ))}
      {!ouvert ? <p className="min-h-11 text-ui text-texte-secondaire">Départs des routines : visibles quand {sur} est ouvert</p> : null}
      <h3 className="mt-2 text-ui text-texte-secondaire">À faire aujourd’hui</h3>
      {rappels.map((rappel) => (
        <p key={rappel._id} className="flex min-h-11 items-center text-body-s text-texte-principal">
          {rappel.titre}
        </p>
      ))}
      {vide ? <p className="text-body-s text-texte-secondaire">Rien d’imposé aujourd’hui : la journée est à toi.</p> : null}
      <span className="sr-only">{cle}</span>
    </div>
  );
}

function GrilleMois({
  jour,
  evenements,
  rappelsJours,
  onChoisir,
}: {
  jour: string;
  evenements: { jour: string }[];
  rappelsJours: Set<string>;
  onChoisir: (cle: string) => void;
}) {
  const d = depuisCle(jour);
  const debut = lundiDe(cleJour(new Date(d.getFullYear(), d.getMonth(), 1)));
  const cases = Array.from({ length: 42 }, (_, i) => ajouterJours(debut, i));
  const occupes = new Set([...evenements.map((e) => e.jour), ...rappelsJours]);
  return (
    <div className="grid grid-cols-7 gap-1 px-3 pb-3">
      {cases.map((cle) => (
        <button key={cle} type="button" onClick={() => onChoisir(cle)} className="flex min-h-11 flex-col items-center justify-center text-ui-xs text-texte-principal">
          {Number(cle.slice(8))}
          {occupes.has(cle) ? <span className="mt-1 h-1.5 w-1.5 rounded-full bg-texte-principal" /> : <span className="mt-1 h-1.5 w-1.5" />}
        </button>
      ))}
    </div>
  );
}

function FormulaireEvenement({ jour, onFermer }: { jour: string; onFermer: () => void }) {
  const creer = useMutation(api.evenements.creer);
  const [titre, setTitre] = useState("");
  const [date, setDate] = useState(jour);
  const [debut, setDebut] = useState("09:00");
  const [fin, setFin] = useState("10:00");
  const [jourEntier, setJourEntier] = useState(false);
  const [notes, setNotes] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);

  const enregistrer = async (e: FormEvent) => {
    e.preventDefault();
    setErreur(null);
    try {
      await creer({
        titre,
        notes,
        jour: date,
        debut: jourEntier ? null : debut,
        fin: jourEntier ? null : fin,
        jourEntier,
        repetition: "aucune",
        touteEquipe: false,
        participants: [],
        debutMs: debutMsEvenement(date, jourEntier ? null : debut),
      });
      onFermer();
    } catch (err) {
      setErreur(messageErreur(err));
    }
  };

  return (
    <form onSubmit={(e) => void enregistrer(e)} className="fixed inset-0 z-20 flex flex-col bg-fond-page px-4 pt-[env(safe-area-inset-top)]">
      <h2 className="flex h-[52px] items-center text-body-s font-medium">Nouvel événement</h2>
      <label className="mt-2 text-ui text-texte-principal">
        Titre
        <input required value={titre} onChange={(e) => setTitre(e.target.value)} className="mt-1 h-12 w-full rounded-md border border-bordure-champ px-3 text-body-s" />
      </label>
      <label className="mt-3 text-ui text-texte-principal">
        Date
        <input required type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 h-12 w-full rounded-md border border-bordure-champ px-3 text-body-s" />
      </label>
      <label className="mt-3 flex min-h-11 items-center gap-2 text-ui">
        <input type="checkbox" checked={jourEntier} onChange={(e) => setJourEntier(e.target.checked)} />
        Toute la journée
      </label>
      {!jourEntier ? (
        <div className="mt-2 flex gap-2">
          <input aria-label="Heure de début" type="time" value={debut} onChange={(e) => setDebut(e.target.value)} className="h-12 flex-1 rounded-md border border-bordure-champ px-3 text-body-s" />
          <input aria-label="Heure de fin" type="time" value={fin} onChange={(e) => setFin(e.target.value)} className="h-12 flex-1 rounded-md border border-bordure-champ px-3 text-body-s" />
        </div>
      ) : null}
      <label className="mt-3 text-ui text-texte-principal">
        Notes
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className="mt-1 min-h-24 w-full rounded-md border border-bordure-champ px-3 py-2 text-body-s" />
      </label>
      {erreur ? <p role="alert" className="mt-2 text-ui">{erreur}</p> : null}
      <div className="mt-auto flex gap-2 py-4">
        <Bouton type="button" onClick={onFermer} className="h-12 flex-1">
          Annuler
        </Bouton>
        <BoutonPrincipal type="submit">Enregistrer</BoutonPrincipal>
      </div>
    </form>
  );
}
