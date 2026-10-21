"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { cn } from "@/lib/cn";
import { libelleFrequence, passagesEntre, prochainPassage } from "@/lib/planning";
import { useProjects, useRole, useWorkspace } from "@/lib/workspace";
import type { Routine } from "@/types/domain";
import { EditeurRoutine, nouvelleRoutine } from "./EditeurRoutine";

const jourCourt = new Intl.DateTimeFormat("fr-FR", { weekday: "short" });
const numero = new Intl.DateTimeFormat("fr-FR", { day: "numeric" });
const heureCourte = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const quand = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const capitaliser = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Des tâches toutes prêtes, pour démarrer. */
const SUGGESTIONS: Partial<Routine>[] = [
  {
    nom: "Revue des mails du matin",
    roleId: "val",
    consigne: "Trie les mails arrivés depuis hier, signale ce qui demande une réponse aujourd’hui et prépare les brouillons. Rien ne part sans moi.",
    frequence: { type: "jours-ouvres", heure: "08:30" },
  },
  {
    nom: "Point de la semaine",
    roleId: "principal",
    consigne: "Fais le point sur les projets en cours : ce qui a avancé la semaine dernière, ce qui bloque, ce qu’on doit livrer cette semaine.",
    frequence: { type: "semaine", jour: 1, heure: "09:00" },
  },
  {
    nom: "Contrôle de klyra.fr",
    roleId: "qa",
    consigne: "Contrôle les pages principales de klyra.fr : liens cassés, textes, affichage mobile. Rends-moi ton verdict.",
    frequence: { type: "semaine", jour: 5, heure: "16:00" },
    projectId: "klyra-fr",
  },
];

