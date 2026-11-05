"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Segments } from "./Controles";
import { AgentsRoutinesTelephone, RoutinesAgentTelephone } from "./RoutinesTelephone";
import { WorkflowsListeTelephone, WorkflowTelephone } from "./WorkflowsTelephone";

/**
 * Automatisations : routines et workflows (lot 7). Route : /routines, mêmes paramètres qu'au bureau
 * (`vue=routines|workflows`, `agent`, `routine`), plus `formulaire=1` (page pleine), `workflow`,
 * `version` et `executions=1`. Tout est lu et fait sur l'ordinateur ouvert ; une routine d'un VPS y
 * passe aussi, comme au bureau (le main la route vers son VPS).
 */
export function AutomatisationsTelephone() {
  const recherche = useSearchParams();
  const router = useRouter();
  const vue = recherche.get("vue") === "workflows" ? "workflows" : "routines";
  const onglets = (
    <Segments<"routines" | "workflows">
      libelle="Automatisations"
      valeur={vue}
      onChange={(o) => router.replace(`/routines?vue=${o}`)}
      segments={[
        { id: "routines", label: "Routines", icone: <Icon name="calendar-01" size={16} /> },
        { id: "workflows", label: "Workflows", icone: <Icon name="lightning-01" size={16} /> },
      ]}
    />
  );

  if (vue === "workflows") {
    const workflow = recherche.get("workflow");
    return workflow ? (
      <WorkflowTelephone key={workflow} id={workflow} versionId={recherche.get("version")} executionsOuvertes={recherche.get("executions") === "1"} />
    ) : (
      <WorkflowsListeTelephone onglets={onglets} />
    );
  }
  const agent = recherche.get("agent");
  return agent ? (
    <RoutinesAgentTelephone key={agent} agentId={agent} routineId={recherche.get("routine")} formulaire={recherche.get("formulaire") === "1"} />
  ) : (
    <AgentsRoutinesTelephone onglets={onglets} routineDemandee={recherche.get("routine")} />
  );
}
