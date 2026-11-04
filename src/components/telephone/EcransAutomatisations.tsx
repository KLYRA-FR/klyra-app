"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Onglets } from "@/components/ui/Onglets";
import { AgentsRoutinesTelephone, RoutinesAgentTelephone } from "./RoutinesTelephone";
import { WorkflowsListeTelephone, WorkflowTelephone } from "./WorkflowsTelephone";
import { ONGLETS_TELEPHONE } from "./CommunAgentsTelephone";

/**
 * Automatisations : routines et workflows (T-14 à T-19). Route : /routines, mêmes paramètres qu'au
 * bureau (`vue=routines|workflows`, `agent`, `routine`), plus `formulaire=1` (T-16 en page pleine),
 * `workflow` et `version` (T-19). Tout est lu et fait sur l'ordinateur ouvert ; une routine d'un VPS
 * y passe aussi, comme au bureau (le main la route vers son VPS).
 */
export function AutomatisationsTelephone() {
  const recherche = useSearchParams();
  const router = useRouter();
  const vue = recherche.get("vue") === "workflows" ? "workflows" : "routines";
  const onglets = (
    <Onglets<"routines" | "workflows">
      libelle="Automatisations"
      valeur={vue}
      onChange={(o) => router.replace(`/routines?vue=${o}`)}
      className={ONGLETS_TELEPHONE}
      onglets={[
        { id: "routines", label: "Routines", icone: <Icon name="calendar-01" size={16} /> },
        { id: "workflows", label: "Workflows", icone: <Icon name="lightning-01" size={16} /> },
      ]}
    />
  );

  if (vue === "workflows") {
    const workflow = recherche.get("workflow");
    return workflow ? <WorkflowTelephone key={workflow} id={workflow} versionId={recherche.get("version")} /> : <WorkflowsListeTelephone onglets={onglets} />;
  }
  const agent = recherche.get("agent");
  return agent ? (
    <RoutinesAgentTelephone key={agent} agentId={agent} routineId={recherche.get("routine")} formulaire={recherche.get("formulaire") === "1"} />
  ) : (
    <AgentsRoutinesTelephone onglets={onglets} routineDemandee={recherche.get("routine")} />
  );
}
