"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { CaseTache, nouvelleTache, PastilleCategorie } from "@/components/planning/Rappels";
import { AgentRond } from "@/components/roles/AgentRond";
import { cn } from "@/lib/cn";
import { aujourdhui, depuisCle, echeance, enRetard, libellePeriode } from "@/lib/dates";
import { evenementsEquipeEntre } from "@/lib/agenda-equipe";
import { passagesEntre } from "@/lib/planning";
import { useWorkspace } from "@/lib/workspace";

const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });

/** L'heure qu'il est, « 14:05 », mise à jour chaque minute. */
function useMaintenant(): string {
  const [maintenant, setMaintenant] = useState(() => fmtHeure.format(new Date()));
  useEffect(() => {
    const id = setInterval(() => setMaintenant(fmtHeure.format(new Date())), 60_000);
    return () => clearInterval(id);
  }, []);
  return maintenant;
}

function EnTete({ titre, sousTitre, href }: { titre: string; sousTitre: string; href: string }) {
  return (
    <Link href={href} className="group flex items-baseline justify-between gap-2 no-underline">
      <span className="text-ui font-semibold text-texte-principal group-hover:text-texte-accent">{titre}</span>
      <span className="flex items-center gap-1 text-ui-xs text-texte-tertiaire group-hover:text-texte-accent">
        {sousTitre}
        <Icon name="chevron-right" size={14} />
      </span>
    </Link>
  );
}

type Tache = ReturnType<typeof useWorkspace>["state"]["taches"][number];

/** Cocher ou décocher un rappel, en notant quand. */
function basculer(t: Tache): Tache {
  return { ...t, faite: !t.faite, faiteLe: t.faite ? null : new Date().toISOString() };
}

/**
 * Au programme : ce qui a une heure aujourd'hui (rendez-vous, passages des
 * agents, rappels à heure fixe), dans l'ordre, avec le repère « maintenant ».
 * Un rappel n'apparaît qu'ici ou dans « À faire », jamais dans les deux.
 */
function AuProgramme() {
  const { state, enregistrerTache } = useWorkspace();
  const maintenant = useMaintenant();
  const cle = aujourdhui();
  const categorieDe = (liste: string) => state.categories.find((c) => c.id === liste) ?? state.categories[0];

  const elements = useMemo(() => {
    const debut = depuisCle(cle);
    const fin = new Date(debut);
    fin.setDate(fin.getDate() + 1);
    return [
      ...[...state.evenements, ...evenementsEquipeEntre(debut, fin)]
        .filter((e) => e.date === cle)
        .map((e) => ({ id: e.id, heure: e.debut, fin: e.fin, titre: e.titre, roleId: null as string | null, tache: null as Tache | null })),
      ...state.routines
        .filter((r) => r.active && r.frequence.type !== "heure")
        .flatMap((r) =>
          passagesEntre(r.frequence, debut, fin, 4).map((d) => ({
            id: `${r.id}-${d.toISOString()}`,
            heure: fmtHeure.format(d) as string | null,
            fin: null as string | null,
            titre: r.nom,
            roleId: r.roleId as string | null,
            tache: null as Tache | null,
          })),
        ),
      ...state.taches
        .filter((t) => t.date === cle && t.heure)
        .map((t) => ({ id: t.id, heure: t.heure, fin: null as string | null, titre: t.titre, roleId: null as string | null, tache: t as Tache | null })),
    ].sort((a, b) => (a.heure ?? "").localeCompare(b.heure ?? ""));
  }, [state.evenements, state.routines, state.taches, cle]);

  const passe = (heure: string | null, fin: string | null) => !!heure && (fin ?? heure) < maintenant;

  return (
    <section aria-label="Au programme" className="klyra-carte-flottante flex min-h-[184px] flex-col gap-3 rounded-lg p-4">
      <EnTete titre="Au programme" sousTitre="Planning" href="/planning" />
      {elements.length === 0 ? (
        <p className="m-0 text-ui-s text-texte-tertiaire">Aucun rendez-vous aujourd’hui.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {elements.slice(0, 6).map((el, i) => {
            const avant = elements[i - 1];
            /* Le repère « maintenant » se place entre ce qui est passé et ce qui vient. */
            const repere = el.heure && el.heure >= maintenant && (!avant || !avant.heure || avant.heure < maintenant);
            const categorie = el.tache ? categorieDe(el.tache.liste) : undefined;
            return (
              <li key={el.id} className="flex flex-col gap-1">
                {repere && (
                  <span aria-label={`Il est ${maintenant}`} className="flex items-center gap-2 text-ui-3xs font-medium text-texte-accent">
                    <span className="size-1.5 rounded-full bg-bleu-k1-500" />
                    {maintenant}
                    <span className="h-px flex-1 bg-bleu-k1-500/40" />
                  </span>
                )}
                <span
                  className={cn(
                    "flex items-center gap-2.5 rounded-sm px-2 py-1.5",
                    el.roleId || el.tache ? "bg-transparent" : "bg-fond-teinte-bleue",
                    (passe(el.heure, el.fin) || el.tache?.faite) && "opacity-55",
                  )}
                >
                  <span className="klyra-mono w-10 shrink-0 text-ui-xs font-medium text-texte-accent">{el.heure ?? "Jour"}</span>
                  {el.roleId && <AgentRond roleId={el.roleId} taille={18} />}
                  {el.tache && (
                    <CaseTache
                      faite={el.tache.faite}
                      libelle={el.tache.titre}
                      teinte={categorie?.teinte}
                      onChange={() => enregistrerTache(basculer(el.tache!))}
                    />
                  )}
                  <span className={cn("truncate text-ui-s text-texte-principal", el.tache?.faite && "line-through")}>{el.titre}</span>
                  {el.fin && <span className="klyra-mono ml-auto shrink-0 text-ui-3xs text-texte-tertiaire">→ {el.fin}</span>}
                </span>
              </li>
            );
          })}
          {elements.length > 6 && <li className="px-2 text-ui-xs text-texte-tertiaire">+ {elements.length - 6} autres</li>}
        </ul>
      )}
    </section>
  );
}

