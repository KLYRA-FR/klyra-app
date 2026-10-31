"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { useAgents } from "@/lib/agents";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { apparition } from "@/lib/mouvement";
import { dureeRun, libelleRun, lienRun, quandRoutine } from "@/lib/routines-affichage";
import type { Routine, RoutineRun } from "@/types/routines";
import { MarqueRun } from "./MarqueRun";

interface Props {
  routine: Routine;
  revision: number;
  actif?: RoutineRun;
  indisponible: boolean;
  className?: string;
  onFermer(): void;
  onInterrompre(run: RoutineRun): void;
}

interface Lecture {
  runs: RoutineRun[];
  dates: string[];
  erreur: string | null;
  charge: boolean;
}

/** Une nouvelle sélection repart à cinquante lignes et ne montre jamais l'ancien historique. */
export function PanneauExecutions(props: Props) {
  return <ExecutionsRoutine key={props.routine.id} {...props} />;
}

function ExecutionsRoutine({ routine: r, revision, actif, indisponible, className, onFermer, onInterrompre }: Props) {
  const { roles, tous } = useAgents();
  const [limite, setLimite] = useState(50);
  const [essai, setEssai] = useState(0);
  const [lecture, setLecture] = useState<Lecture>({ runs: [], dates: [], erreur: null, charge: false });
  const id = useId();
  const agentActif = roles.some((agent) => agent.id === r.agentId);
  const nomAgent = (agentId: string) => roles.find((agent) => agent.id === agentId)?.name
    ?? tous.find((agent) => agent.role.id === agentId)?.role.name ?? agentId;

  useEffect(() => {
    let annule = false;
    const api = getBridge()?.routines;
    const lire = async () => {
      try {
        if (!api) throw new Error("Le moteur des routines n’est pas disponible.");
        const [historique, prochaines] = await Promise.all([
          api.historique(r.id, limite + 1),
          r.schedule.kind === "manual" ? Promise.resolve({ ok: true as const, data: [] as string[] }) : api.prochaines(r.id),
        ]);
        if (annule) return;
        if (!historique.ok) throw new Error(historique.message);
        if (!prochaines.ok) throw new Error(prochaines.message);
        const maintenant = Date.now();
        setLecture({
          runs: historique.data,
          dates: prochaines.data.filter((date) => Date.parse(date) >= maintenant && Date.parse(date) <= maintenant + 7 * 86_400_000).slice(0, 5),
          erreur: null,
          charge: true,
        });
      } catch (error) {
        if (!annule) setLecture({ runs: [], dates: [], erreur: error instanceof Error ? error.message : String(error), charge: true });
      }
    };
    void lire();
    return () => { annule = true; };
  }, [r.id, r.schedule.kind, revision, limite, essai]);

  const runs = actif ? [actif, ...lecture.runs.filter((run) => run.id !== actif.id)] : lecture.runs;
  const bloque = !r.active || !agentActif || !!r.relais?.length || indisponible;

  return (
    <aside ref={apparition} aria-label="Exécutions"
      onKeyDown={(event) => {
        if (event.key === "Escape" && !event.defaultPrevented) {
          event.preventDefault();
          event.stopPropagation();
          onFermer();
        }
      }}
      className={cn("flex min-h-0 w-[300px] shrink-0 flex-col border-l border-bordure-subtile bg-fond-surface", className)}>
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <h2 className="m-0 min-w-0 flex-1 text-ui font-semibold text-texte-principal">Exécutions</h2>
        <BoutonIcone taille="mini" icone={<Icon name="x-01" size={16} />} libelle="Fermer l’historique" onClick={onFermer} />
      </div>
      <p className="m-0 truncate px-4 pb-3 text-ui-xs text-texte-secondaire" title={r.name}>{r.name}</p>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {lecture.erreur && <div role="alert" className="mx-2 mb-3 flex flex-col items-start gap-2 text-ui-xs text-texte-erreur">
          <p className="m-0 break-words">{lecture.erreur}</p>
          <Bouton taille="mini" disabled={indisponible} onClick={() => setEssai((n) => n + 1)}>Réessayer</Bouton>
        </div>}
        {!lecture.charge && <p role="status" className="m-0 px-2 pb-3 text-ui-xs text-texte-secondaire">Chargement des exécutions…</p>}
        {r.schedule.kind !== "manual" && <section aria-labelledby={`${id}-avenir`} className="px-2 pb-4 text-ui-xs text-texte-secondaire">
          <h3 id={`${id}-avenir`} className="mt-0 mb-2 text-ui-s font-medium text-texte-principal">À venir</h3>
          {bloque ? <p>Aucun départ tant que la routine est en pause ou bloquée.</p>
            : lecture.dates.length ? <ul className="my-2 space-y-1 pl-4">{lecture.dates.map((date) => <li key={date}>{quandRoutine(date, r.timezone)}</li>)}</ul>
              : lecture.charge && !lecture.erreur ? <p>Aucun départ dans les sept prochains jours.</p> : null}
          <p className="mb-0">Au retour de veille ou après fermeture : {r.missedPolicy === "skip" ? "ignorer les échéances manquées" : "lancer une seule fois la dernière échéance manquée"}. Aucun rattrapage en rafale. Un retard de moins de cinq minutes est exécuté normalement.</p>
        </section>}
        <section aria-labelledby={`${id}-historique`} className="min-w-0">
          <h3 id={`${id}-historique`} className="m-0 px-2 pb-2 text-ui-s font-medium text-texte-principal">Exécutions</h3>
          {lecture.charge && !lecture.erreur && !runs.length && <p className="m-0 px-2 text-ui-s text-texte-secondaire">Aucune exécution pour l’instant. Lance la routine depuis sa carte.</p>}
          <ol className="m-0 flex list-none flex-col gap-0.5 p-0">{runs.slice(0, limite).map((run) => {
            const lien = lienRun(run);
            const duree = dureeRun(run);
            const enCours = actif?.id === run.id;
            const changee = run.instruction !== r.instruction || run.routineName !== r.name || run.agentId !== r.agentId;
            return <li key={run.id} className="flex min-w-0 flex-col gap-1 rounded-md px-3 py-2.5 text-ui-xs text-texte-secondaire">
              <div className="flex items-center gap-2">
                <MarqueRun run={run} />
                <span className="min-w-0 flex-1 text-ui-s font-medium text-texte-principal" role={enCours ? "status" : undefined}>{libelleRun(run)}</span>
                <span className="shrink-0 text-ui-2xs text-texte-secondaire">{run.kind === "manual" ? "Manuelle" : "Planifiée"}</span>
              </div>
              <p className="m-0">{quandRoutine(run.scheduledFor, r.timezone)}{duree ? ` · ${duree}` : ""}</p>
              {run.error && <p className="m-0 line-clamp-2 whitespace-pre-wrap break-words text-texte-erreur">{run.error}</p>}
              {run.result && <p className="m-0 line-clamp-2 whitespace-pre-wrap break-words">{run.result}</p>}
              {run.status === "needs-attention" && <p className="m-0">L’agent attend une autorisation.</p>}
              {changee && <details className="my-1 min-w-0">
                <summary className="cursor-pointer">Consigne et agent lors du lancement</summary>
                <p className="my-2 break-words">{run.routineName} · {nomAgent(run.agentId)}</p>
                <p className="my-2 whitespace-pre-wrap break-words">{run.instruction}</p>
              </details>}
              {lien && <Link href={lien} className="self-start text-bleu-k1-500 underline underline-offset-2">{run.status === "needs-attention" ? "Répondre dans la conversation" : "Voir la conversation"}</Link>}
              {enCours && <Bouton taille="mini" variant="blanc" className="mt-1 self-start" disabled={indisponible} onClick={() => onInterrompre(run)}>{run.status === "queued" ? "Annuler le départ" : "Interrompre"}</Bouton>}
            </li>;
          })}</ol>
          {lecture.runs.length > limite && <Bouton taille="mini" className="mx-2 mt-3" disabled={indisponible} onClick={() => setLimite((n) => n + 50)}>Voir les exécutions précédentes</Bouton>}
        </section>
      </div>
    </aside>
  );
}
