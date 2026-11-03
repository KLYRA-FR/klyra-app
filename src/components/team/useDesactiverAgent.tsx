"use client";

import type { ReactNode } from "react";
import { useConfirmation } from "@/components/ui/Modale";
import { useAgents } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { useRoutines } from "@/lib/routines";
import { useWorkspace } from "@/lib/workspace";
import type { Role } from "@/types/domain";

/**
 * Désactiver un agent, depuis sa fiche ou le clic droit : la même question (ce qu'il fait en ce
 * moment, ses routines), puis sa réponse en cours arrêtée. Renvoie vrai s'il est désactivé ;
 * une erreur du disque remonte à l'appelant.
 */
export function useDesactiverAgent(): [(role: Role) => Promise<boolean>, ReactNode] {
  const { roles, activer } = useAgents();
  const { state, arreter } = useWorkspace();
  const { routines } = useRoutines();
  const [demander, fenetre] = useConfirmation();

  const desactiver = async (role: Role) => {
    const enCours = Object.entries(state.travail).filter(([, t]) => t.roleId === role.id).map(([chatId]) => chatId);
    const nombreRoutines = routines.filter((r) => r.agentId === role.id).length;
    const oui = await demander({
      titre: `Désactiver ${role.name} ?`,
      texte: (
        <div className="flex flex-col gap-2">
          <p className="m-0">
            {role.name} ne pourra plus être appelé dans KLYRA : ni par toi, ni par {roles[0].name}, ni par tes autres agents. Ses conversations et sa fiche
            sont gardées, et tu pourras le réactiver. Cela ne vaut que pour KLYRA : sa fiche reste dans ~/.claude/agents, et Claude Code dans le terminal ou
            tes autres outils l’utilisent comme avant.
          </p>
          {enCours.length > 0 && <p className="m-0">Il travaille en ce moment : sa réponse en cours sera arrêtée.</p>}
          {nombreRoutines > 0 && (
            <p className="m-0">
              {nombreRoutines > 1
                ? `${nombreRoutines} routines lui sont confiées : elles échoueront tant qu’il est désactivé. Change leur agent ou mets-les en pause dans Automatisations.`
                : "1 routine lui est confiée : elle échouera tant qu’il est désactivé. Change son agent ou mets-la en pause dans Automatisations."}
            </p>
          )}
        </div>
      ),
      confirmer: "Désactiver",
    });
    if (!oui) return false;
    enCours.forEach((chatId) => arreter(chatId));
    await activer(role.id, false);
    annoncer(`${role.name} désactivé.`);
    return true;
  };

  return [desactiver, fenetre];
}
