"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { useAgents } from "@/lib/agents";
import { getBridge, type EntreeConsommation } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { nomAbonnement, useCompteClaude } from "@/lib/compte-claude";
import { calculer, cleJour, compact, dateAnnee, dateCourte, NOMS_JOURS, type Serie } from "@/lib/consommation";
import { useWorkspace } from "@/lib/workspace";
import { ancreReglage, Groupe, Ligne } from "../ui";

/** Le journal de consommation de l'année (vide dans un navigateur). */
function useJournal() {
  const [journal, setJournal] = useState<{ entrees: EntreeConsommation[]; depuis: number | null } | null>(() =>
    getBridge()?.consommation ? null : { entrees: [], depuis: null },
  );
  useEffect(() => {
    void getBridge()
      ?.consommation?.lire()
      .then((r) => setJournal(r.ok ? r.data : { entrees: [], depuis: null }));
  }, []);
  return journal;
}

function Chiffre({ libelle, valeur, detail }: { libelle: string; valeur: ReactNode; detail: ReactNode }) {
  return (
    <div className="klyra-carte-flottante flex min-w-0 flex-col gap-1 rounded-lg p-3.5">
      <span className="text-ui-xs text-texte-tertiaire">{libelle}</span>
      <span className="klyra-mono truncate text-[20px] leading-tight font-semibold tracking-[-0.02em] text-texte-principal">{valeur}</span>
      <span className="text-ui-2xs leading-[1.4] text-texte-tertiaire">{detail}</span>
    </div>
  );
}

function texteSerie(s: Serie, actuelle: boolean): string {
  if (!s.jours || !s.debut || !s.fin) return "Aucune pour l’instant";
  if (actuelle) return `Depuis le ${dateCourte(s.debut)}`;
  return s.jours === 1 ? `Le ${dateAnnee(s.debut)}` : `${dateCourte(s.debut)} – ${dateAnnee(s.fin)}`;
}

const NIVEAUX = ["bg-fond-surface-grise", "bg-bleu-k1-100", "bg-bleu-k1-300", "bg-bleu-k1-400", "bg-bleu-k1-500"];

