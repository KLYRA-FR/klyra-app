"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante, type OptionListe } from "@/components/ui/ListeDeroulante";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { cn } from "@/lib/cn";
import { messageErreur, useCompte, useEquipe } from "@/lib/compte";
import { libellePeriode } from "@/lib/dates";
import { echeanceLocale, versImport } from "@/lib/rappel-compte";
import { jouer } from "@/lib/sons/sons";
import { notifierRappel } from "@/lib/workspace";
import type { Categorie, Tache } from "@/types/domain";

type RappelCompte = FunctionReturnType<typeof api.rappels.mes>[number];
type Vue = "mes" | "assignes";
type Priorite = RappelCompte["priorite"];

const CLE_MONTREES = "klyra.notifications.rappels";
const PLAFOND_MONTREES = 200;
const PLAFOND_POPUPS = 3;
const LOT = 100;

const TEXTE_NOTIFICATION = {
  assigne: "Rappel assigné",
  echeance: "Rappel en retard",
  fait: "Rappel terminé",
  modifie: "Rappel modifié",
} as const;

/** Les rappels du compte qui vont dans cette colonne. Ceux reçus sans catégorie restent dans la boîte. */
export function rappelsDansColonne(
  mes: RappelCompte[],
  moiId: Id<"membres">,
  categorieId: string,
  index: number,
  idsCategories: Set<string>,
): RappelCompte[] {
  return mes.filter((rappel) => {
    if (rappel.liste === categorieId) return true;
    const sansColonne = rappel.liste === null || !idsCategories.has(rappel.liste);
    return index === 0 && sansColonne && rappel.creePar === moiId;
  });
}

function lireMontrees(): string[] {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_MONTREES) ?? "[]") as unknown;
    return Array.isArray(brut) ? brut.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function ecrireMontrees(ids: Iterable<string>) {
  try {
    localStorage.setItem(CLE_MONTREES, JSON.stringify([...ids].slice(-PLAFOND_MONTREES)));
  } catch {
    /* Un stockage plein n'empêche pas de lire les rappels. */
  }
}

/**
 * Rappels du compte, dans l'écran Rappels : les miens (à côté des colonnes locales)
 * et ceux que j'ai assignés. La copie locale n'est pas effacée.
 */
