"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { ListeDeroulante, type OptionListe } from "@/components/ui/ListeDeroulante";
import { cn } from "@/lib/cn";
import { messageErreur, useEquipe } from "@/lib/compte";
import { aujourdhui } from "@/lib/dates";
import { echeanceLocale } from "@/lib/rappel-compte";
import type { RappelTelephone } from "@/lib/telephone/planning";
import { usePlanningTelephone } from "./ContextePlanningTelephone";
import { CHAMP_TELEPHONE, ChampFiche, ErreurFiche, PageFiche } from "./FichePlanningTelephone";
import { NotePoste } from "./etats";

type Priorite = RappelTelephone["priorite"];
const URGENCES: { valeur: Priorite; texte: string; libelle: string }[] = [
  { valeur: 0, texte: "Aucune", libelle: "Aucune" },
  { valeur: 1, texte: "!", libelle: "Basse" },
  { valeur: 2, texte: "!!", libelle: "Moyenne" },
  { valeur: 3, texte: "!!!", libelle: "Haute" },
];

/**
 * T-07 pour un rappel : titre, date, « Jusqu'au (facultatif) », heure, urgence, catégorie, notes,
 * et pour un rappel du compte « Assigner à ». Mêmes droits qu'au bureau : la personne qui l'a créé
 * change tout et le supprime ; celle à qui il est assigné change ses notes et sa catégorie. Un
 * nouveau rappel va dans le compte. Un rappel de l'ordinateur s'écrit sur le poste (P-7 fermé).
 */
