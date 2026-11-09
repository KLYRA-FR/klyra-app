"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import {
  ElementContextuel,
  EnteteContextuel,
  MenuContextuel,
  SeparateurContextuel,
  SousMenuContextuel,
  useMenuContextuel,
} from "@/components/ui/MenuContextuel";
import { cn } from "@/lib/cn";
import { enRetard, libelleEcheance } from "@/lib/dates";
import { LIBELLES_ETAPES, type ColonneTicket } from "@/lib/tickets";
import { dansEspace } from "@/lib/lieux";
import { useRole, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat, Fil } from "@/types/domain";
import { useFermerTicket } from "./useFermerTicket";

const PUCE = "flex h-7 items-center gap-1.5 rounded-sm border border-bordure-subtile bg-fond-surface px-2 text-ui-xs text-texte-secondaire";

/** La progression de la liste de l'agent (TodoWrite), comme dans le panneau latéral. */
function Progression({ chat }: { chat: Chat }) {
  const taches = chat.taches ?? [];
  if (!taches.length) return null;
  const faites = taches.filter((t) => t.statut === "fait").length;
  return (
    <div className="flex items-center gap-2" title={`${faites} tâche${faites > 1 ? "s" : ""} faite${faites > 1 ? "s" : ""} sur ${taches.length}`}>
      <span className="h-1 flex-1 overflow-hidden rounded-pill bg-fond-surface-grise">
        <span className="block h-full rounded-pill bg-bleu-k1-500 transition-[width] duration-[480ms] ease-sortie" style={{ width: `${(faites / taches.length) * 100}%` }} />
      </span>
      <span className="klyra-mono text-ui-2xs text-texte-tertiaire">
        {faites}/{taches.length}
      </span>
    </div>
  );
}

/** Priorité, échéance, projet, et ce qu'on fait du ticket : les réglages dépliés sous la carte. */
function Reglages({ chat, colonne }: { chat: Chat & { fil: Fil }; colonne: ColonneTicket }) {
  const { state, majTicket, rouvrirFil } = useWorkspace();
  const fermer = useFermerTicket();
  const fil = chat.fil;
  const priorite = fil.priorite ?? 0;
  /* Un ticket ne se range que dans un projet de son serveur. */
  const projets = [{ value: "", label: "Aucun projet" }, ...state.projects.filter((p) => dansEspace(p.lieu, chat.lieu ?? null)).map((p) => ({ value: p.id, label: p.name }))];
  return (
    <div className="flex flex-col gap-2 border-t border-bordure-subtile pt-2">
      {colonne !== "termine" && (
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => majTicket(chat.id, { priorite: ((priorite + 1) % 4) as 0 | 1 | 2 | 3 })}
            title="Priorité : clique pour changer"
            className={cn(PUCE, "cursor-pointer font-semibold", priorite > 0 && "border-bleu-k1-500/40 text-texte-accent")}
          >
            {priorite === 0 ? "Priorité" : "!".repeat(priorite)}
          </button>
          <label className={cn(PUCE, fil.echeance && "border-bleu-k1-500/40 text-texte-accent")}>
            <Icon name="calendar-01" size={14} />
            <input
              type="date"
              value={fil.echeance ?? ""}
              onChange={(e) => majTicket(chat.id, { echeance: e.target.value || null })}
              aria-label="Échéance"
              className="w-[112px] border-0 bg-transparent p-0 text-ui-xs text-inherit outline-none"
            />
          </label>
          <ListeDeroulante
            variante="puce"
            libelle="Projet"
            icone={<Icon name="projets-dossier" size={14} />}
            options={projets}
            value={fil.projetId ?? ""}
            onChange={(v) => majTicket(chat.id, { projetId: v || null })}
            largeurListe={220}
            /* Un fil qui travaille dans le dossier de son projet le garde : sa session est liée à ce dossier. */
            disabled={!!fil.dossier}
          />
        </div>
      )}
      <div className="flex flex-wrap items-center gap-1.5">
        {colonne === "termine" ? (
          <Bouton variant="discret" taille="mini" iconeGauche={<Icon name="arrow-rotate-left-01" size={14} />} onClick={() => rouvrirFil(chat.id)}>
            Rouvrir
          </Bouton>
        ) : (
          <>
            {colonne !== "a-faire" && (
              <Bouton variant="discret" taille="mini" iconeGauche={<Icon name="arrow-rotate-left-01" size={14} />} onClick={() => majTicket(chat.id, { etape: "a-faire" })}>
                Remettre à faire
              </Bouton>
            )}
            <Bouton variant="discret" taille="mini" iconeGauche={<Icon name="x-01" size={14} />} onClick={() => fermer(chat.id)}>
              Fermer
            </Bouton>
          </>
        )}
      </div>
    </div>
  );
}

