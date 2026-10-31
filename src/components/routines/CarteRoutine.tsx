"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Icon, type IconName } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { useAgents } from "@/lib/agents";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { apparition } from "@/lib/mouvement";
import { dureeRun, libellePlanning, libelleRun, lienRun, quandRoutine } from "@/lib/routines-affichage";
import type { Routine, RoutineRun } from "@/types/routines";
import { MarqueRun } from "./MarqueRun";

export interface CarteRoutineProps {
  routine: Routine;
  revision: number;
  actif?: RoutineRun;
  choisie: boolean;
  indisponible: boolean;
  erreur?: { message: string; reessayer: () => void };
  onChoisir(): void;
  onModifier(changerAgent?: boolean): void;
  onExecuter(): void;
  onPause(): void;
  onSupprimer(): void;
  onSimplifier(): void;
  onInterrompre(run: RoutineRun): void;
  onExecutions(): void;
}

function dateUneFoisPassee(routine: Routine): boolean {
  if (routine.schedule.kind !== "once") return false;
  const parties = new Intl.DateTimeFormat("fr-FR", { timeZone: routine.timezone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const partie = (type: Intl.DateTimeFormatPartTypes) => parties.find((p) => p.type === type)?.value ?? "";
  const maintenant = `${partie("year")}-${partie("month")}-${partie("day")}T${partie("hour")}:${partie("minute")}`;
  return `${routine.schedule.date}T${routine.schedule.time}` < maintenant;
}

/** Une routine reste une seule carte : son lien décoratif veut dire « confiée à ». */
export function CarteRoutine({ routine: r, revision, actif, choisie, indisponible, erreur, onChoisir, onModifier, onExecuter, onPause, onSupprimer, onSimplifier, onInterrompre, onExecutions }: CarteRoutineProps) {
  const { roles, tous } = useAgents();
  const id = useId();
  const nomAgent = (agentId: string) => roles.find((a) => a.id === agentId)?.name ?? tous.find((a) => a.role.id === agentId)?.role.name ?? agentId;
  const agentActif = roles.some((a) => a.id === r.agentId);
  const relais = !!r.relais?.length;
  const [lecture, setLecture] = useState<{ id: string; derniere?: RoutineRun; erreur?: string } | null>(null);
  const [developpee, setDeveloppee] = useState(false);
  const [deborde, setDeborde] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const consigne = useRef<HTMLParagraphElement>(null);
  const declencheur = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const derniere = lecture?.id === r.id ? lecture.derniere : undefined;
  const erreurLecture = lecture?.id === r.id ? lecture.erreur : undefined;
  const run = actif ?? derniere;

  useEffect(() => {
    let annule = false;
    const api = getBridge()?.routines;
    if (!api) return;
    void api.historique(r.id, 1).then((retour) => {
      if (annule) return;
      setLecture(retour.ok ? { id: r.id, derniere: retour.data[0] } : { id: r.id, erreur: retour.message });
    }).catch((error: unknown) => { if (!annule) setLecture({ id: r.id, erreur: error instanceof Error ? error.message : String(error) }); });
    return () => { annule = true; };
  }, [r.id, revision]);

  useEffect(() => {
    const el = consigne.current;
    if (!el) return;
    const mesurer = () => { if (!developpee) setDeborde(el.scrollHeight > el.clientHeight + 1); };
    const observer = new ResizeObserver(mesurer);
    observer.observe(el);
    mesurer();
    return () => observer.disconnect();
  }, [r.instruction, developpee]);

  useEffect(() => {
    if (!menu) return;
    (menuRef.current?.querySelector<HTMLButtonElement>("[role=menuitem]:not(:disabled)") ?? menuRef.current)?.focus();
    const dehors = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRef.current?.contains(event.target) && !declencheur.current?.contains(event.target)) setMenu(null);
    };
    const repositionnement = () => setMenu(null);
    document.addEventListener("pointerdown", dehors, true);
    window.addEventListener("resize", repositionnement);
    return () => { document.removeEventListener("pointerdown", dehors, true); window.removeEventListener("resize", repositionnement); };
  }, [menu]);

  const ouvrirMenu = (x: number, y: number) => {
    const nombre = 3 + (r.schedule.kind === "manual" ? 0 : 1) + (relais ? 1 : 0) + (agentActif ? 0 : 1);
    setMenu({ x: Math.max(8, Math.min(x, window.innerWidth - 248)), y: Math.max(8, Math.min(y, window.innerHeight - nombre * 34 - 28)) });
  };
  const fermerMenu = (rendreFocus = false) => { setMenu(null); if (rendreFocus) declencheur.current?.focus(); };
  const actionMenu = (action: () => void) => { fermerMenu(true); action(); };
  const clavierMenu = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[role=menuitem]:not(:disabled)")];
    const index = items.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); fermerMenu(true); }
    else if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault(); event.stopPropagation();
      const suivant = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[suivant]?.focus();
    } else if (event.key === "Tab") fermerMenu();
  };

  const bloquerReprise = indisponible || (!r.active && (!agentActif || relais));
  const motif = relais ? "Choisis d’abord quoi conserver de cette ancienne chaîne."
    : !agentActif ? "Choisis un agent actif avant de lancer cette routine."
      : actif ? "Une exécution attend ou travaille déjà pour cette routine."
        : indisponible ? "Le moteur des routines est indisponible." : null;
  const etat = relais ? "Ancienne chaîne à examiner" : !agentActif ? "Agent indisponible"
    : !r.active && dateUneFoisPassee(r) ? "Date passée · en pause"
      : !r.active ? "En pause" : r.schedule.kind === "manual" ? "À lancer quand tu veux"
        : `Prochaine : ${quandRoutine(r.nextRunAt, r.timezone)}`;
  const fuseauDifferent = r.timezone !== Intl.DateTimeFormat().resolvedOptions().timeZone;
  const ville = r.timezone.split("/").at(-1)?.replaceAll("_", " ") ?? r.timezone;
  const heure = actif ? new Intl.DateTimeFormat("fr-FR", { timeZone: r.timezone, hour: "2-digit", minute: "2-digit" }).format(new Date(actif.startedAt ?? actif.createdAt)) : null;
  const bordure = choisie ? "border-bleu-k1-500" : actif?.status === "running" || actif?.status === "needs-attention" ? "border-bleu-k2-500"
    : derniere?.status === "failed" ? "border-bordure-erreur" : relais || !agentActif ? "border-bordure-forte" : "border-bordure-subtile";

  return <section aria-labelledby={`${id}-titre`} aria-describedby={`${id}-agent`} tabIndex={-1} data-routine-carte={r.id}
    onPointerDown={(event) => event.stopPropagation()}
    onClick={(event) => { if (!(event.target instanceof Element) || !event.target.closest("button, a, summary, [role=menu]")) onChoisir(); }}
    onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); ouvrirMenu(event.clientX, event.clientY); }}
    className={cn("relative flex w-[320px] flex-col rounded-lg border bg-fond-surface shadow-ombre-sm transition-[border-color,box-shadow] duration-[120ms] ease-sortie", bordure, (relais || !agentActif) && "bg-fond-surface-douce")}>
    <span aria-hidden className="absolute top-[22px] -right-[7px] z-10 size-3.5 -translate-y-1/2 rounded-full border-2 border-fond-surface bg-texte-tertiaire" />
    <header className="flex h-11 items-center gap-2 px-3">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-xs bg-fond-surface-grise text-icone-secondaire"><Icon name={relais ? "lock-01" : !r.active ? "pause-01" : "clock-01"} size={14} /></span>
      <button id={`${id}-titre`} data-routine-titre={r.id} type="button" onClick={onChoisir} className="min-w-0 flex-1 cursor-pointer truncate rounded-2xs border-0 bg-transparent p-0 text-left text-ui-s font-semibold text-texte-principal">{r.name}</button>
      <MarqueRun run={run} />
      <BoutonIcone ref={declencheur} taille="mini" icone={<Icon name="dot-horizontal" size={14} />} libelle="Actions de la routine" aria-haspopup="menu" aria-expanded={!!menu}
        onClick={() => { if (menu) fermerMenu(); else { const rect = declencheur.current!.getBoundingClientRect(); ouvrirMenu(rect.right - 240, rect.bottom + 6); } }} />
    </header>
    <span id={`${id}-agent`} className="sr-only">Confiée à {nomAgent(r.agentId)}</span>
    <div className="flex flex-col gap-2.5 px-3 pb-3">
      <p className="m-0 text-ui-xs text-texte-secondaire">{libellePlanning(r.schedule)}{fuseauDifferent ? ` · heure de ${ville}` : ""}</p>
      <p className="m-0 text-ui-xs font-medium text-texte-principal">{etat}</p>
      <div>
        <p ref={consigne} className={cn("m-0 whitespace-pre-wrap break-words rounded-sm border border-bordure-subtile bg-fond-page px-2.5 py-2 text-ui-s leading-[1.45] text-texte-principal", !developpee && "line-clamp-4")}>{r.instruction}</p>
        {(deborde || developpee) && <button type="button" aria-expanded={developpee} onClick={() => setDeveloppee((valeur) => !valeur)} className="mt-1 cursor-pointer border-0 bg-transparent p-0 text-ui-xs text-texte-secondaire underline underline-offset-2">{developpee ? "Réduire" : "Afficher toute la consigne"}</button>}
      </div>
      <div className="flex flex-col gap-2 rounded-sm bg-fond-surface-grise px-2.5 py-2 text-ui-xs text-texte-secondaire">
        {actif ? <>
          <p role="status" className="m-0 font-medium text-texte-principal">{libelleRun(actif)} · depuis {heure}</p>
          <div className="flex flex-wrap items-center gap-2"><Bouton variant="blanc" taille="mini" disabled={indisponible} onClick={() => onInterrompre(actif)}>{actif.status === "queued" ? "Annuler le départ" : "Interrompre"}</Bouton>
            {lienRun(actif) && <Link href={lienRun(actif)!} className="text-bleu-k1-500 underline underline-offset-2">{actif.status === "needs-attention" ? "Répondre dans la conversation" : "Ouvrir la conversation"}</Link>}</div>
          {actif.status === "needs-attention" && <p className="m-0">L’agent attend une autorisation.</p>}
        </> : derniere ? <>
          <p className="m-0">Dernière : {libelleRun(derniere)} · {quandRoutine(derniere.scheduledFor, r.timezone)}{dureeRun(derniere) ? ` · ${dureeRun(derniere)}` : ""}</p>
          {(derniere.error || derniere.result) && <p className={cn("m-0 line-clamp-2 whitespace-pre-wrap break-words", derniere.error && "text-texte-erreur")}>{derniere.error || derniere.result}</p>}
          {lienRun(derniere) && <Link href={lienRun(derniere)!} className="text-bleu-k1-500 underline underline-offset-2">Voir la conversation</Link>}
        </> : <p className="m-0">{erreurLecture ? "Le dernier résultat est indisponible." : "Aucune exécution pour le moment."}</p>}
        {erreurLecture && <p role="alert" className="m-0 text-texte-erreur">{erreurLecture}</p>}
      </div>
      {relais ? <div className="flex flex-col gap-2 text-ui-xs text-texte-secondaire">
        <p className="m-0">Elle est conservée en pause. Aucun relais ne sera lancé. Tu peux conserver seulement la consigne du premier agent ; une sauvegarde de l’ancienne chaîne reste sur cet ordinateur.</p>
        <details><summary className="cursor-pointer">Voir les {r.relais!.length} relais conservés</summary><ol className="my-2 space-y-2 pl-4">{r.relais!.map((relai) => <li key={relai.id}><strong className="text-texte-principal">{nomAgent(relai.de)} → {nomAgent(relai.vers)}</strong><p className="my-1 whitespace-pre-wrap break-words">{relai.consigne}</p></li>)}</ol></details>
        <Bouton variant="blanc" taille="mini" className="self-start" disabled={indisponible || !agentActif} onClick={onSimplifier}>Garder seulement {nomAgent(r.agentId)}</Bouton>
      </div> : <>
        <footer className="flex flex-wrap items-center gap-2"><Bouton variant="sombre" taille="mini" iconeGauche={<Icon name="play-01" size={14} />} disabled={indisponible || !agentActif || !!actif} onClick={onExecuter}>Exécuter</Bouton>
          {r.schedule.kind !== "manual" && <Bouton variant="blanc" taille="mini" disabled={bloquerReprise} onClick={onPause}>{r.active ? "Mettre en pause" : "Reprendre"}</Bouton>}</footer>
        {motif && <p className="m-0 text-ui-2xs text-texte-secondaire">{motif}</p>}
      </>}
      {erreur && <div role="alert" className="text-ui-xs text-texte-erreur"><p className="mt-0 mb-1 break-words">{erreur.message}</p><Bouton variant="blanc" taille="mini" disabled={indisponible} onClick={erreur.reessayer}>Réessayer</Bouton></div>}
    </div>
    {menu && createPortal(<div ref={(element) => { menuRef.current = element; apparition(element); }} role="menu" tabIndex={-1} aria-label={`Actions de ${r.name}`} onKeyDown={clavierMenu}
      onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onContextMenu={(event) => event.preventDefault()}
      className="fixed z-50 max-h-[calc(100vh-16px)] w-[240px] overflow-y-auto rounded-md border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-lg" style={{ left: menu.x, top: menu.y }}>
      <ElementMenu libelle="Modifier" icone="pencil-01" desactive={indisponible} onClick={() => actionMenu(() => onModifier())} />
      {r.schedule.kind !== "manual" && <ElementMenu libelle={r.active ? "Mettre en pause" : "Reprendre"} icone={r.active ? "pause-01" : "play-01"} desactive={bloquerReprise} onClick={() => actionMenu(onPause)} />}
      <ElementMenu libelle="Exécutions" icone="list" desactive={indisponible} onClick={() => actionMenu(onExecutions)} />
      {relais && <ElementMenu libelle={`Garder seulement ${nomAgent(r.agentId)}`} desactive={indisponible || !agentActif} onClick={() => actionMenu(onSimplifier)} />}
      {!agentActif && <ElementMenu libelle="Changer d’agent" icone="users-profiles-01" desactive={indisponible} onClick={() => actionMenu(() => onModifier(true))} />}
      <div role="separator" className="my-1 border-t border-bordure-subtile" />
      <ElementMenu libelle="Supprimer" icone="trash-01" danger desactive={indisponible || !!actif} onClick={() => actionMenu(onSupprimer)} />
    </div>, document.body)}
  </section>;
}

/** Petite pièce visuelle recopiée du canevas Workflows, sans dépendance à son code. */
function ElementMenu({ libelle, icone, onClick, desactive, danger }: { libelle: string; icone?: IconName; onClick: () => void; desactive?: boolean; danger?: boolean }) {
  return <button type="button" role="menuitem" disabled={desactive} onClick={onClick}
    className={cn("flex w-full cursor-pointer items-center gap-2 rounded-sm border-0 bg-transparent px-2 py-1.5 text-left text-ui-s hover:bg-fond-survol disabled:cursor-default disabled:opacity-50", danger ? "text-texte-erreur" : "text-texte-principal")}>
    {icone && <Icon name={icone} size={16} className={cn("shrink-0", !danger && "text-icone-secondaire")} />}<span className="flex-1">{libelle}</span>
  </button>;
}