export function FicheRappelTelephone({
  rappel,
  champ,
  onFermer,
  onSupprimer,
}: {
  rappel: RappelTelephone | null;
  /** « Planifier… » : la date prend le focus. */
  champ?: "jour";
  onFermer: (enregistre?: { eclairage: string }) => void;
  onSupprimer: (rappel: RappelTelephone) => void;
}) {
  const { moiId, categories, noms, posteOuvert, surPoste, sur } = usePlanningTelephone();
  const creer = useMutation(api.rappels.creer);
  const modifier = useMutation(api.rappels.modifier);
  const { membres } = useEquipe(false);
  const surLePoste = rappel?.source === "poste";
  const createur = rappel === null || rappel.createur;

  const [titre, setTitre] = useState(rappel?.titre ?? "");
  const [jour, setJour] = useState(rappel?.jour ?? "");
  const [fin, setFin] = useState(rappel?.fin ?? "");
  const [heure, setHeure] = useState(rappel?.heure ?? "");
  const [priorite, setPriorite] = useState<Priorite>(rappel?.priorite ?? 0);
  const [liste, setListe] = useState(rappel ? (rappel.liste ?? "") : (categories?.[0]?.id ?? ""));
  const [assigneA, setAssigneA] = useState(rappel?.assigneA ?? moiId ?? "");
  const [notes, setNotes] = useState(rappel?.notes ?? "");
  const [erreurs, setErreurs] = useState<{ titre?: string; fin?: string }>({});
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const id = useId();
  const champJour = useRef<HTMLInputElement>(null);
  const bloque = surLePoste && !posteOuvert;
  /* La catégorie n'a de sens que pour soi : un rappel assigné à quelqu'un d'autre n'en a pas. */
  const pourMoi = surLePoste || assigneA === moiId;
  const nomCreateur = rappel?.recu && rappel.autre ? (noms.get(rappel.autre) ?? "quelqu’un") : null;

  useEffect(() => {
    if (champ === "jour") champJour.current?.focus();
  }, [champ]);

  const enregistrer = async () => {
    const trouvees: typeof erreurs = {};
    if (!titre.trim()) trouvees.titre = "Donne un titre au rappel.";
    if (jour && fin && fin <= jour) trouvees.fin = "Le dernier jour doit suivre le premier.";
    setErreurs(trouvees);
    if (Object.keys(trouvees).length > 0 || occupe || bloque) return;
    setOccupe(true);
    setErreur(null);
    const date = jour || null;
    const h = date ? heure || null : null;
    const f = date ? fin || null : null;

    if (rappel?.source === "poste") {
      const resultat = await surPoste("planning.enregistrerRappel", {
        id: rappel.id,
        titre,
        notes,
        liste: liste || rappel.liste,
        jour: date,
        heure: h,
        fin: f,
        priorite,
        faite: rappel.faite,
      });
      setOccupe(false);
      if (resultat.ok) onFermer({ eclairage: rappel.id });
      else setErreur(resultat.code === "delai" ? "Pas de réponse de l’ordinateur. Réessaie." : resultat.message || "Le geste a échoué sur l’ordinateur.");
      return;
    }

    try {
      if (!rappel) {
        const nouveau = await creer({
          titre,
          notes,
          jour: date,
          heure: h,
          fin: f,
          echeance: echeanceLocale(date, h, f),
          priorite,
          assigneA: assigneA as Id<"membres">,
          liste: pourMoi && categories !== null && liste ? liste : null,
        });
        onFermer({ eclairage: nouveau });
        return;
      }
      await modifier({
        rappelId: rappel.id as Id<"rappels">,
        notes,
        ...(createur
          ? {
              titre,
              jour: date,
              heure: h,
              fin: f,
              echeance: echeanceLocale(date, h, f),
              priorite,
              ...(assigneA !== rappel.assigneA ? { assigneA: assigneA as Id<"membres"> } : {}),
            }
          : {}),
        /* Les catégories sont sur l'ordinateur : fermé, on ne touche pas au rangement. */
        ...(pourMoi && categories !== null ? { liste: liste || null } : {}),
      });
      onFermer({ eclairage: rappel.id });
    } catch (err) {
      setErreur(messageErreur(err));
      setOccupe(false);
    }
  };

  const optionsCategories: OptionListe<string>[] = [
    ...(surLePoste ? [] : [{ value: "", label: rappel?.recu ? "Assignés par l’équipe" : "Sans catégorie" }]),
    ...(categories ?? []).map((c) => ({ value: c.id, label: c.nom })),
  ];
  const optionsMembres: OptionListe<string>[] = (membres ?? []).map((m) => ({ value: m._id, label: m._id === moiId ? `${m.nom} (moi)` : m.nom }));
  const verrou = !createur;

  return (
    <PageFiche
      titre={rappel ? "Rappel" : "Nouveau rappel"}
      onRetour={() => onFermer()}
      onEnregistrer={() => void enregistrer()}
      pied={
        <>
          <BoutonPrincipal type="submit" disabled={occupe || bloque} className="w-full justify-between">
            {rappel ? "Enregistrer" : "Ajouter"}
          </BoutonPrincipal>
          {bloque ? <NotePoste /> : null}
          <ErreurFiche texte={erreur} />
        </>
      }
    >
      {nomCreateur ? (
        <p className="text-ui text-texte-secondaire">Par {nomCreateur}. Seul qui a créé le rappel peut changer le titre, la date et l’urgence.</p>
      ) : null}
      <ChampFiche id={`${id}-titre`} libelle="Titre" erreur={erreurs.titre}>
        <input
          id={`${id}-titre`}
          value={titre}
          placeholder="Nouveau rappel"
          autoFocus={!rappel}
          disabled={verrou}
          onChange={(e) => setTitre(e.target.value)}
          aria-invalid={erreurs.titre ? true : undefined}
          aria-describedby={erreurs.titre ? `${id}-titre-erreur` : undefined}
          className={CHAMP_TELEPHONE}
        />
      </ChampFiche>
      <ChampFiche id={`${id}-jour`} libelle="Date">
        <input
          ref={champJour}
          id={`${id}-jour`}
          type="date"
          value={jour}
          disabled={verrou}
          onChange={(e) => {
            setJour(e.target.value);
            if (!e.target.value) {
              setHeure("");
              setFin("");
            }
          }}
          className={CHAMP_TELEPHONE}
        />
      </ChampFiche>
      {jour ? (
        <ChampFiche id={`${id}-fin`} libelle="Jusqu’au (facultatif)" erreur={erreurs.fin}>
          <input
            id={`${id}-fin`}
            type="date"
            value={fin}
            min={jour}
            disabled={verrou}
            onChange={(e) => setFin(e.target.value)}
            aria-invalid={erreurs.fin ? true : undefined}
            aria-describedby={erreurs.fin ? `${id}-fin-erreur` : undefined}
            className={CHAMP_TELEPHONE}
          />
        </ChampFiche>
      ) : null}
      <ChampFiche id={`${id}-heure`} libelle="Heure">
        <input
          id={`${id}-heure`}
          type="time"
          value={heure}
          disabled={verrou}
          onChange={(e) => {
            setHeure(e.target.value);
            /* Une heure sans date : aujourd'hui, comme au bureau. */
            if (e.target.value && !jour) setJour(aujourdhui());
          }}
          className={CHAMP_TELEPHONE}
        />
      </ChampFiche>
      <div className="flex flex-col gap-1">
        <span id={`${id}-urgence`} className="text-ui font-medium text-texte-principal">
          Urgence
        </span>
        <div role="radiogroup" aria-labelledby={`${id}-urgence`} className="flex gap-2">
          {URGENCES.map((u) => (
            <button
              key={u.valeur}
              type="button"
              role="radio"
              aria-checked={priorite === u.valeur}
              aria-label={u.libelle}
              disabled={verrou}
              onClick={() => setPriorite(u.valeur)}
              className={cn(
                "min-h-11 flex-1 rounded-xs border text-ui font-semibold disabled:opacity-60",
                priorite === u.valeur ? "border-texte-principal bg-fond-surface-grise text-texte-principal" : "border-bordure-subtile text-texte-secondaire",
              )}
            >
              {u.texte}
            </button>
          ))}
        </div>
      </div>
      {rappel?.source !== "poste" && (createur || rappel === null) ? (
        <ChampFiche id={`${id}-assigne`} libelle="Assigner à">
          <ListeDeroulante
            libelle="Assigner à"
            value={assigneA}
            options={optionsMembres.length > 0 ? optionsMembres : [{ value: assigneA, label: "Moi" }]}
            onChange={setAssigneA}
            className="h-12 w-full text-body-s"
          />
        </ChampFiche>
      ) : null}
      {pourMoi ? (
        <ChampFiche id={`${id}-categorie`} libelle="Catégorie">
          {categories !== null ? (
            <ListeDeroulante libelle="Catégorie" value={liste} options={optionsCategories} onChange={setListe} className="h-12 w-full text-body-s" />
          ) : (
            <>
              <p className="text-body-s text-texte-secondaire">Les catégories sont sur {sur}.</p>
              <NotePoste />
            </>
          )}
        </ChampFiche>
      ) : null}
      <ChampFiche id={`${id}-notes`} libelle="Notes">
        <textarea
          id={`${id}-notes`}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="min-h-24 w-full rounded-md border border-bordure-champ bg-fond-surface px-3 py-2 text-body-s text-texte-principal [field-sizing:content]"
        />
      </ChampFiche>
      {rappel && createur ? (
        <Bouton
          variant="discret"
          taille="md"
          className="self-start text-texte-erreur"
          disabled={occupe || bloque}
          iconeGauche={<Icon name="trash-01" size={20} />}
          onClick={() => onSupprimer(rappel)}
        >
          Supprimer
        </Bouton>
      ) : null}
    </PageFiche>
  );
}