export function RappelsCompte({
  categories,
  idsCategories,
  tachesLocales,
  voirFaits,
  onMasques,
  children,
}: {
  categories: Categorie[];
  idsCategories: Set<string>;
  tachesLocales: Tache[];
  voirFaits: boolean;
  onMasques: (ids: ReadonlySet<string>) => void;
  children: (mes: RappelCompte[]) => ReactNode;
}) {
  const { moi } = useCompte();
  const { membres } = useEquipe(false);
  const mes = useQuery(api.rappels.mes, {});
  const assignes = useQuery(api.rappels.assignes, {});
  const notifications = useQuery(api.rappels.notifications, {});
  const creer = useMutation(api.rappels.creer);
  const importer = useMutation(api.rappels.importer);
  const marquerLues = useMutation(api.rappels.marquerLues);
  const [vue, setVue] = useState<Vue>("mes");
  const [listeOuverte, setListeOuverte] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [bilan, setBilan] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  const origines = useMemo(() => {
    const ids = new Set<string>();
    for (const rappel of mes ?? []) if (rappel.origineLocale) ids.add(rappel.origineLocale);
    return ids;
  }, [mes]);

  const cleOrigines = useMemo(() => [...origines].sort().join("\0"), [origines]);
  useEffect(() => {
    if (mes === undefined) return;
    onMasques(new Set(cleOrigines ? cleOrigines.split("\0") : []));
  }, [mes, cleOrigines, onMasques]);

  useEffect(() => {
    if (!notifications) return;
    const montrees = new Set(lireMontrees());
    const fraiches = notifications.liste.filter((n) => !n.lue && !montrees.has(n._id)).slice(0, PLAFOND_POPUPS);
    if (fraiches.length === 0) return;
    for (const notification of fraiches) {
      notifierRappel(TEXTE_NOTIFICATION[notification.type], notification.titre);
      montrees.add(notification._id);
    }
    ecrireMontrees(montrees);
  }, [notifications]);

  const aImporter = useMemo(
    () => tachesLocales.flatMap((tache) => {
      if (origines.has(tache.id)) return [];
      const entree = versImport(tache);
      return entree ? [entree] : [];
    }),
    [tachesLocales, origines],
  );

  const moiId = moi?._id ?? null;
  const recus = (mes ?? []).filter((rappel) => moiId !== null && rappel.creePar !== moiId && (rappel.liste === null || !idsCategories.has(rappel.liste)));
  const aFaireMes = (mes ?? []).filter((rappel) => rappel.statut !== "fait").length;
  const aFaireAssignes = (assignes ?? []).filter((rappel) => rappel.statut !== "fait").length;

  const agir = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setErreur(null);
      return true;
    } catch (e) {
      setErreur(messageErreur(e));
      return false;
    }
  };

  const mettreDansLeCompte = async () => {
    setEnvoi(true);
    setErreur(null);
    try {
      let ajoutes = 0;
      let deja = 0;
      for (let i = 0; i < aImporter.length; i += LOT) {
        const resultat = await importer({ lot: aImporter.slice(i, i + LOT) });
        ajoutes += resultat.ajoutes;
        deja += resultat.deja;
      }
      setBilan(`${ajoutes} mis dans le compte${deja > 0 ? `, ${deja} déjà là` : ""}.`);
    } catch (e) {
      setErreur(messageErreur(e));
    } finally {
      setEnvoi(false);
    }
  };

  const ouvrirNotifications = () => {
    setListeOuverte((ouverte) => !ouverte);
    if (!listeOuverte && (notifications?.nonLues ?? 0) > 0) {
      void marquerLues({}).catch((e: unknown) => setErreur(messageErreur(e)));
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {aImporter.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-bordure-subtile bg-fond-surface px-3 py-2">
          <p className="m-0 min-w-0 flex-1 text-ui-s text-texte-secondaire">
            {aImporter.length === 1
              ? "Un rappel de cet ordinateur peut rejoindre ton compte. La copie reste ici."
              : `${aImporter.length} rappels de cet ordinateur peuvent rejoindre ton compte. La copie reste ici.`}
          </p>
          <Bouton variant="sombre" taille="compact" disabled={envoi || mes === undefined} onClick={() => void mettreDansLeCompte()}>
            {envoi ? "Envoi…" : "Les mettre dans mon compte"}
          </Bouton>
        </div>
      )}
      {bilan && <p className="m-0 text-ui-xs text-texte-tertiaire">{bilan}</p>}
      {erreur && (
        <p role="alert" className="m-0 text-ui-s text-texte-erreur">
          {erreur}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Interrupteur actif={vue === "mes"} onClick={() => setVue("mes")}>
          Mes rappels{mes ? ` (${aFaireMes})` : ""}
        </Interrupteur>
        <Interrupteur actif={vue === "assignes"} onClick={() => setVue("assignes")}>
          Ceux que j’ai assignés{assignes ? ` (${aFaireAssignes})` : ""}
        </Interrupteur>
        <button
          type="button"
          onClick={ouvrirNotifications}
          aria-expanded={listeOuverte}
          aria-label={`Notifications${notifications ? `, ${notifications.nonLues} non lues` : ""}`}
          className="ml-auto flex h-8 cursor-pointer items-center gap-1.5 rounded-sm border border-bordure-subtile bg-fond-surface px-2.5 text-ui-xs text-texte-secondaire hover:border-bordure-forte"
        >
          <Icon name="bell-01" size={14} />
          {notifications?.nonLues ? notifications.nonLues : "Notifications"}
        </button>
      </div>

      {listeOuverte && (
        <ul className="m-0 flex list-none flex-col gap-1 rounded-lg border border-bordure-subtile bg-fond-surface p-2">
          {(notifications?.liste.length ?? 0) === 0 && <li className="px-1 py-1 text-ui-s text-texte-tertiaire">Aucune notification.</li>}
          {notifications?.liste.map((notification) => (
            <li key={notification._id} className={cn("px-1 py-1 text-ui-s", notification.lue ? "text-texte-tertiaire" : "text-texte-principal")}>
              {TEXTE_NOTIFICATION[notification.type]} : {notification.titre}
            </li>
          ))}
        </ul>
      )}

      {moiId && (
        <FormulaireRappel
          moiId={moiId}
          membres={membres}
          categories={categories}
          occupe={envoi}
          onCreer={(saisie) => agir(() => creer(saisie))}
        />
      )}

      {vue === "assignes" ? (
        <ListeRappels rappels={assignes ?? []} moiId={moiId} categories={categories} voirFaits={voirFaits} libelle="Ceux que j’ai assignés" />
      ) : (
        <div className="-mx-1 flex items-start gap-3 overflow-x-auto px-1 pb-2">
          <ColonneRecus rappels={recus} moiId={moiId} categories={categories} voirFaits={voirFaits} />
          {children(mes ?? [])}
        </div>
      )}
    </div>
  );
}

function Interrupteur({ actif, onClick, children }: { actif: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={actif}
      onClick={onClick}
      className={cn(
        "h-8 cursor-pointer rounded-sm border px-3 text-ui-s",
        actif ? "border-bleu-k1-500/40 bg-fond-surface text-texte-principal" : "border-transparent bg-transparent text-texte-secondaire hover:bg-fond-survol",
      )}
    >
      {children}
    </button>
  );
}

function FormulaireRappel({
  moiId,
  membres,
  categories,
  occupe,
  onCreer,
}: {
  moiId: Id<"membres">;
  membres: { _id: Id<"membres">; nom: string }[] | undefined;
  categories: Categorie[];
  occupe: boolean;
  onCreer: (saisie: {
    titre: string;
    notes: string;
    jour: string | null;
    heure: string | null;
    fin: string | null;
    echeance: number | null;
    priorite: Priorite;
    assigneA: Id<"membres">;
    liste: string | null;
  }) => Promise<boolean>;
}) {
  const [titre, setTitre] = useState("");
  const [notes, setNotes] = useState("");
  const [jour, setJour] = useState<string | null>(null);
  const [heure, setHeure] = useState<string | null>(null);
  const [fin, setFin] = useState<string | null>(null);
  const [priorite, setPriorite] = useState<Priorite>(0);
  const [assigneA, setAssigneA] = useState<Id<"membres">>(moiId);
  const [liste, setListe] = useState<string>(categories[0]?.id ?? "");
  const pourSoi = assigneA === moiId;
  const optionsMembres: OptionListe<string>[] = (membres ?? [{ _id: moiId, nom: "Moi" }]).map((membre) => ({
    value: membre._id,
    label: membre._id === moiId ? `${membre.nom} (moi)` : membre.nom,
  }));
  const optionsListes: OptionListe<string>[] = [
    { value: "", label: "Sans catégorie" },
    ...categories.map((categorie) => ({ value: categorie.id, label: categorie.nom })),
  ];

  const creer = () => {
    if (!titre.trim() || occupe) return;
    const finPropre = jour && fin && fin > jour ? fin : null;
    const heurePropre = jour ? heure : null;
    void onCreer({
      titre,
      notes,
      jour,
      heure: heurePropre,
      fin: finPropre,
      echeance: echeanceLocale(jour, heurePropre, finPropre),
      priorite,
      assigneA,
      liste: pourSoi && liste ? liste : null,
    }).then((ok) => {
      if (!ok) return;
      setTitre("");
      setNotes("");
      setJour(null);
      setHeure(null);
      setFin(null);
      setPriorite(0);
    });
  };

  const puce = "flex h-7 items-center gap-1.5 rounded-sm border border-bordure-subtile bg-fond-surface px-2 text-ui-xs text-texte-secondaire";
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-bordure-subtile bg-fond-surface px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        creer();
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={titre}
          onChange={(e) => setTitre(e.target.value)}
          placeholder="Nouveau rappel pour l’équipe"
          aria-label="Titre du rappel"
          className="h-8 min-w-[180px] flex-1 border-0 bg-transparent text-ui-s text-texte-principal outline-none placeholder:text-texte-tertiaire"
        />
        <ListeDeroulante
          libelle="Assigner à"
          variante="compact"
          options={optionsMembres}
          value={assigneA}
          onChange={(value) => setAssigneA(value as Id<"membres">)}
        />
        {pourSoi && (
          <ListeDeroulante libelle="Catégorie" variante="compact" options={optionsListes} value={liste} onChange={setListe} />
        )}
        <Bouton type="submit" variant="sombre" taille="compact" disabled={occupe || !titre.trim()}>
          Assigner
        </Bouton>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <label className={puce}>
          <Icon name="calendar-01" size={14} />
          <input
            type="date"
            value={jour ?? ""}
            aria-label="Date"
            onChange={(e) => setJour(e.target.value || null)}
            className="w-[112px] border-0 bg-transparent p-0 text-ui-xs text-inherit outline-none"
          />
        </label>
        <label className={puce}>
          <Icon name="clock-01" size={14} />
          <input
            type="time"
            value={heure ?? ""}
            aria-label="Heure"
            onChange={(e) => setHeure(e.target.value || null)}
            className="w-[60px] border-0 bg-transparent p-0 text-ui-xs text-inherit outline-none"
          />
        </label>
        <button
          type="button"
          onClick={() => setPriorite(((priorite + 1) % 4) as Priorite)}
          className={cn(puce, "cursor-pointer font-semibold", priorite > 0 && "border-bleu-k1-500/40 text-texte-accent")}
        >
          {priorite === 0 ? "Urgence" : "!".repeat(priorite)}
        </button>
        <input
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notes"
          aria-label="Notes"
          className="h-7 min-w-[120px] flex-1 border-0 bg-transparent text-ui-xs text-texte-secondaire outline-none placeholder:text-texte-tertiaire"
        />
      </div>
    </form>
  );
}

