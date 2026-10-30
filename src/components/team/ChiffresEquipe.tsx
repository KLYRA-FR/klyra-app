"use client";

import type { CSSProperties, ReactNode } from "react";
import { Apparition } from "@/components/ui/Apparition";
import { Compteur } from "@/components/ui/Compteur";
import { Icon } from "@/components/icons/Icon";
import { useWorkspace } from "@/lib/workspace";

interface Chiffre {
  icone: ReactNode;
  valeur: number;
  libelle: string;
  detail: string;
}

/** Les chats ouverts aujourd'hui. */
function estAujourdhui(iso: string): boolean {
  return new Date(iso).toDateString() === new Date().toDateString();
}

/**
 * Bandeau de chiffres en haut de l'équipe, d'après le bloc « Hours spent ·
 * Average test · Courses completed » de la maquette Figma IA (60:4724) :
 * de vrais chiffres de l'app, chacun dans une carte blanche flottante avec
 * sa sphère bleue (pastille « Analyze data », 65:4743), sur le fond de l'app.
 */
export function ChiffresEquipe({ agents, exemple }: { agents: number; exemple: boolean }) {
  const { chats, projects, messages } = useWorkspace().state;
  const taches = messages.flatMap((m) => m.parts.flatMap((p) => (p.type === "tasks" ? p.tasks : [])));
  const enCours = taches.filter((t) => t.status === "en-cours").length;
  const faites = taches.filter((t) => t.status === "fait").length;
  const actifs = projects.filter((p) => p.status !== "livre").length;
  const aujourdhui = chats.filter((c) => estAujourdhui(c.updatedAt)).length;

  const chiffres: Chiffre[] = [
    {
      icone: <Icon name="users-profiles-01" size={18} />,
      valeur: agents,
      libelle: "Agents dans l’équipe",
      detail: exemple ? "Aperçu" : "Dans Mes agents",
    },
    {
      icone: <Icon name="message-square" size={18} />,
      valeur: chats.length,
      libelle: "Chats en cours",
      detail: `${aujourdhui} actif${aujourdhui > 1 ? "s" : ""} aujourd’hui`,
    },
    {
      icone: <Icon name="folder" size={18} />,
      valeur: actifs,
      libelle: "Projets actifs",
      detail: `Sur ${projects.length} projets`,
    },
    {
      icone: <Icon name="loader-01" size={18} />,
      valeur: enCours,
      libelle: "Tâches en cours",
      detail: `${faites} déjà faite${faites > 1 ? "s" : ""}`,
    },
  ];

  return (
    <Apparition
      role="region"
      aria-label="L’équipe en chiffres"
      // Arrondis emboîtés : 28 px dehors, 12 px de marge, 28 − 12 = 16 px pour les cartes.
      className="grid grid-cols-2 gap-3 rounded-3xl border border-bordure-subtile bg-fond-page p-3 @4xl:grid-cols-4"
    >
      {chiffres.map((c, i) => (
        <div
          key={c.libelle}
          className="klyra-entree klyra-carte-flottante flex flex-col gap-3 rounded-lg p-4"
          style={{ "--delai": `${i * 80}ms` } as CSSProperties}
        >
          {/* L'icône à gauche, le chiffre au bout de la ligne : on gagne de la hauteur. */}
          <div className="flex items-center justify-between gap-3">
            <span aria-hidden="true" className="klyra-orbe flex size-9 shrink-0 items-center justify-center rounded-full">
              {c.icone}
            </span>
            <span className="klyra-mono text-h3 leading-[1] font-semibold tracking-[-0.03em] text-texte-principal">
              <Compteur valeur={c.valeur} delai={i * 80 + 120} />
            </span>
          </div>
          <div className="flex flex-col gap-0.5">
            <span className="text-ui-s font-semibold text-texte-principal">{c.libelle}</span>
            <span className="text-ui-xs text-texte-tertiaire">{c.detail}</span>
          </div>
        </div>
      ))}
    </Apparition>
  );
}
