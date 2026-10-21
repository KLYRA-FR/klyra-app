"use client";

import { AgentRond } from "@/components/roles/AgentRond";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { idDirect } from "@/lib/workspace";

/** Aucun chat ouvert : on choisit un agent dans le panneau, ou on écrit au Principal. */
export function ChatsAccueil() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-12 text-center">
      <AgentRond roleId="principal" taille={56} />
      <div className="flex flex-col gap-1.5">
        <h1 className="m-0 text-h4 leading-[1.1] tracking-[-0.03em] text-texte-principal">
          <span className="font-semibold">Écris à un agent</span> <span className="font-normal">de ton équipe</span>
        </h1>
        <p className="m-0 max-w-[420px] text-ui-s leading-[1.5] text-texte-secondaire">
          Choisis-le dans le panneau à gauche. Tu ne sais pas à qui confier ta demande ? Le Principal la répartit.
        </p>
      </div>
      <BoutonPrincipal href={`/chat?id=${idDirect("principal")}`}>Écrire au Principal</BoutonPrincipal>
    </div>
  );
}