/**
 * À faire : les rappels sans heure du jour et ceux en retard, à cocher. Rien
 * pour aujourd'hui : les rappels sans date prennent la place.
 */
function AFaire() {
  const { state, enregistrerTache } = useWorkspace();
  const [titre, setTitre] = useState("");
  const cle = aujourdhui();
  const categorieDe = (liste: string) => state.categories.find((c) => c.id === liste) ?? state.categories[0];

  /* Ceux à heure fixe aujourd'hui sont dans « Au programme ». */
  const auProgramme = (t: Tache) => t.date === cle && !!t.heure;
  const duJour = (t: Tache) => t.date !== null && t.date <= cle && !auProgramme(t);
  const aFaire = state.taches
    .filter((t) => !t.faite && duJour(t))
    .sort((a, b) => `${a.date}T${a.heure ?? "99"}`.localeCompare(`${b.date}T${b.heure ?? "99"}`) || b.priorite - a.priorite);
  const sansDate = aFaire.length === 0;
  const garde = (t: Tache) => (sansDate ? t.date === null : duJour(t));
  const rappels = sansDate
    ? state.taches.filter((t) => !t.faite && t.date === null).sort((a, b) => b.priorite - a.priorite || a.creeLe.localeCompare(b.creeLe))
    : aFaire;
  /* Ceux cochés aujourd'hui restent visibles, barrés : on voit ce qu'on a fait. */
  const faitsAujourdhui = state.taches.filter((t) => t.faite && t.faiteLe?.startsWith(cle) && garde(t));

  const ajouter = () => {
    if (!titre.trim()) return;
    enregistrerTache(nouvelleTache({ titre: titre.trim(), date: sansDate ? null : cle, liste: state.categories[0]?.id ?? "perso" }));
    setTitre("");
  };

  return (
    <section aria-label="À faire" className="klyra-carte-flottante flex min-h-[184px] flex-col gap-2 rounded-lg p-4">
      <EnTete
        titre={sansDate && rappels.length ? "À faire, sans date" : "À faire"}
        sousTitre={rappels.length ? `${rappels.length} rappel${rappels.length > 1 ? "s" : ""}` : "Tout est fait"}
        href="/planning"
      />
      <ul className="m-0 flex list-none flex-col p-0">
        {[...rappels, ...faitsAujourdhui].slice(0, 6).map((t) => {
          const categorie = categorieDe(t.liste);
          const retard = !t.faite && enRetard(echeance(t), t.fin ? null : t.heure);
          return (
            <li key={t.id} className="flex items-start gap-2.5 py-1.5">
              <CaseTache faite={t.faite} libelle={t.titre} teinte={categorie?.teinte} onChange={() => enregistrerTache(basculer(t))} />
              {t.priorite > 0 && <span className="shrink-0 text-ui-s leading-5 font-semibold text-texte-accent">{"!".repeat(t.priorite)}</span>}
              <span className={cn("min-w-0 flex-1 text-ui-s leading-5 [overflow-wrap:anywhere]", t.faite ? "text-texte-tertiaire line-through" : "text-texte-principal")}>{t.titre}</span>
              {retard && <span className="shrink-0 text-ui-xs font-medium text-texte-erreur">{libellePeriode(t.date!, t.heure, t.fin)}</span>}
              {categorie && <PastilleCategorie categorie={categorie} taille={18} />}
            </li>
          );
        })}
        <li className="flex items-center gap-2.5 py-1.5">
          <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-[1.5px] border-dashed border-bordure-forte" />
          <input
            value={titre}
            placeholder={sansDate ? "Nouveau rappel" : "Nouveau rappel pour aujourd’hui"}
            onChange={(e) => setTitre(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ajouter()}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-ui-s text-texte-principal outline-none placeholder:text-texte-tertiaire"
          />
        </li>
      </ul>
    </section>
  );
}

/** La journée d'un coup d'œil : ce qui a une heure, et ce qui est à faire. */
export function MaJournee() {
  return (
    <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
      <AuProgramme />
      <AFaire />
    </div>
  );
}
