"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { Input, Textarea } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { CHAMP } from "@/components/ui/Champ";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { messageErreur, useCompte } from "@/lib/compte";
import { aujourdhui, cleJour, depuisCle } from "@/lib/dates";
import { useWorkspace } from "@/lib/workspace";
import { ROLE_TEINTES, type Evenement, type RoleTeinte } from "@/types/domain";

/** Même horizon que le planning donné aux agents (`planning-agents.ts`). */
const JOURS_AVANT = 7;
const JOURS_APRES = 60;

function teinteDe(couleur: string): RoleTeinte {
  return (ROLE_TEINTES as string[]).includes(couleur) ? (couleur as RoleTeinte) : "bleu-k1";
}

/** L'instant du début, en heure locale. Le serveur le range tel quel. */
export function debutMsEvenement(jour: string, heure: string | null): number {
  if (!heure) return depuisCle(jour).getTime();
  return new Date(`${jour}T${heure}`).getTime();
}

/**
 * Reçoit les événements du compte et le Weekly, tant que la session est ouverte.
 * Monté seulement sous le client Convex (cf. `CompteConnecte`).
 */
export function AgendaCompte({ actif }: { actif: boolean }) {
  const { poserEvenementsCompte } = useWorkspace();
  const assurer = useMutation(api.evenements.assurerWeekly);
  const [jour, setJour] = useState(aujourdhui);

  useEffect(() => {
    const id = setInterval(() => {
      const suivant = aujourdhui();
      setJour((actuel) => (actuel === suivant ? actuel : suivant));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

  const fenetre = useMemo(() => {
    const debut = depuisCle(jour);
    debut.setDate(debut.getDate() - JOURS_AVANT);
    const fin = depuisCle(jour);
    fin.setDate(fin.getDate() + JOURS_APRES);
    return { debut: cleJour(debut), fin: cleJour(fin), finMs: fin.getTime() };
  }, [jour]);

  const occurrences = useQuery(api.evenements.entre, actif ? fenetre : "skip");
  const membres = useQuery(api.equipe.membres, actif ? {} : "skip");

  useEffect(() => {
    if (!actif) return;
    void assurer({}).catch(() => {
      /* Le prochain affichage réessaie. Le Weekly codé en dur reste en attendant. */
    });
  }, [actif, assurer]);

  useEffect(() => {
    if (!actif || occurrences === undefined || membres === undefined) return;
    const noms = new Map(membres.map((m) => [m._id as string, m.nom]));
    poserEvenementsCompte(
      occurrences.map((o) => ({
        id: o.id,
        compteId: o.evenementId,
        titre: o.titre,
        date: o.jour,
        debut: o.debut,
        fin: o.fin,
        notes: o.notes,
        projectId: null,
        notifie: false,
        equipe: o.touteEquipe,
        repete: o.repetition === "semaine",
        occurrence: true,
        origine: o.origine,
        teinte: teinteDe(o.couleur),
        organisateur: o.organisateur,
        organisateurNom: noms.get(o.organisateur) ?? "Quelqu’un",
        modifiable: o.modifiable,
        participants: o.participants,
      })),
    );
  }, [actif, membres, occurrences, poserEvenementsCompte]);

  useEffect(() => () => poserEvenementsCompte(null), [poserEvenementsCompte]);

  return null;
}

/** Créer ou modifier un événement du compte. Seulement une fois connecté : ce formulaire appelle Convex. */
export function FenetreEvenementCompte({ initial, onFermer }: { initial: Evenement; onFermer: () => void }) {
  const compte = useCompte();
  const creer = useMutation(api.evenements.creer);
  const modifier = useMutation(api.evenements.modifier);
  const supprimer = useMutation(api.evenements.supprimer);
  const membres = useQuery(api.equipe.membres, {});
  const [e, setE] = useState(initial);
  const [repete, setRepete] = useState(Boolean(initial.repete));
  const [touteEquipe, setTouteEquipe] = useState(Boolean(initial.equipe));
  const [personnes, setPersonnes] = useState<string[]>(() => (initial.participants ?? []).filter((id) => id !== compte.moi?._id));
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const journee = e.debut === null;
  const moi = compte.moi?._id;

  useEffect(() => {
    const echap = (ev: KeyboardEvent) => ev.key === "Escape" && onFermer();
    window.addEventListener("keydown", echap);
    return () => window.removeEventListener("keydown", echap);
  }, [onFermer]);

  const enregistrer = (ev: FormEvent) => {
    ev.preventDefault();
    if (!e.titre.trim() || occupe) return;
    const jour = repete && initial.origine && e.date === initial.date ? initial.origine : e.date;
    const saisie = {
      titre: e.titre,
      notes: e.notes,
      jour,
      debut: e.debut,
      fin: journee ? null : e.fin,
      jourEntier: journee,
      repetition: repete ? ("semaine" as const) : ("aucune" as const),
      touteEquipe,
      participants: (touteEquipe ? [] : personnes) as Id<"membres">[],
      debutMs: debutMsEvenement(jour, journee ? null : e.debut),
    };
    setOccupe(true);
    setErreur(null);
    const envoi = initial.compteId
      ? modifier({ evenementId: initial.compteId as Id<"evenements">, ...saisie })
      : creer(saisie);
    void envoi
      .then(() => onFermer())
      .catch((err: unknown) => {
        setErreur(messageErreur(err));
        setOccupe(false);
      });
  };

  const autres = (membres ?? []).filter((m) => m._id !== moi);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-fond-inverse-fort/20 p-6" onMouseDown={onFermer}>
      <form
        role="dialog"
        aria-modal="true"
        aria-label="Événement"
        onSubmit={enregistrer}
        onMouseDown={(x) => x.stopPropagation()}
        className="flex w-[380px] max-w-full flex-col gap-3 rounded-xl border border-bordure-subtile bg-fond-surface p-4 shadow-ombre-flottante"
      >
        <input
          autoFocus
          value={e.titre}
          placeholder="Nouvel événement"
          onChange={(x) => setE({ ...e, titre: x.target.value })}
          className="border-0 bg-transparent p-0 text-ui font-semibold text-texte-principal outline-none placeholder:text-texte-tertiaire"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Input
            size="sm"
            type="date"
            value={e.date}
            onChange={(x) => x.target.value && setE({ ...e, date: x.target.value })}
            className={cn(CHAMP, "w-[150px]")}
          />
          {!journee && (
            <>
              <Input
                size="sm"
                type="time"
                value={e.debut ?? ""}
                onChange={(x) => setE({ ...e, debut: x.target.value || "09:00" })}
                className={cn(CHAMP, "w-[96px]")}
              />
              <span className="text-ui-s text-texte-tertiaire">à</span>
              <Input
                size="sm"
                type="time"
                value={e.fin ?? ""}
                onChange={(x) => setE({ ...e, fin: x.target.value || null })}
                className={cn(CHAMP, "w-[96px]")}
              />
            </>
          )}
        </div>
        <label className="flex items-center gap-2 text-ui-s text-texte-principal">
          <input
            type="checkbox"
            checked={journee}
            onChange={() => setE({ ...e, debut: journee ? "09:00" : null, fin: journee ? "10:00" : null })}
            className="size-4 accent-bleu-k1-500"
          />
          Toute la journée
        </label>
        <label className="flex items-center gap-2 text-ui-s text-texte-principal">
          <input type="checkbox" checked={repete} onChange={() => setRepete((v) => !v)} className="size-4 accent-bleu-k1-500" />
          Chaque semaine
        </label>
        <label className="flex items-center gap-2 text-ui-s text-texte-principal">
          <input type="checkbox" checked={touteEquipe} onChange={() => setTouteEquipe((v) => !v)} className="size-4 accent-bleu-k1-500" />
          Toute l’équipe
        </label>
        {!touteEquipe && (
          <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="mb-1 text-ui-s text-texte-secondaire">Avec</legend>
            {membres === undefined && <span className="text-ui-s text-texte-tertiaire">L’équipe se charge…</span>}
            {autres.map((m) => (
              <label key={m._id} className="flex items-center gap-2 text-ui-s text-texte-principal">
                <input
                  type="checkbox"
                  checked={personnes.includes(m._id)}
                  onChange={() => setPersonnes((liste) => (liste.includes(m._id) ? liste.filter((id) => id !== m._id) : [...liste, m._id]))}
                  className="size-4 accent-bleu-k1-500"
                />
                {m.nom}
              </label>
            ))}
            {membres !== undefined && autres.length === 0 && <span className="text-ui-s text-texte-tertiaire">Personne d’autre dans l’équipe.</span>}
          </fieldset>
        )}
        <Textarea
          size="sm"
          autoGrow
          value={e.notes}
          placeholder="Notes"
          onChange={(x) => setE({ ...e, notes: x.target.value })}
          className={cn(CHAMP, "min-h-[56px]")}
        />
        {erreur && <p role="alert" className="m-0 text-ui-s text-texte-erreur">{erreur}</p>}
        <div className="flex flex-wrap gap-2">
          <Bouton type="submit" variant="sombre" taille="compact" disabled={!e.titre.trim() || occupe}>
            {initial.compteId ? "Enregistrer" : "Ajouter"}
          </Bouton>
          <Bouton variant="blanc" taille="compact" onClick={onFermer}>
            Annuler
          </Bouton>
          {initial.compteId && (
            <Bouton
              variant="discret"
              taille="compact"
              iconeGauche={<Icon name="trash-01" size={16} />}
              disabled={occupe}
              onClick={() => {
                setOccupe(true);
                setErreur(null);
                void supprimer({ evenementId: initial.compteId as Id<"evenements"> })
                  .then(() => onFermer())
                  .catch((err: unknown) => {
                    setErreur(messageErreur(err));
                    setOccupe(false);
                  });
              }}
              className="ml-auto"
            >
              Supprimer
            </Bouton>
          )}
        </div>
      </form>
    </div>
  );
}