/** Un an, jour par jour : une colonne par semaine (du lundi au dimanche), plus c'est bleu, plus il y a eu de messages. */
function Chaleur({ parJour }: { parJour: Map<string, number> }) {
  const { semaines, mois, max } = useMemo(() => {
    const aujourdhui = new Date();
    aujourdhui.setHours(0, 0, 0, 0);
    // Du lundi de la semaine d'il y a un an au dimanche de cette semaine, en jours du calendrier.
    const debut = new Date(aujourdhui);
    debut.setDate(debut.getDate() - 364);
    debut.setDate(debut.getDate() - ((debut.getDay() + 6) % 7));
    const fin = new Date(aujourdhui);
    fin.setDate(fin.getDate() + ((7 - fin.getDay()) % 7));
    const semaines: { cle: string; date: Date; n: number; futur: boolean }[][] = [];
    const mois: { colonne: number; nom: string }[] = [];
    for (const d = new Date(debut); d <= fin; d.setDate(d.getDate() + 1)) {
      if (d.getDay() === 1) semaines.push([]);
      const col = semaines.length - 1;
      if (d.getDate() === 1 && d <= aujourdhui) mois.push({ colonne: col, nom: d.toLocaleDateString("fr-FR", { month: "short" }) });
      semaines[col].push({ cle: cleJour(d), date: new Date(d), n: parJour.get(cleJour(d)) ?? 0, futur: d > aujourdhui });
    }
    return { semaines, mois, max: Math.max(0, ...parJour.values()) };
  }, [parJour]);

  const niveau = (n: number) => (!n || !max ? 0 : Math.min(4, Math.ceil((n / max) * 4)));

  /* Les colonnes se partagent la largeur de la carte : l'année entière tient, aujourd'hui compris. */
  return (
    <div className="flex w-full flex-col gap-1.5">
      <div className="relative h-4 text-ui-3xs text-texte-tertiaire">
        {mois.map((m) => (
          <span key={`${m.colonne}-${m.nom}`} className="absolute top-0" style={{ left: `${(m.colonne / semaines.length) * 100}%` }}>
            {m.nom}
          </span>
        ))}
      </div>
      <div
        role="img"
        aria-label={`Activité sur un an : ${[...parJour.values()].filter(Boolean).length} jours actifs`}
        className="grid gap-[2px]"
        style={{ gridTemplateColumns: `repeat(${semaines.length}, minmax(0, 1fr))` }}
      >
        {semaines.map((s, i) => (
          <div key={i} className="flex flex-col gap-[2px]">
            {s.map((j) => (
              <span
                key={j.cle}
                title={j.futur ? undefined : `${j.n} message${j.n > 1 ? "s" : ""} le ${dateAnnee(j.date)}`}
                className={cn("aspect-square w-full max-w-[12px] rounded-[2px]", j.futur ? "bg-transparent" : NIVEAUX[niveau(j.n)])}
              />
            ))}
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="flex items-center justify-end gap-[3px] text-ui-3xs text-texte-tertiaire">
        <span className="mr-1">Moins</span>
        {NIVEAUX.map((c) => (
          <span key={c} className={cn("size-[10px] rounded-[2px]", c)} />
        ))}
        <span className="ml-1">Plus</span>
      </div>
    </div>
  );
}

function Barre({ libelle, part, detail }: { libelle: string; part: number; detail: string }) {
  return (
    <div className="flex items-center gap-3 py-2.5 text-ui-s">
      <span className="w-[180px] shrink-0 truncate text-texte-principal" title={libelle}>
        {libelle}
      </span>
      <span className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-pill bg-fond-surface-grise">
        <span className="absolute inset-y-0 left-0 rounded-pill bg-bleu-k1-500" style={{ width: `${Math.max(1, part * 100)}%` }} />
      </span>
      <span className="klyra-mono w-12 shrink-0 text-right text-ui-xs text-texte-secondaire" title={detail}>
        {Math.round(part * 100)} %
      </span>
    </div>
  );
}

/** Une ligne de l'aperçu : libellé à gauche, valeur à droite, explication dessous. */
function Info({ libelle, valeur, aide }: { libelle: string; valeur: ReactNode; aide?: string }) {
  return (
    <div className="flex flex-col gap-0.5 py-3">
      <div className="flex items-baseline justify-between gap-3 text-ui-s">
        <span className="text-texte-secondaire">{libelle}</span>
        <span className="truncate text-right font-medium text-texte-principal">{valeur}</span>
      </div>
      {aide && <span className="text-ui-2xs leading-[1.4] text-texte-tertiaire">{aide}</span>}
    </div>
  );
}

/** Ce qu'on affiche tant qu'une donnée n'existe pas encore : jamais de chiffre inventé. */
function Vide({ children }: { children: ReactNode }) {
  return <p className="m-0 py-3 text-ui-xs leading-[1.45] text-texte-tertiaire">{children}</p>;
}

/**
 * La consommation sur cet ordinateur : chiffres clés, activité de l'année,
 * aperçu, coéquipiers, modèles et compte. Messages et jours actifs viennent de
 * l'historique des conversations ; jetons et coûts du journal que l'app tient
 * depuis cette version (electron/consommation.ts).
 */
export function Consommation() {
  const router = useRouter();
  const { state } = useWorkspace();
  const { roles } = useAgents();
  const { compte } = useCompteClaude();
  const journal = useJournal();
  const stats = useMemo(() => calculer(state.messages, journal?.entrees ?? []), [state.messages, journal]);

  const nomAgent = (id: string) => roles.find((r) => r.id === id)?.name ?? (id === "principal" ? "Principal" : id);
  const depuis = journal?.depuis ? `Comptés depuis le ${dateAnnee(new Date(journal.depuis))}` : "Comptés à partir de cette version";
  const totalFournisseurs = stats.fournisseurs.reduce((s, f) => s + f.jetons, 0);
  const totalModeles = stats.modeles.reduce((s, m) => s + m.jetons, 0);
  const abonnement = compte?.methode === "claude.ai";

  return (
    <>
      <div id={ancreReglage("chiffres")} className="klyra-reglage grid scroll-mt-6 grid-cols-2 gap-2.5 rounded-lg @lg:grid-cols-3 @2xl:grid-cols-5">
        <Chiffre libelle="Jetons" valeur={stats.jetons === null ? "—" : compact(stats.jetons)} detail={stats.jetons === null ? depuis : "Sur un an"} />
        <Chiffre
          libelle="Jour record"
          valeur={stats.jourRecord ? compact(stats.jourRecord.jetons) : "—"}
          detail={stats.jourRecord ? dateAnnee(stats.jourRecord.jour) : "Pas encore de jetons comptés"}
        />
        <Chiffre libelle="Messages" valeur={compact(stats.messages)} detail="Sur un an" />
        <Chiffre
          libelle="Série actuelle"
          valeur={`${stats.serieActuelle.jours} jour${stats.serieActuelle.jours > 1 ? "s" : ""}`}
          detail={texteSerie(stats.serieActuelle, true)}
        />
        <Chiffre
          libelle="Plus longue série"
          valeur={`${stats.plusLongueSerie.jours} jour${stats.plusLongueSerie.jours > 1 ? "s" : ""}`}
          detail={texteSerie(stats.plusLongueSerie, false)}
        />
      </div>

      <Groupe titre="Activité sur cet ordinateur" description={`${stats.joursActifs} jour${stats.joursActifs > 1 ? "s" : ""} actif${stats.joursActifs > 1 ? "s" : ""} sur un an`}>
        <div id={ancreReglage("activite")} className="klyra-reglage -mx-4 scroll-mt-6 px-4 py-4">
          <Chaleur parJour={stats.messagesParJour} />
        </div>
      </Groupe>

      <div className="grid grid-cols-1 gap-6 @2xl:grid-cols-2">
        <Groupe titre="Aperçu">
          <div id={ancreReglage("apercu")} className="klyra-reglage -mx-4 scroll-mt-6 divide-y divide-bordure-subtile px-4">
            <Info
              libelle="Fournisseur principal"
              valeur={stats.fournisseurs[0] && totalFournisseurs ? `${stats.fournisseurs[0].nom} · ${Math.round((stats.fournisseurs[0].jetons / totalFournisseurs) * 100)} %` : "—"}
            />
            <Info libelle="Modèle principal" valeur={stats.modeles[0]?.nom ?? "—"} />
            <Info libelle="Jour le plus actif" valeur={stats.jourLePlusActif === null ? "—" : NOMS_JOURS[stats.jourLePlusActif]} />
            <Info
              libelle="Coût estimé"
              valeur={stats.coutUsd === null ? "—" : `${stats.coutUsd.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} $US`}
              aide={
                stats.coutUsd === null
                  ? "Le coût de chaque réponse de Claude Code, à partir de cette version."
                  : abonnement
                    ? "Indicatif : avec l’abonnement claude.ai, c’est un équivalent, pas une facture."
                    : "Renvoyé par Claude Code, réponse par réponse."
              }
            />
          </div>
        </Groupe>

        <Groupe titre="Coéquipiers les plus actifs">
          <div id={ancreReglage("coequipiers")} className="klyra-reglage -mx-4 scroll-mt-6 px-4">
            {stats.agents.length || stats.reponsesParAgent.length ? (
              <ul className="m-0 flex list-none flex-col divide-y divide-bordure-subtile p-0">
                {(stats.agents.length ? stats.agents.map((a) => ({ id: a.id, valeur: compact(a.jetons), unite: "jetons" })) : stats.reponsesParAgent.map((a) => ({ id: a.id, valeur: String(a.reponses), unite: a.reponses > 1 ? "réponses" : "réponse" })))
                  .slice(0, 5)
                  .map((a) => (
                    <li key={a.id} className="flex items-center gap-3 py-2.5">
                      <AgentRond roleId={a.id} taille={24} fondPastille="surface" />
                      <span className="min-w-0 flex-1 truncate text-ui-s text-texte-principal">{nomAgent(a.id)}</span>
                      <span className="klyra-mono text-ui-s font-medium text-texte-principal">
                        {a.valeur} <span className="font-normal text-texte-tertiaire">{a.unite}</span>
                      </span>
                    </li>
                  ))}
              </ul>
            ) : (
              <Vide>Aucun agent n’a encore répondu sur cet ordinateur.</Vide>
            )}
            {!stats.agents.length && stats.reponsesParAgent.length > 0 && <Vide>Classés par réponses : les jetons de chaque agent se comptent à partir de cette version.</Vide>}
          </div>
        </Groupe>
      </div>

      <Groupe titre="Utilisation des modèles" description="Part des jetons, tous fournisseurs confondus.">
        <div id={ancreReglage("modeles-utilisation")} className="klyra-reglage -mx-4 scroll-mt-6 divide-y divide-bordure-subtile px-4">
          {stats.modeles.length && totalModeles ? (
            stats.modeles.slice(0, 6).map((m) => <Barre key={m.nom} libelle={m.nom} part={m.jetons / totalModeles} detail={`${compact(m.jetons)} jetons · ${m.fournisseur}`} />)
          ) : (
            <Vide>{depuis} : chaque réponse de Claude Code et des autres IA viendra remplir cette liste.</Vide>
          )}
        </div>
      </Groupe>

      <Groupe titre="Compte">
        <Ligne id="compte-profil" libelle="Claude" description={compte?.connecte ? `${compte.email ?? ""}${compte.abonnement ? ` · abonnement ${nomAbonnement(compte.abonnement)}` : ""}` : "Pas connecté."}>
          <Bouton variant="blanc" taille="compact" onClick={() => router.push("/reglages?section=claude")}>
            Gérer
          </Bouton>
        </Ligne>
      </Groupe>
    </>
  );
}