const PRIORITES = ["Aucune", "Basse", "Moyenne", "Haute"] as const;

/** Le clic droit sur un ticket : l'ouvrir, sa priorité, son étape, le fermer ou le supprimer. */
function MenuTicket({ chat, colonne, x, y, onFermer }: { chat: Chat & { fil: Fil }; colonne: ColonneTicket; x: number; y: number; onFermer: (rendreFocus?: boolean) => void }) {
  const router = useRouter();
  const { majTicket, rouvrirFil, arreter } = useWorkspace();
  const fermer = useFermerTicket();
  const role = useRole(chat.fil.roleId);
  const travail = useTravail(chat.id);
  const priorite = chat.fil.priorite ?? 0;
  const termine = colonne === "termine";
  return (
    <MenuContextuel x={x} y={y} libelle={`Ticket ${chat.title}`} onFermer={onFermer}>
      <EnteteContextuel visuel={<AgentRond roleId={chat.fil.roleId} taille={24} />} titre={chat.title} sousTitre={`${role.name} · ${LIBELLES_ETAPES[colonne]}`} enCours={!!travail} />
      <SeparateurContextuel />
      <ElementContextuel icone="message-square" raccourci="↵" onChoisir={() => router.push(`/chat?id=${encodeURIComponent(chat.id)}`)}>
        Ouvrir le fil
      </ElementContextuel>
      {!termine && (
        <SousMenuContextuel icone="star-01" libelle="Priorité">
          {PRIORITES.map((libelle, rang) => (
            <ElementContextuel key={libelle} icone={rang === priorite ? "check-01" : "circle"} raccourci={"!".repeat(rang) || undefined} onChoisir={() => majTicket(chat.id, { priorite: rang as 0 | 1 | 2 | 3 })}>
              {libelle}
            </ElementContextuel>
          ))}
        </SousMenuContextuel>
      )}
      {travail && (
        <ElementContextuel icone="stop-01" onChoisir={() => arreter(chat.id)}>
          Arrêter {role.name}
        </ElementContextuel>
      )}
      <SeparateurContextuel />
      {termine ? (
        <ElementContextuel icone="arrow-rotate-left-01" onChoisir={() => rouvrirFil(chat.id)}>
          Rouvrir
        </ElementContextuel>
      ) : (
        <>
          {colonne !== "a-faire" && (
            <ElementContextuel icone="arrow-rotate-left-01" onChoisir={() => majTicket(chat.id, { etape: "a-faire" })}>
              Remettre à faire
            </ElementContextuel>
          )}
          <ElementContextuel icone={colonne === "a-valider" ? "check-01" : "x-01"} onChoisir={() => fermer(chat.id)}>
            {colonne === "a-valider" ? "Valider et fermer" : "Fermer"}
          </ElementContextuel>
        </>
      )}
      <ElementContextuel icone="trash-01" danger onChoisir={() => fermer(chat.id, true)}>
        Supprimer
      </ElementContextuel>
    </MenuContextuel>
  );
}

/**
 * Un ticket (un fil) : titre, agent, projet, priorité, échéance, progression,
 * raison de blocage. Le titre ouvre le fil dans l'onglet de l'agent ; le « … »
 * déplie les réglages, comme une ligne de rappel ; le clic droit ouvre `MenuTicket`.
 */
