"use client";

import { useState, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { cn } from "@/lib/cn";
import { FILTRES_PAR_DEFAUT, LIBELLES_ETAPES, tableauTickets, type ColonneTicket, type FiltresTickets } from "@/lib/tickets";
import { useChatsEspace, useProjects, useRoles, useWorkspace } from "@/lib/workspace";
import { AMoi } from "./AMoi";
import { CarteTicket } from "./CarteTicket";

/** Les filtres du tableau : une préférence de cet écran. */
const CLE = "klyra-tickets-filtres";

function lireFiltres(): FiltresTickets {
  try {
    const v = JSON.parse(localStorage.getItem(CLE) ?? "{}") as Partial<FiltresTickets>;
    return {
      agent: typeof v.agent === "string" ? v.agent : null,
      projet: typeof v.projet === "string" ? v.projet : null,
      origine: v.origine === "moi" || v.origine === "agents" ? v.origine : "tous",
    };
  } catch {
    return FILTRES_PAR_DEFAUT;
  }
}

function ecrireFiltres(filtres: FiltresTickets) {
  try {
    localStorage.setItem(CLE, JSON.stringify(filtres));
  } catch {
    /* stockage indisponible : les filtres ne survivent pas à la fermeture */
  }
}

const TITRES: Record<ColonneTicket, string> = {
  "a-faire": "À faire",
  "en-cours": "En cours",
  bloque: "Bloqué",
  "a-valider": "À valider",
  termine: "Terminé",
};

function Colonne({ titre, nombre, accent, large, children }: { titre: string; nombre?: number; accent?: boolean; large?: boolean; children: ReactNode }) {
  return (
    /* Les six colonnes se partagent la largeur ; sous leur minimum, le tableau défile. Les lignes de rappel (boutons au survol) demandent plus. */
    <section aria-label={titre} className={cn("flex max-w-[320px] flex-1 basis-0 flex-col gap-2 rounded-lg bg-fond-surface-grise p-2", large ? "min-w-[270px]" : "min-w-[210px]")}>
      <header className="flex items-baseline gap-2 px-1.5 pt-1">
        <h2 className={cn("m-0 text-ui-s text-texte-principal", accent ? "font-semibold" : "font-medium")}>{titre}</h2>
        {nombre !== undefined && <span className={cn("text-ui-xs", accent && nombre > 0 ? "font-semibold text-texte-accent" : "text-texte-tertiaire")}>{nombre}</span>}
      </header>
      {children}
    </section>
  );
}

/**
 * Tickets : le travail en cours, le tien et celui des agents. Un ticket = un
 * fil ; ses colonnes suivent son étape (src/lib/tickets.ts). « À moi » montre
 * tes rappels. « À valider » est ce qui t'attend.
 */
export function TicketsScreen() {
  const { state } = useWorkspace();
  const roles = useRoles();
  /* Les tickets et les projets du serveur affiché. « À moi » (les rappels) reste commun : il est à la personne. */
  const chats = useChatsEspace();
  const projets = useProjects();
  /* Rien n'est rendu au build (AppShell attend l'ouverture) : le stockage se lit dès le premier rendu. */
  const [filtres, setFiltres] = useState<FiltresTickets>(lireFiltres);
  /* « Ses tickets » (clic droit sur un agent) : `/tickets?agent=…` filtre sur lui, sans toucher au reste. */
  const agentDemande = useSearchParams().get("agent");
  const [agentVu, setAgentVu] = useState<string | null>(null);
  if (agentDemande && agentDemande !== agentVu) {
    setAgentVu(agentDemande);
    setFiltres((f) => ({ ...f, agent: agentDemande }));
  }
  const [tousTermines, setTousTermines] = useState(false);
  const changer = (patch: Partial<FiltresTickets>) => {
    const suite = { ...filtres, ...patch };
    setFiltres(suite);
    ecrireFiltres(suite);
  };

  const travaille = (id: string) => !!state.travail[id];
  /* Un filtre retenu sur un projet d'un autre serveur ne vide pas ce tableau. */
  const filtresIci = filtres.projet && !projets.some((p) => p.id === filtres.projet) ? { ...filtres, projet: null } : filtres;
  const { colonnes, termines } = tableauTickets(chats, travaille, filtresIci, new Date(), tousTermines);
  const ouverts = colonnes["a-faire"].length + colonnes["en-cours"].length + colonnes.bloque.length + colonnes["a-valider"].length;
  const compteurs = (["en-cours", "a-valider", "bloque"] as const)
    .filter((c) => colonnes[c].length)
    .map((c) => `${colonnes[c].length} ${LIBELLES_ETAPES[c]}${c === "bloque" && colonnes[c].length > 1 ? "s" : ""}`);

  /* Les agents qui ont des fils, même désactivés depuis, en plus de ceux de Mes agents. */
  const idsAgents = [...new Set([...roles.map((r) => r.id), ...chats.flatMap((c) => (c.fil ? [c.fil.roleId] : []))])];
  const nomAgent = (id: string) => roles.find((r) => r.id === id)?.name ?? id;
  const optionsAgents = [
    { value: "", label: "Tous les agents" },
    ...idsAgents.map((id) => ({ value: id, label: nomAgent(id), icone: <AgentRond roleId={id} taille={18} /> })),
  ];
  const optionsProjets = [{ value: "", label: "Tous les projets" }, ...projets.map((p) => ({ value: p.id, label: p.name }))];
  const optionsOrigine = [
    { value: "tous" as const, label: "Lancés par tous" },
    { value: "moi" as const, label: "Lancés par moi" },
    { value: "agents" as const, label: "Lancés par un agent" },
  ];

  const cartes = (colonne: ColonneTicket) =>
    colonnes[colonne].length ? (
      colonnes[colonne].map((c) => <CarteTicket key={c.id} chat={c} colonne={colonne} />)
    ) : (
      <p className="m-0 px-1.5 pb-1 text-ui-xs text-texte-tertiaire">Aucun</p>
    );

  return (
    <div className="flex h-full flex-col overflow-hidden">
      <div className="flex shrink-0 flex-col gap-3 px-5 pt-5 pb-3">
        <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
            <span className="font-semibold">Tickets</span> <span className="font-normal">de l’équipe</span>
          </h1>
          {compteurs.length > 0 && <span className="text-ui-s text-texte-tertiaire">{compteurs.join(" · ")}</span>}
        </header>
        <div className="flex flex-wrap items-center gap-2">
          <ListeDeroulante variante="puce" libelle="Agent" icone={<Icon name="users-profiles-01" size={14} />} options={optionsAgents} value={filtres.agent ?? ""} onChange={(v) => changer({ agent: v || null })} largeurListe={240} />
          <ListeDeroulante variante="puce" libelle="Projet" icone={<Icon name="projets-dossier" size={14} />} options={optionsProjets} value={filtresIci.projet ?? ""} onChange={(v) => changer({ projet: v || null })} largeurListe={240} />
          <ListeDeroulante variante="puce" libelle="Lancés par" options={optionsOrigine} value={filtres.origine} onChange={(v) => changer({ origine: v })} largeurListe={220} />
        </div>
        {ouverts === 0 && (
          <p className="m-0 text-ui-s text-texte-tertiaire">Aucun ticket ouvert. Ouvre un fil depuis le chat d’un agent, ou demande-lui d’en ouvrir un.</p>
        )}
      </div>

      <div className="flex min-h-0 flex-1 items-start gap-3 overflow-auto px-5 pb-5">
        <Colonne titre="À moi" large>
          <div className="rounded-md bg-fond-surface px-2.5 py-1">
            <AMoi />
          </div>
        </Colonne>
        {(["a-faire", "en-cours", "bloque", "a-valider"] as const).map((c) => (
          <Colonne key={c} titre={TITRES[c]} nombre={colonnes[c].length} accent={c === "a-valider"}>
            {cartes(c)}
          </Colonne>
        ))}
        <Colonne titre={TITRES.termine} nombre={tousTermines ? termines : colonnes.termine.length}>
          {cartes("termine")}
          {termines > colonnes.termine.length || tousTermines ? (
            <button
              type="button"
              onClick={() => setTousTermines((v) => !v)}
              className="cursor-pointer self-start border-0 bg-transparent px-1.5 pb-1 text-ui-xs text-texte-tertiaire underline decoration-bordure-forte underline-offset-2 hover:text-texte-principal"
            >
              {tousTermines ? "Seulement les 7 derniers jours" : `Tous les fils fermés (${termines})`}
            </button>
          ) : null}
        </Colonne>
      </div>
    </div>
  );
}
