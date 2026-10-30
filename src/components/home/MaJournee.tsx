"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { ECLAIRAGE_MS, MenuReporter, type Reporte } from "@/components/planning/MenuReporter";
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
 * Un rappel reporté qui quitte la liste (à demain, planifié) y reste à sa place
 * le temps de l'éclairage, avec sa nouvelle date, puis part. S'il avait le
 * focus, celui-ci va au bouton Reporter de la ligne qui prend sa place, sinon
 * au champ « Nouveau rappel » de la carte.
 */
function useRetenues(carte: RefObject<HTMLElement | null>) {
  const [retenues, setRetenues] = useState<{ id: string; rang: number }[]>([]);
  const retenir = useCallback(
    (id: string, rang: number) => {
      if (rang < 0) return;
      setRetenues((r) => [...r.filter((x) => x.id !== id), { id, rang }]);
      window.setTimeout(() => {
        const focus = !!carte.current?.querySelector(`[data-ligne-rappel="${CSS.escape(id)}"]`)?.contains(document.activeElement);
        setRetenues((r) => r.filter((x) => x.id !== id));
        if (!focus) return;
        requestAnimationFrame(() => {
          const el = carte.current;
          if (!el || el.querySelector(`[data-ligne-rappel="${CSS.escape(id)}"]`)) return;
          const lignes = [...el.querySelectorAll<HTMLElement>("[data-ligne-rappel]")];
          const suivante = lignes[Math.min(rang, lignes.length - 1)]?.querySelector<HTMLElement>("[data-reporter]");
          (suivante ?? el.querySelector<HTMLElement>("[data-nouveau-rappel]"))?.focus({ preventScroll: true });
        });
      }, ECLAIRAGE_MS);
    },
    [carte],
  );
  /* Les retenues absentes de la liste y sont remises à leur place, lues dans l'état (nouvelle date). */
  const avecRetenues = <T,>(liste: T[], idDe: (x: T) => string, depuis: (id: string) => T | null): { element: T; retenue: boolean }[] => {
    const out = liste.map((element) => ({ element, retenue: false }));
    for (const { id, rang } of [...retenues].sort((a, b) => a.rang - b.rang)) {
      if (liste.some((x) => idDe(x) === id)) continue;
      const element = depuis(id);
      if (element) out.splice(Math.min(rang, out.length), 0, { element, retenue: true });
    }
    return out;
  };
  return { retenir, avecRetenues };
}

/**
 * Au programme : ce qui a une heure aujourd'hui (rendez-vous, passages des
 * agents, rappels à heure fixe), dans l'ordre, avec le repère « maintenant ».
 * Un rappel n'apparaît qu'ici ou dans « À faire », jamais dans les deux.
 */