export function CarteTicket({ chat, colonne }: { chat: Chat & { fil: Fil }; colonne: ColonneTicket }) {
  const { state } = useWorkspace();
  const fermer = useFermerTicket();
  const fil = chat.fil;
  const role = useRole(fil.roleId);
  const lanceur = useRole(fil.lancePar?.roleId ?? fil.roleId);
  const travail = useTravail(chat.id);
  const [ouverte, setOuverte] = useState(false);
  const menu = useMenuContextuel<null>();
  const projet = fil.projetId ? state.projects.find((p) => p.id === fil.projetId) : null;
  const retard = colonne !== "termine" && !!fil.echeance && enRetard(fil.echeance, null);
  const priorite = fil.priorite ?? 0;

  return (
    <article
      data-ticket={chat.id}
      onContextMenu={(e) => {
        if ((e.target as HTMLElement).closest("input, textarea")) return;
        menu.ouvrir(e, null);
      }}
      className={cn(
        "group/ticket flex flex-col gap-2 rounded-md border border-bordure-subtile bg-fond-surface p-3 transition-colors duration-[120ms]",
        colonne === "termine" && "bg-transparent",
      )}
    >
      <div className="flex items-start gap-2">
        {/* Un agent y travaille : le point respire, comme dans les onglets. */}
        {travail && <span aria-label="Un agent travaille" className="klyra-respire mt-[7px] size-1.5 shrink-0 rounded-full bg-bleu-k1-500" />}
        <Link
          href={`/chat?id=${encodeURIComponent(chat.id)}`}
          title={`${chat.title} (${chat.id})`}
          className={cn(
            "line-clamp-2 min-w-0 flex-1 text-ui-s leading-5 font-medium no-underline hover:underline",
            colonne === "termine" ? "text-texte-secondaire" : "text-texte-principal",
          )}
        >
          {priorite > 0 && <span className="mr-1 font-semibold text-texte-accent">{"!".repeat(priorite)}</span>}
          {chat.title}
        </Link>
        <button
          type="button"
          onClick={() => setOuverte((o) => !o)}
          aria-label={`Réglages du ticket ${chat.title}`}
          aria-expanded={ouverte}
          className={cn(
            "-mt-0.5 -mr-1 flex size-6 shrink-0 cursor-pointer items-center justify-center rounded-full border-0 bg-transparent text-icone-secondaire transition-opacity duration-[120ms] hover:bg-fond-survol focus-visible:opacity-100",
            ouverte ? "opacity-100" : "opacity-0 group-hover/ticket:opacity-100",
          )}
        >
          <Icon name="dot-horizontal" size={16} />
        </button>
      </div>

      {colonne === "bloque" && fil.raison && <p className="m-0 line-clamp-2 text-ui-xs leading-[1.4] text-texte-erreur">{fil.raison}</p>}

      <Progression chat={chat} />

      <div className="flex items-center gap-1.5 text-ui-xs">
        <AgentRond roleId={fil.roleId} taille={18} />
        <span className="truncate text-texte-secondaire">{role.name}</span>
        {fil.echeance && colonne !== "termine" && (
          <span className={cn("ml-auto shrink-0", retard ? "font-medium text-texte-erreur" : "text-texte-tertiaire")}>{libelleEcheance(fil.echeance, null)}</span>
        )}
      </div>
      {(projet || fil.lancePar) && (
        <p className="m-0 truncate text-ui-xs text-texte-tertiaire">{[projet?.name, fil.lancePar && `lancé par ${lanceur.name}`].filter(Boolean).join(" · ")}</p>
      )}

      {colonne === "a-valider" && !ouverte && (
        <Bouton variant="gris" taille="mini" iconeGauche={<Icon name="check-01" size={14} />} onClick={() => fermer(chat.id)} className="self-start">
          Valider et fermer
        </Bouton>
      )}

      {ouverte && <Reglages chat={chat} colonne={colonne} />}
      {menu.menu && <MenuTicket key={menu.menu.x + "," + menu.menu.y} chat={chat} colonne={colonne} x={menu.menu.x} y={menu.menu.y} onFermer={menu.fermer} />}
    </article>
  );
}
