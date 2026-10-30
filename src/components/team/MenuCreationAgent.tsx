"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useAgents } from "@/lib/agents";
import { useDecrireAAssistant } from "@/lib/decrire-a-assistant";
import { useRole } from "@/lib/workspace";
import { MenuLignes, type Declencheur } from "./MenuLignes";

/**
 * Créer un agent (spec §9.1) : le décrire à l'assistant d'abord, la fiche à remplir soi-même ensuite,
 * puis la bibliothèque. Ouvert par la carte « Nouvel agent », le « + » de « Mes agents » du panneau
 * et sa ligne « Créer un agent ».
 */
export function MenuCreationAgent({
  declencheur,
  alignement = "gauche",
  className,
}: {
  declencheur: (d: Declencheur) => ReactNode;
  alignement?: "gauche" | "droite";
  className?: string;
}) {
  const router = useRouter();
  const { canEdit } = useAgents();
  const assistant = useRole("principal");
  const decrire = useDecrireAAssistant();
  const horsApp = canEdit ? undefined : "Dans l’app de bureau";
  return (
    <MenuLignes
      libelle="Créer un agent"
      alignement={alignement}
      className={className}
      declencheur={declencheur}
      lignes={[
        {
          id: "assistant",
          icone: "message-square",
          titre: `Le décrire à ${assistant.name}`,
          detail: horsApp ?? "Dis-lui ce dont tu as besoin : il prépare la fiche.",
          desactivee: !canEdit,
          onChoisir: decrire,
        },
        {
          id: "fiche",
          icone: "file-plus-01",
          titre: "Remplir la fiche moi-même",
          detail: horsApp ?? "Pour qui sait déjà ce qu’il veut écrire.",
          desactivee: !canEdit,
          onChoisir: () => router.push("/equipe?nouveau=1"),
        },
        {
          id: "bibliotheque",
          icone: "layers-01",
          titre: "Choisir dans la bibliothèque",
          detail: "Des agents prêts, partagés par l’équipe ou par KLYRA.",
          onChoisir: () => router.push("/equipe?vue=bibliotheque"),
        },
      ]}
    />
  );
}
