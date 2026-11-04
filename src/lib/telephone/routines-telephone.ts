import type { AgentRoutine } from "@/components/routines/ColonneAgents";
import { ErreurPoste } from "@/lib/poste/types";
import { tagLisible } from "@/lib/telephone/agents";
import type { Role, RoleTeinte } from "@/types/domain";
import type { Routine, RoutineInput, RoutinePatch, RoutineRun, RoutineSchedule } from "@/types/routines";

/**
 * Les routines lues et écrites depuis le téléphone (spec mobile T-14 à T-17). Le moteur reste sur
 * l'ordinateur et valide en dernier ressort ; ici, la forme des demandes du téléphone (le geste ne
 * fait jamais confiance à ce qui arrive) et ce que le téléphone affiche.
 */

/** Un agent de la colonne, avec la teinte de son visuel (le téléphone n'a pas les fiches). */
export interface AgentLu extends AgentRoutine {
  teinte: RoleTeinte;
}

/** Réponse de `routines.liste`. */
export interface RoutinesLues {
  actif: boolean;
  erreur: string | null;
  agents: AgentLu[];
  routines: Routine[];
  enCours: RoutineRun[];
  /** Le fuseau de l'ordinateur : celui d'une nouvelle routine, comme au bureau. */
  fuseau: string;
  /** La machine active de l'ordinateur : celle d'une nouvelle routine. */
  lieu: string | null;
  serveurs: { adresse: string; nom: string }[];
  projets: { id: string; name: string; lieu: string | null }[];
  /** Avec un agent : la dernière exécution de chacune de ses routines (ou l'erreur de lecture). */
  dernieres?: Record<string, { run: RoutineRun | null } | { erreur: string }>;
}

/** Réponse de `routines.executions` (T-17). */
export interface ExecutionsLues {
  runs: RoutineRun[];
  /** Les départs des 7 prochains jours, cinq au plus. */
  dates: string[];
}

/** Les agents de la colonne, comme au bureau : Mes agents, puis ceux qui ont des routines sans être actifs. */
export function agentsDesRoutines(roles: readonly Role[], tous: readonly { role: Role }[], routines: readonly Pick<Routine, "agentId">[]): AgentLu[] {
  const actif = (id: string) => roles.some((r) => r.id === id);
  return [
    ...roles.map((r) => ({ id: r.id, name: r.name, tag: tagLisible(r), title: r.title, teinte: r.teinte, actif: true, connu: true })),
    ...[...new Set(routines.map((r) => r.agentId))].filter((id) => !actif(id)).map((id) => {
      const local = tous.find((a) => a.role.id === id)?.role;
      return { id, name: local?.name ?? id, tag: local ? tagLisible(local) : "", title: local?.title ?? "", teinte: local?.teinte ?? ("jaune" as RoleTeinte), actif: false, connu: !!local };
    }),
  ];
}

/** Ce que l'ordinateur envoie d'une routine : tout, sauf les places de l'ancien canevas. */
export function routineLue(r: Routine): Routine {
  const copie = { ...r };
  delete copie.positions;
  return copie;
}

/* ─── Les demandes du téléphone ────────────────────────────────── */

const illisible = () => new ErreurPoste("arguments", "Demande illisible.");
const HEURE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function entier(valeur: unknown, min: number, max: number): number {
  if (typeof valeur !== "number" || !Number.isSafeInteger(valeur) || valeur < min || valeur > max) throw illisible();
  return valeur;
}

function heure(valeur: unknown): string {
  if (typeof valeur !== "string" || !HEURE.test(valeur)) throw new ErreurPoste("programmation", "Choisis une heure au format HH:mm.");
  return valeur;
}

function entiers(valeur: unknown, min: number, max: number): number[] {
  if (!Array.isArray(valeur) || !valeur.length || valeur.length > max - min + 1) throw illisible();
  return valeur.map((v) => entier(v, min, max));
}

function enregistrement(valeur: unknown): Record<string, unknown> {
  if (typeof valeur !== "object" || valeur === null || Array.isArray(valeur)) throw illisible();
  return valeur as Record<string, unknown>;
}

