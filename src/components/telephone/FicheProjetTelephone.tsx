"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import type { LecturePoste } from "@/lib/poste/client";
import { libelleStatut, tonStatut } from "@/lib/telephone/dossiers";
import { ilYa, jourCourt, ligneTravail, quandLisible, type FicheProjet, type SuiviTravail, type TravailFiche } from "@/lib/telephone/fiche-projet";
import { RondAgent } from "./AgentsChat";
import { Feuille } from "./Feuille";
import { Bandeau, DemandeEnCours, EtatEcran, LectureGardee, useMaintenant, VueLecture } from "./etats";
import { Etiquette, GroupeListe, LigneListe, SectionListe, TuileIcone } from "./Liste";
import { useSupport } from "./poste";
import { useTirerPourRelire } from "./TirerPourRelire";

/**
 * L'onglet Projet (E6-08 à E6-12) : la carte vient du compte et s'affiche tout de suite ; le brief, les
 * agents et les travaux viennent de l'ordinateur, chacun dans sa zone. Ordinateur fermé : la dernière
 * fiche lue sur ce téléphone. Une section absente du contrat est dite indisponible, jamais « aucune ».
 */

export interface CarteProjetLue {
  origine: string;
  nom: string;
  accroche: string;
  statut: string;
  epingle: boolean;
}

const FERME = (sur: string) => `le brief, les agents et les travaux de ce projet sont sur ${sur}. Ils s’affichent ici quand KLYRA y est ouverte.`;
const BRIEF_LONG = 200;

export function FicheProjetTelephone({
  carte,
  lecture,
  eclaire,
  relireActif,
}: {
  carte: CarteProjetLue;
  lecture: LecturePoste<FicheProjet> & { relancer: () => void };
  eclaire: boolean;
  relireActif: boolean;
}) {
  const [travail, setTravail] = useState<TravailFiche | null>(null);
  const tirage = useTirerPourRelire(lecture.relancer, { actif: relireActif });
  const gardee = lecture.etat === "ferme" ? lecture.gardee : null;
  const attente = lecture.etat === "attente";

  const suite = (fiche: FicheProjet) => (
    <>
      <SectionTravaux fiche={fiche} onOuvrir={setTravail} />
      <SectionSurPoste surPoste={fiche.surPoste} />
    </>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-y-contain pb-6" {...tirage.props}>
      {tirage.indicateur}
      {gardee ? (
        /* E6-09 : le bandeau, puis la carte (compte) et ce qui a été lu. Un travail s'ouvre quand même. */
        <LectureGardee vue={gardee} gestes="Modifier le projet" verrou={false}>
          <div className="flex flex-col gap-4 px-4">
            <CarteIdentite carte={carte} fiche={gardee.data} eclaire={eclaire} />
            {suite(gardee.data)}
          </div>
        </LectureGardee>
      ) : (
        <div className="flex flex-col gap-4 pt-3">
          <div className="px-4">
            <CarteIdentite carte={carte} fiche={lecture.etat === "ok" ? lecture.data : null} chargement={attente && lecture.lent} eclaire={eclaire} />
          </div>
          {lecture.etat === "ok" ? (
            <div className="flex flex-col gap-4 px-4">{suite(lecture.data)}</div>
          ) : attente ? (
            <DemandeEnCours lent={lecture.lent} lignes={3} />
          ) : (
            <VueLecture lecture={lecture} ferme={FERME} forme="encadre" sansRecours>
              {() => null}
            </VueLecture>
          )}
        </div>
      )}
      {travail ? <FeuilleTravail travail={travail} onFermer={() => setTravail(null)} /> : null}
    </div>
  );
}

