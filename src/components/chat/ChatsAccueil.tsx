"use client";

import { AgentRond } from "@/components/roles/AgentRond";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { idDirect, useRole, useRoles } from "@/lib/workspace";

/** Aucun chat ouvert : on choisit un agent dans le panneau, ou on écrit à l'assistant. */
export function ChatsAccueil() {
  const assistant = useRole("principal");
  const seul = useRoles().length <= 1;
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-12 text-center">
      <AgentRond roleId="principal" taille={56} />
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-h4 leading-[1.1] tracking-[-0.03em] text-texte-principal">
          {seul ? (
            <>
              <span className="font-semibold">Écris à {assistant.name}</span> <span className="font-normal">ton assistant</span>
            </>
          ) : (
            <>
              <span className="font-semibold">Écris à un agent</span> <span className="font-normal">ou à ton assistant</span>
            </>
          )}
        </h1>
        <p className="m-0 max-w-[420px] text-ui-s leading-[1.5] text-texte-secondaire">
          {seul
            ? "Il répond à tes demandes, travaille dans tes projets et t’aide à créer d’autres agents quand un besoin revient."
            : `Choisis-le dans le panneau à gauche. Tu ne sais pas à qui confier ta demande ? ${assistant.name} la répartit.`}
        </p>
      </div>
      <BoutonPrincipal href={`/chat?id=${idDirect("principal")}`}>Écrire à {assistant.name}</BoutonPrincipal>
    </div>
  );
}