/**
 * Un planning reçu du téléphone, recopié champ par champ (rien d'autre ne passe). Le moteur
 * vérifie ensuite ce qui dépend du fuseau et de la date (`validateSchedule`).
 */
export function lireSchedule(valeur: unknown): RoutineSchedule {
  const s = enregistrement(valeur);
  switch (s.kind) {
    case "manual":
      return { kind: "manual" };
    case "once":
      if (typeof s.date !== "string" || !DATE.test(s.date)) throw new ErreurPoste("programmation", "Choisis une date pour cette exécution.");
      return { kind: "once", date: s.date, time: heure(s.time) };
    case "hourly":
      return { kind: "hourly", minute: entier(s.minute, 0, 59) };
    case "daily":
    case "weekdays":
      return { kind: s.kind, time: heure(s.time) };
    case "weekly":
      return { kind: "weekly", weekday: entier(s.weekday, 0, 6), time: heure(s.time) };
    case "monthly":
      return { kind: "monthly", day: entier(s.day, 1, 31), time: heure(s.time) };
    case "interval": {
      if (s.unit !== "minutes" && s.unit !== "hours" && s.unit !== "days") throw illisible();
      if (typeof s.anchorAt !== "string" || s.anchorAt.length > 40 || !Number.isFinite(Date.parse(s.anchorAt))) throw illisible();
      return { kind: "interval", amount: entier(s.amount, 1, 100_000), unit: s.unit, anchorAt: s.anchorAt };
    }
    case "advanced": {
      const jours = enregistrement(s.days);
      const temps = enregistrement(s.time);
      const days =
        jours.kind === "every-day"
          ? ({ kind: "every-day" } as const)
          : jours.kind === "days-of-week"
            ? ({ kind: "days-of-week", days: entiers(jours.days, 0, 6) } as const)
            : jours.kind === "days-of-month"
              ? ({ kind: "days-of-month", days: entiers(jours.days, 1, 31) } as const)
              : null;
      if (!days) throw illisible();
      let time: Extract<RoutineSchedule, { kind: "advanced" }>["time"];
      if (temps.kind === "at-time") time = { kind: "at-time", time: heure(temps.time) };
      else if (temps.kind === "every" && (temps.unit === "minutes" || temps.unit === "hours")) time = { kind: "every", amount: entier(temps.amount, 1, 100_000), unit: temps.unit };
      else throw illisible();
      return { kind: "advanced", months: entiers(s.months, 1, 12), days, time };
    }
    case "custom":
      if (typeof s.expression !== "string" || !s.expression.trim() || s.expression.length > 200) throw illisible();
      return { kind: "custom", expression: s.expression };
    default:
      throw illisible();
  }
}

function texte(r: Record<string, unknown>, cle: string, max: number): string {
  const v = r[cle];
  if (typeof v !== "string" || v.length > max) throw illisible();
  return v;
}

function texteOuNull(r: Record<string, unknown>, cle: string, max: number): string | null {
  return r[cle] === null || r[cle] === undefined ? null : texte(r, cle, max);
}

/** Une routine envoyée par le formulaire du téléphone (T-16). Les limites sont celles du moteur. */
export function lireRoutineInput(valeur: unknown): RoutineInput {
  const r = enregistrement(valeur);
  const agentId = texte(r, "agentId", 64);
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(agentId)) throw new ErreurPoste("agent", "Choisis un agent actif.");
  const timezone = texte(r, "timezone", 100);
  if (typeof r.active !== "boolean") throw illisible();
  if (r.missedPolicy !== "skip" && r.missedPolicy !== "run-once") throw illisible();
  const lieu = texteOuNull(r, "lieu", 260);
  if (lieu !== null && !/^https?:\/\/[^\s/]{1,200}$/.test(lieu)) throw illisible();
  return {
    agentId,
    name: texte(r, "name", 200),
    instruction: texte(r, "instruction", 100_000),
    schedule: lireSchedule(r.schedule),
    timezone,
    active: r.active,
    missedPolicy: r.missedPolicy,
    projectId: texteOuNull(r, "projectId", 200),
    lieu,
  };
}

/** Un identifiant de routine ou d'exécution (celles d'un VPS contiennent « ~ »). */
export function lireId(args: Record<string, unknown>, cle: string): string {
  const v = args[cle];
  if (typeof v !== "string" || !v || v.length > 200) throw illisible();
  return v;
}

