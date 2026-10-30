"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bouton } from "@/components/ui/Bouton";
import { AgentRond } from "@/components/roles/AgentRond";
import { useAgents } from "@/lib/agents";
import { getBridge } from "@/lib/bridge";
import { dureeRun, libellePlanning, libelleRun, lienRun, quandRoutine, runActif } from "@/lib/routines-affichage";
import type { Routine, RoutineRun } from "@/types/routines";

interface Props {
  routine: Routine;
  revision: number;
  indisponible: boolean;
  onRetour(): void;
  onModifier(): void;
  onExecuter(): void;
  onPause(): void;
  onSupprimer(): void;
  onSimplifier(): void;
  onInterrompre(run: RoutineRun): void;
}

export function DetailRoutine({ routine: r, revision, indisponible, onRetour, onModifier, onExecuter, onPause, onSupprimer, onSimplifier, onInterrompre }: Props) {
  const { roles, tous } = useAgents();
  const nomAgent = roles.find((a) => a.id === r.agentId)?.name ?? tous.find((a) => a.role.id === r.agentId)?.role.name ?? r.agentId;
  const agentActif = roles.some((a) => a.id === r.agentId);
  const [lecture, setLecture] = useState<{ runs: RoutineRun[]; dates: string[]; erreur: string | null }>({ runs: [], dates: [], erreur: null });
  const [limite, setLimite] = useState(50);
  const titre = useRef<HTMLHeadingElement>(null);
  useEffect(() => { titre.current?.focus(); }, [r.id]);
  useEffect(() => {
    let annule = false;
    const api = getBridge()?.routines;
    if (!api) return;
    void Promise.all([api.historique(r.id, limite + 1), api.prochaines(r.id)]).then(([h, p]) => {
      if (annule) return;
      if (!h.ok || !p.ok) setLecture({ runs: [], dates: [], erreur: !h.ok ? h.message : !p.ok ? p.message : null });
      else setLecture({ runs: h.data, dates: p.data.filter((d) => Date.parse(d) <= Date.now() + 7 * 86_400_000).slice(0, 5), erreur: null });
    }).catch((e: unknown) => { if (!annule) setLecture({ runs: [], dates: [], erreur: String(e) }); });
    return () => { annule = true; };
  }, [r.id, revision, limite]);
  const actif = lecture.runs.find(runActif);
  const relais = !!r.relais?.length;
  const bloque = indisponible || !agentActif || relais;
  const prochaines = lecture.dates;
  const motif = relais ? "Choisis d’abord quoi conserver de cette ancienne chaîne." : !agentActif ? "Choisis un agent actif avant de lancer cette routine." : actif ? "Une exécution attend ou travaille déjà pour cette routine." : null;

  return (
    <section aria-labelledby="titre-routine" className="flex min-w-0 flex-col gap-5 rounded-3xl border border-bordure-subtile bg-fond-surface p-5">
      <div><Bouton variant="discret" onClick={onRetour} className="@4xl:hidden">← Toutes les routines</Bouton></div>
      <header className="flex flex-col gap-2">
        <h2 ref={titre} id="titre-routine" tabIndex={-1} className="m-0 break-words text-h4 font-semibold text-texte-principal">{r.name}</h2>
        <span className="flex items-center gap-2 text-ui-s text-texte-secondaire"><AgentRond roleId={r.agentId} taille={24} />{nomAgent}</span>
        <p className="m-0 text-ui-s text-texte-secondaire">{libellePlanning(r.schedule)} · {r.timezone}</p>
        <p className="m-0 text-ui-s text-texte-secondaire">{relais ? "Ancienne chaîne à examiner" : !agentActif ? "Agent indisponible" : !r.active ? "En pause" : r.schedule.kind === "manual" ? "À lancer quand tu veux" : `Prochaine : ${quandRoutine(r.nextRunAt, r.timezone)}`}</p>
      </header>

      {relais && <div className="rounded-lg border border-bordure-forte bg-fond-page p-4 text-ui-s text-texte-principal">
        <p className="m-0 font-semibold">Cette ancienne routine contient des relais entre agents.</p>
        <p>Elle est conservée en pause. Aucun relais ne sera lancé. Tu peux conserver seulement la consigne du premier agent ; une sauvegarde de l’ancienne chaîne reste sur cet ordinateur.</p>
        <details><summary className="cursor-pointer">Voir les {r.relais!.length} relais conservés</summary><ol className="my-3 space-y-3 pl-5">{r.relais!.map((l) => <li key={l.id}><strong>{l.de} → {l.vers}</strong><p className="whitespace-pre-wrap break-words">{l.consigne}</p></li>)}</ol></details>
        <Bouton disabled={indisponible || !agentActif} onClick={onSimplifier}>Garder seulement {nomAgent}</Bouton>
      </div>}
      {!agentActif && <div className="rounded-lg border border-bordure-forte bg-fond-page p-4 text-ui-s text-texte-principal">
        <p className="mt-0">{nomAgent} est désactivé, retiré ou absent de cet ordinateur. Aucun lancement ne lui sera confié.</p>
        <div className="flex flex-wrap items-center gap-3"><Bouton disabled={indisponible} onClick={onModifier}>Changer d’agent</Bouton><Link href="/equipe" className="underline underline-offset-2">Ouvrir l’équipe</Link></div>
      </div>}

      <div className="flex flex-wrap gap-2">
        <Bouton variant="sombre" disabled={bloque || !!actif} onClick={onExecuter}>Exécuter maintenant</Bouton>
        <Bouton disabled={indisponible || (!r.active && (!agentActif || relais))} onClick={onPause}>{r.active ? "Mettre en pause" : "Reprendre"}</Bouton>
        <Bouton disabled={indisponible} onClick={onModifier}>Modifier</Bouton>
        <Bouton disabled={indisponible || !!actif} onClick={onSupprimer}>Supprimer</Bouton>
      </div>
      {motif && <p className="-mt-3 mb-0 text-ui-s text-texte-secondaire">{motif}</p>}
      <p className="m-0 text-ui-s text-texte-secondaire">Exécuter maintenant ne décale pas le planning. La pause suspend les prochains départs ; pour arrêter le travail actuel, utilise « Interrompre ».</p>

      {actif && <div className="flex flex-col gap-3 rounded-lg border border-bordure-forte bg-fond-page p-4">
        <p role="status" className="m-0 text-ui-s font-semibold text-texte-principal">{libelleRun(actif)}{actif.status === "queued" ? " · l’agent peut être occupé" : ""}</p>
        <div className="flex flex-wrap items-center gap-3">
          <Bouton disabled={indisponible} onClick={() => onInterrompre(actif)}>{actif.status === "queued" ? "Annuler le départ" : "Interrompre"}</Bouton>
          {lienRun(actif) && <Link href={lienRun(actif)!} className="text-ui-s text-texte-principal underline underline-offset-2">{actif.status === "needs-attention" ? "Répondre dans la conversation" : "Ouvrir la conversation"}</Link>}
        </div>
        {actif.status === "needs-attention" && <p className="m-0 text-ui-s text-texte-secondaire">L’agent attend une autorisation. Ce run reste en attente jusqu’à ta réponse ou son interruption.</p>}
      </div>}

      <details className="text-ui-s text-texte-principal"><summary className="cursor-pointer font-semibold">Consigne</summary><p className="whitespace-pre-wrap break-words">{r.instruction}</p></details>
      {r.schedule.kind !== "manual" && <section className="text-ui-s text-texte-secondaire">
        <h3 className="mt-0 text-ui font-semibold text-texte-principal">Les prochains départs</h3>
        {!r.active || !agentActif || relais ? <p>Aucun départ tant que la routine est en pause ou bloquée.</p> : prochaines.length ? <ul className="space-y-1 pl-5">{prochaines.map((d) => <li key={d}>{quandRoutine(d, r.timezone)}</li>)}</ul> : <p>Aucun départ dans les sept prochains jours.</p>}
        <p className="mb-0">Au retour de veille ou après fermeture : {r.missedPolicy === "skip" ? "ignorer les échéances manquées" : "lancer une seule fois la dernière échéance manquée"}. Aucun rattrapage en rafale. Un retard de moins de cinq minutes est exécuté normalement.</p>
      </section>}

      <section aria-labelledby="historique-routine" className="min-w-0 border-t border-bordure-subtile pt-5">
        <h3 id="historique-routine" className="mt-0 text-ui font-semibold text-texte-principal">Historique</h3>
        {lecture.erreur && <p role="alert" className="text-ui-s text-texte-principal">{lecture.erreur}</p>}
        {!lecture.erreur && !lecture.runs.length && <p className="text-ui-s text-texte-secondaire">Aucune exécution pour le moment.</p>}
        <ol className="m-0 flex list-none flex-col gap-3 p-0">{lecture.runs.slice(0, limite).map((run) => <li key={run.id} className="min-w-0 rounded-lg border border-bordure-subtile p-3 text-ui-s text-texte-secondaire">
          <p className="m-0 font-semibold text-texte-principal">{libelleRun(run)} <span className="font-normal">· {run.kind === "manual" ? "Manuelle" : "Programmée"}{dureeRun(run) ? ` · ${dureeRun(run)}` : ""}</span></p>
          <p className="my-1">{quandRoutine(run.scheduledFor, r.timezone)} · {r.timezone}</p>
          {run.error && <p className="whitespace-pre-wrap break-words text-texte-principal">{run.error}</p>}
          {run.result && <p className="line-clamp-4 whitespace-pre-wrap break-words">{run.result}</p>}
          {(run.instruction !== r.instruction || run.routineName !== r.name || run.agentId !== r.agentId) && <details className="my-2"><summary className="cursor-pointer">Consigne et agent lors du lancement</summary><p>{run.routineName} · {run.agentId}</p><p className="whitespace-pre-wrap break-words">{run.instruction}</p></details>}
          {lienRun(run) && <Link href={lienRun(run)!} className="text-texte-principal underline underline-offset-2">{run.status === "needs-attention" ? "Répondre dans la conversation" : "Voir la conversation"}</Link>}
        </li>)}</ol>
        {lecture.runs.length > limite && <Bouton className="mt-3" onClick={() => setLimite((n) => n + 50)}>Voir les exécutions précédentes</Bouton>}
      </section>
    </section>
  );
}
