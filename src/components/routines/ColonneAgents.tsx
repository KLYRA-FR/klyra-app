"use client";

import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { LIGNE, LIGNE_ACTIVE, LIGNE_REPOS } from "@/components/shell/LignesBarre";
import { cn } from "@/lib/cn";
import { poste } from "@/lib/plateforme";
import { quandRoutine } from "@/lib/routines-affichage";
import type { Routine, RoutineRun } from "@/types/routines";

export interface AgentRoutine { id: string; name: string; tag: string; title: string; actif: boolean; connu: boolean }

export function apercuAgent(agent: AgentRoutine, routines: Routine[], runs: RoutineRun[], brouillon?: string, charge = true) {
  if (!charge) return "";
  const liste = routines.filter((r) => r.agentId === agent.id);
  const actifs = runs.filter((r) => r.agentId === agent.id);
  if (actifs.some((r) => r.status === "needs-attention")) return "Attend ton accord";
  if (actifs.some((r) => r.status === "running")) return "Routine en cours";
  if (actifs.some((r) => r.status === "queued")) return "Routine en attente";
  if (brouillon === agent.id) return "Brouillon non enregistré";
  if (liste.some((r) => r.relais?.length)) return "Ancienne chaîne à examiner";
  if (!agent.actif) return agent.connu ? "Désactivé" : "Absent de cet ordinateur";
  if (!liste.length) return "Aucune routine";
  const prochaine = liste.filter((r) => r.active && r.nextRunAt && !r.relais?.length).sort((a, b) => a.nextRunAt!.localeCompare(b.nextRunAt!))[0];
  return `${liste.length} routine${liste.length > 1 ? "s" : ""} · ${prochaine ? `prochaine ${quandRoutine(prochaine.nextRunAt, prochaine.timezone)}` : "aucune prévue"}`;
}

export function ColonneAgents({ agents, choisi, routines, runs, brouillon, charge, onChoisir }: {
  agents: AgentRoutine[]; choisi: string; routines: Routine[]; runs: RoutineRun[]; brouillon?: string; charge: boolean; onChoisir(id: string): void;
}) {
  return <nav aria-label="Agents" className="klyra-routines-colonne flex min-h-0 w-[280px] shrink-0 flex-col border-r border-bordure-subtile bg-fond-surface">
    <div className="min-h-0 flex-1 overflow-y-auto p-2">{[true, false].map((actif) => {
      const groupe = agents.filter((a) => a.actif === actif);
      return groupe.length ? <section key={String(actif)} aria-label={actif ? "Mes agents" : "Hors de Mes agents"}>
        <h2 className="m-0 px-2 pt-2 pb-1 text-ui-2xs font-medium text-texte-secondaire">{actif ? "Mes agents" : "Hors de Mes agents"}</h2>
        {groupe.map((a) => <button key={a.id} type="button" aria-current={a.id === choisi ? "true" : undefined} onClick={() => onChoisir(a.id)} className={cn(LIGNE, "w-full cursor-pointer border-0 bg-transparent text-left", a.id === choisi ? LIGNE_ACTIVE : LIGNE_REPOS)}>
          <AgentRond roleId={a.id} taille={36} fondPastille="surface" statut={runs.some((r) => r.agentId === a.id && r.status === "running") ? { type: "travaille" } : null} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5"><span className="flex min-w-0 items-center gap-1.5"><strong className="truncate text-ui-s font-semibold text-texte-principal">{a.name}</strong><span className="shrink-0 rounded-sm bg-fond-surface-grise px-1.5 text-ui-2xs text-texte-secondaire">{a.tag}</span></span><span className="truncate text-ui-xs text-texte-secondaire">{apercuAgent(a, routines, runs, brouillon, charge)}</span></span>
        </button>)}
      </section> : null;
    })}</div>
    <p className="m-0 border-t border-bordure-subtile p-3 text-ui-xs text-texte-secondaire"><Icon name="clock-01" size={14} className="mr-1 inline text-icone-secondaire" />Les routines partent de {poste.ce} tant que KLYRA est ouverte. App fermée ou en veille, rien ne part.</p>
  </nav>;
}
