"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { nomModele } from "@/components/chat/ChoixModele";
import { Onglets } from "@/components/ui/Onglets";
import type { EntreeConsommation } from "@/lib/bridge";
import { cleJour, compact, dateCourte, totalJetons, UN_JOUR } from "@/lib/consommation";
import type { Role } from "@/types/domain";
import type { Lecture } from "./donnees";
import { EnteteVue, Note, TitreGroupe } from "./elements";

type Periode = "7" | "30" | "365";
const PERIODES: { id: Periode; label: string }[] = [
  { id: "7", label: "7 jours" },
  { id: "30", label: "30 jours" },
  { id: "365", label: "1 an" },
];

const dollars = (n: number) => n.toLocaleString("fr-FR", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 });
const pourcent = (n: number) => n.toLocaleString("fr-FR", { style: "percent", maximumFractionDigits: 1 });
const nomMois = (d: Date) => d.toLocaleDateString("fr-FR", { month: "short" });

/** Le résumé de la ligne « Utilisation » : les jetons des 30 derniers jours. */
export function resumeUtilisation(lecture: Lecture<EntreeConsommation[]>, maintenant: number): string | undefined {
  if (lecture.etat !== "pret") return undefined;
  const depuis = maintenant - 30 * UN_JOUR;
  const n = lecture.valeur.filter((e) => e.at >= depuis).reduce((s, e) => s + totalJetons(e), 0);
  return n ? `${compact(n)} jetons · 30 j` : "Rien sur 30 j";
}

/** Des barres, une par jour (ou par mois sur un an), à la hauteur des jetons. */
function Barres({ entrees, periode, maintenant: instant }: { entrees: EntreeConsommation[]; periode: Periode; maintenant: number }) {
  const barres = useMemo(() => {
    const maintenant = new Date(instant);
    if (periode === "365") {
      const mois = Array.from({ length: 12 }, (_, i) => new Date(maintenant.getFullYear(), maintenant.getMonth() - 11 + i, 1));
      return mois.map((d) => ({
        cle: `${d.getFullYear()}-${d.getMonth()}`,
        libelle: nomMois(d),
        jetons: entrees.filter((e) => new Date(e.at).getFullYear() === d.getFullYear() && new Date(e.at).getMonth() === d.getMonth()).reduce((s, e) => s + totalJetons(e), 0),
      }));
    }
    const n = Number(periode);
    const parJour = new Map<string, number>();
    for (const e of entrees) parJour.set(cleJour(e.at), (parJour.get(cleJour(e.at)) ?? 0) + totalJetons(e));
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(maintenant.getTime() - (n - 1 - i) * UN_JOUR);
      return { cle: cleJour(d), libelle: dateCourte(d), jetons: parJour.get(cleJour(d)) ?? 0 };
    });
  }, [entrees, periode, instant]);
  const max = Math.max(...barres.map((b) => b.jetons), 1);
  const actifs = barres.filter((b) => b.jetons > 0).length;

  return (
    <div className="flex flex-col gap-1">
      <div
        role="img"
        aria-label={`${actifs} ${periode === "365" ? "mois" : "jours"} avec de l’activité sur la période, au plus ${compact(max)} jetons.`}
        className="flex h-20 items-end gap-[2px] rounded-md border border-bordure-subtile bg-fond-surface px-2 pt-2 pb-1.5"
      >
        {barres.map((b) => (
          <span
            key={b.cle}
            title={`${b.libelle} : ${b.jetons ? `${compact(b.jetons)} jetons` : "rien"}`}
            className={b.jetons ? "min-h-[3px] flex-1 rounded-t-[2px] bg-fond-accent" : "h-[2px] flex-1 rounded-[1px] bg-bordure-subtile"}
            style={b.jetons ? { height: `${Math.max(4, (b.jetons / max) * 100)}%` } : undefined}
          />
        ))}
      </div>
      <div className="flex justify-between px-0.5 text-ui-3xs text-texte-tertiaire">
        <span>{barres[0]?.libelle}</span>
        <span>{barres.at(-1)?.libelle}</span>
      </div>
    </div>
  );
}

/**
 * Ce que l'agent a consommé dans l'app, sur 7 jours, 30 jours ou un an : jetons, coût quand le
 * fournisseur le donne, appels, modèles. Tiré du journal de consommation, sans rien estimer.
 */
