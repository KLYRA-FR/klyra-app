"use client";

import { useId, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Icon } from "@/components/icons/Icon";
import { debutMsEvenement } from "@/components/planning/AgendaCompte";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { messageErreur, useEquipe } from "@/lib/compte";
import { usePlanningTelephone, type EvenementTelephone } from "./ContextePlanningTelephone";
import { ConfirmationFeuille } from "./Feuille";
import { CHAMP_TELEPHONE, CaseFiche, ChampFiche, ErreurFiche, PageFiche } from "./FichePlanningTelephone";
import { NotePoste } from "./etats";

const plusUneHeure = (heure: string) => {
  const [h, m] = heure.split(":").map(Number);
  return `${String(Math.min(23, (h || 0) + 1)).padStart(2, "0")}:${String(m || 0).padStart(2, "0")}`;
};

/**
 * T-07 pour un événement, avec les champs de sa fenêtre au bureau. Un événement nouveau ou du
 * compte (`FenetreEvenementCompte`) : date, heure « à » heure, « Toute la journée », « Chaque
 * semaine », « Toute l'équipe », « Avec », notes ; il s'écrit en ligne, ordinateur fermé compris.
 * Un événement de l'ordinateur (`FenetreEvenement`) : date, heures, « Projet », notes ; il
 * s'écrit sur le poste, et attend qu'il soit ouvert (P-7).
 */
