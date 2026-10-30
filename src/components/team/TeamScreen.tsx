"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { BibliothequeVue } from "@/components/bibliotheque/BibliothequeVue";
import { FicheDefinition } from "@/components/bibliotheque/FicheDefinition";
import { VueMiseAJour } from "@/components/bibliotheque/VueMiseAJour";
import { Bouton } from "@/components/ui/Bouton";
import { Onglets } from "@/components/ui/Onglets";
import { useAgents } from "@/lib/agents";
import { AgentDetail } from "./AgentDetail";
import { AgentEditor } from "./AgentEditor";
import { AgentHistory } from "./AgentHistory";
import { LouPanel } from "./LouPanel";
import { MesAgentsVue } from "./MesAgentsVue";

function Centre({ children }: { children: React.ReactNode }) {
  return <div className="flex h-full items-center justify-center p-12">{children}</div>;
}

type Vue = "mes-agents" | "bibliotheque";

/**
 * Les agents (spec §3, §7, §10) : deux onglets à la même adresse.
 * - `/equipe` : Mes agents ; `?vue=bibliotheque` : Bibliothèque KLYRA ; `?vue=membres` mène aux
 *   Membres de l'équipe, dans Réglages › Équipe.
 * - `?agent=<id>` : sa fiche ; `&mode=modifier | lou | historique | maj`.
 * - `?definition=<id>` : une définition de la bibliothèque (`klyra:<nom>` pour un modèle KLYRA).
 * - `?nouveau=1` : créer un agent (`&proposition=…` : préparé par l'assistant).
 */
export function TeamScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const { roles, tous, status, error, canEdit, reload } = useAgents();
  const [cleEditeur, setCleEditeur] = useState(0);

  const vueDemandee = params.get("vue");
  const agentId = params.get("agent");
  const definition = params.get("definition");
  const mode = params.get("mode");
  const local = tous.find((a) => a.role.id === agentId) ?? null;
  const selected = roles.find((r) => r.id === agentId) ?? local?.role;

  useEffect(() => {
    if (vueDemandee === "membres") router.replace("/reglages?section=equipe");
  }, [vueDemandee, router]);

  if (status === "chargement" || vueDemandee === "membres") {
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
  if (definition) return <FicheDefinition key={definition} id={definition} />;

  if (agentId && !selected) {
    return (
      <Centre>
        <div className="flex flex-col items-center gap-4 text-center">
          <p className="m-0 text-ui text-texte-secondaire">L’agent « {agentId} » n’existe pas sur ce poste.</p>
          <Bouton variant="blanc" taille="compact" onClick={() => router.push("/equipe")}>
            Retour à Mes agents
          </Bouton>
        </div>
      </Centre>
    );
  }

  if (selected) {
    // key : une autre fiche, ou une nouvelle version sur le disque, repart d'un écran neuf.
    if (mode === "modifier" && canEdit && selected.file && local) {
      return <AgentEditor key={`${selected.id}-${cleEditeur}`} role={selected} onReprendre={() => setCleEditeur((k) => k + 1)} />;
    }
    if (mode === "lou" && selected.file) return <LouPanel key={selected.id} role={selected} />;
    if (mode === "historique" && selected.file) return <AgentHistory key={selected.id} role={selected} />;
    if (mode === "maj" && local) return <VueMiseAJour key={selected.id} agent={local} />;
    return <AgentDetail key={selected.id} role={selected} />;
  }

  const vue: Vue = vueDemandee === "bibliotheque" ? "bibliotheque" : "mes-agents";
  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
        <h1 className="sr-only">{vue === "bibliotheque" ? "Bibliothèque KLYRA" : "Mes agents"}</h1>
        <Onglets<Vue>
          libelle="Agents"
          className="self-start"
          valeur={vue}
          onChange={(v) => router.replace(v === "bibliotheque" ? "/equipe?vue=bibliotheque" : "/equipe")}
          onglets={[
            { id: "mes-agents", label: "Mes agents", nombre: roles.length - 1 },
            { id: "bibliotheque", label: "Bibliothèque KLYRA" },
          ]}
        />
        {vue === "bibliotheque" ? <BibliothequeVue /> : <MesAgentsVue />}
        {status === "exemple" && (
          <p role="status" className="m-0 rounded-md border border-bordure-subtile bg-fond-page px-4 py-2.5 text-ui-s text-texte-secondaire">
            Aperçu en lecture seule. Ouvre l’app de bureau pour choisir et modifier tes agents.
          </p>
        )}
      </div>
    </div>
  );
}
