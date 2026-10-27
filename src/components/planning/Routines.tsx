"use client";

import { useMemo, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { cn } from "@/lib/cn";
import { aujourdhui, cleJour, depuisCle, grilleMois } from "@/lib/dates";
import { libelleFrequence, passagesEntre } from "@/lib/planning";
import { useWorkspace } from "@/lib/workspace";
import type { Message, Routine } from "@/types/domain";
import { CanevasRoutine } from "./CanevasRoutine";
import { nouvelleRoutine } from "./EditeurRoutine";
import { etatPassage, LIBELLES_ETAT, MarqueEtat, quand, type Etat } from "./EtatPassage";

/**
 * Les routines : une chaîne d'agents qui part à la demande ou à heure fixe.
 * La liste et le canevas de la routine choisie, puis un calendrier en carrés
 * (ce qui est parti, ce qui va partir) et ce qui part bientôt.
 */

type Vue = "semaine" | "mois";

interface Passage {
  routine: Routine;
  at: Date;
  etat: Etat;
  /** La conversation où le passage a eu lieu (passages déjà partis). */
  chatId: string | null;
  rattrapee: boolean;
}

const JOURS = ["lun.", "mar.", "mer.", "jeu.", "ven.", "sam.", "dim."];
const fmtHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit" });
const fmtMois = new Intl.DateTimeFormat("fr-FR", { month: "long", year: "numeric" });

const capitaliser = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function lundi(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}

/** Les passages entre deux dates : ceux déjà partis (historique) et ceux à venir. */
function usePassages(debut: Date, fin: Date): { passages: Passage[]; horaires: Routine[] } {
  const { state } = useWorkspace();
  return useMemo(() => {
    const parChat = new Map<string, Message[]>();
    for (const m of state.messages) parChat.set(m.chatId, [...(parChat.get(m.chatId) ?? []), m]);
    const maintenant = new Date();
    const passages: Passage[] = [];
    for (const routine of state.routines) {
      for (const h of routine.historique) {
        const at = new Date(h.at);
        if (at < debut || at >= fin) continue;
        passages.push({
          routine,
          at,
          etat: etatPassage(parChat.get(h.chatId) ?? [], h),
          chatId: h.chatId,
          rattrapee: h.rattrapee,
        });
      }
      /* Les routines horaires rempliraient chaque carré : on les cite à part. */
      if (!routine.active || routine.frequence.type === "heure") continue;
      const depart = debut > maintenant ? debut : maintenant;
      for (const at of passagesEntre(routine.frequence, depart, fin, 62))
        passages.push({ routine, at, etat: "a-venir", chatId: null, rattrapee: false });
    }
    passages.sort((a, b) => a.at.getTime() - b.at.getTime());
    return { passages, horaires: state.routines.filter((r) => r.active && r.frequence.type === "heure") };
  }, [state.messages, state.routines, debut, fin]);
}

/* ─── Le calendrier en carrés ──────────────────────────────────── */

function LignePassage({ passage, onChoisir }: { passage: Passage; onChoisir: (id: string) => void }) {
  const { routine, at, etat } = passage;
  return (
    <li>
      <button
        type="button"
        onClick={() => onChoisir(routine.id)}
        title={`${routine.nom} · ${fmtHeure.format(at)} · ${LIBELLES_ETAT[etat]}`}
        className={cn(
          "flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-xs border-0 bg-fond-page px-1.5 py-1 text-left",
          "transition-colors duration-[120ms] ease-sortie hover:bg-fond-survol",
        )}
      >
        <MarqueEtat etat={etat} />
        <span className="shrink-0 text-ui-3xs text-texte-tertiaire tabular-nums">{fmtHeure.format(at)}</span>
        <span className="min-w-0 flex-1 truncate text-ui-2xs font-medium text-texte-principal">{routine.nom}</span>
        <AgentRond roleId={routine.roleId} taille={16} />
      </button>
    </li>
  );
}

function Calendrier({ onChoisir }: { onChoisir: (id: string) => void }) {
  const [vue, setVue] = useState<Vue>("semaine");
  const [cle, setCle] = useState(aujourdhui());
  const ref = depuisCle(cle);

  const jours = useMemo(() => {
    const d = depuisCle(cle);
    if (vue === "mois") return grilleMois(d.getFullYear(), d.getMonth());
    const l = lundi(d);
    return Array.from({ length: 7 }, (_, i) => new Date(l.getFullYear(), l.getMonth(), l.getDate() + i));
  }, [vue, cle]);
  const fin = useMemo(() => {
    const d = new Date(jours[jours.length - 1]);
    d.setDate(d.getDate() + 1);
    return d;
  }, [jours]);
  const { passages, horaires } = usePassages(jours[0], fin);
  const parJour = useMemo(() => {
    const m = new Map<string, Passage[]>();
    for (const p of passages) m.set(cleJour(p.at), [...(m.get(cleJour(p.at)) ?? []), p]);
    return m;
  }, [passages]);

  const decaler = (sens: number) => {
    const d = depuisCle(cle);
    if (vue === "semaine") d.setDate(d.getDate() + 7 * sens);
    else {
      d.setDate(1);
      d.setMonth(d.getMonth() + sens);
    }
    setCle(cleJour(d));
  };

  const auj = aujourdhui();
  const limite = vue === "mois" ? 3 : 6;

  return (
    <section aria-label="Calendrier des routines" className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-center gap-2">
        <h2 className="m-0 mr-auto text-h4 leading-[1.1] font-semibold tracking-[-0.03em] text-texte-principal">
          {capitaliser(fmtMois.format(vue === "mois" ? ref : jours[0]))}
        </h2>
        <div role="radiogroup" aria-label="Vue" className="flex gap-0.5 rounded-sm bg-fond-surface-grise p-0.5">
          {(["semaine", "mois"] as const).map((v) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={vue === v}
              onClick={() => setVue(v)}
              className={cn(
                "h-7 cursor-pointer rounded-2xs border-0 px-3 text-ui-xs font-medium capitalize transition-colors duration-[220ms] ease-sortie",
                vue === v
                  ? "bg-fond-surface text-texte-principal shadow-ombre-xs"
                  : "bg-transparent text-texte-secondaire hover:text-texte-principal",
              )}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-1">
          <BoutonIcone taille="compact" icone={<Icon name="chevron-left" size={16} />} libelle="Précédent" onClick={() => decaler(-1)} />
          <Bouton variant="blanc" taille="compact" onClick={() => setCle(aujourdhui())}>
            Aujourd’hui
          </Bouton>
          <BoutonIcone taille="compact" icone={<Icon name="chevron-right" size={16} />} libelle="Suivant" onClick={() => decaler(1)} />
        </div>
      </header>

      {vue === "mois" && (
        <div aria-hidden="true" className="grid grid-cols-7 gap-2 px-1">
          {JOURS.map((j) => (
            <span key={j} className="text-ui-2xs font-medium text-texte-tertiaire capitalize">
              {j}
            </span>
          ))}
        </div>
      )}

      <ol className="m-0 grid list-none grid-cols-7 gap-2 p-0">
        {jours.map((d) => {
          const c = cleJour(d);
          const duJour = parJour.get(c) ?? [];
          const caches = Math.max(0, duJour.length - limite);
          const horsMois = vue === "mois" && d.getMonth() !== ref.getMonth();
          return (
            <li
              key={c}
              aria-current={c === auj ? "date" : undefined}
              className={cn(
                "klyra-carte-flottante flex min-w-0 flex-col gap-1.5 rounded-lg p-2",
                vue === "semaine" ? "min-h-[168px]" : "min-h-[112px]",
                horsMois && "opacity-50",
              )}
            >
              <div className="flex items-center gap-1.5 px-0.5">
                {vue === "semaine" && (
                  <span className="text-ui-xs text-texte-secondaire capitalize">{JOURS[(d.getDay() + 6) % 7]}</span>
                )}
                <span
                  className={cn(
                    "flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-ui-xs font-semibold",
                    c === auj ? "bg-bleu-k1-500 text-texte-inverse" : "text-texte-principal",
                  )}
                >
                  {d.getDate()}
                </span>
              </div>
              {duJour.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-1 p-0">
                  {duJour.slice(0, limite).map((p) => (
                    <LignePassage key={`${p.routine.id}-${p.at.toISOString()}`} passage={p} onChoisir={onChoisir} />
                  ))}
                </ul>
              )}
              {caches > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setCle(c);
                    setVue("semaine");
                  }}
                  className="cursor-pointer self-start rounded-xs border-0 bg-transparent px-1.5 text-ui-2xs text-texte-tertiaire hover:text-texte-principal"
                >
                  + {caches} {caches > 1 ? "autres" : "autre"}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {horaires.length > 0 && (
        <p className="m-0 px-1 text-ui-xs text-texte-tertiaire">
          Et toutes les heures : {horaires.map((r) => r.nom).join(", ")}.
        </p>
      )}
    </section>
  );
}

/* ─── À côté du calendrier : ce qui part bientôt ───────────────── */

function AVenir({ onChoisir }: { onChoisir: (id: string) => void }) {
  const { state } = useWorkspace();
  const prochains = useMemo(() => {
    const maintenant = new Date();
    const dans14 = new Date(maintenant.getTime() + 14 * 86_400_000);
    return state.routines
      .filter((r) => r.active)
      .flatMap((r) => passagesEntre(r.frequence, maintenant, dans14, 3).map((at) => ({ r, at })))
      .sort((a, b) => a.at.getTime() - b.at.getTime())
      .slice(0, 8);
  }, [state.routines]);

  return (
    <>
      <h3 className="m-0 px-1 text-ui-s font-semibold text-texte-principal">À venir</h3>
      {prochains.length === 0 ? (
        <p className="m-0 px-1 text-ui-s text-texte-tertiaire">Aucune routine ne part dans les deux semaines.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
          {prochains.map(({ r, at }) => (
            <li key={`${r.id}-${at.toISOString()}`}>
              <button
                type="button"
                onClick={() => onChoisir(r.id)}
                className="flex w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent px-1.5 py-1.5 text-left hover:bg-fond-survol"
              >
                <AgentRond roleId={r.roleId} taille={24} />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate text-ui-s font-medium text-texte-principal">{r.nom}</span>
                  <span className="text-ui-xs text-texte-tertiaire">{quand(at)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ─── Toutes les routines, en cartes ───────────────────────────── */

/** Des routines toutes prêtes, pour démarrer. */
const SUGGESTIONS: Partial<Routine>[] = [
  {
    nom: "Nouvelle page, de la maquette à la recette",
    roleId: "designer",
    consigne: "Propose la maquette de la page demandée, en suivant le design system KLYRA.",
    frequence: { type: "manuel" },
    relais: [
      { id: "suggestion-dev", de: "designer", vers: "dev", consigne: "Code cette maquette dans le projet." },
      { id: "suggestion-qa", de: "dev", vers: "qa", consigne: "Contrôle ce qui vient d’être codé et rends ton verdict." },
    ],
  },
  {
    nom: "Revue des mails du matin",
    roleId: "val",
    consigne:
      "Trie les mails arrivés depuis hier, signale ce qui demande une réponse aujourd’hui et prépare les brouillons. Rien ne part sans moi.",
    frequence: { type: "jours-ouvres", heure: "08:30" },
  },
  {
    nom: "Point de la semaine",
    roleId: "principal",
    consigne:
      "Fais le point sur les projets en cours : ce qui a avancé la semaine dernière, ce qui bloque, ce qu’on doit livrer cette semaine.",
    frequence: { type: "semaine", jour: 1, heure: "09:00" },
  },
  {
    nom: "Contrôle de klyra.fr",
    roleId: "qa",
    consigne:
      "Contrôle les pages principales de klyra.fr : liens cassés, textes, affichage mobile. Rends-moi ton verdict.",
    frequence: { type: "semaine", jour: 5, heure: "16:00" },
  },
];

/** Une routine dans la liste de gauche : qui, quoi, quand. */
function LigneRoutine({ routine, choisie, onChoisir }: { routine: Routine; choisie: boolean; onChoisir: () => void }) {
  const agents = new Set([routine.roleId, ...(routine.relais ?? []).map((l) => l.vers)]).size;
  return (
    <li>
      <button
        type="button"
        onClick={onChoisir}
        aria-current={choisie ? "true" : undefined}
        className={cn(
          "flex w-full cursor-pointer items-center gap-2.5 rounded-md border px-2.5 py-2 text-left",
          "transition-colors duration-[120ms] ease-sortie",
          choisie ? "border-bordure-subtile bg-fond-surface shadow-ombre-xs" : "border-transparent bg-transparent hover:bg-fond-survol",
          !routine.active && "opacity-70",
        )}
      >
        <AgentRond roleId={routine.roleId} taille={28} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-ui-s font-semibold text-texte-principal">{routine.nom}</span>
          <span className="truncate text-ui-2xs text-texte-tertiaire">
            {routine.active ? libelleFrequence(routine.frequence) : "En pause"}
            {agents > 1 && ` · ${agents} agents`}
          </span>
        </span>
      </button>
    </li>
  );
}

/** L'écran Routines : la liste et le canevas de la routine choisie, puis le calendrier. */
export function Routines({ onModifier }: { onModifier: (routine: Routine) => void }) {
  const { state } = useWorkspace();
  const triees = [...state.routines].sort(
    (a, b) => Number(b.active) - Number(a.active) || a.nom.localeCompare(b.nom, "fr"),
  );
  const [choisie, setChoisie] = useState<string | null>(null);
  const routine = triees.find((r) => r.id === choisie) ?? triees[0] ?? null;
  const montrer = (id: string) => {
    setChoisie(id);
    document.getElementById("canevas-routine")?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="flex flex-col gap-6">
      {routine ? (
        <div id="canevas-routine" className="grid scroll-mt-5 grid-cols-1 gap-4 @5xl:grid-cols-[240px_minmax(0,1fr)]">
          <nav aria-label="Tes routines" className="flex flex-col gap-2 self-start rounded-3xl border border-bordure-subtile bg-fond-page p-2">
            <h2 className="m-0 px-2 pt-1 text-ui-s font-semibold text-texte-principal">
              Tes routines <span className="font-normal text-texte-tertiaire">{triees.length}</span>
            </h2>
            <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
              {triees.map((r) => (
                <LigneRoutine key={r.id} routine={r} choisie={r.id === routine.id} onChoisir={() => setChoisie(r.id)} />
              ))}
            </ul>
          </nav>
          <CanevasRoutine key={routine.id} routine={routine} onModifier={() => onModifier(routine)} />
        </div>
      ) : (
        <section aria-label="Pour commencer" className="flex flex-col gap-3">
          <p className="m-0 px-1 text-ui-s text-texte-secondaire">
            Une routine, c’est une chaîne d’agents sur un projet : le premier reçoit ta consigne, puis chacun passe sa
            réponse au suivant. Elle part à la demande ou à heure fixe. Pour commencer :
          </p>
          <ul className="m-0 grid list-none grid-cols-1 gap-3 p-0 @2xl:grid-cols-3">
            {SUGGESTIONS.map((s) => (
              <li key={s.nom} className="rounded-2xl bg-fond-surface-grise p-1.5">
                <button
                  type="button"
                  onClick={() => onModifier(nouvelleRoutine(s))}
                  className="flex h-full w-full cursor-pointer flex-col gap-2 rounded-lg border border-bordure-subtile bg-fond-surface p-3.5 text-left transition-[translate] duration-[220ms] ease-sortie hover:-translate-y-px"
                >
                  <span className="flex items-center gap-2">
                    <AgentRond roleId={s.roleId ?? "principal"} taille={24} />
                    <span className="text-ui-s font-semibold text-texte-principal">{s.nom}</span>
                  </span>
                  <span className="text-ui-xs text-texte-tertiaire">{s.frequence && libelleFrequence(s.frequence)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 @5xl:grid-cols-[minmax(0,1fr)_280px]">
        <Calendrier onChoisir={montrer} />
        <aside aria-label="À venir" className="flex flex-col gap-2 self-start rounded-3xl border border-bordure-subtile bg-fond-page p-3">
          <AVenir onChoisir={montrer} />
        </aside>
      </div>
    </div>
  );
}
