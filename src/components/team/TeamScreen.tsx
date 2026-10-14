"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AGENT_TEMPLATES } from "@/data/agent-templates.generated";
import { CIRCUITS } from "@/data/agents";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { roleFromContent, useAgents } from "@/lib/agents";
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

/** Prénoms des agents de l'équipe KLYRA, pour les nommer avant installation. */
const PRENOMS = Object.fromEntries(AGENT_TEMPLATES.map((t) => [t.name, roleFromContent(t.name, t.content, {}, null).name]));

function Centre({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-12">{children}</div>;
}

/** Aucun agent sur ce poste : on installe l'équipe. */
function Installation({ dir }: { dir: string | null }) {
  const { install } = useAgents();
  const [etat, setEtat] = useState<string | null>(null);
  return (
    <Centre>
      <div className="flex max-w-[560px] flex-col items-center gap-5 text-center">
        <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">
          <span className="font-semibold">Aucun agent</span> <span className="font-normal">sur ce poste</span>
        </h1>
        <p className="m-0 text-body-s leading-[1.5] text-texte-secondaire">
          Les agents de l’équipe vivent dans <span className="klyra-mono">{dir ?? "~/.claude/agents"}</span>. Installe les{" "}
          {AGENT_TEMPLATES.length} fiches de l’équipe KLYRA : Claude Code et l’app les trouveront aussitôt.
        </p>
        <p className="m-0 text-ui-s text-texte-tertiaire">{Object.values(PRENOMS).join(" · ")}</p>
        <BoutonPrincipal
          disabled={etat === "Installation…"}
          onClick={() => {
            setEtat("Installation…");
            install()
              .then(() => setEtat(null))
              .catch((e: unknown) => setEtat(`L’installation a échoué : ${e instanceof Error ? e.message : String(e)}`));
          }}
        >
          Installer l’équipe KLYRA
        </BoutonPrincipal>
        {etat && <p className="m-0 text-ui-s text-texte-secondaire">{etat}</p>}
      </div>
    </Centre>
  );
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
  const { roles, status, error, dir, missing, canEdit, install, reload } = useAgents();
  const { chats } = useWorkspace().state;
  const [installation, setInstallation] = useState<string | null>(null);
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

  if (status === "disque" && agents.length === 0) return <Installation dir={dir} />;

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
        {missing.length > 0 && (
          <div role="status" className="flex flex-wrap items-center gap-3 rounded-md border border-bordure-accent-survol bg-fond-teinte-bleue px-4 py-3">
            <p className="m-0 flex-1 text-ui-s text-texte-principal">
              {missing.length > 1 ? `${missing.length} agents de l’équipe manquent` : "Un agent de l’équipe manque"} sur ce poste :{" "}
              {missing.map((n) => PRENOMS[n] ?? n).join(", ")}.
            </p>
            <Bouton
              variant="sombre"
              taille="compact"
              disabled={installation === "Installation…"}
              onClick={() => {
                setInstallation("Installation…");
                install(missing)
                  .then(() => setInstallation(null))
                  .catch((e: unknown) => setInstallation(e instanceof Error ? e.message : String(e)));
              }}
            >
              {missing.length > 1 ? "Les installer" : "L’installer"}
            </Bouton>
            {installation && <p className="m-0 w-full text-ui-xs text-texte-secondaire">{installation}</p>}
          </div>
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
