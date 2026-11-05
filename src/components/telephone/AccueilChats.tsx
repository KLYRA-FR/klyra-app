"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Icon } from "@/components/icons/Icon";
import { useCompte } from "@/lib/compte";
import { aujourdhui as cleAujourdhui } from "@/lib/dates";
import { useLecturePoste } from "@/lib/poste/client";
import type { PlanningDuPoste } from "@/lib/poste/gestes/planning";
import { dureeDepuis, type AgentAuTravail } from "@/lib/telephone/chats";
import { journeeDuJour, texteAFaire } from "@/lib/telephone/journee";
import { depuisCompte, depuisPoste, fenetreAgenda } from "@/lib/telephone/planning";
import { LignePoste } from "./ContextePlanningTelephone";
import { RondAgent, useCartes } from "./AgentsChat";
import { useSupport } from "./poste";

/**
 * Le haut de Chats (lot 2, E2-01) : « Ta journée » et « Au travail ». Pièces du lot, pas du socle
 * (§ 12 de la spec : le kit commun ne s'étend qu'après arbitrage d'Iris).
 */

const CARTE = "rounded-xl border border-bordure-subtile bg-fond-surface shadow-ombre-ambiante";

/** « aujourd'hui » suit minuit et le retour dans l'app. */
function useAujourdhui(): string {
  const [jour, setJour] = useState(cleAujourdhui);
  useEffect(() => {
    const suivre = () => setJour(cleAujourdhui());
    const horloge = setInterval(suivre, 60_000);
    document.addEventListener("visibilitychange", suivre);
    return () => {
      clearInterval(horloge);
      document.removeEventListener("visibilitychange", suivre);
    };
  }, []);
  return jour;
}

const lienRappel = (id: string, source: "compte" | "poste") => `/planning?onglet=rappels&fiche=rappel&id=${encodeURIComponent(id)}${source === "poste" ? "&source=poste" : ""}`;

/**
 * « Ta journée » : les rendez-vous et rappels à heure d'aujourd'hui, du compte et de l'ordinateur (la
 * même lecture que Planning, donc la même vue gardée), et les rappels à faire. D-8 : « Rien de prévu »
 * seulement quand le compte et l'ordinateur ont répondu (ou qu'aucun ordinateur n'est relié).
 */
export function CarteJournee() {
  const aujourdhui = useAujourdhui();
  const { moi } = useCompte();
  const sur = useSupport();
  const fenetre = useMemo(() => fenetreAgenda("jour", aujourdhui), [aujourdhui]);
  const occurrences = useQuery(api.evenements.entre, fenetre);
  const mes = useQuery(api.rappels.mes, {});
  const poste = useLecturePoste<PlanningDuPoste>("planning.lire", {});
  const donnees = poste.etat === "ok" ? poste.data : poste.etat === "ferme" ? (poste.gardee?.data ?? null) : null;
  const moiId = (moi?._id as string | undefined) ?? "";

  const journee = useMemo(() => {
    const origines = new Set((mes ?? []).flatMap((r) => (r.origineLocale ? [r.origineLocale] : [])));
    const rappels = [
      ...(mes ?? []).map((r) => ({ ...depuisCompte(r, moiId), href: lienRappel(r._id, "compte") })),
      ...(donnees?.taches ?? []).filter((t) => !origines.has(t.id)).map((t) => ({ ...depuisPoste(t), href: lienRappel(t.id, "poste") })),
    ];
    const evenements = [
      ...(occurrences ?? []).map((o) => ({
        cle: o.id,
        titre: o.titre,
        jour: o.jour,
        debut: o.jourEntier ? null : o.debut,
        /* Le Weekly et les événements des autres ne s'ouvrent pas en fiche, comme dans Planning. */
        href: o.modifiable ? `/planning?fiche=evenement&id=${encodeURIComponent(o.id)}` : "/planning",
      })),
      ...(donnees?.evenements ?? [])
        .filter((e) => !e.equipe)
        .map((e) => ({ cle: `poste-${e.id}`, titre: e.titre, jour: e.date, debut: e.debut, href: `/planning?fiche=evenement&id=${encodeURIComponent(e.id)}&source=poste` })),
    ];
    return journeeDuJour({ evenements, rappels, aujourdhui });
  }, [occurrences, mes, donnees, moiId, aujourdhui]);

  const compteLu = occurrences !== undefined && mes !== undefined;
  const toutLu = compteLu && (poste.etat === "ok" || poste.etat === "aucun");
  const aFaire = texteAFaire(journee.aFaire);

  return (
    <section aria-labelledby="ta-journee" className={`${CARTE} px-4 pt-3 pb-1`}>
      <div className="flex items-center">
        <h2 id="ta-journee" className="text-body-s font-semibold text-texte-principal">
          Ta journée
        </h2>
        <Link href="/planning" className="relative ml-auto inline-flex items-center gap-0.5 text-ui text-texte-secondaire no-underline after:absolute after:-inset-x-2 after:-inset-y-3.5">
          Planning
          <Icon name="chevron-right" size={16} />
        </Link>
      </div>
      {!compteLu ? (
        <div aria-hidden="true" className="flex flex-col gap-2 py-3">
          <span className="h-3 w-3/5 rounded-sm bg-fond-surface-grise motion-safe:animate-pulse" />
          <span className="h-3 w-4/5 rounded-sm bg-fond-surface-grise motion-safe:animate-pulse" />
        </div>
      ) : (
        <>
          {journee.lignes.length > 0 ? (
            <ul className="py-1">
              {journee.lignes.map((l) => (
                <li key={l.cle}>
                  <Link href={l.href} className="flex min-h-11 items-center gap-3 text-ui text-texte-principal no-underline active:bg-fond-survol">
                    <span className="w-12 shrink-0 font-semibold text-texte-accent tabular-nums">{l.heure ?? "Jour"}</span>
                    <span className="min-w-0 flex-1 truncate">{l.titre}</span>
                  </Link>
                </li>
              ))}
              {journee.autres > 0 ? (
                <li className="pb-1 text-ui text-texte-secondaire">
                  {journee.autres === 1 ? "Et un autre aujourd’hui" : `Et ${journee.autres} autres aujourd’hui`}
                </li>
              ) : null}
            </ul>
          ) : toutLu && !aFaire ? (
            <p className="py-3 text-body-s text-texte-secondaire">Rien de prévu aujourd’hui.</p>
          ) : null}
          <LignePoste lecture={poste} ferme={`Ce qui est gardé sur ${sur} : visible quand il est ouvert`} sur={sur} mot="Vus" />
          {aFaire ? (
            <Link href="/planning?onglet=rappels" className="flex min-h-11 items-center border-t border-bordure-defaut text-ui text-texte-secondaire no-underline">
              {aFaire}
            </Link>
          ) : null}
        </>
      )}
    </section>
  );
}