function ColonneRecus({
  rappels,
  moiId,
  categories,
  voirFaits,
}: {
  rappels: RappelCompte[];
  moiId: Id<"membres"> | null;
  categories: Categorie[];
  voirFaits: boolean;
}) {
  const aFaire = rappels.filter((rappel) => rappel.statut !== "fait");
  return (
    <section aria-label="Assignés par l’équipe" className="klyra-carte-flottante relative flex w-[300px] shrink-0 flex-col rounded-lg px-4 pt-3 pb-2">
      <header className="flex items-center gap-2.5 pb-1">
        <span aria-hidden="true" className="flex size-7 shrink-0 items-center justify-center rounded-full bg-fond-surface-grise text-icone-secondaire">
          <Icon name="users-profiles-01" size={16} />
        </span>
        <h3 className="m-0 min-w-0 flex-1 truncate text-ui font-semibold text-texte-principal">Assignés par l’équipe</h3>
        <span className="text-ui-s font-semibold text-texte-tertiaire">{aFaire.length}</span>
      </header>
      <ul className="m-0 flex list-none flex-col p-0">
        <LignesCompte rappels={rappels} moiId={moiId} categories={categories} voirFaits={voirFaits} />
      </ul>
    </section>
  );
}

function ListeRappels({
  rappels,
  moiId,
  categories,
  voirFaits,
  libelle,
}: {
  rappels: RappelCompte[];
  moiId: Id<"membres"> | null;
  categories: Categorie[];
  voirFaits: boolean;
  libelle: string;
}) {
  return (
    <section aria-label={libelle} className="klyra-carte-flottante rounded-lg px-4 pt-3 pb-2">
      <ul className="m-0 flex list-none flex-col p-0">
        {rappels.filter((rappel) => voirFaits || rappel.statut !== "fait").length === 0 && (
          <li className="py-2 text-ui-s text-texte-tertiaire">Aucun rappel assigné.</li>
        )}
        <LignesCompte rappels={rappels} moiId={moiId} categories={categories} voirFaits={voirFaits} />
      </ul>
    </section>
  );
}