/** Le nombre de lignes d'historique demandées : par paquets de 50, comme au bureau. */
export function lireLimite(args: Record<string, unknown>): number {
  return args.limite === undefined ? 50 : entier(args.limite, 1, 1000);
}

/** Ce qui change entre la routine lue et ce que le formulaire envoie : seuls ces champs partent au moteur. */
export function patchRoutine(courante: Routine, input: RoutineInput): RoutinePatch {
  return Object.fromEntries(
    Object.entries(input).filter(([cle, valeur]) => JSON.stringify(valeur) !== JSON.stringify(courante[cle as keyof Routine] ?? (cle === "lieu" || cle === "projectId" ? null : undefined))),
  ) as RoutinePatch;
}

/* ─── Le formulaire et son brouillon ───────────────────────────── */

/** Les champs d'une routine existante, tels que le formulaire les modifie. */
export function valeursRoutine(r: Routine): RoutineInput {
  return { agentId: r.agentId, name: r.name, instruction: r.instruction, schedule: r.schedule, timezone: r.timezone, active: r.active, missedPolicy: r.missedPolicy, projectId: r.projectId, lieu: r.lieu ?? null };
}

/** Une nouvelle routine, comme au bureau : chaque jour à 09:00, au fuseau et sur la machine active de l'ordinateur. */
export function nouvelleRoutine(agentId: string, fuseau: string, lieu: string | null): RoutineInput {
  return { agentId, name: "", instruction: "", schedule: { kind: "daily", time: "09:00" }, timezone: fuseau, missedPolicy: "skip", active: true, projectId: null, lieu };
}

/** Ce que le formulaire garde de la routine modifiée : de quoi la nommer et refuser un conflit. */
export interface InitialeBrouillon {
  id: string;
  name: string;
  updatedAt: string;
  active: boolean;
  scheduleKind: RoutineSchedule["kind"];
}

export function initialeDe(r: Routine): InitialeBrouillon {
  return { id: r.id, name: r.name, updatedAt: r.updatedAt, active: r.active, scheduleKind: r.schedule.kind };
}

export interface BrouillonRoutine {
  initiale: InitialeBrouillon | null;
  /** Les valeurs à l'ouverture : le brouillon n'est gardé que s'il s'en écarte. */
  base: RoutineInput;
  valeurs: RoutineInput;
  /** Le formulaire s'est ouvert sur « Changer d'agent ». */
  champAgent: boolean;
}

const CLE_BROUILLON = "klyra:telephone:routine-brouillon";

const saisieValide = (v: Partial<RoutineInput> | undefined): v is RoutineInput =>
  !!v && typeof v.name === "string" && typeof v.instruction === "string" && typeof v.agentId === "string" && !!v.schedule?.kind;

/** Un brouillon relu du stockage : gardé seulement s'il a la forme attendue. */
export function brouillonValide(brut: unknown): BrouillonRoutine | null {
  if (typeof brut !== "object" || brut === null) return null;
  const b = brut as Partial<BrouillonRoutine>;
  if (!saisieValide(b.valeurs)) return null;
  const i = b.initiale;
  if (i !== null && (typeof i !== "object" || typeof i.id !== "string" || typeof i.updatedAt !== "string" || typeof i.name !== "string")) return null;
  return { initiale: i ?? null, base: saisieValide(b.base) ? b.base : b.valeurs, valeurs: b.valeurs, champAgent: !!b.champAgent };
}

export function lireBrouillon(): BrouillonRoutine | null {
  try {
    return brouillonValide(JSON.parse(localStorage.getItem(CLE_BROUILLON) ?? "null"));
  } catch {
    return null;
  }
}

export function ecrireBrouillon(brouillon: BrouillonRoutine | null) {
  try {
    if (brouillon) localStorage.setItem(CLE_BROUILLON, JSON.stringify(brouillon));
    else localStorage.removeItem(CLE_BROUILLON);
  } catch {
    /* Le formulaire reste utilisable sans stockage. */
  }
}

/** Une demande au poste ne dépasse pas 64 000 caractères : au-delà, le compte la refuse. */
export const DEMANDE_MAX = 60_000;