function AuProgramme({ annoncer }: { annoncer: (texte: string) => void }) {
  const { state, enregistrerTache } = useWorkspace();
  const maintenant = useMaintenant();
  const cle = aujourdhui();
  const categorieDe = (liste: string) => state.categories.find((c) => c.id === liste) ?? state.categories[0];
  const carte = useRef<HTMLElement>(null);
  const { retenir, avecRetenues } = useRetenues(carte);

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
  const visibles = avecRetenues(
    elements.slice(0, 6),
    (el) => el.id,
    (id) => {
      const t = state.taches.find((x) => x.id === id);
      return t ? { id, heure: t.heure, fin: null, titre: t.titre, roleId: null, tache: t } : null;
    },
  );

  return (
    <section ref={carte} aria-label="Au programme" className="klyra-carte-flottante flex min-h-[184px] flex-col gap-3 rounded-lg p-4">
      <EnTete titre="Au programme" sousTitre="Planning" href="/planning" />
      {visibles.length === 0 ? (
        <p className="m-0 text-ui-s text-texte-tertiaire">Aucun rendez-vous aujourd’hui.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {visibles.map(({ element: el, retenue }, i) => {
            const avant = visibles[i - 1]?.element;
            /* Le repère « maintenant » se place entre ce qui est passé et ce qui vient. */
            const repere = !retenue && el.heure && el.heure >= maintenant && (!avant || !avant.heure || avant.heure < maintenant);
            const categorie = el.tache ? categorieDe(el.tache.liste) : undefined;
            const tache = el.tache;
            return (
              <li key={el.id} data-ligne-rappel={tache?.id} className="group/rappel flex flex-col gap-1">
                {repere && (
                  <span aria-label={`Il est ${maintenant}`} className="flex items-center gap-2 text-ui-3xs font-medium text-texte-accent">
                    <span className="size-1.5 rounded-full bg-bleu-k1-500" />
                    {maintenant}
                    <span className="h-px flex-1 bg-bleu-k1-500/40" />
                  </span>
                )}
                {/* Pour un rappel, toute la ligne porte sa date (data-echeance) : elle s'éclaire après un report. */}
                <span
                  data-echeance={tache?.id}
                  className={cn(
                    "flex items-center gap-2.5 rounded-sm px-2 py-1.5",
                    el.roleId || tache ? "bg-transparent" : "bg-fond-teinte-bleue",
                    ((!retenue && passe(el.heure, el.fin)) || tache?.faite) && "opacity-55",
                  )}
                >
                  <span className="klyra-mono w-10 shrink-0 text-ui-xs font-medium text-texte-accent">{el.heure ?? "Jour"}</span>
                  {el.roleId && <AgentRond roleId={el.roleId} taille={18} />}
                  {tache && (
                    <CaseTache faite={tache.faite} libelle={tache.titre} teinte={categorie?.teinte} onChange={() => enregistrerTache(basculer(tache))} />
                  )}
                  <span className={cn("truncate text-ui-s text-texte-principal", tache?.faite && "line-through")}>{el.titre}</span>
                  {retenue && tache?.date && (
                    <span className="shrink-0 text-ui-xs font-medium text-texte-accent">{libellePeriode(tache.date, tache.heure, tache.fin)}</span>
                  )}
                  {el.fin && <span className="klyra-mono ml-auto shrink-0 text-ui-3xs text-texte-tertiaire">→ {el.fin}</span>}
                  {tache && !tache.faite && (
                    <MenuReporter
                      tache={tache}
                      className="ml-auto"
                      onReporte={({ id, annonce }: Reporte) => {
                        annoncer(annonce);
                        retenir(id, i);
                      }}
                    />
                  )}
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
function AFaire({ annoncer }: { annoncer: (texte: string) => void }) {
  const { state, enregistrerTache } = useWorkspace();
  const [titre, setTitre] = useState("");
  const carte = useRef<HTMLElement>(null);
  const { retenir, avecRetenues } = useRetenues(carte);
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

  const visibles = avecRetenues(
    [...rappels, ...faitsAujourdhui].slice(0, 6),
    (t) => t.id,
    (id) => state.taches.find((t) => t.id === id) ?? null,
  );

  return (
    <section ref={carte} aria-label="À faire" className="klyra-carte-flottante flex min-h-[184px] flex-col gap-2 rounded-lg p-4">
      <EnTete
        titre={sansDate && rappels.length ? "À faire, sans date" : "À faire"}
        sousTitre={rappels.length ? `${rappels.length} rappel${rappels.length > 1 ? "s" : ""}` : "Tout est fait"}
        href="/planning"
      />
      <ul className="m-0 flex list-none flex-col p-0">
        {visibles.map(({ element: t, retenue }, i) => {
          const categorie = categorieDe(t.liste);
          const retard = !t.faite && enRetard(echeance(t), t.fin ? null : t.heure);
          return (
            <li key={t.id} data-ligne-rappel={t.id} className="group/rappel flex items-start gap-2.5 py-1.5">
              <CaseTache faite={t.faite} libelle={t.titre} teinte={categorie?.teinte} onChange={() => enregistrerTache(basculer(t))} />
              {t.priorite > 0 && <span className="shrink-0 text-ui-s leading-5 font-semibold text-texte-accent">{"!".repeat(t.priorite)}</span>}
              <span className={cn("min-w-0 flex-1 text-ui-s leading-5 [overflow-wrap:anywhere]", t.faite ? "text-texte-tertiaire line-through" : "text-texte-principal")}>{t.titre}</span>
              {/* La date d'un rappel en retard, ou la nouvelle date d'un rappel reporté qui va quitter la liste. */}
              {(retard || retenue) && t.date && (
                <span
                  data-echeance={t.id}
                  className={cn("-mx-1 shrink-0 self-start rounded-2xs px-1 text-ui-xs font-medium", retenue ? "text-texte-accent" : "text-texte-erreur")}
                >
                  {libellePeriode(t.date, t.heure, t.fin)}
                </span>
              )}
              {categorie && <PastilleCategorie categorie={categorie} taille={18} />}
              {!t.faite && (
                <MenuReporter
                  tache={t}
                  onReporte={({ id, annonce }: Reporte) => {
                    annoncer(annonce);
                    retenir(id, i);
                  }}
                />
              )}
            </li>
          );
        })}
        <li className="flex items-center gap-2.5 py-1.5">
          <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-[1.5px] border-dashed border-bordure-forte" />
          <input
            data-nouveau-rappel
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
  /* Un report annoncé au lecteur d'écran : « Rappel reporté : Demain, 09:00. ». */
  const [annonce, setAnnonce] = useState("");
  return (
    <div className="grid grid-cols-1 gap-3 @3xl:grid-cols-2">
      <AuProgramme annoncer={setAnnonce} />
      <AFaire annoncer={setAnnonce} />
      <p aria-live="polite" className="sr-only">
        {annonce}
      </p>
    </div>
  );
}
