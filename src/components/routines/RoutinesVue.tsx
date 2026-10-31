"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { useConfirmation } from "@/components/ui/Modale";
import { AgentRond } from "@/components/roles/AgentRond";
import { useAgents } from "@/lib/agents";
import { apparition } from "@/lib/mouvement";
import { useRoutines } from "@/lib/routines";
import { libellePlanning, libelleRun, runActif } from "@/lib/routines-affichage";
import type { Routine, RoutineInput, RoutinePatch, RoutineRun } from "@/types/routines";
import { FormulaireRoutine } from "./FormulaireRoutine";
import { ColonneAgents, apercuAgent, type AgentRoutine } from "./ColonneAgents";
import { CanevasRoutines, type CarteCanevas } from "./CanevasRoutines";
import { CarteRoutine } from "./CarteRoutine";
import { CarteAgent } from "./CarteAgent";
import { PanneauExecutions } from "./PanneauExecutions";

interface Edition { initiale: Routine | null; valeurs?: RoutineInput; cle: number; champAgent?: boolean }
type Echec = { message: string; reessayer: () => void };
const BROUILLON = "klyra:routine-brouillon";
function lireBrouillon(): Edition | null {
  try { const b = JSON.parse(localStorage.getItem(BROUILLON) ?? "null"); return b?.valeurs && typeof b.valeurs.name === "string" && typeof b.valeurs.instruction === "string" && b.valeurs.schedule?.kind && typeof b.valeurs.agentId === "string" ? b : null; } catch { return null; }
}
function effacerBrouillon() { try { localStorage.removeItem(BROUILLON); } catch { /* Le formulaire reste utilisable sans stockage local. */ } }
function valeursRoutine(r: Routine): RoutineInput { return { agentId: r.agentId, name: r.name, instruction: r.instruction, schedule: r.schedule, timezone: r.timezone, active: r.active, missedPolicy: r.missedPolicy, projectId: r.projectId }; }
function instantaneRoutine(r: Routine): Routine {
  return { id: r.id, agentId: r.agentId, name: r.name, instruction: r.instruction, schedule: r.schedule, timezone: r.timezone, active: r.active, missedPolicy: r.missedPolicy, projectId: r.projectId, nextRunAt: r.nextRunAt, relais: r.relais, blockedReason: r.blockedReason, createdAt: r.createdAt, updatedAt: r.updatedAt };
}
function nouvelle(agentId: string): RoutineInput { return { agentId, name: "", instruction: "", schedule: { kind: "daily", time: "09:00" }, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, missedPolicy: "skip", active: true }; }