export function FicheEvenementTelephone({
  evenement,
  jourParDefaut,
  onFermer,
}: {
  evenement: EvenementTelephone | null;
  jourParDefaut: string;
  /** Avec l'élément à éclairer et son jour, après un enregistrement. */
  onFermer: (enregistre?: { eclairage: string; jour: string }) => void;
}) {
  const { moiId, posteOuvert, surPoste } = usePlanningTelephone();
  const creer = useMutation(api.evenements.creer);
  const modifier = useMutation(api.evenements.modifier);
  const supprimerCompte = useMutation(api.evenements.supprimer);
  const { membres } = useEquipe(false);
  const projets = useQuery(api.conversationsCompte.projets, {});
  const occurrence = evenement?.source === "compte" ? evenement.occurrence : null;
  const local = evenement?.source === "poste" ? evenement.evenement : null;
  const surLePoste = local !== null;

  const [titre, setTitre] = useState(occurrence?.titre ?? local?.titre ?? "");
  const [jour, setJour] = useState(occurrence?.jour ?? local?.date ?? jourParDefaut);
  const [journee, setJournee] = useState(occurrence ? occurrence.jourEntier : local ? local.debut === null : false);
  const [debut, setDebut] = useState(occurrence?.debut ?? local?.debut ?? "09:00");
  const [fin, setFin] = useState(occurrence?.fin ?? local?.fin ?? plusUneHeure(occurrence?.debut ?? local?.debut ?? "09:00"));
  const [repete, setRepete] = useState(occurrence?.repetition === "semaine");
  const [touteEquipe, setTouteEquipe] = useState(occurrence?.touteEquipe ?? false);
  const [personnes, setPersonnes] = useState<string[]>(() => (occurrence?.participants ?? []).filter((id) => id !== moiId));
  const [projet, setProjet] = useState(local?.projectId ?? "");
  const [notes, setNotes] = useState(occurrence?.notes ?? local?.notes ?? "");
  const [erreurs, setErreurs] = useState<{ titre?: string; jour?: string; heure?: string }>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [confirmer, setConfirmer] = useState(false);
  const id = useId();
  const bloque = surLePoste && !posteOuvert;

  const enregistrer = async () => {
    const trouvees: typeof erreurs = {};
    if (!titre.trim()) trouvees.titre = "Donne un titre à l’événement.";
    if (!jour) trouvees.jour = "Choisis une date.";
    if (!journee && !debut) trouvees.heure = "Choisis une heure de début.";
    else if (!journee && !surLePoste && !fin) trouvees.heure = "Choisis une heure de fin.";
    else if (!journee && fin && fin <= debut) trouvees.heure = "L’heure de fin doit suivre celle du début.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length > 0 || occupe || bloque) return;
    setOccupe(true);
    setErreur(null);

    if (local) {
      const resultat = await surPoste("planning.enregistrerEvenement", {
        id: local.id,
        titre,
        notes,
        jour,
        debut: journee ? null : debut,
        fin: journee ? null : fin || null,
        projectId: projet || null,
      });
      setOccupe(false);
      if (resultat.ok) onFermer({ eclairage: local.id, jour });
      else setErreur(resultat.code === "delai" ? "Pas de réponse de l’ordinateur. Réessaie." : resultat.message || "Le geste a échoué sur l’ordinateur.");
      return;
    }

    /* Une occurrence d'un événement répété garde son premier jour, sauf si la date a changé (comme au bureau). */
    const jourEnvoye = repete && occurrence && jour === occurrence.jour ? occurrence.origine : jour;
    const saisie = {
      titre,
      notes,
      jour: jourEnvoye,
      debut: journee ? null : debut,
      fin: journee ? null : fin,
      jourEntier: journee,
      repetition: repete ? ("semaine" as const) : ("aucune" as const),
      touteEquipe,
      participants: (touteEquipe ? [] : personnes) as Id<"membres">[],
      debutMs: debutMsEvenement(jourEnvoye, journee ? null : debut),
    };
    try {
      const evenementId = occurrence ? (await modifier({ evenementId: occurrence.evenementId, ...saisie }), occurrence.evenementId) : await creer(saisie);
      onFermer({ eclairage: evenementId, jour });
    } catch (err) {
      setErreur(messageErreur(err));
      setOccupe(false);
    }
  };

  const supprimer = async () => {
    setOccupe(true);
    setErreur(null);
    if (local) {
      const resultat = await surPoste("planning.supprimerEvenement", { id: local.id });
      setOccupe(false);
      if (resultat.ok) onFermer();
      else setErreur(resultat.message || "Le geste a échoué sur l’ordinateur.");
      return;
    }
    if (!occurrence) return;
    try {
      await supprimerCompte({ evenementId: occurrence.evenementId });
      onFermer();
    } catch (err) {
      setErreur(messageErreur(err));
      setOccupe(false);
    }
  };

  const autres = (membres ?? []).filter((m) => m._id !== moiId);
  const existe = evenement !== null;

  return (
    <PageFiche
      titre={existe ? "Événement" : "Nouvel événement"}
      onRetour={() => onFermer()}
      onEnregistrer={() => void enregistrer()}
      pied={
        <>
          <BoutonPrincipal type="submit" disabled={occupe || bloque} className="w-full justify-between">
            {existe ? "Enregistrer" : "Ajouter"}
          </BoutonPrincipal>
          {bloque ? <NotePoste /> : null}
          <ErreurFiche texte={erreur} />
        </>
      }
    >
      <ChampFiche id={`${id}-titre`} libelle="Titre" erreur={erreurs.titre}>
        <input
          id={`${id}-titre`}
          value={titre}
          placeholder="Nouvel événement"
          autoFocus={!existe}
          onChange={(e) => setTitre(e.target.value)}
          aria-invalid={erreurs.titre ? true : undefined}
          aria-describedby={erreurs.titre ? `${id}-titre-erreur` : undefined}
          className={CHAMP_TELEPHONE}
        />
      </ChampFiche>
      <ChampFiche id={`${id}-jour`} libelle="Date" erreur={erreurs.jour}>
        <input
          id={`${id}-jour`}
          type="date"
          value={jour}
          onChange={(e) => setJour(e.target.value)}
          aria-invalid={erreurs.jour ? true : undefined}
          aria-describedby={erreurs.jour ? `${id}-jour-erreur` : undefined}
          className={CHAMP_TELEPHONE}
        />
      </ChampFiche>
      <CaseFiche
        libelle="Toute la journée"
        coche={journee}
        onChange={(coche) => {
          setJournee(coche);
          if (!coche && !debut) {
            setDebut("09:00");
            setFin("10:00");
          }
        }}
      />
      {!journee ? (
        <ChampFiche id={`${id}-debut`} libelle="Heure" erreur={erreurs.heure}>
          <div className="flex items-center gap-2">
            <input
              id={`${id}-debut`}
              type="time"
              value={debut}
              aria-label="Heure de début"
              onChange={(e) => setDebut(e.target.value)}
              aria-invalid={erreurs.heure ? true : undefined}
              aria-describedby={erreurs.heure ? `${id}-debut-erreur` : undefined}
              className={CHAMP_TELEPHONE}
            />
            <span className="shrink-0 text-ui text-texte-secondaire">à</span>
            <input
              type="time"
              value={fin ?? ""}
              aria-label="Heure de fin"
              onChange={(e) => setFin(e.target.value)}
              aria-invalid={erreurs.heure ? true : undefined}
              className={CHAMP_TELEPHONE}
            />
          </div>
        </ChampFiche>
      ) : null}

      {surLePoste ? (
        <ChampFiche id={`${id}-projet`} libelle="Projet">
          <ListeDeroulante
            libelle="Projet"
            value={projet}
            options={[{ value: "", label: "Aucun projet" }, ...(projets ?? []).map((p) => ({ value: p.origine, label: p.nom }))]}
            onChange={setProjet}
            className="h-12 w-full text-body-s"
          />
        </ChampFiche>
      ) : (
        <>
          <CaseFiche libelle="Chaque semaine" coche={repete} onChange={setRepete} />
          <CaseFiche libelle="Toute l’équipe" coche={touteEquipe} onChange={setTouteEquipe} />
          {!touteEquipe ? (
            <fieldset className="flex flex-col">
              <legend className="mb-1 text-ui font-medium text-texte-principal">Avec</legend>
              {membres === undefined ? <p className="text-ui text-texte-secondaire">L’équipe se charge…</p> : null}
              {autres.map((m) => (
                <CaseFiche
                  key={m._id}
                  libelle={m.nom}
                  coche={personnes.includes(m._id)}
                  onChange={() => setPersonnes((liste) => (liste.includes(m._id) ? liste.filter((x) => x !== m._id) : [...liste, m._id]))}
                />
              ))}
              {membres !== undefined && autres.length === 0 ? <p className="text-ui text-texte-secondaire">Personne d’autre dans l’équipe.</p> : null}
            </fieldset>
          ) : null}
        </>
      )}

      <ChampFiche id={`${id}-notes`} libelle="Notes">
        <textarea
          id={`${id}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-24 w-full rounded-md border border-bordure-champ bg-fond-surface px-3 py-2 text-body-s text-texte-principal [field-sizing:content]"
        />
      </ChampFiche>

      {existe ? (
        <Bouton
          variant="discret"
          taille="md"
          className="self-start text-texte-erreur"
          disabled={occupe || bloque}
          iconeGauche={<Icon name="trash-01" size={20} />}
          onClick={() => setConfirmer(true)}
        >
          Supprimer
        </Bouton>
      ) : null}
      {confirmer ? (
        <ConfirmationFeuille
          titre="Supprimer l’événement ?"
          texte={titre.trim() || undefined}
          confirmer="Supprimer"
          danger
          onConfirmer={() => void supprimer()}
          onFermer={() => setConfirmer(false)}
        />
      ) : null}
    </PageFiche>
  );
}