export function VueUtilisation({ role, lecture, onRetour }: { role: Role; lecture: Lecture<EntreeConsommation[]>; onRetour: () => void }) {
  const [periode, setPeriode] = useState<Periode>("30");
  // L'instant d'ouverture de la vue : les périodes se comptent depuis lui.
  const [maintenant] = useState(() => Date.now());

  const chiffres = useMemo(() => {
    if (lecture.etat !== "pret") return null;
    const depuis = maintenant - Number(periode) * UN_JOUR;
    const entrees = lecture.valeur.filter((e) => e.at >= depuis);
    const jetons = entrees.reduce((s, e) => s + totalJetons(e), 0);
    const avecCout = entrees.filter((e) => e.coutUsd !== null);
    const parModele = new Map<string, number>();
    for (const e of entrees) parModele.set(e.modele || e.fournisseur, (parModele.get(e.modele || e.fournisseur) ?? 0) + totalJetons(e));
    const somme = (cle: keyof EntreeConsommation["jetons"]) => entrees.reduce((s, e) => s + e.jetons[cle], 0);
    return {
      entrees,
      jetons,
      appels: entrees.length,
      cout: avecCout.length ? avecCout.reduce((s, e) => s + (e.coutUsd ?? 0), 0) : null,
      sansCout: entrees.length - avecCout.length,
      modeles: [...parModele.entries()].sort((a, b) => b[1] - a[1]),
      detail: [
        { libelle: "Entrée", valeur: somme("entree") },
        { libelle: "Sortie", valeur: somme("sortie") },
        { libelle: "Cache lu", valeur: somme("cacheLu") },
        { libelle: "Cache écrit", valeur: somme("cacheEcrit") },
      ],
    };
  }, [lecture, periode, maintenant]);

  return (
    <div className="flex flex-col gap-4 p-4">
      <EnteteVue titre="Utilisation" onRetour={onRetour} />
      <Onglets onglets={PERIODES} valeur={periode} onChange={setPeriode} libelle="Période" className="self-center" />

      {lecture.etat === "chargement" && <Note>Lecture du journal…</Note>}
      {lecture.etat === "erreur" && <Note erreur>{lecture.message}</Note>}
      {lecture.etat === "indisponible" && <Note>Le journal de consommation se lit dans l’app de bureau.</Note>}

      {chiffres && !chiffres.appels && <Note>Rien sur cette période : {role.name} n’a pas répondu par l’app.</Note>}
      {chiffres && chiffres.appels > 0 && (
        <>
          <div className="flex flex-col gap-0.5">
            <span className="klyra-mono text-h4 leading-[1.1] font-semibold tracking-[-0.03em] text-texte-principal">{compact(chiffres.jetons)} jetons</span>
            <span className="text-ui-xs text-texte-tertiaire">
              {chiffres.appels} appel{chiffres.appels > 1 ? "s" : ""}
              {chiffres.cout !== null ? ` · ${dollars(chiffres.cout)}` : ""}
            </span>
          </div>
          <Barres entrees={chiffres.entrees} periode={periode} maintenant={maintenant} />

          <section className="flex flex-col gap-1.5">
            <TitreGroupe>Jetons</TitreGroupe>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-md border border-bordure-subtile bg-bordure-subtile">
              {chiffres.detail.map((d) => (
                <div key={d.libelle} className="flex flex-col gap-0.5 bg-fond-surface px-3 py-2">
                  <span className="text-ui-2xs text-texte-tertiaire">{d.libelle}</span>
                  <span className="klyra-mono text-ui-s font-medium text-texte-principal">{compact(d.valeur)}</span>
                </div>
              ))}
            </div>
          </section>

          <section className="flex flex-col gap-1.5">
            <TitreGroupe>Par modèle</TitreGroupe>
            <ul className="m-0 flex list-none flex-col gap-px rounded-md border border-bordure-subtile bg-fond-surface p-1">
              {chiffres.modeles.map(([modele, n]) => (
                <li key={modele} className="flex items-center gap-2 px-2.5 py-2 text-ui-s">
                  <span className="min-w-0 flex-1 truncate text-texte-principal">{nomModele(modele)}</span>
                  <span className="klyra-mono shrink-0 text-ui-xs text-texte-tertiaire">{pourcent(n / (chiffres.jetons || 1))}</span>
                  <span className="klyra-mono w-16 shrink-0 text-right text-ui-xs text-texte-secondaire">{compact(n)}</span>
                </li>
              ))}
            </ul>
          </section>

          {chiffres.cout !== null && chiffres.sansCout > 0 && (
            <Note>
              Coût des appels dont le fournisseur donne le prix ; {chiffres.sansCout} appel{chiffres.sansCout > 1 ? "s" : ""} sans coût donné.
            </Note>
          )}
        </>
      )}
      <Note>
        Seulement ce qui est passé par l’app, d’après son journal.{" "}
        <Link href="/reglages?section=profil" className="text-texte-principal underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent">
          Tout voir dans le Profil
        </Link>
      </Note>
    </div>
  );
}