/** Seule la présentation change : données et mutations restent celles du moteur de routines. */
export function RoutinesVue({ onglets, garderSortie }: { onglets: ReactNode; garderSortie: (garde: () => Promise<boolean>) => () => void }) {
  const api = useRoutines();
  const { roles, tous } = useAgents();
  const router = useRouter();
  const recherche = useSearchParams();
  const selection = recherche.get("routine");
  const demandee = api.routines.find((r) => r.id === selection);
  const [edition, setEdition] = useState<Edition | null>(null);
  const [brouillon, setBrouillon] = useState<Edition | null>(lireBrouillon);
  const [executions, setExecutions] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreursCartes, setErreursCartes] = useState<Record<string, Echec | undefined>>({});
  const [annonce, setAnnonce] = useState("");
  const [focusCarte, setFocusCarte] = useState<string | null>(null);
  const [demander, confirmation] = useConfirmation();
  const modifie = useRef(false);
  const sauvegardeEnCours = useRef(false);
  const actionEnCours = useRef(false);
  const formulaire = useRef<HTMLElement>(null);
  const origineFormulaire = useRef<HTMLElement | null>(null);
  const monterFormulaire = useCallback((el: HTMLElement | null) => { formulaire.current = el; apparition(el); }, []);
  const nouvelleRef = useRef<HTMLButtonElement & HTMLAnchorElement>(null);
  const executionsRef = useRef<HTMLButtonElement>(null);
  const indisponible = !api.actif || !!api.erreur || occupe;
  const nomAgent = (id: string) => roles.find((a) => a.id === id)?.name ?? tous.find((a) => a.role.id === id)?.role.name ?? id;
  const agentActif = (id: string) => roles.some((a) => a.id === id);
  const agents: AgentRoutine[] = [
    ...roles.map((r) => ({ id: r.id, name: r.name, tag: r.tag, title: r.title, actif: true, connu: true })),
    ...[...new Set(api.routines.map((r) => r.agentId))].filter((id) => !agentActif(id)).map((id) => {
      const local = tous.find((a) => a.role.id === id);
      return { id, name: local?.role.name ?? id, tag: local?.role.tag ?? "", title: local?.role.title ?? "", actif: false, connu: !!local };
    }),
  ];
  const paramAgent = recherche.get("agent");
  const defaut = agents.find((a) => api.routines.some((r) => r.agentId === a.id))?.id ?? "principal";
  const agentId = (edition ? brouillon?.valeurs?.agentId ?? edition.valeurs?.agentId ?? edition.initiale?.agentId : null)
    ?? (agents.some((a) => a.id === paramAgent) ? paramAgent : (!paramAgent && demandee ? demandee.agentId : defaut))!;
  const agent = agents.find((a) => a.id === agentId) ?? { id: agentId, name: nomAgent(agentId), tag: "", title: "", actif: agentActif(agentId), connu: false };
  const routine = demandee?.agentId === agentId ? demandee : undefined;
  const liste = api.routines.filter((r) => r.agentId === agentId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const url = useCallback((idAgent: string, idRoutine?: string | null) => `/routines?vue=routines&agent=${encodeURIComponent(idAgent)}${idRoutine ? `&routine=${encodeURIComponent(idRoutine)}` : ""}`, []);

  useEffect(() => {
    if (!api.charge || api.erreur || !api.actif) return;
    const cible = url(agentId, routine?.id);
    if (`/routines?${recherche.toString()}` !== cible) router.replace(cible, { scroll: false });
  }, [api.charge, api.erreur, api.actif, agentId, routine?.id, recherche, router, url]);
  const quitter = useCallback(async () => {
    if (sauvegardeEnCours.current) return false;
    if (!edition) return true;
    if (modifie.current && !(await demander({ titre: "Abandonner les modifications ?", texte: "Les changements de ce formulaire ne seront pas enregistrés.", confirmer: "Abandonner", annuler: "Continuer à modifier" }))) return false;
    modifie.current = false; setEdition(null); setBrouillon(null); effacerBrouillon();
    return true;
  }, [demander, edition]);
  const fermerFormulaire = () => void quitter().then((ok) => {
    if (!ok) return;
    requestAnimationFrame(() => {
      const origine = origineFormulaire.current;
      if (origine?.isConnected && !origine.matches(":disabled") && origine.getClientRects().length) origine.focus();
      else if (nouvelleRef.current && !nouvelleRef.current.disabled) nouvelleRef.current.focus();
      else document.querySelector<HTMLElement>('nav[aria-label="Agents"] [aria-current], .klyra-routines-agent-compact button')?.focus();
    });
  });
  useEffect(() => garderSortie(quitter), [garderSortie, quitter]);
  const choisirAgent = async (id: string) => { if (id !== agentId && await quitter()) { setExecutions(false); setFocusCarte(null); router.replace(url(id), { scroll: false }); } };
  const choisir = async (r: Routine, historique = false) => { if (!(await quitter())) return; router.replace(url(r.agentId, r.id), { scroll: false }); if (historique) setExecutions(true); };
  const commencer = async (initiale: Routine | null, valeurs?: RoutineInput, changerAgent = false) => {
    const origine = document.activeElement;
    if (!(await quitter())) return;
    origineFormulaire.current = origine instanceof HTMLElement ? origine : null;
    const saisie = { initiale, valeurs: valeurs ?? (initiale ? valeursRoutine(initiale) : nouvelle(agentId)), cle: Date.now(), champAgent: changerAgent };
    setEdition(saisie); setBrouillon(saisie); setExecutions(false); setFocusCarte(null);
  };
  useEffect(() => {
    if (!edition?.champAgent) return;
    const frame = requestAnimationFrame(() => formulaire.current?.querySelector<HTMLButtonElement>('[data-champ="agentId"] button')?.focus());
    return () => cancelAnimationFrame(frame);
  }, [edition?.cle, edition?.champAgent]);
  const memoriser = useCallback((valeurs: RoutineInput, dirty: boolean) => {
    modifie.current = dirty;
    const saisie = { ...edition!, initiale: edition?.initiale ? instantaneRoutine(edition.initiale) : null, valeurs };
    setBrouillon(saisie);
    if (!dirty) { effacerBrouillon(); return; }
    try { localStorage.setItem(BROUILLON, JSON.stringify(saisie)); } catch { /* La saisie reste utilisable. */ }
  }, [edition]);
  const agir = async (r: Routine, operation: () => Promise<unknown>, message: string) => {
    if (actionEnCours.current || indisponible) return;
    actionEnCours.current = true; setOccupe(true); setErreursCartes((e) => ({ ...e, [r.id]: undefined }));
    try { await operation(); await api.actualiser(); setAnnonce(message); }
    catch (error) { setErreursCartes((e) => ({ ...e, [r.id]: { message: error instanceof Error ? error.message : String(error), reessayer: () => void agir(r, operation, message) } })); }
    finally { actionEnCours.current = false; setOccupe(false); }
  };
  const enregistrer = async (input: RoutineInput) => {
    if (!edition) return;
    if (indisponible) throw new Error(api.erreur ?? "Le moteur des routines est indisponible.");
    sauvegardeEnCours.current = true;
    try {
      let sauvee: Routine;
      if (edition.initiale) {
        const courante = api.routines.find((r) => r.id === edition.initiale!.id);
        if (!courante) throw new Error("Cette routine a été supprimée pendant la modification. Copie ta consigne avant de fermer ce formulaire.");
        if (courante.updatedAt !== edition.initiale.updatedAt) throw new Error("Cette routine a changé. Recharge-la avant de l’enregistrer pour ne pas écraser ces changements.");
        const patch = Object.fromEntries(Object.entries(input).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(edition.initiale![k as keyof RoutineInput]))) as RoutinePatch;
        sauvee = await api.modifier(courante.id, patch);
      } else sauvee = await api.creer(input);
      modifie.current = false; effacerBrouillon(); setBrouillon(null); setEdition(null);
      await api.actualiser();
      router.replace(url(sauvee.agentId, sauvee.id), { scroll: false }); setFocusCarte(sauvee.id);
      setAnnonce(edition.initiale ? "Routine enregistrée." : "Routine créée.");
    } finally { sauvegardeEnCours.current = false; }
  };
  const pause = async (r: Routine) => {
    if (!r.active && r.schedule.kind === "once" && !r.nextRunAt) { await commencer(r, { ...valeursRoutine(r), active: true }); return; }
    await agir(r, () => api.modifier(r.id, { active: !r.active }), r.active ? "Routine en pause. Une exécution déjà en cours continue." : "Routine reprise.");
  };
  const supprimer = async (r: Routine) => {
    if (api.enCours.some((run) => run.routineId === r.id && runActif(run))) return;
    if (!(await demander({ titre: `Supprimer « ${r.name} » ?`, texte: "La routine et son historique seront supprimés. Les messages de ses conversations sont conservés.", confirmer: "Supprimer" }))) return;
    await agir(r, async () => { await api.supprimer(r.id); if (selection === r.id) { setExecutions(false); router.replace(url(r.agentId), { scroll: false }); } }, "Routine supprimée.");
  };
  const interrompre = async (r: Routine, run: RoutineRun) => {
    const enFile = run.status === "queued";
    if (!(await demander({ titre: enFile ? "Annuler ce départ ?" : "Interrompre cette exécution ?", texte: "Le planning de la routine reste inchangé. Les messages déjà écrits sont conservés.", confirmer: enFile ? "Annuler le départ" : "Interrompre" }))) return;
    await agir(r, () => api.interrompre(run.id), enFile ? "Départ annulé." : "Exécution interrompue.");
  };
  const simplifier = async (r: Routine) => {
    if (!(await demander({ titre: `Garder seulement ${nomAgent(r.agentId)} ?`, texte: `La routine reprendra avec sa première consigne et un seul agent. Les ${r.relais?.length ?? 0} relais ne seront plus exécutés. Leur sauvegarde reste sur cet ordinateur.`, confirmer: "Garder et reprendre" }))) return;
    await agir(r, () => api.modifier(r.id, { relais: [], active: true }), "Routine reprise avec un seul agent.");
  };
  const suggestion = (i: number): RoutineInput => ({ ...nouvelle(agentId), name: ["Point de la semaine", "Revue des mails", "Contrôle de klyra.fr"][i], instruction: ["Fais le point sur mes tâches de la semaine. Signale les échéances proches, les blocages et les décisions qui m’attendent.", "Relis les mails accessibles avec mes connexions et propose les réponses utiles en brouillon. Si une connexion manque, signale-le. N’envoie aucun message.", "Vérifie les pages publiques de klyra.fr. Signale les liens cassés et les erreurs visibles ; ne modifie pas le site."][i], schedule: i === 0 ? { kind: "weekly", weekday: 1, time: "09:00" } : { kind: "weekdays", time: "09:00" } });
  const actifChoisi = api.enCours.find((r) => r.routineId === routine?.id && runActif(r));
  const dernierStatut = useRef<string | null>(null);
  useEffect(() => {
    if (!routine) { dernierStatut.current = null; return; }
    let annule = false;
    void api.historique(routine.id).then((runs) => {
      if (annule) return;
      const run = actifChoisi ?? runs[0]; const cle = run ? `${run.id}:${run.status}` : null;
      if (dernierStatut.current && cle !== dernierStatut.current && run) setAnnonce(libelleRun(run));
      dernierStatut.current = cle;
    }).catch(() => { /* Cartes et panneau exposent les erreurs de lecture. */ });
    return () => { annule = true; };
    // Révision publiée par le moteur, aucun polling.
  }, [routine?.id, api.revision, actifChoisi?.status]); // eslint-disable-line react-hooks/exhaustive-deps
  const reprendreBrouillon = () => { if (!brouillon) return; origineFormulaire.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setEdition({ ...brouillon, cle: Date.now() }); setExecutions(false); setFocusCarte(null); };
  const abandonnerBrouillon = async () => { if (await demander({ titre: "Abandonner ce brouillon ?", confirmer: "Abandonner" })) { effacerBrouillon(); setBrouillon(null); } };
  const cartes: CarteCanevas[] = liste.map((r) => {
    const actif = api.enCours.find((run) => run.routineId === r.id && runActif(run));
    return { id: r.id, lien: true, travaille: actif?.status === "running" || actif?.status === "needs-attention", pointille: !r.active || r.schedule.kind === "manual" || !!r.relais?.length || !agent.actif,
      contenu: <CarteRoutine routine={r} revision={api.revision} actif={actif} choisie={routine?.id === r.id} indisponible={indisponible} erreur={erreursCartes[r.id]} onChoisir={() => void choisir(r)} onModifier={(changerAgent) => void commencer(r, undefined, changerAgent)} onExecuter={() => void agir(r, () => api.executer(r.id), "Exécution ajoutée à la file de l’agent.")} onPause={() => void pause(r)} onSupprimer={() => void supprimer(r)} onSimplifier={() => void simplifier(r)} onInterrompre={(run) => void interrompre(r, run)} onExecutions={() => void choisir(r, true)} /> };
  });
  const brouillonVisible = brouillon?.valeurs?.agentId === agentId;
  if (brouillonVisible) cartes.push({ id: "brouillon", lien: true, pointille: true, contenu: <section aria-label="Brouillon non enregistré" className={`relative flex w-[320px] flex-col gap-2.5 rounded-lg border border-dashed bg-fond-surface p-3 shadow-ombre-sm ${edition ? "border-bleu-k1-500" : "border-bordure-forte"}`}><span aria-hidden="true" className="absolute top-[22px] -right-[7px] z-10 size-3.5 -translate-y-1/2 rounded-full border-2 border-fond-surface bg-texte-tertiaire" /><header className="flex items-center gap-2"><Icon name="pencil-01" size={14} /><h2 className="m-0 truncate text-ui-s font-semibold text-texte-principal">{brouillon.valeurs!.name || "Nouvelle routine"}</h2></header><p className="m-0 text-ui-xs text-texte-secondaire">{libellePlanning(brouillon.valeurs!.schedule)}</p><p className="m-0 text-ui-xs text-texte-principal">Brouillon non enregistré</p>{!edition && <div className="flex gap-2"><Bouton taille="mini" disabled={indisponible} onClick={reprendreBrouillon}>Reprendre</Bouton><Bouton taille="mini" onClick={() => void abandonnerBrouillon()}>Abandonner</Bouton></div>}</section> });
  if (!liste.length && !brouillonVisible && agent.actif) cartes.push({ id: "vide", lien: false, contenu: <section className="flex w-[320px] flex-col gap-3 rounded-lg border border-dashed border-bordure-forte bg-transparent p-4"><h2 className="m-0 text-ui-s font-semibold text-texte-principal">Confie une tâche qui revient à {agent.name}</h2><p className="m-0 text-ui-xs text-texte-secondaire">Commence avec un exemple, puis adapte sa consigne avant de l’enregistrer.</p><div className="flex flex-wrap gap-2">{[0, 1, 2].map((i) => <Bouton key={i} taille="mini" disabled={indisponible} onClick={() => void commencer(null, suggestion(i))}>{suggestion(i).name}</Bouton>)}</div></section> });
  const etat = !api.charge ? <div className="absolute inset-0 flex items-center justify-center"><p role="status" className="text-ui-s text-texte-secondaire">Chargement des routines…</p></div> : api.erreur || !api.actif ? <div className="absolute inset-0 flex items-center justify-center p-4"><div role="alert" className="max-w-md rounded-lg border border-bordure-forte bg-fond-surface p-4 text-ui-s text-texte-principal"><p className="mt-0 font-semibold">Les routines sont arrêtées</p><p>{api.erreur ?? "Le moteur des routines est indisponible."}</p><Bouton onClick={() => void api.actualiser()}>Réessayer</Bouton></div></div> : undefined;

  return <div className="klyra-routines-grille h-full min-w-0" onKeyDown={(e) => { if (e.key !== "Escape" || e.defaultPrevented) return; if (edition) { e.preventDefault(); fermerFormulaire(); } else if (executions) { e.preventDefault(); setExecutions(false); executionsRef.current?.focus(); } }}>
    <ColonneAgents agents={agents} choisi={agentId} routines={api.routines} runs={api.enCours} brouillon={brouillon?.valeurs?.agentId} charge={api.charge} onChoisir={(id) => void choisirAgent(id)} />
    <header className="klyra-routines-barre flex shrink-0 flex-wrap items-center gap-2 border-b border-bordure-subtile px-4 py-2.5"><div className="mr-auto flex min-w-0 items-center gap-1.5"><AgentRond roleId={agentId} taille={20} /><h1 className="m-0 truncate text-ui font-semibold text-texte-principal">Routines de {agent.name}</h1><span className="text-ui-s text-texte-secondaire">· {liste.length}</span></div><div className="klyra-routines-agent-compact"><ListeDeroulante variante="compact" libelle="Agent" value={agentId} options={agents.map((a) => ({ value: a.id, label: `${a.actif ? "Mes agents" : "Hors de Mes agents"} · ${a.name} · ${apercuAgent(a, api.routines, api.enCours, brouillon?.valeurs?.agentId, api.charge)}`, icone: <AgentRond roleId={a.id} taille={20} /> }))} onChange={(id) => void choisirAgent(id)} /></div><Bouton ref={executionsRef} taille="compact" variant={executions ? "gris" : "blanc"} disabled={indisponible || !routine || !!edition} iconeGauche={<Icon name="list" size={16} />} onClick={() => setExecutions(!executions)}>Exécutions</Bouton>{onglets}{!edition && <BoutonPrincipal ref={nouvelleRef} disabled={indisponible || !agent.actif} onClick={() => void commencer(null)}>Nouvelle routine</BoutonPrincipal>}</header>
    <div className="klyra-routines-corps relative flex min-h-0 min-w-0">
      <CanevasRoutines agentId={agentId} nom={agent.name} cartes={cartes} agent={<CarteAgent agent={agent} />} etat={etat} focaliser={focusCarte} />
      {edition ? (
        <aside ref={monterFormulaire} aria-labelledby="titre-formulaire-routine" className="klyra-routines-panneau flex min-h-0 w-[380px] shrink-0 flex-col border-l border-bordure-subtile bg-fond-surface">
          <header className="flex items-center gap-2 px-4 pt-3 pb-2">
            <h2 id="titre-formulaire-routine" className="m-0 min-w-0 flex-1 truncate text-ui font-semibold text-texte-principal">{edition.initiale ? `Modifier « ${edition.initiale.name} »` : "Nouvelle routine"}</h2>
            <BoutonIcone taille="mini" icone={<Icon name="x-01" size={16} />} libelle="Fermer" onClick={fermerFormulaire} />
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 [&_.klyra-carte-flottante]:shadow-none">
            <fieldset disabled={!api.actif || !!api.erreur} className="m-0 min-w-0 border-0 p-0">
              <FormulaireRoutine key={edition.cle} initiale={edition.initiale} valeursInitiales={edition.valeurs}
                onEnregistrer={enregistrer} onAnnuler={fermerFormulaire} onChange={memoriser}
                changeeAilleurs={!!edition.initiale && api.routines.find((r) => r.id === edition.initiale!.id)?.updatedAt !== edition.initiale.updatedAt}
                onRecharger={async () => { const r = api.routines.find((r) => r.id === edition.initiale?.id); if (r) await commencer(r); }} />
            </fieldset>
          </div>
        </aside>
      ) : executions && routine && <PanneauExecutions className="klyra-routines-panneau" routine={routine} revision={api.revision} actif={actifChoisi} indisponible={indisponible}
        onFermer={() => { setExecutions(false); executionsRef.current?.focus(); }} onInterrompre={(run) => void interrompre(routine, run)} />}
    </div>
    <p className="sr-only" role="status" aria-live="polite">{annonce}</p>{confirmation}
  </div>;
}
