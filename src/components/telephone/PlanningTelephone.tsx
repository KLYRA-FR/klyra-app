"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Icon } from "@/components/icons/Icon";
import { eclairerEcheance } from "@/components/planning/MenuReporter";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { Onglets } from "@/components/ui/Onglets";
import { messageErreur, useCompte, useEquipe } from "@/lib/compte";
import { aujourdhui as cleAujourdhui, depuisCle, libellePeriode } from "@/lib/dates";
import { useGestePoste, useLecturePoste, type LecturePoste, type ResultatPoste } from "@/lib/poste/client";
import type { DepartRoutine, PlanningDuPoste } from "@/lib/poste/gestes/planning";
import { texteErreurPoste } from "@/lib/poste-texte";
import type { Report } from "@/lib/report";
import { jouer } from "@/lib/sons/sons";
import {
  depuisCompte,
  depuisPoste,
  fenetreAgenda,
  placerDepart,
  reportCompte,
  sectionsRappels,
  type RappelTelephone,
  type VueAgenda,
} from "@/lib/telephone/planning";
import type { Categorie } from "@/types/domain";
import { AgendaPlanningTelephone } from "./AgendaPlanningTelephone";
import { ContextePlanning, LignePoste, type ElementAgenda, type EvenementTelephone, type PlanningTelephoneApi } from "./ContextePlanningTelephone";
import { EnteteTelephone } from "./EnteteTelephone";
import { FicheEvenementTelephone } from "./FicheEvenementTelephone";
import { PageFiche } from "./FichePlanningTelephone";
import { FicheRappelTelephone } from "./FicheRappelTelephone";
import { FeuilleCategorie, MenuRappels, RappelsTelephone } from "./RappelsTelephone";
import { usePostes, useSupport } from "./poste";
import { ONGLETS_TELEPHONE } from "./CommunAgentsTelephone";

type Onglet = "agenda" | "rappels";

/** Le temps pour annuler une suppression, comme `MessageSuppression` au bureau. */
const ANNULATION_MS = 8000;
const BANDEAU_MS = 3000;

const titreCourt = (titre: string) => (titre.length > 60 ? `${titre.slice(0, 59)}…` : titre);

function texteResultat(resultat: ResultatPoste<unknown>, sur: string): string {
  return resultat.ok ? "" : texteErreurPoste(resultat, sur);
}

/**
 * T-05 à T-07, le Planning du téléphone. Tout ce qui est dans le compte (rappels assignés, calendrier
 * commun, Weekly) se lit et s'écrit en ligne, ordinateur fermé compris. Ce qui reste sur
 * l'ordinateur (catégories, rappels et événements de cet ordinateur, départs des routines) passe
 * par les gestes `planning.*` du poste, et n'apparaît que quand il est ouvert.
 * Onglet et page pleine dans l'adresse (`?onglet=rappels`, `?fiche=rappel&id=…`) : le retour du
 * système ferme T-07.
 */
