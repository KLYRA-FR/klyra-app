"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { CaseTache, nouvelleTache, PastilleCategorie } from "@/components/planning/Rappels";
import { AgentRond } from "@/components/roles/AgentRond";
import { cn } from "@/lib/cn";
import { aujourdhui, depuisCle, enRetard, libelleEcheance } from "@/lib/dates";
import { passagesEntre } from "@/lib/planning";
import { useWorkspace } from "@/lib/workspace";

const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtJour = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

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

/** Aujourd'hui : les événements et les passages des agents, dans l'ordre des heures. */
function Aujourdhui() {
  const { state } = useWorkspace();
  const maintenant = useMaintenant();
  const cle = aujourdhui();

  const elements = useMemo(() => {
    const debut = depuisCle(cle);
    const fin = new Date(debut);
    fin.setDate(fin.getDate() + 1);
    return [
      ...state.evenements
        .filter((e) => e.date === cle)
        .map((e) => ({ id: e.id, heure: e.debut, fin: e.fin, titre: e.titre, roleId: null as string | null })),
      ...state.routines
        .filter((r) => r.active && r.frequence.type !== "heure")
        .flatMap((r) =>
          passagesEntre(r.frequence, debut, fin, 4).map((d) => ({
            id: `${r.id}-${d.toISOString()}`,
            heure: fmtHeure.format(d) as string | null,
            fin: null as string | null,
            titre: r.nom,
            roleId: r.roleId as string | null,
          })),
        ),
    ].sort((a, b) => (a.heure ?? "").localeCompare(b.heure ?? ""));
  }, [state.evenements, state.routines, cle]);

  const passe = (heure: string | null, fin: string | null) => !!heure && (fin ?? heure) < maintenant;

  return (
    <section aria-label="Aujourd’hui" className="klyra-carte-flottante flex min-h-[184px] flex-col gap-3 rounded-lg p-4">
      <EnTete titre="Aujourd’hui" sousTitre={fmtJour.format(new Date())} href="/planning" />
      {elements.length === 0 ? (
        <p className="m-0 text-ui-s text-texte-tertiaire">Rien de prévu aujourd’hui.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {elements.slice(0, 5).map((el, i) => {
            const avant = elements[i - 1];
            /* Le repère « maintenant » se place entre ce qui est passé et ce qui vient. */
            const repere = el.heure && el.heure >= maintenant && (!avant || !avant.heure || avant.heure < maintenant);
            return (
              <li key={el.id} className="flex flex-col gap-1">
                {repere && (
                  <span aria-label={`Il est ${maintenant}`} className="flex items-center gap-2 text-ui-3xs font-medium text-texte-accent">
                    <span className="size-1.5 rounded-full bg-bleu-k1-500" />
                    {maintenant}
                    <span className="h-px flex-1 bg-bleu-k1-500/40" />
                  </span>
                )}
                <span className={cn("flex items-center gap-2.5 rounded-sm px-2 py-1.5", el.roleId ? "bg-transparent" : "bg-fond-teinte-bleue", passe(el.heure, el.fin) && "opacity-55")}>
                  <span className="klyra-mono w-10 shrink-0 text-ui-xs font-medium text-texte-accent">{el.heure ?? "Jour"}</span>
                  {el.roleId && <AgentRond roleId={el.roleId} taille={18} />}
                  <span className="truncate text-ui-s text-texte-principal">{el.titre}</span>
                  {el.fin && <span className="klyra-mono ml-auto shrink-0 text-ui-3xs text-texte-tertiaire">→ {el.fin}</span>}
                </span>
              </li>
            );
          })}
          {elements.length > 5 && <li className="px-2 text-ui-xs text-texte-tertiaire">+ {elements.length - 5} autres</li>}
        </ul>
      )}
    </section>
  );
}

/** Rappels du jour : ceux d'aujourd'hui et ceux en retard, à cocher, et une ligne pour en ajouter. */
function RappelsDuJour() {
  const { state, enregistrerTache } = useWorkspace();
  const [titre, setTitre] = useState("");
  const cle = aujourdhui();
  const categorieDe = (liste: string) => state.categories.find((c) => c.id === liste) ?? state.categories[0];

  const rappels = state.taches
    .filter((t) => !t.faite && t.date !== null && t.date <= cle)
    .sort((a, b) => `${a.date}T${a.heure ?? "99"}`.localeCompare(`${b.date}T${b.heure ?? "99"}`) || b.priorite - a.priorite);
  /* Ceux cochés aujourd'hui restent visibles, barrés : on voit ce qu'on a fait. */
  const faitsAujourdhui = state.taches.filter((t) => t.faite && t.faiteLe?.startsWith(cle) && t.date !== null && t.date <= cle);

  const ajouter = () => {
    if (!titre.trim()) return;
    enregistrerTache(nouvelleTache({ titre: titre.trim(), date: cle, liste: state.categories[0]?.id ?? "perso" }));
    setTitre("");
  };

  return (
    <section aria-label="Rappels du jour" className="klyra-carte-flottante flex min-h-[184px] flex-col gap-2 rounded-lg p-4">
      <EnTete titre="Rappels du jour" sousTitre={rappels.length ? `${rappels.length} à faire` : "Tout est fait"} href="/planning" />
      <ul className="m-0 flex list-none flex-col p-0">
        {[...rappels, ...faitsAujourdhui].slice(0, 6).map((t) => {
          const categorie = categorieDe(t.liste);
          const retard = !t.faite && enRetard(t.date, t.heure);
          return (
            <li key={t.id} className="flex items-start gap-2.5 py-1.5">
              <CaseTache
                faite={t.faite}
                libelle={t.titre}
                teinte={categorie?.teinte}
                onChange={() => enregistrerTache({ ...t, faite: !t.faite, faiteLe: t.faite ? null : new Date().toISOString() })}
              />
              {t.priorite > 0 && <span className="shrink-0 text-ui-s font-semibold text-texte-accent">{"!".repeat(t.priorite)}</span>}
              <span className={cn("min-w-0 flex-1 text-ui-s leading-[1.45] [overflow-wrap:anywhere]", t.faite ? "text-texte-tertiaire line-through" : "text-texte-principal")}>{t.titre}</span>
              {(t.heure || retard) && (
                <span className={cn("shrink-0 text-ui-xs", retard ? "font-medium text-texte-erreur" : "text-texte-tertiaire")}>
                  {retard ? libelleEcheance(t.date!, t.heure) : t.heure}
                </span>
              )}
              {categorie && <PastilleCategorie categorie={categorie} taille={18} />}
            </li>
          );
        })}
        <li className="flex items-center gap-2.5 py-1.5">
          <span aria-hidden="true" className="size-5 shrink-0 rounded-full border-[1.5px] border-dashed border-bordure-forte" />
          <input
            value={titre}
            placeholder="Nouveau rappel pour aujourd’hui"
            onChange={(e) => setTitre(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && ajouter()}
            className="min-w-0 flex-1 border-0 bg-transparent p-0 text-ui-s text-texte-principal outline-none placeholder:text-texte-tertiaire"
          />
        </li>
      </ul>
    </section>
  );
}

/** En haut de l'accueil : la journée, d'un coup d'œil. */
export function MaJournee() {
  return (
    <div className="grid grid-cols-1 gap-4 @3xl:grid-cols-2">
      <Aujourdhui />
      <RappelsDuJour />
    </div>
  );
}
