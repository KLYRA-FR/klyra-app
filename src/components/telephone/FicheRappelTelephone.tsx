"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Icon } from "@/components/icons/Icon";
import { PastilleCategorie } from "@/components/planning/Rappels";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { cn } from "@/lib/cn";
import { messageErreur, useEquipe } from "@/lib/compte";
import { aujourdhui, libelleEcheance } from "@/lib/dates";
import { texteErreurPoste } from "@/lib/poste-texte";
import { echeanceLocale } from "@/lib/rappel-compte";
import type { RappelTelephone } from "@/lib/telephone/planning";
import { RondAgent, useCartes } from "./AgentsChat";
import { useAnnonce } from "./Annonce";
import { usePlanningTelephone } from "./ContextePlanningTelephone";
import { feuilleConfier, texteConfie } from "./RappelsTelephone";
import { CHAMP_TELEPHONE, ChampFiche, ErreurFiche, FeuilleChoixFiche, LigneChoixFiche, LigneDateFiche, NoteEnregistrement, PageFiche, RaisonFiche } from "./FichePlanningTelephone";
import { BandeauVueGardee } from "./etats";
import { GroupeListe, LigneListe, TuileIcone } from "./Liste";

type Priorite = RappelTelephone["priorite"];
const URGENCES: { valeur: Priorite; texte: string; libelle: string }[] = [
  { valeur: 0, texte: "Aucune", libelle: "Aucune" },
  { valeur: 1, texte: "!", libelle: "Basse" },
  { valeur: 2, texte: "!!", libelle: "Moyenne" },
  { valeur: 3, texte: "!!!", libelle: "Haute" },
];