export function PlanningTelephone() {
  const router = useRouter();
  const params = useSearchParams();
  const onglet: Onglet = params.get("onglet") === "rappels" ? "rappels" : "agenda";
  const fiche = params.get("fiche");
  const ficheId = params.get("id");
  const ficheSource = params.get("source") === "poste" ? "poste" : "compte";

  const [vue, setVue] = useState<VueAgenda>("jour");
  const [jour, setJour] = useState(cleAujourdhui);
  const [aujourdhui, setAujourdhui] = useState(cleAujourdhui);
  const [voirFaits, setVoirFaits] = useState(false);
  const [menu, setMenu] = useState(false);
  const [categorieEditee, setCategorieEditee] = useState<Categorie | "nouvelle" | null>(null);
  const [gardes, setGardes] = useState<ReadonlySet<string>>(() => new Set());
  const [occupes, setOccupes] = useState<ReadonlySet<string>>(() => new Set());

  const { moi } = useCompte();
  const moiId = moi?._id ?? null;
  const { ouvert } = usePostes();
  const sur = useSupport();
  const fenetre = useMemo(() => fenetreAgenda(vue, jour), [vue, jour]);
  const occurrences = useQuery(api.evenements.entre, fenetre);
  const mes = useQuery(api.rappels.mes, {});
  const assignes = useQuery(api.rappels.assignes, {});
  const agents = useQuery(api.conversationsCompte.agents, {});
  const { membres } = useEquipe(false);
  const modifierRappel = useMutation(api.rappels.modifier);
  const supprimerRappel = useMutation(api.rappels.supprimer);
  const assurerWeekly = useMutation(api.evenements.assurerWeekly);
  const poste = useLecturePoste<PlanningDuPoste>("planning.lire", {});
  const fenetreDeparts = useMemo(() => ({ debut: depuisCle(fenetre.debut).toISOString(), fin: depuisCle(fenetre.fin).toISOString() }), [fenetre]);
  const departs = useLecturePoste<DepartRoutine[]>("planning.departs", onglet === "agenda" && vue !== "mois" ? fenetreDeparts : null);
  const { faire } = useGestePoste();
  const { relancer: relirePoste } = poste;
  const { relancer: relireDeparts } = departs;
  /* Ordinateur fermé : sa dernière vue lue sur ce téléphone (socle § 5.4), en lecture seule. */
  const vueGardee = poste.etat === "ferme" ? poste.gardee : null;
  const donnees = poste.etat === "ok" ? poste.data : (vueGardee?.data ?? null);

  /* Le Weekly existe dans le compte même si aucun ordinateur ne l'a encore créé, comme au bureau. */
  useEffect(() => {
    void assurerWeekly({}).catch(() => {
      /* Le prochain affichage réessaie. */
    });
  }, [assurerWeekly]);

  /* Minuit passe : « aujourd'hui » suit. De retour dans l'app : l'ordinateur est relu (pas d'abonnement à son planning). */
  useEffect(() => {
    const horloge = setInterval(() => setAujourdhui(cleAujourdhui()), 60_000);
    const retour = () => {
      if (document.visibilityState !== "visible") return;
      setAujourdhui(cleAujourdhui());
      relirePoste();
      relireDeparts();
    };
    document.addEventListener("visibilitychange", retour);
    return () => {
      clearInterval(horloge);
      document.removeEventListener("visibilitychange", retour);
    };
  }, [relirePoste, relireDeparts]);

  /* ─── Bandeau bas (« Rappel reporté : … ») ─── */

  const [bandeau, setBandeau] = useState<string | null>(null);
  useEffect(() => {
    if (!bandeau) return;
    const minuteur = setTimeout(() => setBandeau(null), BANDEAU_MS);
    return () => clearTimeout(minuteur);
  }, [bandeau]);

  /* Cochés sur un rappel de l'ordinateur : affichés tout de suite, jusqu'à la lecture suivante. */
  const [coches, setCoches] = useState<{ pour: PlanningDuPoste | null; faites: ReadonlyMap<string, boolean> }>({ pour: null, faites: new Map() });
  const faitesIci = coches.pour !== null && coches.pour === donnees ? coches.faites : null;

  const surPoste = useCallback(
    async <T,>(type: string, args: unknown): Promise<ResultatPoste<T>> => {
      const resultat = await faire<T>(type, args);
      if (resultat.ok) relirePoste();
      return resultat;
    },
    [faire, relirePoste],
  );

  /* ─── Suppression d'un rappel : cachée tout de suite, écrite après le délai d'annulation ─── */

  const [enSuppression, setEnSuppression] = useState<RappelTelephone | null>(null);
  const suppression = useRef<{ rappel: RappelTelephone; minuteur: ReturnType<typeof setTimeout> } | null>(null);
  const confirmerSuppression = useCallback(() => {
    const enCours = suppression.current;
    if (!enCours) return;
    clearTimeout(enCours.minuteur);
    suppression.current = null;
    setEnSuppression(null);
    const { rappel } = enCours;
    if (rappel.source === "compte") {
      void supprimerRappel({ rappelId: rappel.id as Id<"rappels"> }).catch((err: unknown) => setBandeau(messageErreur(err)));
    } else {
      void surPoste("planning.supprimerRappel", { id: rappel.id }).then((r) => {
        if (!r.ok) setBandeau(texteResultat(r, sur));
      });
    }
  }, [supprimerRappel, surPoste, sur]);
  const confirmerRef = useRef(confirmerSuppression);
  useEffect(() => {
    confirmerRef.current = confirmerSuppression;
  });
  /* Quitter l'écran pendant le délai : la suppression part quand même. */
  useEffect(() => () => confirmerRef.current(), []);

  const supprimer = (rappel: RappelTelephone) => {
    confirmerRef.current();
    suppression.current = { rappel, minuteur: setTimeout(() => confirmerRef.current(), ANNULATION_MS) };
    setEnSuppression(rappel);
    setBandeau(null);
  };
  const annulerSuppression = () => {
    const enCours = suppression.current;
    if (!enCours) return;
    clearTimeout(enCours.minuteur);
    suppression.current = null;
    setEnSuppression(null);
    setBandeau(`Rappel restauré : ${titreCourt(enCours.rappel.titre)}.`);
    eclairerEcheance(enCours.rappel.id);
  };

  /* ─── Les données, compte et ordinateur réunis ─── */

  const noms = useMemo(() => new Map((membres ?? []).map((m) => [m._id as string, m.nom])), [membres]);
  const rappelsMes = useMemo(() => {
    const origines = new Set((mes ?? []).flatMap((r) => (r.origineLocale ? [r.origineLocale] : [])));
    const liste = [
      ...(mes ?? []).map((r) => depuisCompte(r, moiId ?? "")),
      ...(donnees?.taches ?? []).filter((t) => !origines.has(t.id)).map(depuisPoste),
    ];
    return liste
      .filter((r) => r.id !== enSuppression?.id)
      .map((r) => (r.source === "poste" && faitesIci?.has(r.id) ? { ...r, faite: faitesIci.get(r.id) === true } : r));
  }, [mes, donnees, moiId, enSuppression, faitesIci]);
  const rappelsAssignes = useMemo(
    () => (assignes ?? []).map((r) => depuisCompte(r, moiId ?? "")).filter((r) => r.id !== enSuppression?.id),
    [assignes, moiId, enSuppression],
  );
  const categories = donnees?.categories ?? null;
  /* Vue gardée (S-22) : le compte d'abord, puis ce que l'ordinateur gardait, à part et daté. */
  /* Vue gardée : les catégories de l'ordinateur ne rangent plus les rappels du compte (des catégories vides). */
  const sections = sectionsRappels({
    mes: vueGardee ? rappelsMes.filter((r) => r.source === "compte") : rappelsMes,
    assignes: rappelsAssignes,
    categories: vueGardee ? null : categories,
    voirFaits,
    gardes,
  });
  const surPosteGarde = vueGardee
    ? { lu: vueGardee.lu, rappels: sectionsRappels({ mes: rappelsMes.filter((r) => r.source === "poste"), assignes: [], categories: null, voirFaits, gardes }).flatMap((s) => s.rappels) }
    : null;
  const aFaire = rappelsMes.filter((r) => !r.faite).length;
  const faits = [...rappelsMes, ...rappelsAssignes].filter((r) => r.faite).length;

  const elements = useMemo((): ElementAgenda[] => {
    const nomsAgents = new Map((agents ?? []).map((a) => [a.origine, a.nom]));
    const duCompte = (occurrences ?? []).map(
      (o): ElementAgenda => ({
        cle: o.id,
        genre: "evenement",
        titre: o.titre,
        jour: o.jour,
        debut: o.jourEntier ? null : o.debut,
        fin: o.jourEntier ? null : o.fin,
        detail: o.touteEquipe ? "Toute l’équipe" : o.organisateur !== moiId ? `Par ${noms.get(o.organisateur) ?? "quelqu’un"}` : null,
        eclairage: o.evenementId,
        /* Le Weekly et les événements des autres ne se modifient pas, comme au bureau. */
        evenement: o.modifiable ? { source: "compte", occurrence: o } : null,
      }),
    );
    const locaux = (donnees?.evenements ?? [])
      .filter((e) => e.date >= fenetre.debut && e.date < fenetre.fin && !e.equipe)
      .map(
        (e): ElementAgenda => ({
          cle: `poste-${e.id}`,
          genre: "evenement",
          titre: e.titre,
          jour: e.date,
          debut: e.debut,
          fin: e.debut ? e.fin : null,
          detail: null,
          eclairage: e.id,
          evenement: { source: "poste", evenement: e },
        }),
      );
    const routines = (departs.etat === "ok" ? departs.data : []).flatMap((d): ElementAgenda[] => {
      const place = placerDepart(d.at);
      if (!place) return [];
      return [{ cle: `depart-${d.routineId}-${d.at}`, genre: "depart", titre: d.nom, ...place, fin: null, detail: nomsAgents.get(d.agentId) ?? null, eclairage: null, evenement: null }];
    });
    return [...duCompte, ...locaux, ...routines];
  }, [occurrences, donnees, departs, agents, noms, moiId, fenetre]);

  /* ─── Navigation : T-07 dans l'adresse, pour que le retour du système la ferme ─── */

  const pousse = useRef(false);
  const aEclairer = useRef<string | null>(null);
  const adresse = (extra: Record<string, string> = {}) => {
    const p = new URLSearchParams();
    if (onglet === "rappels") p.set("onglet", "rappels");
    for (const [cle, valeur] of Object.entries(extra)) p.set(cle, valeur);
    const q = p.toString();
    return q ? `/planning?${q}` : "/planning";
  };
  const ouvrirFiche = (extra: Record<string, string>) => {
    pousse.current = true;
    router.push(adresse(extra));
  };
  const fermerFiche = (eclairage?: string) => {
    aEclairer.current = eclairage ?? null;
    if (pousse.current) {
      pousse.current = false;
      router.back();
    } else {
      router.replace(adresse());
    }
  };

  /* De retour sur la liste : l'élément enregistré s'éclaire à sa place (`data-echeance`). */
  useEffect(() => {
    /* Fermée par le retour du système : la prochaine fermeture ne revient pas en arrière une fois de trop. */
    if (!fiche) pousse.current = false;
    if (fiche || !aEclairer.current) return;
    const id = aEclairer.current;
    aEclairer.current = null;
    eclairerEcheance(id);
    requestAnimationFrame(() =>
      document.querySelector(`[data-echeance="${CSS.escape(id)}"]`)?.scrollIntoView({
        block: "nearest",
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      }),
    );
  }, [fiche]);

  /* ─── Les gestes sur un rappel ─── */

  const cocher = (rappel: RappelTelephone) => {
    const faite = !rappel.faite;
    if (faite) {
      jouer("validation");
      setGardes((avant) => new Set(avant).add(rappel.id));
    }
    if (rappel.source === "compte") {
      void modifierRappel({ rappelId: rappel.id as Id<"rappels">, fait: faite }).catch((err: unknown) => setBandeau(messageErreur(err)));
      return;
    }
    setCoches({ pour: donnees, faites: new Map(faitesIci ?? []).set(rappel.id, faite) });
    setOccupes((avant) => new Set(avant).add(rappel.id));
    void surPoste("planning.enregistrerRappel", {
      id: rappel.id,
      titre: rappel.titre,
      notes: rappel.notes,
      liste: rappel.liste,
      jour: rappel.jour,
      heure: rappel.heure,
      fin: rappel.fin,
      priorite: rappel.priorite,
      faite,
    }).then((resultat) => {
      setOccupes((avant) => {
        const apres = new Set(avant);
        apres.delete(rappel.id);
        return apres;
      });
      if (!resultat.ok) {
        setCoches({ pour: null, faites: new Map() });
        setBandeau(texteResultat(resultat, sur));
      }
    });
  };

  const reporter = (rappel: RappelTelephone, report: Report) => {
    const annoncer = (jourReporte: string, heure: string | null, fin: string | null) => {
      setBandeau(`Rappel ${rappel.jour ? "reporté" : "planifié"} : ${libellePeriode(jourReporte, heure, fin)}.`);
      eclairerEcheance(rappel.id);
    };
    if (rappel.source === "compte") {
      const e = reportCompte(rappel, report, new Date());
      void modifierRappel({ rappelId: rappel.id as Id<"rappels">, jour: e.jour, heure: e.heure, fin: e.fin, echeance: e.echeance })
        .then(() => annoncer(e.jour, e.heure, e.fin))
        .catch((err: unknown) => setBandeau(messageErreur(err)));
      return;
    }
    void surPoste<{ jour: string; heure: string | null; fin: string | null }>("planning.reporterRappel", { id: rappel.id, report }).then((r) => {
      if (r.ok) annoncer(r.data.jour, r.data.heure, r.data.fin);
      else setBandeau(texteResultat(r, sur));
    });
  };

  const ouvrirRappel = (rappel: RappelTelephone | null, champ?: "jour") =>
    ouvrirFiche(rappel ? { fiche: "rappel", id: rappel.id, source: rappel.source, ...(champ ? { champ } : {}) } : { fiche: "rappel" });
  const ouvrirEvenement = (evenement: EvenementTelephone | null) =>
    ouvrirFiche(
      evenement === null
        ? { fiche: "evenement" }
        : evenement.source === "compte"
          ? { fiche: "evenement", id: evenement.occurrence.id }
          : { fiche: "evenement", id: evenement.evenement.id, source: "poste" },
    );

  const contexte: PlanningTelephoneApi = {
    moiId,
    aujourdhui,
    sur,
    posteOuvert: ouvert,
    surPoste,
    categories,
    noms,
    gardes,
    occupes,
    cocher,
    reporter,
    ouvrirRappel,
    ouvrirEvenement,
    modifierCategorie: (categorie) => setCategorieEditee(categorie ?? "nouvelle"),
  };

  /* ─── T-07 : l'élément ouvert, relu dans les données à jour ─── */

  const charge = occurrences !== undefined && mes !== undefined && assignes !== undefined;
  const lectureFiche = ficheSource === "poste" ? poste : null;
  let page = null;
  if (fiche === "rappel") {
    const rappel = ficheId ? ([...rappelsMes, ...rappelsAssignes].find((r) => r.id === ficheId && r.source === ficheSource) ?? null) : null;
    page =
      ficheId !== null && rappel === null ? (
        <Introuvable charge={charge} texte="Ce rappel n’existe plus." lecture={lectureFiche} sur={sur} onRetour={() => fermerFiche()} />
      ) : (
        <FicheRappelTelephone
          key={ficheId ?? "nouveau"}
          rappel={rappel}
          champ={params.get("champ") === "jour" ? "jour" : undefined}
          onFermer={(enregistre) => fermerFiche(enregistre?.eclairage)}
          onSupprimer={(r) => {
            fermerFiche();
            supprimer(r);
          }}
        />
      );
  } else if (fiche === "evenement") {
    const local = ficheSource === "poste" ? donnees?.evenements.find((e) => e.id === ficheId) : undefined;
    const occurrence = ficheSource === "compte" ? occurrences?.find((o) => o.id === ficheId && o.modifiable) : undefined;
    const evenement: EvenementTelephone | null = local ? { source: "poste", evenement: local } : occurrence ? { source: "compte", occurrence } : null;
    page =
      ficheId !== null && evenement === null ? (
        <Introuvable charge={charge} texte="Cet événement n’existe plus." lecture={lectureFiche} sur={sur} onRetour={() => fermerFiche()} />
      ) : (
        <FicheEvenementTelephone
          key={ficheId ?? "nouveau"}
          evenement={evenement}
          jourParDefaut={jour}
          onFermer={(enregistre) => {
            if (enregistre) setJour(enregistre.jour);
            fermerFiche(enregistre?.eclairage);
          }}
        />
      );
  }

  return (
    <ContextePlanning.Provider value={contexte}>
      <div className="relative flex min-h-0 flex-1 flex-col">
        <EnteteTelephone
          titre={onglet === "rappels" ? (mes === undefined ? "Rappels" : `Rappels · ${aFaire} à faire`) : "Planning"}
          droite={
            onglet === "agenda" ? (
              <Bouton variant="discret" className="h-11" onClick={() => setJour(cleAujourdhui())}>
                Aujourd’hui
              </Bouton>
            ) : (
              <BoutonIcone taille="md" libelle="Options des rappels" icone={<Icon name="dot-horizontal" size={20} />} onClick={() => setMenu(true)} />
            )
          }
        />
        <div className="shrink-0 px-4 pb-2">
          <Onglets<Onglet>
            libelle="Planning"
            onglets={[
              { id: "agenda", label: "Agenda" },
              { id: "rappels", label: "Rappels" },
            ]}
            valeur={onglet}
            onChange={(o) => router.replace(o === "rappels" ? "/planning?onglet=rappels" : "/planning")}
            className={ONGLETS_TELEPHONE}
          />
        </div>

        {onglet === "agenda" ? (
          <AgendaPlanningTelephone
            vue={vue}
            jour={jour}
            onVue={setVue}
            onJour={setJour}
            elements={elements}
            rappels={rappelsMes}
            charge={charge}
            departs={departs}
            poste={poste}
          />
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-24">
            <RappelsTelephone
              sections={sections}
              charge={mes !== undefined && assignes !== undefined}
              toutLu={poste.etat === "ok" || poste.etat === "aucun"}
              surPoste={surPosteGarde}
            />
            {surPosteGarde ? null : <LignePoste lecture={poste} ferme={`Catégories et rappels gardés sur ${sur} : visibles quand il est ouvert`} sur={sur} />}
          </div>
        )}

        <Bouton
          variant="sombre"
          taille="md"
          iconeGauche={<Icon name="plus-01" size={20} />}
          onClick={() => (onglet === "rappels" ? ouvrirRappel(null) : ouvrirEvenement(null))}
          className="absolute right-4 bottom-4 shadow-ombre-flottante"
        >
          {onglet === "rappels" ? "Rappel" : "Événement"}
        </Bouton>

        {/* Au-dessus du bouton flottant et de la barre du bas. */}
        {enSuppression || bandeau ? (
          <div className="absolute inset-x-4 bottom-[70px] z-20 flex flex-col gap-2">
            {bandeau ? (
              <p role="status" className="rounded-md bg-texte-principal px-4 py-3 text-ui text-texte-inverse shadow-ombre-flottante">
                {bandeau}
              </p>
            ) : null}
            {enSuppression ? (
              <div role="status" className="flex items-center gap-3 rounded-md bg-texte-principal py-1 pr-1 pl-4 text-ui text-texte-inverse shadow-ombre-flottante">
                <span className="min-w-0 flex-1 truncate">Rappel supprimé</span>
                <button type="button" onClick={annulerSuppression} className="min-h-11 shrink-0 rounded-xs px-3 font-medium text-texte-inverse">
                  Annuler
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {menu ? <MenuRappels voirFaits={voirFaits} faits={faits} onVoirFaits={setVoirFaits} onFermer={() => setMenu(false)} /> : null}
        {categorieEditee ? (
          <FeuilleCategorie
            categorie={categorieEditee === "nouvelle" ? null : categorieEditee}
            nombre={categories?.length ?? 0}
            onFermer={() => setCategorieEditee(null)}
          />
        ) : null}
        {page}
      </div>
    </ContextePlanning.Provider>
  );
}

/** T-07 demandée pour un élément absent : encore en lecture, sur un ordinateur fermé, ou supprimé entre-temps. */
function Introuvable({
  charge,
  texte,
  lecture,
  sur,
  onRetour,
}: {
  charge: boolean;
  texte: string;
  lecture: (LecturePoste<unknown> & { relancer: () => void }) | null;
  sur: string;
  onRetour: () => void;
}) {
  return (
    <PageFiche titre="Planning" onRetour={onRetour} onEnregistrer={onRetour} pied={null}>
      {lecture && lecture.etat !== "ok" ? (
        <LignePoste lecture={lecture} ferme={`Ce qui est gardé sur ${sur} s’affiche quand il est ouvert.`} sur={sur} />
      ) : charge ? (
        <p className="text-body-s text-texte-principal">{texte}</p>
      ) : (
        <p className="text-ui text-texte-secondaire">Chargement…</p>
      )}
    </PageFiche>
  );
}
