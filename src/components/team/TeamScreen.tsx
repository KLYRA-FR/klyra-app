"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { CIRCUITS } from "@/data/agents";
import { Bouton } from "@/components/ui/Bouton";
import { useAgents } from "@/lib/agents";
import { useWorkspace } from "@/lib/workspace";
import { Apparition } from "@/components/ui/Apparition";
import { AgentCard } from "./AgentCard";
import { AgentDetail } from "./AgentDetail";
import { AgentEditor } from "./AgentEditor";
import { AgentHistory } from "./AgentHistory";
import { CarteNouvelAgent } from "./CarteNouvelAgent";
import { ChiffresEquipe } from "./ChiffresEquipe";
import { CircuitsAnimes } from "./CircuitsAnimes";
import { LouPanel } from "./LouPanel";

function Centre({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-12">{children}</div>;
}

/**
 * Équipe : les sous-agents de ce poste (`~/.claude/agents/`), un par carte,
 * puis les circuits de passation.
 * - `?agent=<id>` : sa fiche ; `&mode=modifier | lou | historique`.
 * - `?nouveau=1` : créer un agent.
 */
export function TeamScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { roles, status, error, canEdit, reload } = useAgents();
  const { chats } = useWorkspace().state;
  const [cleEditeur, setCleEditeur] = useState(0);

  const agentId = params.get("agent");
  const mode = params.get("mode");
  const selected = roles.find((r) => r.id === agentId);
  const agents = roles.filter((r) => r.id !== "principal");

  if (status === "chargement") {
    return (
      <Centre>
        <p className="m-0 text-ui text-texte-tertiaire">Lecture des fiches…</p>
      </Centre>
    );
  }
  if (status === "erreur") {
    return (
      <Centre>
        <div className="flex max-w-[520px] flex-col items-center gap-4 text-center">
          <p className="m-0 text-ui text-texte-erreur">Impossible de lire les fiches des agents : {error}</p>
          <Bouton variant="blanc" taille="compact" onClick={() => void reload()}>
            Réessayer
          </Bouton>
        </div>
      </Centre>
    );
  }

  if (params.get("nouveau") && canEdit) return <AgentEditor key={`nouveau-${cleEditeur}`} role={null} onReprendre={() => setCleEditeur((k) => k + 1)} />;

  if (agentId && !selected) {
    return (
      <Centre>
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="m-0 text-ui text-texte-secondaire">L’agent « {agentId} » n’existe pas sur ce poste.</p>
          <Bouton variant="blanc" taille="compact" onClick={() => router.push("/equipe")}>
            Retour à l’équipe
          </Bouton>
        </div>
      </Centre>
    );
  }

  if (selected) {
    // key : une autre fiche, ou une nouvelle version sur le disque, repart d'un écran neuf.
    if (mode === "modifier" && canEdit && selected.file) {
      return (
        <AgentEditor
          key={`${selected.id}-${cleEditeur}`}
          role={selected}
          onReprendre={() => setCleEditeur((k) => k + 1)}
        />
      );
    }
    if (mode === "lou" && selected.file) return <LouPanel key={selected.id} role={selected} />;
    if (mode === "historique" && selected.file) return <AgentHistory key={selected.id} role={selected} />;
    return <AgentDetail key={selected.id} role={selected} />;
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
        {/* Pas de titre ni de texte : les chiffres suffisent. Le titre reste pour les lecteurs d'écran. */}
        <h1 className="sr-only">L’équipe</h1>
        <ChiffresEquipe agents={agents.length} exemple={status === "exemple"} />

        {/* Bandeau de lecture seule : dans un navigateur seulement. */}
        {status === "exemple" && (
          <p role="status" className="m-0 rounded-md border border-bordure-subtile bg-fond-page px-4 py-2.5 text-ui-s text-texte-secondaire">
            Fiches d’exemple de l’équipe KLYRA, en lecture seule. Ouvre l’app de bureau pour voir et modifier les agents de ton poste.
          </p>
        )}
        {/* Les cartes arrivent en cascade, puis la place du prochain agent. */}
        <Apparition className="grid grid-cols-[repeat(auto-fill,minmax(300px,1fr))] items-start gap-4" seuil={0.05}>
          {agents.map((role, i) => (
            <AgentCard
              key={role.id}
              role={role}
              chatCount={chats.filter((c) => c.roleIds.includes(role.id)).length}
              totalChats={chats.length}
              ordre={i}
            />
          ))}
          <CarteNouvelAgent actif={canEdit} delai={240 + agents.length * 60} />
        </Apparition>

        {/* Même fond que le bandeau des chiffres ; chaque circuit dans sa carte blanche. */}
        <Apparition
          role="region"
          aria-labelledby="circuits-titre"
          className="flex flex-col gap-3 rounded-3xl border border-bordure-subtile bg-fond-page p-3"
        >
          <div className="flex flex-col gap-1 px-2 pt-2">
            <h2 id="circuits-titre" className="m-0 text-h4 leading-[1] font-semibold tracking-[-0.04em] text-texte-principal">
              Qui passe la main à qui
            </h2>
            <p className="m-0 text-ui text-texte-secondaire">Les circuits de l’équipe, de la demande à la livraison.</p>
          </div>
          <CircuitsAnimes circuits={CIRCUITS} />
        </Apparition>

      </div>
    </div>
  );
}