/**
 * Une carte « Au travail » (236 px) : avatar, nom, sujet, tâches faites, ce qu'il fait et depuis
 * quand. La fine barre bleue est indéterminée : aucune mesure d'avancement n'existe, rien n'est chiffré.
 */
function CarteAuTravail({ agent, maintenant }: { agent: AgentAuTravail; maintenant: Date }) {
  const { nom } = useCartes();
  const qui = nom(agent.roleId);
  const duree = dureeDepuis(agent.depuis, maintenant);
  return (
    <Link
      href={`/chat?id=${encodeURIComponent(agent.origine)}`}
      aria-label={`${qui}${agent.sujet ? `, ${agent.sujet}` : ""} : ${agent.texte} depuis ${duree}`}
      className={`${CARTE} flex w-[236px] shrink-0 snap-start items-center gap-3 px-3 py-3 no-underline transition-transform duration-[120ms] ease-sortie active:scale-[0.98]`}
    >
      <RondAgent id={agent.roleId} taille={36} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex min-w-0 items-baseline gap-1">
          <span className="shrink-0 text-ui font-semibold text-texte-principal">{qui}</span>
          {agent.sujet ? <span className="min-w-0 truncate text-ui text-texte-principal">· {agent.sujet}</span> : null}
          <span className="ml-auto shrink-0 pl-1 text-ui-xs text-texte-secondaire tabular-nums">{agent.taches ? `${agent.taches.faites}/${agent.taches.total}` : duree}</span>
        </span>
        <span className="truncate text-ui text-texte-secondaire">{agent.texte}</span>
        <span aria-hidden="true" className="mt-2 flex h-0.5 overflow-hidden rounded-full bg-fond-surface-grise">
          <span className="klyra-chargement-navigateur flex-1" />
        </span>
      </span>
    </Link>
  );
}

/** Le rail « Au travail » : absent si personne ne travaille vraiment (D2-2). Chaque carte ouvre le fil. */
export function RailAuTravail({ agents }: { agents: AgentAuTravail[] }) {
  const [maintenant, setMaintenant] = useState(() => new Date());
  useEffect(() => {
    const minuteur = setInterval(() => setMaintenant(new Date()), 60_000);
    return () => clearInterval(minuteur);
  }, []);
  if (agents.length === 0) return null;
  return (
    <section aria-labelledby="au-travail" className="mt-6">
      <h2 id="au-travail" className="px-1 pb-2 text-ui font-semibold text-texte-principal">
        Au travail<span className="ml-1.5 font-normal text-texte-secondaire">{agents.length}</span>
      </h2>
      <ul className="-mx-4 flex snap-x gap-2 overflow-x-auto scroll-px-4 px-4 pb-1 [scrollbar-width:none]">
        {agents.map((a) => (
          <li key={a.origine} className="flex">
            <CarteAuTravail agent={a} maintenant={maintenant} />
          </li>
        ))}
      </ul>
    </section>
  );
}