/** Statut, nom · accroche (compte), brief et agents (ordinateur). */
function CarteIdentite({ carte, fiche, chargement = false, eclaire }: { carte: CarteProjetLue; fiche: FicheProjet | null; chargement?: boolean; eclaire: boolean }) {
  const statut = libelleStatut(carte.statut);
  return (
    <div data-carte-projet data-eclaire={eclaire || undefined} className="rounded-xl border border-bordure-subtile bg-fond-surface px-4 pt-[18px] pb-4 shadow-ombre-ambiante">
      {statut ? <Etiquette ton={tonStatut(carte.statut)}>{statut}</Etiquette> : null}
      <h2 className={cn("text-h4 leading-[1.1] font-normal tracking-title text-texte-principal [overflow-wrap:anywhere]", statut && "mt-3")}>
        <span className="font-semibold">{carte.nom}</span>
        {carte.accroche ? ` · ${carte.accroche}` : null}
      </h2>
      {fiche ? (
        <>
          <Brief brief={fiche.brief} />
          <AgentsDuProjet agents={fiche.agents} />
        </>
      ) : chargement ? (
        <div aria-busy="true" className="mt-3.5 flex flex-col gap-2.5">
          {["w-[92%]", "w-[84%]", "w-3/5"].map((largeur) => (
            <span key={largeur} className={cn("h-3 rounded-sm bg-fond-surface-grise motion-safe:animate-pulse", largeur)} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** Le brief, replié à 5 lignes ; sans brief, on le dit sans en inventer un. */
function Brief({ brief }: { brief: string }) {
  const [deplie, setDeplie] = useState(false);
  const texte = brief.trim();
  if (!texte) return <p className="mt-2.5 text-body-s text-texte-secondaire">Aucun brief renseigné</p>;
  const long = texte.length > BRIEF_LONG || texte.split("\n").length > 5;
  return (
    <>
      <p className={cn("mt-2.5 text-body-s leading-[1.45] whitespace-pre-line text-texte-secondaire [overflow-wrap:anywhere]", long && !deplie && "line-clamp-5")}>{texte}</p>
      {long ? (
        <button type="button" aria-expanded={deplie} onClick={() => setDeplie((d) => !d)} className="-mb-2.5 inline-flex min-h-11 items-center text-ui font-medium text-texte-principal underline underline-offset-[3px]">
          {deplie ? "Replier le brief" : "Lire tout le brief"}
        </button>
      ) : null}
    </>
  );
}

/** Les visages et les noms ; chaque nom ouvre la fiche de l'agent. */
function AgentsDuProjet({ agents }: { agents: FicheProjet["agents"] }) {
  if (agents === null) return <p className="mt-3.5 border-t border-bordure-defaut pt-3.5 text-ui text-texte-secondaire">Les agents de ce projet n’ont pas pu être lus.</p>;
  if (agents.length === 0) return <p className="mt-3.5 border-t border-bordure-defaut pt-3.5 text-ui text-texte-secondaire">Aucun agent sur ce projet.</p>;
  return (
    <div className="mt-3.5 flex items-center gap-2.5 border-t border-bordure-defaut pt-3.5">
      <span aria-hidden="true" className="flex shrink-0">
        {agents.slice(0, 4).map((agent, i) => (
          <span key={agent.id} className={cn("flex rounded-[9px] ring-2 ring-fond-surface", i > 0 && "-ml-2")}>
            <RondAgent id={agent.id} taille={28} />
          </span>
        ))}
      </span>
      <p className="min-w-0 flex-1 text-ui text-texte-secondaire">
        {agents.map((agent, i) => (
          <span key={agent.id}>
            {i > 0 ? ", " : null}
            <Link
              href={`/equipe?agent=${encodeURIComponent(agent.id)}`}
              aria-label={agent.role ? `${agent.nom}, ${agent.role}` : agent.nom}
              className="relative text-texte-secondaire no-underline after:absolute after:-inset-x-1 after:-inset-y-3.5 active:text-texte-principal"
            >
              {agent.nom}
            </Link>
          </span>
        ))}
      </p>
    </div>
  );
}

function SectionTravaux({ fiche, onOuvrir }: { fiche: FicheProjet; onOuvrir: (t: TravailFiche) => void }) {
  const maintenant = useMaintenant();
  const { travaux } = fiche;
  if (travaux.etat === "indisponible") {
    return (
      <SectionListe titre="Travaux">
        <Bandeau icone="help-circle-contained" role="status">
          {travaux.raison}
        </Bandeau>
      </SectionListe>
    );
  }
  if (travaux.liste.length === 0) {
    return (
      <SectionListe titre="Travaux">
        <EtatEcran forme="encadre" className="px-0 pb-0" icone="list" titre="Aucun travail enregistré" texte="Un travail apparaît ici quand un agent en ouvre un dans ce projet." />
      </SectionListe>
    );
  }
  return (
    <SectionListe titre="Travaux" compte={travaux.liste.length + travaux.coupes}>
      <GroupeListe>
        {travaux.liste.map((travail) => (
          <LigneListe
            key={travail.cle}
            onClick={() => onOuvrir(travail)}
            debut={<TuileIcone icone="list" />}
            retrait="tuile"
            nom={travail.titre}
            etiquette={<Etiquette ton={travail.ton}>{travail.statut}</Etiquette>}
            ligne2={ligneTravail(travail, maintenant) || undefined}
            fin="chevron"
          />
        ))}
      </GroupeListe>
      {travaux.coupes > 0 ? <p className="px-1 pt-2 text-ui-xs text-texte-secondaire">{travaux.coupes} autres travaux ne sont pas affichés ici.</p> : null}
    </SectionListe>
  );
}

/** Ce qui reste sur l'ordinateur (P-8). */
function SectionSurPoste({ surPoste }: { surPoste: boolean }) {
  const sur = useSupport();
  const ligne = (icone: IconName, nom: string, raison: string) => (
    <LigneListe key={nom} debut={<TuileIcone icone={icone} />} retrait="tuile" nom={nom} etiquette={<Etiquette>{`Sur ${sur}`}</Etiquette>} ligne2={raison} />
  );
  return (
    <SectionListe titre={`Sur ${sur}`}>
      <GroupeListe>
        {[
          ligne("note-01", "Consignes des agents", surPoste ? "Elles s’écrivent dans le dossier du projet, sur l’ordinateur." : "Elles s’écrivent dans le dossier du projet, depuis l’app de bureau."),
          ligne("globe-01", "Aperçu du site", surPoste ? "L’aperçu est servi par ton ordinateur." : "L’aperçu s’ouvre dans l’app de bureau."),
          ligne("send-01", "Publier", "Commit et push se font en voyant le code."),
        ]}
      </GroupeListe>
    </SectionListe>
  );
}

const ICONES_SUIVI: Record<SuiviTravail["genre"], IconName> = {
  alerte: "help-circle-contained",
  verification: "check-01",
  commentaire: "message-square",
  preuves: "shield-check",
};

/** E6-12 : où en est le travail, son suivi, ses preuves ; « Ouvrir le fil » si son fil est dans le compte. */
function FeuilleTravail({ travail, onFermer }: { travail: TravailFiche; onFermer: () => void }) {
  const router = useRouter();
  const conversations = useQuery(api.conversationsCompte.liste, {});
  const maintenant = useMaintenant();
  const filConnu = !!travail.filId && !!conversations?.some((c) => c.origine === travail.filId);
  const details: { icone: IconName; nom: string; valeur: string }[] = [];
  const echeance = jourCourt(travail.echeance);
  const nouvelle = ilYa(travail.derniereNouvelle, maintenant);
  if (echeance) details.push({ icone: "calendar-01", nom: "Échéance", valeur: echeance });
  if (nouvelle) details.push({ icone: "clock-01", nom: "Dernière nouvelle", valeur: nouvelle });
  if (travail.cout) details.push({ icone: "lightning-01", nom: "Coût estimé", valeur: travail.cout });

  return (
    <Feuille
      titre={travail.titre}
      objet={{ visuel: <TuileIcone icone="list" grande />, sous: [travail.statut, travail.agent].filter(Boolean).join(" · ") }}
      onFermer={onFermer}
      pied={
        filConnu ? (
          <Bouton variant="sombre" taille="md" className="w-full" onClick={() => router.push(`/chat?id=${encodeURIComponent(travail.filId!)}`)}>
            Ouvrir le fil
          </Bouton>
        ) : (
          <p className="text-ui text-texte-secondaire">{conversations === undefined ? "Lecture du compte…" : "Le fil de ce travail n’est pas dans ton compte : il s’ouvre depuis l’ordinateur."}</p>
        )
      }
    >
      <div className="flex flex-col gap-4 pb-1">
        {details.length ? (
          <GroupeListe>
            {details.map((d) => (
              <LigneListe key={d.nom} debut={<TuileIcone icone={d.icone} />} retrait="tuile" nom={d.nom} fin={<span className="shrink-0 text-ui text-texte-secondaire">{d.valeur}</span>} />
            ))}
          </GroupeListe>
        ) : null}
        <section aria-label="Suivi">
          <h3 className="px-1 text-ui font-semibold text-texte-principal">Suivi</h3>
          {travail.suivi.length ? (
            <ul className="mt-2.5 flex flex-col gap-2.5 px-1">
              {travail.suivi.map((s, i) => (
                <li key={i} className="flex gap-2.5 text-ui leading-[1.4] text-texte-principal">
                  <Icon name={ICONES_SUIVI[s.genre]} size={16} className="mt-px shrink-0 text-icone-secondaire" />
                  <span className="min-w-0 [overflow-wrap:anywhere]">
                    {s.texte}
                    {s.detail || s.quand ? <span className="mt-px block text-ui-xs text-texte-secondaire">{s.detail ?? quandLisible(s.quand, maintenant)}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 px-1 text-ui text-texte-secondaire">Aucun fait constaté dans le journal pour ce travail.</p>
          )}
        </section>
      </div>
    </Feuille>
  );
}
