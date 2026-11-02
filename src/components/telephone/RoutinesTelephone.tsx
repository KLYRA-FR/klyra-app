"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { RondApercu } from "@/components/roles/AgentRond";
import { dateUneFoisPassee } from "@/components/routines/CarteRoutine";
import { apercuAgent } from "@/components/routines/ColonneAgents";
import { MarqueRun } from "@/components/routines/MarqueRun";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { cn } from "@/lib/cn";
import { useServeursRelies } from "@/lib/lieux";
import { useGestePoste } from "@/lib/poste/client";
import { dureeRun, libellePlanning, libelleRun, lienRun, quandRoutine, runActif } from "@/lib/routines-affichage";
import { messageGeste, useLectureSuivie, useTirerPourRelire } from "@/lib/telephone/lecture-suivie";
import {
  ecrireBrouillon,
  initialeDe,
  lireBrouillon,
  nouvelleRoutine,
  valeursRoutine,
  type AgentLu,
  type BrouillonRoutine,
  type ExecutionsLues,
  type RoutinesLues,
} from "@/lib/telephone/routines-telephone";
import type { RoleTeinte } from "@/types/domain";
import type { Routine, RoutineInput, RoutineRun } from "@/types/routines";
import { EnteteTelephone } from "./EnteteTelephone";
import { ConfirmationFeuille, Feuille, MenuFeuille, useAppuiLong, type ActionMenu } from "./Feuille";
import { FormulaireRoutineTelephone, type ContexteRoutine } from "./FormulaireRoutineTelephone";
import { VueLecture, useBandeau } from "./etats";
import { usePostes, useSupport } from "./poste";

/**
 * Automatisations › Routines sur le téléphone (spec mobile T-14 à T-17). La colonne des agents du
 * canevas devient le premier écran ; les routines d'un agent se lisent en colonne, l'agent en tête.
 * Tout passe par l'ordinateur ouvert (gestes `routines.*`) ; rien n'est gardé dans le compte.
 */

export const urlRoutines = (agent?: string | null, routine?: string | null, formulaire = false) =>
  `/routines?vue=routines${agent ? `&agent=${encodeURIComponent(agent)}` : ""}${routine ? `&routine=${encodeURIComponent(routine)}` : ""}${formulaire ? "&formulaire=1" : ""}`;

/** P-6 des routines. Celles d'un VPS partent quand même (MO-T17) : dit seulement si ce téléphone en connaît un. */
function usePhraseFermee() {
  const vps = useServeursRelies().length > 0;
  return (sur: string) => `les routines sont sur ${sur}. Elles ne partent que quand KLYRA y est ouverte.${vps ? ` Celles d’un VPS y tournent même ${sur} fermé.` : ""}`;
}

/** Le moteur des routines ne tourne pas sur l'ordinateur : mêmes mots qu'au bureau. */
function MoteurArrete({ erreur, relancer }: { erreur: string | null; relancer: () => void }) {
  return (
    <div role="alert" className="mx-4 mt-6 rounded-xl border border-bordure-forte bg-fond-surface p-4">
      <p className="text-body-s font-medium text-texte-principal">Les routines sont arrêtées</p>
      <p className="mt-1 text-ui text-texte-secondaire">{erreur ?? "Le moteur des routines est indisponible."}</p>
      <Bouton variant="blanc" taille="md" className="mt-3" onClick={relancer}>
        Réessayer
      </Bouton>
    </div>
  );
}

function Relache({ visible }: { visible: boolean }) {
  return visible ? <p className="px-4 py-2 text-ui-xs text-texte-secondaire">Relâche pour relire</p> : null;
}

/* ─── T-14 : les agents ────────────────────────────────────────── */