/**
 * Un rappel en page pleine (E3-31 à E3-36). Mêmes droits qu'au bureau : la personne qui l'a créé change
 * tout et le supprime ; celle à qui il est assigné change ses notes et sa catégorie, et la raison est
 * écrite en tête. Un nouveau rappel va dans le compte. Un rappel de l'ordinateur s'écrit sur le poste ;
 * lu dans sa vue gardée, tout est en lecture. Hors ligne, les saisies restent, Enregistrer attend.
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
  const { moiId, categories, noms, posteOuvert, horsLigne, gardeeLe, surPoste, sur, modifierCategorie, aUnPoste, confier, confieDe } = usePlanningTelephone();
  const { cartes, nom } = useCartes();
  const annoncer = useAnnonce();
  const router = useRouter();
  const [agentChoisi, setAgentChoisi] = useState<string | null>(null);
  const confie = rappel ? confieDe(rappel) : null;
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
  const champTitre = useRef<HTMLInputElement>(null);
  const [feuille, setFeuille] = useState<"assigne" | "categorie" | "agent" | null>(null);
  const bloque = surLePoste && !posteOuvert;
  /* La catégorie n'a de sens que pour soi : un rappel assigné à quelqu'un d'autre n'en a pas. */
  const pourMoi = surLePoste || assigneA === moiId;
  const nomCreateur = rappel?.recu && rappel.autre ? (noms.get(rappel.autre) ?? "quelqu’un") : null;

  useEffect(() => {
    if (champ !== "jour") return;
    champJour.current?.focus();
    /* « Planifier… » ouvre le sélecteur de date, quand le navigateur le permet sans geste. */
    try {
      champJour.current?.showPicker();
    } catch {
      /* Le focus reste sur la ligne ; un toucher l'ouvre. */
    }
  }, [champ]);

  const enregistrer = async () => {
    const trouvees: typeof erreurs = {};
    if (!titre.trim()) trouvees.titre = "Donne un titre au rappel.";
    if (jour && fin && fin <= jour) trouvees.fin = "Le dernier jour doit suivre le premier.";
    setErreurs(trouvees);
    if (trouvees.titre) champTitre.current?.focus();
    if (Object.keys(trouvees).length > 0 || occupe || bloque || horsLigne) return;
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
      else setErreur(texteErreurPoste(resultat, sur));
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
        /* Le rappel est créé, quoi qu'il arrive à l'attribution : il n'est jamais recréé (contrat, règle 5). */
        if (agentChoisi) {
          const echec = await confier({ source: "compte", id: nouveau }, agentChoisi);
          if (echec) annoncer({ texte: "Rappel ajouté, attribution à réessayer", erreur: true });
          else if (!posteOuvert) annoncer({ texte: `${nom(agentChoisi)} s’y mettra à l’ouverture de ${sur}`, icone: "clock-backward" });
        }
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

  const optionsCategories = [
    ...(surLePoste ? [] : [{ valeur: "", libelle: rappel?.recu ? "Assignés par l’équipe" : "Sans catégorie" }]),
    ...(categories ?? []).map((c) => ({ valeur: c.id, libelle: c.nom, visuel: <PastilleCategorie categorie={c} taille={28} /> })),
  ];
  const optionsMembres = (membres ?? []).map((m) => ({ valeur: m._id as string, libelle: m._id === moiId ? `${m.nom} (moi)` : m.nom }));
  const nomMembre = assigneA === moiId ? "Moi" : (noms.get(assigneA) ?? "Quelqu’un");
  const nomCategorie = optionsCategories.find((o) => o.valeur === liste)?.libelle ?? "Sans catégorie";
  const verrou = !createur;
  const urgence = URGENCES.find((u) => u.valeur === priorite) ?? URGENCES[0];
  /* Des champs saisis et pas enregistrés : ✕ et le retour demandent d'abord (E3-36). */
  const modifie =
    titre !== (rappel?.titre ?? "") ||
    jour !== (rappel?.jour ?? "") ||
    fin !== (rappel?.fin ?? "") ||
    heure !== (rappel?.heure ?? "") ||
    priorite !== (rappel?.priorite ?? 0) ||
    notes !== (rappel?.notes ?? "") ||
    (rappel !== null && liste !== (rappel.liste ?? "")) ||
    (rappel !== null && !surLePoste && assigneA !== (rappel.assigneA ?? ""));

  return (
    <PageFiche
      titre={rappel ? "Rappel" : "Nouveau rappel"}
      modifie={modifie && !bloque}
      onRetour={() => onFermer()}
      onEnregistrer={() => void enregistrer()}
      pied={
        <>
          <BoutonPrincipal type="submit" disabled={occupe || bloque || horsLigne} className="w-full justify-between">
            {rappel ? "Enregistrer" : "Ajouter"}
          </BoutonPrincipal>
          <NoteEnregistrement horsLigne={horsLigne} poste={bloque} />
          <ErreurFiche texte={erreur} />
        </>
      }
    >
      {bloque && gardeeLe !== null ? <BandeauVueGardee lu={gardeeLe} /> : null}
      {nomCreateur ? <RaisonFiche>Par {nomCreateur}. Seul qui a créé le rappel peut changer le titre, la date et l’urgence.</RaisonFiche> : null}
      <fieldset disabled={bloque} className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0">
        <ChampFiche id={`${id}-titre`} libelle="Rappel" erreur={erreurs.titre}>
          <input
            ref={champTitre}
            id={`${id}-titre`}
            value={titre}
            placeholder="Nouveau rappel"
            autoFocus={!rappel}
            disabled={verrou}
            onChange={(e) => setTitre(e.target.value)}
            aria-invalid={erreurs.titre ? true : undefined}
            aria-describedby={erreurs.titre ? `${id}-titre-erreur` : undefined}
            className={cn(CHAMP_TELEPHONE, verrou && "bg-fond-surface-grise")}
          />
        </ChampFiche>
        <GroupeListe>
          <LigneDateFiche
            libelle="Date"
            icone="calendar-01"
            type="date"
            champ={champJour}
            valeur={jour}
            affichage={jour ? libelleEcheance(jour, null) : null}
            vide="Aucune"
            disabled={verrou || bloque}
            actif={!!rappel?.retard && !rappel.faite}
            onChange={(v) => {
              setJour(v);
              if (!v) {
                setHeure("");
                setFin("");
              }
            }}
          />
          {jour ? (
            <LigneDateFiche libelle="Jusqu’au" icone="calendar-01" type="date" valeur={fin} min={jour} affichage={fin ? libelleEcheance(fin, null) : null} vide="Facultatif" disabled={verrou || bloque} erreur={erreurs.fin} onChange={setFin} />
          ) : null}
          <LigneDateFiche
            libelle="Heure"
            icone="clock-01"
            type="time"
            valeur={heure}
            affichage={heure || null}
            vide="Aucune"
            disabled={verrou || bloque}
            onChange={(v) => {
              setHeure(v);
              /* Une heure sans date : aujourd'hui, comme au bureau. */
              if (v && !jour) setJour(aujourdhui());
            }}
          />
          {verrou || bloque ? <LigneChoixFiche libelle="Urgence" icone="star-01" valeur={`${urgence.libelle}${urgence.valeur ? ` ${urgence.texte}` : ""}`} disabled onClick={() => undefined} /> : null}
        </GroupeListe>
        {verrou || bloque ? null : (
          <div className="flex flex-col gap-1">
            <span id={`${id}-urgence`} className="text-ui font-medium text-texte-principal">
              Urgence
            </span>
            <div role="radiogroup" aria-labelledby={`${id}-urgence`} className="grid grid-cols-4 gap-0.5 rounded-md bg-fond-surface-grise p-0.5">
              {URGENCES.map((u) => (
                <button
                  key={u.valeur}
                  type="button"
                  role="radio"
                  aria-checked={priorite === u.valeur}
                  aria-label={u.libelle}
                  onClick={() => setPriorite(u.valeur)}
                  className={cn("min-h-11 rounded-sm text-ui font-medium transition-colors duration-[120ms] ease-sortie", priorite === u.valeur ? "bg-fond-surface text-texte-principal shadow-ombre-xs" : "text-texte-secondaire")}
                >
                  {u.texte}
                </button>
              ))}
            </div>
          </div>
        )}
        <GroupeListe>
          {rappel?.source !== "poste" && (createur || rappel === null) ? <LigneChoixFiche libelle="Assigner à" icone="user-profile-01" valeur={nomMembre} onClick={() => setFeuille("assigne")} /> : null}
          {pourMoi ? (
            categories !== null ? (
              <LigneChoixFiche libelle="Catégorie" icone="folder" valeur={nomCategorie} disabled={bloque} onClick={() => setFeuille("categorie")} />
            ) : (
              <LigneChoixFiche libelle="Catégorie" icone="folder" valeur={rappel?.recu ? "Assignés par l’équipe" : "Sans catégorie"} note={`Les catégories sont sur ${sur}`} disabled onClick={() => undefined} />
            )
          ) : null}
          {rappel?.faite ? null : confie?.etat === "confie" && confie.fil ? (
            <LigneListe
              retrait="tuile"
              debut={<TuileIcone icone="users-profiles-01" />}
              nom={`Confié à ${nom(confie.roleId)}`}
              ligne2="Ticket en cours · voir le ticket"
              fin={
                <span className="flex shrink-0 items-center gap-2">
                  <RondAgent id={confie.roleId} taille={28} />
                  <Icon name="chevron-right" size={20} className="text-icone-secondaire" />
                </span>
              }
              onClick={() => router.push(`/tickets?id=${encodeURIComponent(confie.fil as string)}`)}
            />
          ) : (
            <LigneChoixFiche
              libelle="Confier à un agent"
              icone="users-profiles-01"
              valeur={confie ? "" : agentChoisi ? nom(agentChoisi) : "Personne"}
              note={confie ? texteConfie(confie, nom(confie.roleId), sur, posteOuvert).texte : !aUnPoste ? "Possible quand un ordinateur est relié à ton compte" : undefined}
              disabled={bloque || horsLigne || !aUnPoste || confie?.etat === "attente"}
              onClick={() => setFeuille("agent")}
            />
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
        {rappel && createur && !bloque ? (
          <Bouton variant="discret" taille="md" className="self-start text-texte-erreur" disabled={occupe || bloque || horsLigne} iconeGauche={<Icon name="trash-01" size={20} />} onClick={() => onSupprimer(rappel)}>
            Supprimer
          </Bouton>
        ) : null}
      </fieldset>
      {feuille === "assigne" ? (
        <FeuilleChoixFiche titre="Assigner à" options={optionsMembres.length > 0 ? optionsMembres : [{ valeur: assigneA, libelle: "Moi" }]} valeur={assigneA} onChoisir={setAssigneA} onFermer={() => setFeuille(null)} />
      ) : null}
      {feuille === "agent" && rappel ? feuilleConfier(rappel, () => setFeuille(null)) : null}
      {feuille === "agent" && !rappel ? (
        <FeuilleChoixFiche
          titre="Confier à un agent"
          options={[{ valeur: "", libelle: "Personne" }, ...(cartes ?? []).filter((c) => c.actif).map((c) => ({ valeur: c.origine, libelle: c.nom, visuel: <RondAgent id={c.origine} taille={36} /> }))]}
          valeur={agentChoisi ?? ""}
          onChoisir={(v) => setAgentChoisi(v || null)}
          onFermer={() => setFeuille(null)}
          note="Le rappel reste ici, marqué « Confié à … ». Il se coche quand tu valides son ticket."
        />
      ) : null}
      {feuille === "categorie" ? (
        <FeuilleChoixFiche
          titre="Catégorie"
          options={optionsCategories}
          valeur={liste}
          onChoisir={setListe}
          onFermer={() => setFeuille(null)}
          apres={
            posteOuvert && !horsLigne ? (
              <button
                type="button"
                className="mt-1 flex min-h-[52px] w-full items-center gap-3 px-1 text-left text-body-s text-texte-principal"
                onClick={() => {
                  setFeuille(null);
                  modifierCategorie(null);
                }}
              >
                <Icon name="plus-01" size={20} className="shrink-0 text-icone-secondaire" />
                Nouvelle catégorie…
              </button>
            ) : null
          }
        />
      ) : null}
    </PageFiche>
  );
}