export function LignesCompte({
  rappels,
  moiId,
  categories,
  voirFaits,
}: {
  rappels: RappelCompte[];
  moiId: Id<"membres"> | null;
  categories: Categorie[];
  voirFaits: boolean;
}) {
  const { membres } = useEquipe(false);
  const noms = new Map((membres ?? []).map((membre) => [membre._id, membre.nom]));
  const visibles = rappels.filter((rappel) => voirFaits || rappel.statut !== "fait");
  if (visibles.length === 0) return null;
  return (
    <>
      {visibles.map((rappel) => (
        <LigneCompte key={rappel._id} rappel={rappel} noms={noms} moiId={moiId} categories={categories} />
      ))}
    </>
  );
}

function LigneCompte({
  rappel,
  noms,
  moiId,
  categories,
}: {
  rappel: RappelCompte;
  noms: Map<string, string>;
  moiId: Id<"membres"> | null;
  categories: Categorie[];
}) {
  const modifier = useMutation(api.rappels.modifier);
  const supprimer = useMutation(api.rappels.supprimer);
  const [ouverte, setOuverte] = useState(false);
  const [titre, setTitre] = useState(rappel.titre);
  const [notes, setNotes] = useState(rappel.notes);
  const [erreur, setErreur] = useState<string | null>(null);
  const createur = moiId !== null && rappel.creePar === moiId;
  const assignee = moiId !== null && rappel.assigneA === moiId;
  const faite = rappel.statut === "fait";
  const autre = createur ? rappel.assigneA : rappel.creePar;
  const nomAutre = autre === moiId ? null : (noms.get(autre) ?? "quelqu’un");

  const agir = async (action: () => Promise<unknown>) => {
    try {
      await action();
      setErreur(null);
    } catch (e) {
      setErreur(messageErreur(e));
    }
  };

  const changerDate = (jour: string | null, heure: string | null, fin: string | null) => {
    const finPropre = jour && fin && fin > jour ? fin : null;
    const heurePropre = jour ? heure : null;
    void agir(() => modifier({
      rappelId: rappel._id,
      jour,
      heure: heurePropre,
      fin: finPropre,
      echeance: echeanceLocale(jour, heurePropre, finPropre),
    }));
  };

  return (
    <li className="group/rappel flex items-start gap-2.5 border-b border-bordure-subtile py-2 last:border-b-0">
      <button
        type="button"
        role="checkbox"
        aria-checked={faite}
        aria-label={faite ? `Rouvrir ${rappel.titre}` : `Terminer ${rappel.titre}`}
        onClick={() => {
          if (!faite) jouer("validation");
          void agir(() => modifier({ rappelId: rappel._id, fait: !faite }));
        }}
        className={cn(
          "mt-0.5 flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-full border-[1.5px] p-0",
          faite ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte bg-transparent hover:border-bleu-k1-500",
        )}
      >
        {faite && <Icon name="check-01" size={14} />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-start gap-1.5">
          {rappel.priorite > 0 && <span className="shrink-0 text-ui-s leading-5 font-semibold text-texte-accent">{"!".repeat(rappel.priorite)}</span>}
          {createur ? (
            <input
              value={titre}
              aria-label="Rappel"
              onChange={(e) => setTitre(e.target.value)}
              onBlur={() => titre.trim() && titre.trim() !== rappel.titre && void agir(() => modifier({ rappelId: rappel._id, titre: titre.trim() }))}
              className={cn(
                "min-w-0 flex-1 border-0 bg-transparent p-0 text-ui-s leading-5 outline-none",
                faite ? "text-texte-tertiaire line-through" : "text-texte-principal",
              )}
            />
          ) : (
            <p className={cn("m-0 min-w-0 flex-1 text-ui-s leading-5", faite ? "text-texte-tertiaire line-through" : "text-texte-principal")}>{rappel.titre}</p>
          )}
          <button
            type="button"
            onClick={() => setOuverte((o) => !o)}
            aria-label="Détails du rappel"
            aria-expanded={ouverte}
            className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-icone-secondaire opacity-0 group-hover/rappel:opacity-100 focus-visible:opacity-100 hover:bg-fond-survol"
          >
            <Icon name="dot-horizontal" size={16} />
          </button>
          {createur && (
            <button
              type="button"
              onClick={() => void agir(() => supprimer({ rappelId: rappel._id }))}
              aria-label={`Supprimer ${rappel.titre}`}
              className="flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-icone-secondaire opacity-0 group-hover/rappel:opacity-100 focus-visible:opacity-100 hover:bg-fond-survol"
            >
              <Icon name="trash-01" size={14} />
            </button>
          )}
        </div>
        {rappel.jour && (
          <span className={cn("-mx-1 self-start rounded-2xs px-1 text-ui-xs", rappel.statut === "en_retard" ? "font-medium text-texte-erreur" : "text-texte-tertiaire")}>
            {libellePeriode(rappel.jour, rappel.heure, rappel.fin)}
          </span>
        )}
        {nomAutre && (
          <span className="text-ui-xs text-texte-tertiaire">{createur ? `Assigné à ${nomAutre}` : `Par ${nomAutre}`}</span>
        )}
        {ouverte && (
          <div className="flex flex-col gap-1.5 pt-1">
            <textarea
              value={notes}
              aria-label="Notes"
              rows={2}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={() => notes.trim() !== rappel.notes && void agir(() => modifier({ rappelId: rappel._id, notes }))}
              className="resize-none rounded-sm border border-bordure-subtile bg-fond-surface px-2 py-1 text-ui-xs text-texte-principal outline-none"
            />
            {createur && (
              <div className="flex flex-wrap items-center gap-1.5">
                <input
                  type="date"
                  aria-label="Date"
                  value={rappel.jour ?? ""}
                  onChange={(e) => changerDate(e.target.value || null, rappel.heure, rappel.fin)}
                  className="h-7 rounded-sm border border-bordure-subtile bg-fond-surface px-2 text-ui-xs text-texte-secondaire"
                />
                <input
                  type="time"
                  aria-label="Heure"
                  value={rappel.heure ?? ""}
                  onChange={(e) => changerDate(rappel.jour, e.target.value || null, rappel.fin)}
                  className="h-7 rounded-sm border border-bordure-subtile bg-fond-surface px-2 text-ui-xs text-texte-secondaire"
                />
                <button
                  type="button"
                  onClick={() => void agir(() => modifier({ rappelId: rappel._id, priorite: ((rappel.priorite + 1) % 4) as Priorite }))}
                  className="h-7 cursor-pointer rounded-sm border border-bordure-subtile bg-fond-surface px-2 text-ui-xs font-semibold text-texte-secondaire"
                >
                  {rappel.priorite === 0 ? "Urgence" : "!".repeat(rappel.priorite)}
                </button>
                {membresOptions(noms, moiId, rappel.assigneA).length > 1 && (
                  <ListeDeroulante
                    libelle="Assigner à"
                    variante="compact"
                    options={membresOptions(noms, moiId, rappel.assigneA)}
                    value={rappel.assigneA}
                    onChange={(value) => void agir(() => modifier({ rappelId: rappel._id, assigneA: value as Id<"membres"> }))}
                  />
                )}
              </div>
            )}
            {assignee && (
              <ListeDeroulante
                libelle="Catégorie"
                variante="compact"
                options={[{ value: "", label: "Assignés par l’équipe" }, ...categories.map((categorie) => ({ value: categorie.id, label: categorie.nom }))]}
                value={rappel.liste ?? ""}
                onChange={(value) => void agir(() => modifier({ rappelId: rappel._id, liste: value || null }))}
              />
            )}
          </div>
        )}
        {erreur && <span className="text-ui-xs text-texte-erreur">{erreur}</span>}
      </div>
    </li>
  );
}

function membresOptions(noms: Map<string, string>, moiId: Id<"membres"> | null, actuel: Id<"membres">): OptionListe<string>[] {
  const ids = new Set(noms.keys());
  ids.add(actuel);
  return [...ids].map((id) => ({ value: id, label: id === moiId ? "Moi" : (noms.get(id) ?? "quelqu’un") }));
}
