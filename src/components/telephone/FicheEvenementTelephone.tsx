"use client";

import { useId, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Icon } from "@/components/icons/Icon";
import { debutMsEvenement } from "@/components/planning/AgendaCompte";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { cn } from "@/lib/cn";
import { messageErreur, useEquipe } from "@/lib/compte";
import { libelleEcheance, libelleJourCourt } from "@/lib/dates";
import { texteErreurPoste } from "@/lib/poste-texte";
import { usePlanningTelephone, type EvenementTelephone } from "./ContextePlanningTelephone";
import { ConfirmationFeuille, Feuille } from "./Feuille";
import { CHAMP_TELEPHONE, CaseFiche, ChampFiche, ErreurFiche, FeuilleChoixFiche, LigneChoixFiche, LigneDateFiche, LigneInterrupteurFiche, NoteEnregistrement, PageFiche } from "./FichePlanningTelephone";
import { BandeauVueGardee } from "./etats";
import { GroupeListe } from "./Liste";
import { useProjetsEspace } from "@/lib/telephone/espace";

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
  const { moiId, posteOuvert, horsLigne, gardeeLe, surPoste, sur } = usePlanningTelephone();
  const creer = useMutation(api.evenements.creer);
  const modifier = useMutation(api.evenements.modifier);
  const supprimerCompte = useMutation(api.evenements.supprimer);
  const { membres } = useEquipe(false);
  const projets = useProjetsEspace();
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
  const [feuille, setFeuille] = useState<"projet" | "avec" | null>(null);
  const champTitre = useRef<HTMLInputElement>(null);
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
    if (trouvees.titre) champTitre.current?.focus();
    if (Object.keys(trouvees).length > 0 || occupe || bloque || horsLigne) return;
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
      else setErreur(texteErreurPoste(resultat, sur));
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
      else {
        setErreur(texteErreurPoste(resultat, sur));
        setConfirmer(true);
      }
      return;
    }
    if (!occurrence) return;
    try {
      await supprimerCompte({ evenementId: occurrence.evenementId });
      onFermer();
    } catch (err) {
      setErreur(messageErreur(err));
      setOccupe(false);
      setConfirmer(true);
    }
  };

  const autres = (membres ?? []).filter((m) => m._id !== moiId);
  const existe = evenement !== null;
  const nomsPersonnes = autres.filter((m) => personnes.includes(m._id)).map((m) => m.nom);
  const avec = nomsPersonnes.length === 0 ? "Personne" : nomsPersonnes.length === 1 ? nomsPersonnes[0] : `${nomsPersonnes.length} personnes`;
  const nomProjet = (projets ?? []).find((p) => p.origine === projet)?.nom ?? "Aucun projet";
  /* La conséquence réelle : le nom, la date, et qui le voit disparaître (E3-39). */
  const consequence = [
    `« ${titre.trim() || "Sans titre"} », ${libelleJourCourt(jour, journee ? null : debut)}.`,
    touteEquipe ? "Il disparaît aussi du calendrier de toute l’équipe." : nomsPersonnes.length ? `Il disparaît aussi du calendrier de ${nomsPersonnes.join(", ")}.` : null,
    erreur,
  ]
    .filter(Boolean)
    .join(" ");
  const modifie =
    titre !== (occurrence?.titre ?? local?.titre ?? "") ||
    notes !== (occurrence?.notes ?? local?.notes ?? "") ||
    jour !== (occurrence?.jour ?? local?.date ?? jourParDefaut) ||
    (existe && debut !== (occurrence?.debut ?? local?.debut ?? "09:00")) ||
    (existe && (fin ?? "") !== (occurrence?.fin ?? local?.fin ?? plusUneHeure(occurrence?.debut ?? local?.debut ?? "09:00"))) ||
    repete !== (occurrence?.repetition === "semaine") ||
    touteEquipe !== (occurrence?.touteEquipe ?? false) ||
    personnes.length !== (occurrence?.participants ?? []).filter((x) => x !== moiId).length ||
    projet !== (local?.projectId ?? "");

  return (
    <PageFiche
      titre={existe ? "Événement" : "Nouvel événement"}
      modifie={modifie && !bloque}
      onRetour={() => onFermer()}
      onEnregistrer={() => void enregistrer()}
      pied={
        <>
          <BoutonPrincipal type="submit" disabled={occupe || bloque || horsLigne} className="w-full justify-between">
            {existe ? "Enregistrer" : "Ajouter"}
          </BoutonPrincipal>
          <NoteEnregistrement horsLigne={horsLigne} poste={bloque} />
          <ErreurFiche texte={erreur} />
        </>
      }
    >
      {bloque && gardeeLe !== null ? <BandeauVueGardee lu={gardeeLe} /> : null}
      <fieldset disabled={bloque} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <ChampFiche id={`${id}-titre`} libelle="Titre" erreur={erreurs.titre}>
          <input
            ref={champTitre}
            id={`${id}-titre`}
            value={titre}
            placeholder="Nouvel événement"
            autoFocus={!existe}
            onChange={(e) => setTitre(e.target.value)}
            aria-invalid={erreurs.titre ? true : undefined}
            aria-describedby={erreurs.titre ? `${id}-titre-erreur` : undefined}
            className={cn(CHAMP_TELEPHONE, bloque && "bg-fond-surface-grise")}
          />
        </ChampFiche>
        <GroupeListe>
          <LigneDateFiche libelle="Date" icone="calendar-01" type="date" valeur={jour} affichage={jour ? libelleEcheance(jour, null) : null} vide="Aucune" disabled={bloque} erreur={erreurs.jour} onChange={setJour} />
          {surLePoste ? null : (
            <LigneInterrupteurFiche
              libelle="Toute la journée"
              icone="clock-01"
              actif={journee}
              onChange={(coche) => {
                setJournee(coche);
                if (!coche && !debut) {
                  setDebut("09:00");
                  setFin("10:00");
                }
              }}
            />
          )}
          {!journee ? (
            <>
              <LigneDateFiche libelle="Début" icone="clock-01" type="time" valeur={debut} affichage={debut || null} vide="Aucune" disabled={bloque} erreur={erreurs.heure} onChange={setDebut} />
              <LigneDateFiche libelle="Fin" icone="clock-01" type="time" valeur={fin ?? ""} min={debut} affichage={fin || null} vide="Aucune" disabled={bloque} onChange={setFin} />
            </>
          ) : null}
          {surLePoste ? null : <LigneInterrupteurFiche libelle="Chaque semaine" icone="refresh-01" actif={repete} onChange={setRepete} />}
        </GroupeListe>
        <GroupeListe>
          {surLePoste ? (
            <LigneChoixFiche libelle="Projet" icone="projets-dossier" valeur={nomProjet} disabled={bloque} onClick={() => setFeuille("projet")} />
          ) : (
            <>
              <LigneInterrupteurFiche libelle="Toute l’équipe" icone="users-profiles-01" actif={touteEquipe} onChange={setTouteEquipe} />
              {!touteEquipe ? <LigneChoixFiche libelle="Avec" icone="user-profile-01" valeur={avec} onClick={() => setFeuille("avec")} /> : null}
            </>
          )}
        </GroupeListe>
        <ChampFiche id={`${id}-notes`} libelle="Notes">
          <textarea
            id={`${id}-notes`}
            value={notes}
            placeholder="Ajoute un détail utile…"
            onChange={(e) => setNotes(e.target.value)}
            className="min-h-24 w-full rounded-md border border-bordure-champ bg-fond-surface px-3 py-2 text-body-s text-texte-principal placeholder:text-texte-secondaire disabled:bg-fond-surface-grise [field-sizing:content]"
          />
        </ChampFiche>
        {existe && !bloque ? (
          <Bouton variant="discret" taille="md" className="self-start text-texte-erreur" disabled={occupe || bloque || horsLigne} iconeGauche={<Icon name="trash-01" size={20} />} onClick={() => setConfirmer(true)}>
            Supprimer
          </Bouton>
        ) : null}
      </fieldset>
      {feuille === "projet" ? (
        <FeuilleChoixFiche
          titre="Projet"
          options={[{ valeur: "", libelle: "Aucun projet" }, ...(projets ?? []).map((p) => ({ valeur: p.origine, libelle: p.nom }))]}
          valeur={projet}
          onChoisir={setProjet}
          onFermer={() => setFeuille(null)}
        />
      ) : null}
      {feuille === "avec" ? (
        <Feuille titre="Avec" onFermer={() => setFeuille(null)}>
          {membres === undefined ? <p className="text-ui text-texte-secondaire">L’équipe se charge…</p> : null}
          {membres !== undefined && autres.length === 0 ? <p className="text-ui text-texte-secondaire">Personne d’autre dans l’équipe.</p> : null}
          {autres.map((m) => (
            <CaseFiche key={m._id} libelle={m.nom} coche={personnes.includes(m._id)} onChange={() => setPersonnes((liste) => (liste.includes(m._id) ? liste.filter((x) => x !== m._id) : [...liste, m._id]))} />
          ))}
        </Feuille>
      ) : null}
      {confirmer ? <ConfirmationFeuille titre="Supprimer l’événement ?" texte={consequence} confirmer={erreur ? "Réessayer" : "Supprimer"} onConfirmer={() => void supprimer()} onFermer={() => setConfirmer(false)} /> : null}
    </PageFiche>
  );
}