/** Les sept prochains jours, avec les passages de chaque tâche active. */
function Semaine({ routines }: { routines: Routine[] }) {
  const jours = useMemo(() => {
    const debut = new Date();
    debut.setHours(0, 0, 0, 0);
    return Array.from({ length: 7 }, (_, i) => {
      const d = new Date(debut);
      d.setDate(d.getDate() + i);
      const fin = new Date(d);
      fin.setDate(fin.getDate() + 1);
      const passages = routines
        .filter((r) => r.active && r.frequence.type !== "heure")
        .flatMap((r) => passagesEntre(r.frequence, d, fin, 4).map((at) => ({ r, at })))
        .filter(({ at }) => at.getTime() > Date.now() - 60_000 || i > 0)
        .sort((a, b) => a.at.getTime() - b.at.getTime());
      return { d, passages };
    });
  }, [routines]);
  const horaires = routines.filter((r) => r.active && r.frequence.type === "heure");

  return (
    <section aria-label="Les sept prochains jours" className="rounded-3xl border border-bordure-subtile bg-fond-page p-3">
      <div className="flex items-center justify-between px-2 pt-1 pb-3">
        <h2 className="m-0 text-ui font-semibold text-texte-principal">Les sept prochains jours</h2>
        {horaires.length > 0 && (
          <span className="text-ui-xs text-texte-tertiaire">
            + {horaires.map((r) => r.nom).join(", ")} toutes les heures
          </span>
        )}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {jours.map(({ d, passages }, i) => (
          <div key={d.toISOString()} className="klyra-carte-flottante flex min-h-[148px] min-w-0 flex-col gap-2 rounded-lg p-2.5">
            <div className="flex items-baseline gap-1.5 px-0.5">
              <span className={cn("text-ui-s font-semibold", i === 0 ? "text-texte-accent" : "text-texte-principal")}>
                {i === 0 ? "Aujourd’hui" : capitaliser(jourCourt.format(d))}
              </span>
              <span className="text-ui-xs text-texte-tertiaire">{numero.format(d)}</span>
            </div>
            {passages.length === 0 ? (
              <span className="px-0.5 text-ui-2xs text-texte-tertiaire">Rien de prévu</span>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-1 p-0">
                {passages.map(({ r, at }) => (
                  <li key={`${r.id}-${at.toISOString()}`} className="flex min-w-0 items-center gap-1.5 rounded-sm bg-fond-page px-1.5 py-1">
                    <AgentRond roleId={r.roleId} taille={18} />
                    <span className="klyra-mono shrink-0 text-ui-3xs text-texte-secondaire">{heureCourte.format(at)}</span>
                    <span className="truncate text-ui-2xs font-medium text-texte-principal" title={r.nom}>
                      {r.nom}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

/** Une tâche planifiée : qui, quoi, quand, et ses actions. */
function LigneRoutine({ routine, onModifier }: { routine: Routine; onModifier: () => void }) {
  const role = useRole(routine.roleId);
  const projet = useProjects().find((p) => p.id === routine.projectId);
  const { enregistrerRoutine, supprimerRoutine, lancerRoutine } = useWorkspace();
  const [confirmer, setConfirmer] = useState(false);
  const derniere = routine.historique[0];

  return (
    <li className={cn("klyra-carte-flottante flex flex-col gap-3 rounded-lg p-4", !routine.active && "opacity-70")}>
      <div className="flex items-start gap-3">
        <AgentRond roleId={routine.roleId} taille={36} />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-ui font-semibold text-texte-principal">{routine.nom}</span>
            <span className="text-ui-xs text-texte-tertiaire">
              {role.name}
              {projet ? ` · ${projet.name}` : ""}
            </span>
          </div>
          <p className="m-0 line-clamp-2 text-ui-s leading-[1.45] text-texte-secondaire">{routine.consigne}</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-ui-xs text-texte-tertiaire">
            <span className="flex items-center gap-1">
              <Icon name="clock-01" size={14} />
              {libelleFrequence(routine.frequence)}
            </span>
            <span className={routine.active ? "font-medium text-texte-principal" : ""}>
              {routine.active ? `Prochain : ${quand.format(new Date(routine.prochaine))}` : "En pause"}
            </span>
            {derniere && (
              <Link href={`/chat?id=${derniere.chatId}`} className="text-texte-tertiaire underline decoration-bordure-forte underline-offset-2 hover:text-texte-accent">
                Dernier : {quand.format(new Date(derniere.at))}
                {derniere.rattrapee ? " (rattrapé)" : ""}
              </Link>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <BoutonIcone
            taille="compact"
            icone={<Icon name="play-01" size={16} />}
            libelle="Lancer maintenant"
            onClick={() => lancerRoutine(routine.id)}
            className="text-icone-secondaire"
          />
          {routine.active ? (
            <BoutonIcone
              taille="compact"
              icone={<Icon name="pause-01" size={16} />}
              libelle="Mettre en pause"
              onClick={() => enregistrerRoutine({ ...routine, active: false })}
              className="text-icone-secondaire"
            />
          ) : (
            <Bouton variant="blanc" taille="compact" onClick={() =>
                // Reprise : on repart du prochain passage à venir, sans rattraper la pause.
                enregistrerRoutine({
                  ...routine,
                  active: true,
                  prochaine: prochainPassage(routine.frequence, new Date()).toISOString(),
                })
              }>
              Reprendre
            </Bouton>
          )}
          <BoutonIcone
            taille="compact"
            icone={<Icon name="file-code" size={16} />}
            libelle="Modifier"
            onClick={onModifier}
            className="text-icone-secondaire"
          />
          <BoutonIcone
            taille="compact"
            icone={<Icon name="trash-01" size={16} />}
            libelle="Supprimer"
            onClick={() => setConfirmer(true)}
            className="text-icone-secondaire"
          />
        </div>
      </div>
      {confirmer && (
        <div className="flex flex-wrap items-center gap-2 rounded-md bg-fond-page p-3">
          <span className="flex-1 text-ui-s text-texte-principal">Supprimer « {routine.nom} » ? Les conversations déjà faites restent.</span>
          <Bouton variant="sombre" taille="compact" onClick={() => supprimerRoutine(routine.id)}>
            Supprimer
          </Bouton>
          <Bouton variant="blanc" taille="compact" onClick={() => setConfirmer(false)}>
            Annuler
          </Bouton>
        </div>
      )}
    </li>
  );
}

/** Planning : les tâches que les agents refont toutes seules, à heure fixe. */
export function PlanningScreen() {
  const { state, enregistrerRoutine } = useWorkspace();
  const routines = state.routines;
  const [edition, setEdition] = useState<Routine | null>(null);
  const triees = [...routines].sort((a, b) => Number(b.active) - Number(a.active) || a.prochaine.localeCompare(b.prochaine));

  return (
    <div className="h-full overflow-y-auto">
      <div className="@container flex flex-col gap-5 px-5 pt-5 pb-6">
        <header className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1.5">
            <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
              <span className="font-semibold">Planning</span> <span className="font-normal">de l’équipe</span>
            </h1>
            <p className="m-0 text-ui-s text-texte-secondaire">Des tâches confiées aux agents, qui se relancent toutes seules à l’heure dite.</p>
          </div>
          {!edition && <BoutonPrincipal onClick={() => setEdition(nouvelleRoutine())}>Nouvelle tâche planifiée</BoutonPrincipal>}
        </header>

        {edition && (
          <EditeurRoutine
            key={edition.id}
            initiale={edition}
            onAnnuler={() => setEdition(null)}
            onEnregistrer={(r) => {
              enregistrerRoutine(r);
              setEdition(null);
            }}
          />
        )}

        <Semaine routines={routines} />

        <section aria-label="Tâches planifiées" className="flex flex-col gap-3 rounded-3xl border border-bordure-subtile bg-fond-page p-3">
          <h2 className="m-0 px-2 pt-1 text-ui font-semibold text-texte-principal">
            Tâches planifiées <span className="font-normal text-texte-tertiaire">{routines.length}</span>
          </h2>
          {triees.length > 0 ? (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {triees.map((r) => (
                <LigneRoutine key={r.id} routine={r} onModifier={() => setEdition(r)} />
              ))}
            </ul>
          ) : (
            <div className="flex flex-col gap-3 px-2 pb-2">
              <p className="m-0 text-ui-s text-texte-secondaire">Rien de planifié pour l’instant. Pour commencer :</p>
              <div className="grid grid-cols-1 gap-2 @3xl:grid-cols-3">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s.nom}
                    type="button"
                    onClick={() => setEdition(nouvelleRoutine(s))}
                    className="klyra-carte-flottante flex cursor-pointer flex-col gap-2 rounded-lg border-0 p-4 text-left"
                  >
                    <span className="flex items-center gap-2">
                      <AgentRond roleId={s.roleId ?? "principal"} taille={24} />
                      <span className="text-ui-s font-semibold text-texte-principal">{s.nom}</span>
                    </span>
                    <span className="text-ui-xs text-texte-tertiaire">{s.frequence && libelleFrequence(s.frequence)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