export function AgentsRoutinesTelephone({ onglets, routineDemandee }: { onglets: ReactNode; routineDemandee: string | null }) {
  const router = useRouter();
  const sur = useSupport();
  const ferme = usePhraseFermee();
  const lecture = useLectureSuivie<RoutinesLues>("routines.liste", {}, { suivre: (d) => d.enCours.some(runActif) });
  const tirer = useTirerPourRelire(lecture.relancer);
  const [brouillon] = useState(lireBrouillon);
  const data = lecture.etat === "ok" ? lecture.data : null;
  /* Un lien vers une routine sans son agent (notification) mène à son agent, comme au bureau. */
  const cible = routineDemandee ? data?.routines.find((r) => r.id === routineDemandee) : undefined;
  useEffect(() => {
    if (cible) router.replace(urlRoutines(cible.agentId, cible.id));
  }, [cible, router]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone titre="Automatisations" retour={() => router.push("/plus")} />
      <div className="shrink-0 px-4 pb-2">{onglets}</div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-4" {...tirer.props}>
        <Relache visible={tirer.tire} />
        <VueLecture lecture={lecture} ferme={ferme} lignes={5}>
          {(d) =>
            !d.actif ? (
              <MoteurArrete erreur={d.erreur} relancer={lecture.relancer} />
            ) : (
              <nav aria-label="Agents" className="px-4">
                {[true, false].map((actif) => {
                  const groupe = d.agents.filter((a) => a.actif === actif);
                  if (!groupe.length) return null;
                  return (
                    <section key={String(actif)} aria-label={actif ? "Mes agents" : "Hors de Mes agents"}>
                      <h2 className="pt-4 pb-1 text-ui-xs font-medium text-texte-secondaire">{actif ? "Mes agents" : "Hors de Mes agents"}</h2>
                      <ul>
                        {groupe.map((a) => (
                          <li key={a.id}>
                            <Link href={urlRoutines(a.id)} className="flex min-h-16 items-center gap-3 border-b border-bordure-subtile py-2 active:bg-fond-survol">
                              <RondApercu agentId={a.id} nom={a.name} teinte={a.teinte} taille={36} className={a.actif ? undefined : "opacity-60"} />
                              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                                <span className="flex min-w-0 items-center gap-1.5">
                                  <span className="truncate text-body-s font-medium text-texte-principal">{a.name}</span>
                                  {a.tag ? <span className="shrink-0 rounded-sm bg-fond-surface-grise px-1.5 text-ui-xs text-texte-secondaire">{a.tag}</span> : null}
                                </span>
                                <span className="truncate text-ui-xs text-texte-secondaire">{apercuAgent(a, d.routines, d.enCours, brouillon?.valeurs.agentId, true)}</span>
                              </span>
                              <Icon name="chevron-right" size={16} className="shrink-0 text-icone-secondaire" />
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </section>
                  );
                })}
              </nav>
            )
          }
        </VueLecture>
      </div>
      {data?.actif ? (
        <p className="shrink-0 border-t border-bordure-subtile px-4 py-3 text-ui-xs text-texte-secondaire">
          <Icon name="clock-01" size={14} className="mr-1 inline text-icone-secondaire" />
          Les routines partent de {sur} tant que KLYRA est ouverte. App fermée ou en veille, rien ne part.
        </p>
      ) : null}
    </div>
  );
}

/* ─── T-15 : les routines d'un agent ───────────────────────────── */

interface Edition extends BrouillonRoutine {
  contexte: ContexteRoutine;
  /** L'adresse a montré le formulaire : si elle ne le montre plus (retour du système), il se ferme. */
  affichee: boolean;
}
type Echec = { message: string; reessayer: () => void };
interface Confirmation {
  titre: string;
  texte?: string;
  confirmer: string;
  danger?: boolean;
  action: () => void;
}

const SUGGESTIONS = [
  {
    name: "Point de la semaine",
    instruction: "Fais le point sur mes tâches de la semaine. Signale les échéances proches, les blocages et les décisions qui m’attendent.",
    schedule: { kind: "weekly", weekday: 1, time: "09:00" },
  },
  {
    name: "Revue des mails",
    instruction: "Relis les mails accessibles avec mes connexions et propose les réponses utiles en brouillon. Si une connexion manque, signale-le. N’envoie aucun message.",
    schedule: { kind: "weekdays", time: "09:00" },
  },
  {
    name: "Contrôle de klyra.fr",
    instruction: "Vérifie les pages publiques de klyra.fr. Signale les liens cassés et les erreurs visibles ; ne modifie pas le site.",
    schedule: { kind: "weekdays", time: "09:00" },
  },
] as const satisfies readonly Pick<RoutineInput, "name" | "instruction" | "schedule">[];

export function RoutinesAgentTelephone({ agentId, routineId, formulaire }: { agentId: string; routineId: string | null; formulaire: boolean }) {
  const router = useRouter();
  const sur = useSupport();
  const { ouvert } = usePostes();
  const ferme = usePhraseFermee();
  const lecture = useLectureSuivie<RoutinesLues>("routines.liste", { agentId }, { suivre: (d) => d.enCours.some((r) => r.agentId === agentId && runActif(r)) });
  const { relancer } = lecture;
  const tirer = useTirerPourRelire(relancer);
  const { faire, occupe } = useGestePoste();
  const [bandeau, annoncer] = useBandeau();
  const [brouillon, setBrouillon] = useState<BrouillonRoutine | null>(lireBrouillon);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [tour, setTour] = useState(0);
  const [restaurer, setRestaurer] = useState(formulaire);
  const [executions, setExecutions] = useState<Routine | null>(null);
  const [menu, setMenu] = useState<Routine | null>(null);
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const [erreurs, setErreurs] = useState<Record<string, Echec | undefined>>({});
  const [eclairee, setEclairee] = useState<string | null>(null);
  const data = lecture.etat === "ok" ? lecture.data : null;

  const agent: AgentLu = data?.agents.find((a) => a.id === agentId) ?? { id: agentId, name: agentId, tag: "", title: "", teinte: "jaune" as RoleTeinte, actif: false, connu: false };
  const nomAgent = (id: string) => data?.agents.find((a) => a.id === id)?.name ?? id;
  const agentActif = (id: string) => !!data?.agents.some((a) => a.id === id && a.actif);
  const liste = (data?.routines ?? []).filter((r) => r.agentId === agentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const actifDe = (id: string) => data?.enCours.find((run) => run.routineId === id && runActif(run));
  const indisponible = !ouvert || occupe || !data?.actif;
  const choisie = liste.find((r) => r.id === routineId) ?? null;

  /* Le formulaire est une page : « formulaire=1 » dans l'adresse, le retour du système le ferme (le brouillon reste). */
  if (edition && formulaire && !edition.affichee) setEdition({ ...edition, affichee: true });
  if (edition?.affichee && !formulaire) setEdition(null);
  /* Page rouverte sur le formulaire : il reprend le brouillon de cet agent, s'il y en a un. */
  if (restaurer && data) {
    setRestaurer(false);
    if (formulaire && !edition && brouillon?.valeurs.agentId === agentId) setEdition({ ...brouillon, contexte: data, affichee: true });
  }

  useEffect(() => {
    if (!eclairee) return;
    document.querySelector(`[data-routine-carte="${CSS.escape(eclairee)}"]`)?.scrollIntoView({ block: "center" });
    const minuteur = setTimeout(() => setEclairee(null), 2500);
    return () => clearTimeout(minuteur);
  }, [eclairee, data]);

  const commencer = (initiale: Routine | null, valeurs?: RoutineInput, champAgent = false) => {
    if (!data) return;
    const base = initiale ? valeursRoutine(initiale) : nouvelleRoutine(agentId, data.fuseau, data.lieu);
    setEdition({ initiale: initiale ? initialeDe(initiale) : null, base, valeurs: valeurs ?? base, champAgent, contexte: data, affichee: false });
    setTour((n) => n + 1);
    router.push(urlRoutines(agentId, routineId, true));
  };
  /* Le brouillon n'est gardé que s'il s'écarte de l'ouverture, comme au bureau. */
  const memoriser = useCallback(
    (valeurs: RoutineInput, modifie: boolean) => {
      if (!edition) return;
      const suivant = modifie ? { initiale: edition.initiale, base: edition.base, valeurs, champAgent: edition.champAgent } : null;
      setBrouillon(suivant);
      ecrireBrouillon(suivant);
    },
    [edition],
  );
  const fermerFormulaire = () => {
    ecrireBrouillon(null);
    setBrouillon(null);
    setEdition(null);
    router.replace(urlRoutines(agentId, routineId));
  };
  const annulerFormulaire = () => {
    if (brouillon) setConfirmation({ titre: "Abandonner les modifications ?", texte: "Les changements de ce formulaire ne seront pas enregistrés.", confirmer: "Abandonner", action: fermerFormulaire });
    else fermerFormulaire();
  };
  const enregistrer = async (input: RoutineInput) => {
    if (!edition) return;
    const r = await faire<Routine>("routines.enregistrer", { id: edition.initiale?.id ?? null, updatedAt: edition.initiale?.updatedAt ?? null, input });
    if (!r.ok) {
      if (r.code === "changee" || r.code === "supprimee") relancer();
      throw Object.assign(new Error(messageGeste(r, sur)), { code: r.code });
    }
    ecrireBrouillon(null);
    setBrouillon(null);
    setEdition(null);
    setEclairee(r.data.id);
    annoncer(edition.initiale ? "Routine enregistrée." : "Routine créée.");
    relancer();
    router.replace(urlRoutines(r.data.agentId, r.data.id));
  };
  const recharger = () => {
    const courante = data?.routines.find((r) => r.id === edition?.initiale?.id);
    if (!courante || !data) return;
    const base = valeursRoutine(courante);
    setEdition({ initiale: initialeDe(courante), base, valeurs: base, champAgent: false, contexte: data, affichee: true });
    setTour((n) => n + 1);
  };
  const reprendreBrouillon = () => {
    if (!brouillon || !data) return;
    setEdition({ ...brouillon, contexte: data, affichee: false });
    setTour((n) => n + 1);
    router.push(urlRoutines(agentId, routineId, true));
  };

  const agir = async (r: Routine, type: string, args: Record<string, unknown>, message: string, apres?: () => void) => {
    if (occupe) return;
    setErreurs((e) => ({ ...e, [r.id]: undefined }));
    const res = await faire(type, args);
    if (res.ok) {
      annoncer(message);
      apres?.();
      relancer();
    } else setErreurs((e) => ({ ...e, [r.id]: { message: messageGeste(res, sur), reessayer: () => void agir(r, type, args, message, apres) } }));
  };
  const pause = (r: Routine) => {
    /* Une « une fois » passée et en pause : on choisit une nouvelle date avant de la reprendre, comme au bureau. */
    if (!r.active && r.schedule.kind === "once" && !r.nextRunAt) commencer(r, { ...valeursRoutine(r), active: true });
    else void agir(r, "routines.pause", { id: r.id, active: !r.active }, r.active ? "Routine en pause. Une exécution déjà en cours continue." : "Routine reprise.");
  };
  const interrompre = (r: Routine, run: RoutineRun) => {
    const enFile = run.status === "queued";
    setConfirmation({
      titre: enFile ? "Annuler ce départ ?" : "Interrompre cette exécution ?",
      texte: "Le planning de la routine reste inchangé. Les messages déjà écrits sont conservés.",
      confirmer: enFile ? "Annuler le départ" : "Interrompre",
      action: () => void agir(r, "routines.interrompre", { runId: run.id }, enFile ? "Départ annulé." : "Exécution interrompue."),
    });
  };
  const supprimer = (r: Routine) =>
    setConfirmation({
      titre: `Supprimer « ${r.name} » ?`,
      texte: "La routine et son historique seront supprimés. Les messages de ses conversations sont conservés.",
      confirmer: "Supprimer",
      danger: true,
      action: () =>
        void agir(r, "routines.supprimer", { id: r.id }, "Routine supprimée.", () => {
          if (routineId === r.id) router.replace(urlRoutines(agentId));
        }),
    });
  const simplifier = (r: Routine) =>
    setConfirmation({
      titre: `Garder seulement ${nomAgent(r.agentId)} ?`,
      texte: `La routine reprendra avec sa première consigne et un seul agent. Les ${r.relais?.length ?? 0} relais ne seront plus exécutés. Leur sauvegarde reste sur ${sur}.`,
      confirmer: "Garder et reprendre",
      action: () => void agir(r, "routines.simplifier", { id: r.id }, "Routine reprise avec un seul agent."),
    });
  const ouvrirExecutions = (r: Routine) => {
    setExecutions(r);
    if (routineId !== r.id) router.replace(urlRoutines(agentId, r.id));
  };

  const actionsMenu = (r: Routine): ActionMenu[] => {
    const relais = !!r.relais?.length;
    const actif = actifDe(r.id);
    const bloquerReprise = indisponible || (!r.active && (!agentActif(r.agentId) || relais));
    return [
      { libelle: "Modifier", desactivee: indisponible, onChoisir: () => commencer(r) },
      ...(r.schedule.kind !== "manual" ? [{ libelle: r.active ? "Mettre en pause" : "Reprendre", desactivee: bloquerReprise, onChoisir: () => pause(r) }] : []),
      { libelle: "Exécutions", onChoisir: () => ouvrirExecutions(r) },
      ...(relais ? [{ libelle: `Garder seulement ${nomAgent(r.agentId)}`, desactivee: indisponible || !agentActif(r.agentId), onChoisir: () => simplifier(r) }] : []),
      ...(!agentActif(r.agentId) ? [{ libelle: "Changer d’agent", desactivee: indisponible, onChoisir: () => commencer(r, undefined, true) }] : []),
      {
        libelle: "Supprimer",
        danger: true,
        desactivee: indisponible || !!actif,
        note: actif ? <p className="text-ui-xs text-texte-secondaire">Une exécution attend ou travaille déjà pour cette routine.</p> : undefined,
        onChoisir: () => supprimer(r),
      },
    ];
  };

  const brouillonVisible = !edition && brouillon?.valeurs.agentId === agentId;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <EnteteTelephone
        titre={data ? `Routines de ${agent.name} · ${liste.length}` : "Routines"}
        retour={() => router.push(urlRoutines())}
        droite={
          data && choisie ? (
            <Bouton variant="discret" taille="compact" className="min-h-11" iconeGauche={<Icon name="list" size={16} />} onClick={() => setExecutions(choisie)}>
              Exécutions
            </Bouton>
          ) : null
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto pb-6" {...tirer.props}>
        <Relache visible={tirer.tire} />
        <VueLecture lecture={lecture} ferme={ferme}>
          {(d) =>
            !d.actif ? (
              <MoteurArrete erreur={d.erreur} relancer={relancer} />
            ) : (
              <div className="flex flex-col gap-3 px-4 pt-2">
                <CarteAgentTelephone agent={agent} sur={sur} />
                <p className="flex items-center gap-2 text-ui-xs text-texte-secondaire" aria-hidden="true">
                  <span className="h-px flex-1 bg-bordure-subtile" />
                  confiées à {agent.name}
                  <span className="h-px flex-1 bg-bordure-subtile" />
                </p>
                {brouillonVisible && brouillon ? (
                  <section aria-label="Brouillon non enregistré" className="flex flex-col gap-2 rounded-xl border border-dashed border-bordure-forte bg-fond-surface p-4">
                    <header className="flex items-center gap-2">
                      <Icon name="pencil-01" size={16} className="text-icone-secondaire" />
                      <h2 className="truncate text-body-s font-medium text-texte-principal">{brouillon.valeurs.name || "Nouvelle routine"}</h2>
                    </header>
                    <p className="text-ui-xs text-texte-secondaire">{libellePlanning(brouillon.valeurs.schedule)}</p>
                    <p className="text-ui-xs text-texte-principal">Brouillon non enregistré</p>
                    <div className="flex gap-2">
                      <Bouton variant="sombre" taille="md" className="flex-1" disabled={indisponible} onClick={reprendreBrouillon}>
                        Reprendre
                      </Bouton>
                      <Bouton
                        variant="blanc"
                        taille="md"
                        className="flex-1"
                        onClick={() =>
                          setConfirmation({
                            titre: "Abandonner ce brouillon ?",
                            confirmer: "Abandonner",
                            action: () => {
                              ecrireBrouillon(null);
                              setBrouillon(null);
                            },
                          })
                        }
                      >
                        Abandonner
                      </Bouton>
                    </div>
                  </section>
                ) : null}
                {liste.map((r) => (
                  <CarteRoutineTelephone
                    key={r.id}
                    routine={r}
                    agentActif={agentActif(r.agentId)}
                    nomDe={nomAgent}
                    actif={actifDe(r.id)}
                    derniere={d.dernieres?.[r.id]}
                    choisie={routineId === r.id}
                    eclairee={eclairee === r.id}
                    indisponible={indisponible}
                    erreur={erreurs[r.id]}
                    onChoisir={() => router.replace(urlRoutines(agentId, r.id))}
                    onMenu={() => setMenu(r)}
                    onExecuter={() => void agir(r, "routines.executer", { id: r.id }, "Exécution ajoutée à la file de l’agent.")}
                    onPause={() => pause(r)}
                    onInterrompre={(run) => interrompre(r, run)}
                    onSimplifier={() => simplifier(r)}
                  />
                ))}
                {!liste.length && !brouillonVisible && agent.actif ? (
                  <section className="flex flex-col gap-3 rounded-xl border border-dashed border-bordure-forte p-4">
                    <h2 className="text-body-s font-medium text-texte-principal">Confie une tâche qui revient à {agent.name}</h2>
                    <p className="text-ui text-texte-secondaire">Commence avec un exemple, puis adapte sa consigne avant de l’enregistrer.</p>
                    <div className="flex flex-col gap-2">
                      {SUGGESTIONS.map((s) => (
                        <Bouton key={s.name} variant="blanc" taille="md" className="justify-start" disabled={indisponible} onClick={() => commencer(null, { ...nouvelleRoutine(agentId, d.fuseau, d.lieu), ...s })}>
                          {s.name}
                        </Bouton>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            )
          }
        </VueLecture>
      </div>
      {data?.actif && agent.actif ? (
        <div className="shrink-0 border-t border-bordure-subtile px-4 py-3">
          <BoutonPrincipal className="w-full" disabled={indisponible} onClick={() => commencer(null)}>
            Nouvelle routine
          </BoutonPrincipal>
        </div>
      ) : null}

      {edition ? (
        <FormulaireRoutineTelephone
          key={tour}
          initiale={edition.initiale}
          base={edition.base}
          valeurs={edition.valeurs}
          champAgent={edition.champAgent}
          contexte={edition.contexte}
          changeeAilleurs={!!edition.initiale && !!data && data.routines.find((r) => r.id === edition.initiale!.id)?.updatedAt !== edition.initiale.updatedAt}
          onRecharger={recharger}
          onEnregistrer={enregistrer}
          onChange={memoriser}
          onAnnuler={annulerFormulaire}
        />
      ) : null}
      {executions ? (
        <FeuilleExecutions
          routine={executions}
          actif={actifDe(executions.id)}
          agentActif={agentActif(executions.agentId)}
          nomAgent={nomAgent}
          indisponible={indisponible}
          onInterrompre={(run) => interrompre(executions, run)}
          onFermer={() => setExecutions(null)}
        />
      ) : null}
      {menu ? <MenuFeuille titre={menu.name} actions={actionsMenu(menu)} onFermer={() => setMenu(null)} /> : null}
      {confirmation ? (
        <ConfirmationFeuille
          titre={confirmation.titre}
          texte={confirmation.texte}
          confirmer={confirmation.confirmer}
          danger={confirmation.danger}
          onConfirmer={confirmation.action}
          onFermer={() => setConfirmation(null)}
        />
      ) : null}
      {bandeau}
    </div>
  );
}

/** L'agent en tête de ses routines : le lien « confiée à » du canevas devient l'ordre de lecture. */
function CarteAgentTelephone({ agent, sur }: { agent: AgentLu; sur: string }) {
  return (
    <section aria-label={`Agent ${agent.name}`} className={cn("flex flex-col gap-2 rounded-xl border p-4", agent.actif ? "border-bordure-subtile bg-fond-surface" : "border-bordure-forte bg-fond-surface-douce")}>
      <header className="flex items-center gap-3">
        <RondApercu agentId={agent.id} nom={agent.name} teinte={agent.teinte} taille={40} className={agent.actif ? undefined : "opacity-60"} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-body-s font-medium text-texte-principal">{agent.name}</span>
          <span className="truncate text-ui-xs text-texte-secondaire">
            {[agent.tag, agent.actif ? "Actif" : agent.connu ? "Désactivé" : `Absent de ${sur}`].filter(Boolean).join(" · ")}
          </span>
        </span>
      </header>
      {agent.title ? <p className="line-clamp-2 text-ui text-texte-secondaire">{agent.title}</p> : null}
      {!agent.actif ? <p className="text-ui text-texte-secondaire">{agent.connu ? "Désactivé : ses routines ne partent pas." : `Absent de ${sur} : ses routines ne partent pas.`}</p> : null}
      <div className="flex flex-wrap gap-x-4">
        <Link className="flex min-h-11 items-center text-ui text-texte-principal underline underline-offset-2" href={`/chat?id=${encodeURIComponent(`dm-${agent.id}`)}`}>
          Ouvrir la conversation
        </Link>
        {!agent.actif ? (
          <Link className="flex min-h-11 items-center text-ui text-texte-principal underline underline-offset-2" href="/equipe">
            Ouvrir l’équipe
          </Link>
        ) : null}
      </div>
    </section>
  );
}

/** La carte d'une routine du bureau, pleine largeur : même contenu, mêmes gestes, cibles de 44 px. */
function CarteRoutineTelephone({
  routine: r,
  agentActif,
  nomDe,
  actif,
  derniere: lue,
  choisie,
  eclairee,
  indisponible,
  erreur,
  onChoisir,
  onMenu,
  onExecuter,
  onPause,
  onInterrompre,
  onSimplifier,
}: {
  routine: Routine;
  agentActif: boolean;
  nomDe: (id: string) => string;
  actif?: RoutineRun;
  derniere?: { run: RoutineRun | null } | { erreur: string };
  choisie: boolean;
  eclairee: boolean;
  indisponible: boolean;
  erreur?: Echec;
  onChoisir(): void;
  onMenu(): void;
  onExecuter(): void;
  onPause(): void;
  onInterrompre(run: RoutineRun): void;
  onSimplifier(): void;
}) {
  const id = useId();
  const nomAgent = nomDe(r.agentId);
  const appui = useAppuiLong(onMenu);
  const consigne = useRef<HTMLParagraphElement>(null);
  const [developpee, setDeveloppee] = useState(false);
  const [deborde, setDeborde] = useState(false);
  const relais = !!r.relais?.length;
  const derniere = lue && "run" in lue ? (lue.run ?? undefined) : undefined;
  const erreurLecture = lue && "erreur" in lue ? lue.erreur : undefined;
  const run = actif ?? derniere;

  useEffect(() => {
    const el = consigne.current;
    if (!el) return;
    const mesurer = () => {
      if (!developpee) setDeborde(el.scrollHeight > el.clientHeight + 1);
    };
    const observateur = new ResizeObserver(mesurer);
    observateur.observe(el);
    return () => observateur.disconnect();
  }, [r.instruction, developpee]);

  const bloquerReprise = indisponible || (!r.active && (!agentActif || relais));
  const motif = relais
    ? "Choisis d’abord quoi conserver de cette ancienne chaîne."
    : !agentActif
      ? "Choisis un agent actif avant de lancer cette routine."
      : actif
        ? "Une exécution attend ou travaille déjà pour cette routine."
        : null;
  const etat = relais
    ? "Ancienne chaîne à examiner"
    : !agentActif
      ? "Agent indisponible"
      : !r.active && dateUneFoisPassee(r)
        ? "Date passée · en pause"
        : !r.active
          ? "En pause"
          : r.schedule.kind === "manual"
            ? "À lancer quand tu veux"
            : `Prochaine : ${quandRoutine(r.nextRunAt, r.timezone)}`;
  const fuseauDifferent = r.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ville = r.timezone.split("/").at(-1)?.replaceAll("_", " ") ?? r.timezone;
  const heure = actif ? new Intl.DateTimeFormat("fr-FR", { timeZone: r.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(actif.startedAt ?? actif.createdAt)) : null;
  const bordure = eclairee || choisie
    ? "border-bleu-k1-500"
    : actif?.status === "running" || actif?.status === "needs-attention"
      ? "border-bleu-k2-500"
      : derniere?.status === "failed"
        ? "border-bordure-erreur"
        : relais || !agentActif
          ? "border-bordure-forte"
          : "border-bordure-subtile";

  return (
    <section
      aria-labelledby={`${id}-titre`}
      aria-describedby={`${id}-agent`}
      data-routine-carte={r.id}
      {...appui}
      className={cn("flex flex-col rounded-xl border bg-fond-surface transition-[border-color] duration-[120ms] ease-sortie", bordure, (relais || !agentActif) && "bg-fond-surface-douce")}
    >
      <header className="flex min-h-12 items-center gap-2 pl-4">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-xs bg-fond-surface-grise text-icone-secondaire">
          <Icon name={relais ? "lock-01" : !r.active ? "pause-01" : "clock-01"} size={16} />
        </span>
        <button id={`${id}-titre`} type="button" onClick={onChoisir} className="min-h-11 min-w-0 flex-1 truncate text-left text-body-s font-medium text-texte-principal">
          {r.name}
        </button>
        <MarqueRun run={run} />
        <BoutonIcone variant="discret" taille="md" libelle="Actions de la routine" aria-haspopup="dialog" icone={<Icon name="dot-horizontal" size={20} />} onClick={onMenu} />
      </header>
      <span id={`${id}-agent`} className="sr-only">
        Confiée à {nomAgent}
      </span>
      <div className="flex flex-col gap-3 px-4 pb-4">
        <div>
          <p className="text-ui-xs text-texte-secondaire">
            {libellePlanning(r.schedule)}
            {fuseauDifferent ? ` · heure de ${ville}` : ""}
          </p>
          <p className="mt-0.5 text-ui-xs font-medium text-texte-principal">{etat}</p>
        </div>
        <div>
          <p
            ref={consigne}
            className={cn("rounded-md border border-bordure-subtile bg-fond-page px-3 py-2 text-ui leading-[1.45] break-words whitespace-pre-wrap text-texte-principal", !developpee && "line-clamp-4")}
          >
            {r.instruction}
          </p>
          {deborde || developpee ? (
            <button type="button" aria-expanded={developpee} onClick={() => setDeveloppee((v) => !v)} className="min-h-11 text-ui-xs text-texte-secondaire underline underline-offset-2">
              {developpee ? "Réduire" : "Afficher toute la consigne"}
            </button>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 rounded-md bg-fond-surface-grise px-3 py-2 text-ui-xs text-texte-secondaire">
          {actif ? (
            <>
              <p role="status" className="font-medium text-texte-principal">
                {libelleRun(actif)} · depuis {heure}
              </p>
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <Bouton variant="blanc" taille="md" disabled={indisponible} onClick={() => onInterrompre(actif)}>
                  {actif.status === "queued" ? "Annuler le départ" : "Interrompre"}
                </Bouton>
                {lienRun(actif) ? (
                  <Link href={lienRun(actif)!} className="flex min-h-11 items-center text-ui text-texte-principal underline underline-offset-2">
                    {actif.status === "needs-attention" ? "Répondre dans la conversation" : "Ouvrir la conversation"}
                  </Link>
                ) : null}
              </div>
              {actif.status === "needs-attention" ? <p>L’agent attend une autorisation.</p> : null}
            </>
          ) : derniere ? (
            <>
              <p>
                Dernière : {libelleRun(derniere)} · {quandRoutine(derniere.scheduledFor, r.timezone)}
                {dureeRun(derniere) ? ` · ${dureeRun(derniere)}` : ""}
              </p>
              {derniere.error || derniere.result ? (
                <p className={cn("line-clamp-2 break-words whitespace-pre-wrap", derniere.error && "text-texte-erreur")}>{derniere.error || derniere.result}</p>
              ) : null}
              {lienRun(derniere) ? (
                <Link href={lienRun(derniere)!} className="flex min-h-11 items-center self-start text-ui text-texte-principal underline underline-offset-2">
                  Voir la conversation
                </Link>
              ) : null}
            </>
          ) : (
            <p>{erreurLecture ? "Le dernier résultat est indisponible." : "Aucune exécution pour le moment."}</p>
          )}
          {erreurLecture ? (
            <p role="alert" className="text-texte-erreur">
              {erreurLecture}
            </p>
          ) : null}
        </div>
        {relais ? (
          <div className="flex flex-col gap-2 text-ui-xs text-texte-secondaire">
            <p>Elle est conservée en pause. Aucun relais ne sera lancé. Tu peux conserver seulement la consigne du premier agent ; une sauvegarde de l’ancienne chaîne reste sur l’ordinateur.</p>
            <details>
              <summary className="flex min-h-11 cursor-pointer items-center">Voir les {r.relais!.length} relais conservés</summary>
              <ol className="my-2 flex list-decimal flex-col gap-2 pl-4">
                {r.relais!.map((relai) => (
                  <li key={relai.id}>
                    <strong className="text-texte-principal">
                      {nomDe(relai.de)} → {nomDe(relai.vers)}
                    </strong>
                    <p className="my-1 break-words whitespace-pre-wrap">{relai.consigne}</p>
                  </li>
                ))}
              </ol>
            </details>
            <Bouton variant="blanc" taille="md" className="self-start" disabled={indisponible || !agentActif} onClick={onSimplifier}>
              Garder seulement {nomAgent}
            </Bouton>
          </div>
        ) : (
          <>
            <footer className="flex gap-2">
              <Bouton variant="sombre" taille="md" className="flex-1" iconeGauche={<Icon name="play-01" size={16} />} disabled={indisponible || !agentActif || !!actif} onClick={onExecuter}>
                Exécuter
              </Bouton>
              {r.schedule.kind !== "manual" ? (
                <Bouton variant="blanc" taille="md" className="flex-1" iconeGauche={<Icon name={r.active ? "pause-01" : "play-01"} size={16} />} disabled={bloquerReprise} onClick={onPause}>
                  {r.active ? "Pause" : "Reprendre"}
                </Bouton>
              ) : null}
            </footer>
            {motif ? <p className="text-ui-xs text-texte-secondaire">{motif}</p> : null}
          </>
        )}
        {erreur ? (
          <div role="alert" className="text-ui-xs text-texte-erreur">
            <p className="mb-1 break-words">{erreur.message}</p>
            <Bouton variant="blanc" taille="md" disabled={indisponible} onClick={erreur.reessayer}>
              Réessayer
            </Bouton>
          </div>
        ) : null}
      </div>
    </section>
  );
}

/* ─── T-17 : les exécutions d'une routine ──────────────────────── */

function FeuilleExecutions({
  routine: r,
  actif,
  agentActif,
  nomAgent,
  indisponible,
  onInterrompre,
  onFermer,
}: {
  routine: Routine;
  actif?: RoutineRun;
  agentActif: boolean;
  nomAgent: (id: string) => string;
  indisponible: boolean;
  onInterrompre(run: RoutineRun): void;
  onFermer(): void;
}) {
  const [limite, setLimite] = useState(50);
  const id = useId();
  const lecture = useLectureSuivie<ExecutionsLues>("routines.executions", { id: r.id, limite }, { garde: r.id, suivre: () => !!actif });
  const bloque = !r.active || !agentActif || !!r.relais?.length;

  return (
    <Feuille titre="Exécutions" haute onFermer={onFermer}>
      <p className="truncate pb-3 text-ui text-texte-secondaire">{r.name}</p>
      <div className="-mx-4">
        <VueLecture lecture={lecture} ferme={(sur) => `l’historique de cette routine est sur ${sur}. Il s’affiche quand KLYRA y est ouverte.`}>
          {(data) => {
            const runs = actif ? [actif, ...data.runs.filter((run) => run.id !== actif.id)] : data.runs;
            return (
              <div className="flex flex-col gap-4 px-4">
                {r.schedule.kind !== "manual" ? (
                  <section aria-labelledby={`${id}-avenir`} className="flex flex-col gap-2 text-ui text-texte-secondaire">
                    <h3 id={`${id}-avenir`} className="text-body-s font-medium text-texte-principal">
                      À venir
                    </h3>
                    {bloque ? (
                      <p>Aucun départ tant que la routine est en pause ou bloquée.</p>
                    ) : data.dates.length ? (
                      <ul className="flex list-disc flex-col gap-1 pl-5">
                        {data.dates.map((date) => (
                          <li key={date}>{quandRoutine(date, r.timezone)}</li>
                        ))}
                      </ul>
                    ) : (
                      <p>Aucun départ dans les sept prochains jours.</p>
                    )}
                    <p className="text-ui-xs">
                      Au retour de veille ou après fermeture : {r.missedPolicy === "skip" ? "ignorer les échéances manquées" : "lancer une seule fois la dernière échéance manquée"}. Aucun rattrapage en rafale. Un
                      retard de moins de cinq minutes est exécuté normalement.
                    </p>
                  </section>
                ) : null}
                <section aria-labelledby={`${id}-historique`}>
                  <h3 id={`${id}-historique`} className="pb-2 text-body-s font-medium text-texte-principal">
                    Exécutions
                  </h3>
                  {!runs.length ? <p className="text-ui text-texte-secondaire">Aucune exécution pour le moment.</p> : null}
                  <ol className="flex flex-col">
                    {runs.slice(0, limite).map((run) => {
                      const lien = lienRun(run);
                      const duree = dureeRun(run);
                      const enCours = actif?.id === run.id;
                      const changee = run.instruction !== r.instruction || run.routineName !== r.name || run.agentId !== r.agentId;
                      return (
                        <li key={run.id} className="flex flex-col gap-1 border-b border-bordure-subtile py-3 text-ui-xs text-texte-secondaire">
                          <div className="flex items-center gap-2">
                            <MarqueRun run={run} />
                            <span className="min-w-0 flex-1 text-ui font-medium text-texte-principal" role={enCours ? "status" : undefined}>
                              {libelleRun(run)}
                            </span>
                            <span className="shrink-0">{run.kind === "manual" ? "Manuelle" : "Planifiée"}</span>
                          </div>
                          <p>
                            {quandRoutine(run.scheduledFor, r.timezone)}
                            {duree ? ` · ${duree}` : ""}
                          </p>
                          {run.error ? <p className="line-clamp-2 break-words whitespace-pre-wrap text-texte-erreur">{run.error}</p> : null}
                          {run.result ? <p className="line-clamp-2 break-words whitespace-pre-wrap">{run.result}</p> : null}
                          {run.status === "needs-attention" ? <p>L’agent attend une autorisation.</p> : null}
                          {changee ? (
                            <details>
                              <summary className="flex min-h-11 cursor-pointer items-center">Consigne et agent lors du lancement</summary>
                              <p className="my-2 break-words">
                                {run.routineName} · {nomAgent(run.agentId)}
                              </p>
                              <p className="my-2 break-words whitespace-pre-wrap">{run.instruction}</p>
                            </details>
                          ) : null}
                          {lien ? (
                            <Link href={lien} className="flex min-h-11 items-center self-start text-ui text-texte-principal underline underline-offset-2">
                              {run.status === "needs-attention" ? "Répondre dans la conversation" : "Voir la conversation"}
                            </Link>
                          ) : null}
                          {enCours ? (
                            <Bouton taille="md" variant="blanc" className="self-start" disabled={indisponible} onClick={() => onInterrompre(run)}>
                              {run.status === "queued" ? "Annuler le départ" : "Interrompre"}
                            </Bouton>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                  {data.runs.length > limite ? (
                    <Bouton taille="md" variant="blanc" className="mt-3" disabled={lecture.relecture} onClick={() => setLimite((n) => n + 50)}>
                      Voir les exécutions précédentes
                    </Bouton>
                  ) : null}
                </section>
              </div>
            );
          }}
        </VueLecture>
      </div>
    </Feuille>
  );
}
