/** Plannings locaux. Les échéances renvoyées sont toujours des instants UTC. */
export type RoutineSchedule =
  /** Propre à KLYRA (l'ancienne fréquence « manuel ») : jamais d'elle-même, seulement « Exécuter ». */
  | { kind: "manual" }
  | { kind: "once"; date: string; time: string }
  | { kind: "hourly"; minute: number }
  | { kind: "daily"; time: string }
  | { kind: "weekdays"; time: string }
  | { kind: "weekly"; weekday: number; time: string }
  | { kind: "monthly"; day: number; time: string }
  | { kind: "interval"; amount: number; unit: "minutes" | "hours" | "days"; anchorAt: string }
  | {
      kind: "advanced";
      months: number[];
      days:
        | { kind: "every-day" }
        | { kind: "days-of-week"; days: number[] }
        | { kind: "days-of-month"; days: number[] };
      time: { kind: "at-time"; time: string } | { kind: "every"; amount: number; unit: "minutes" | "hours" };
    }
  | { kind: "custom"; expression: string };

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const formatters = new Map<string, Intl.DateTimeFormat>();
const occurrencesCache = new Map<string, number[]>();
const cronCache = new Map<string, Cron>();

interface LocalDate { year: number; month: number; day: number }
interface LocalMinute extends LocalDate { hour: number; minute: number }
interface CronField { values: number[]; wildcard: boolean }
interface Cron { minute: CronField; hour: CronField; day: CronField; month: CronField; weekday: CronField }

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Programmation invalide.");
  return value as Record<string, unknown>;
}

function integer(value: unknown, min: number, max: number, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) {
    throw new Error(`${label} invalide (${min} à ${max}).`);
  }
  return value;
}

function integers(value: unknown, min: number, max: number, label: string): number[] {
  if (!Array.isArray(value) || !value.length) throw new Error(`${label} : sélection vide ou invalide.`);
  return [...new Set(value.map((n) => integer(n, min, max, label)))].sort((a, b) => a - b);
}

function time(value: unknown): string {
  if (typeof value !== "string" || !TIME.test(value)) throw new Error("Heure invalide : utilisez HH:mm.");
  return value;
}

function formatter(timezone: string): Intl.DateTimeFormat {
  let result = formatters.get(timezone);
  if (!result) {
    if (typeof timezone !== "string" || !timezone.trim() || /^[+-]/.test(timezone)) throw new Error("Fuseau IANA invalide.");
    try {
      result = new Intl.DateTimeFormat("en-GB-u-ca-gregory-nu-latn", {
        timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
        hour: "2-digit", minute: "2-digit", hourCycle: "h23",
      });
    } catch { throw new Error("Fuseau IANA invalide."); }
    formatters.set(timezone, result);
  }
  return result;
}

function instant(date: Date): number {
  const value = date.getTime();
  if (!Number.isFinite(value)) throw new Error("Instant invalide.");
  return value;
}

function utc(local: LocalDate, hour = 0, minute = 0): number {
  const result = new Date(0);
  result.setUTCFullYear(local.year, local.month - 1, local.day);
  result.setUTCHours(hour, minute, 0, 0);
  return result.getTime();
}

function parts(at: number, timezone: string): LocalMinute {
  const p: Record<string, number> = {};
  for (const part of formatter(timezone).formatToParts(at)) {
    if (part.type !== "literal") p[part.type] = Number(part.value);
  }
  return { year: p.year, month: p.month, day: p.day, hour: p.hour, minute: p.minute };
}

function localDate(value: unknown): LocalDate {
  if (typeof value !== "string" || !DATE.test(value)) throw new Error("Date invalide : utilisez YYYY-MM-DD.");
  const [year, month, day] = value.split("-").map(Number);
  const normalized = new Date(utc({ year, month, day }));
  if (year < 1 || normalized.getUTCFullYear() !== year || normalized.getUTCMonth() + 1 !== month || normalized.getUTCDate() !== day) {
    throw new Error("Cette date n’existe pas.");
  }
  return { year, month, day };
}

function addDay(date: LocalDate): LocalDate {
  const result = new Date(utc(date) + DAY);
  return { year: result.getUTCFullYear(), month: result.getUTCMonth() + 1, day: result.getUTCDate() };
}

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

/** Les deux offsets sont conservés le jour d'un retour à l'heure d'hiver. */
function offsets(date: LocalDate, timezone: string): number[] {
  const result = new Set<number>();
  const day = utc(date);
  for (let sample = day - 2 * DAY; sample <= day + 2 * DAY; sample += 6 * 60 * MINUTE) {
    const local = parts(sample, timezone);
    result.add(utc(local, local.hour, local.minute) - sample);
  }
  return [...result];
}

function localCandidates(date: LocalDate, minute: number, timezone: string, zoneOffsets: number[]): number[] {
  const wall = utc(date, Math.floor(minute / 60), minute % 60);
  return zoneOffsets.map((offset) => wall - offset).filter((at) => {
    const actual = parts(at, timezone);
    return utc(actual, actual.hour, actual.minute) === wall;
  }).sort((a, b) => a - b);
}

/** Une fois : premier passage lors d'un doublon, première minute existante après un trou. */
function onceAt(schedule: Extract<RoutineSchedule, { kind: "once" }>, timezone: string): number {
  const wanted = localDate(schedule.date);
  let wall = utc(wanted, Math.floor(minutes(schedule.time) / 60), minutes(schedule.time) % 60);
  let currentDate = wanted;
  let zoneOffsets = offsets(currentDate, timezone);
  // Un saut de ligne de date IANA peut supprimer une journée entière (Pacific/Apia).
  for (let i = 0; i <= 2 * 24 * 60; i++, wall += MINUTE) {
    const d = new Date(wall);
    if (d.getUTCDate() !== currentDate.day || d.getUTCMonth() + 1 !== currentDate.month) {
      currentDate = { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
      zoneOffsets = offsets(currentDate, timezone);
    }
    const found = localCandidates(currentDate, d.getUTCHours() * 60 + d.getUTCMinutes(), timezone, zoneOffsets);
    if (found.length) return found[0];
  }
  throw new Error("Cette heure ne peut pas être résolue dans ce fuseau.");
}

const MONTH_NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const DAY_NAMES = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function cronField(source: string, min: number, max: number, names: string[] = [], sunday = false): CronField {
  const normalized = source.toUpperCase().replace(/[A-Z]+/g, (name) => {
    const index = names.indexOf(name);
    if (index < 0) throw new Error(`Nom cron inconnu : ${name}.`);
    return String(index + (sunday ? 0 : min));
  });
  const values = new Set<number>();
  for (const item of normalized.split(",")) {
    if (!/^(\*|\d+(?:-\d+)?)(?:\/\d+)?$/.test(item)) throw new Error("Expression cron invalide (listes, plages et pas attendus).");
    const [base, stepText] = item.split("/");
    const step = stepText === undefined ? 1 : Number(stepText);
    if (!Number.isSafeInteger(step) || step < 1) throw new Error("Pas cron invalide.");
    const [startText, endText] = base.split("-");
    const start = base === "*" ? min : Number(startText);
    const end = base === "*" ? max : Number(endText ?? startText);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < min || end > max || start > end) throw new Error("Valeur cron hors limites.");
    for (let n = start; n <= end; n += step) values.add(sunday && n === 7 ? 0 : n);
  }
  return { values: [...values].sort((a, b) => a - b), wildcard: source === "*" };
}

function parseCron(expression: string): Cron {
  const cached = cronCache.get(expression);
  if (cached) return cached;
  if (!expression.trim() || expression.length > 255) throw new Error("Expression cron invalide (255 caractères maximum).");
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) throw new Error("Une expression cron doit contenir 5 champs : minute heure jour mois jour-de-semaine.");
  const cron: Cron = {
    minute: cronField(fields[0], 0, 59), hour: cronField(fields[1], 0, 23), day: cronField(fields[2], 1, 31),
    month: cronField(fields[3], 1, 12, MONTH_NAMES), weekday: cronField(fields[4], 0, 7, DAY_NAMES, true),
  };
  if (cronCache.size >= 100) cronCache.delete(cronCache.keys().next().value as string);
  cronCache.set(expression, cron);
  return cron;
}

function matchesDay(schedule: RoutineSchedule, date: LocalDate): boolean {
  const weekday = new Date(utc(date)).getUTCDay();
  switch (schedule.kind) {
    case "weekdays": return weekday >= 1 && weekday <= 5;
    case "weekly": return weekday === schedule.weekday;
    case "monthly": return date.day === schedule.day;
    case "advanced":
      return schedule.months.includes(date.month) && (
        schedule.days.kind === "every-day" ||
        (schedule.days.kind === "days-of-week" && schedule.days.days.includes(weekday)) ||
        (schedule.days.kind === "days-of-month" && schedule.days.days.includes(date.day))
      );
    case "custom": {
      const cron = parseCron(schedule.expression);
      if (!cron.month.values.includes(date.month)) return false;
      const day = cron.day.values.includes(date.day);
      const week = cron.weekday.values.includes(weekday);
      // Cron traditionnel : OU quand les deux champs jour sont restreints ; ET sinon.
      return cron.day.wildcard || cron.weekday.wildcard ? day && week : day || week;
    }
    default: return true;
  }
}

function dayMinutes(schedule: RoutineSchedule): number[] {
  switch (schedule.kind) {
    case "hourly": return Array.from({ length: 24 }, (_, hour) => hour * 60 + schedule.minute);
    case "daily": case "weekdays": case "weekly": case "monthly": return [minutes(schedule.time)];
    case "advanced": {
      if (schedule.time.kind === "at-time") return [minutes(schedule.time.time)];
      const amount = schedule.time.amount;
      // Parité OpenBot : les minutes recommencent chaque heure, les heures chaque jour.
      if (schedule.time.unit === "hours") return Array.from({ length: Math.ceil(24 / amount) }, (_, index) => index * amount * 60);
      return Array.from({ length: 24 }, (_, hour) =>
        Array.from({ length: Math.ceil(60 / amount) }, (_, index) => hour * 60 + index * amount),
      ).flat();
    }
    case "custom": {
      const cron = parseCron(schedule.expression);
      return cron.hour.values.flatMap((hour) => cron.minute.values.map((minute) => hour * 60 + minute));
    }
    default: return [];
  }
}

function occurrencesOnDay(schedule: RoutineSchedule, timezone: string, date: LocalDate): number[] {
  const key = `${JSON.stringify(schedule)}|${timezone}|${date.year}-${date.month}-${date.day}`;
  const cached = occurrencesCache.get(key);
  if (cached) return cached;
  const zoneOffsets = offsets(date, timezone);
  const result = [...new Set(dayMinutes(schedule).flatMap((minute) => localCandidates(date, minute, timezone, zoneOffsets)))].sort((a, b) => a - b);
  if (occurrencesCache.size >= 64) occurrencesCache.delete(occurrencesCache.keys().next().value as string);
  occurrencesCache.set(key, result);
  return result;
}

function hasCalendarDay(schedule: RoutineSchedule): boolean {
  // Le calendrier grégorien (jours de semaine et années bissextiles) se répète en 400 ans.
  let date: LocalDate = { year: 2000, month: 1, day: 1 };
  while (date.year < 2400) {
    if (matchesDay(schedule, date)) return true;
    date = addDay(date);
  }
  return false;
}

function intervalMs(amount: number, unit: "minutes" | "hours" | "days"): number {
  return amount * MINUTE * (unit === "days" ? 1440 : unit === "hours" ? 60 : 1);
}

/** Valide les entrées IPC et renvoie un objet normalisé sans champs inconnus. */
export function validateSchedule(value: unknown, timezone: string, now: Date): RoutineSchedule {
  formatter(timezone);
  instant(now);
  const input = record(value);
  let result: RoutineSchedule;
  switch (input.kind) {
    case "manual": return { kind: "manual" };
    case "once":
      localDate(input.date);
      result = { kind: "once", date: input.date as string, time: time(input.time) };
      if (onceAt(result, timezone) <= now.getTime()) throw new Error("Choisissez une date et une heure futures.");
      return result;
    case "hourly": return { kind: "hourly", minute: integer(input.minute, 0, 59, "Minute") };
    case "daily": return { kind: "daily", time: time(input.time) };
    case "weekdays": return { kind: "weekdays", time: time(input.time) };
    case "weekly": return { kind: "weekly", weekday: integer(input.weekday, 0, 6, "Jour de semaine"), time: time(input.time) };
    case "monthly": return { kind: "monthly", day: integer(input.day, 1, 31, "Jour du mois"), time: time(input.time) };
    case "interval": {
      const amount = integer(input.amount, 1, 100_000, "Intervalle");
      if (input.unit !== "minutes" && input.unit !== "hours" && input.unit !== "days") throw new Error("Unité d’intervalle invalide.");
      const duration = intervalMs(amount, input.unit);
      if (!Number.isSafeInteger(duration)) throw new Error("Intervalle trop grand.");
      if (duration < 3 * MINUTE) throw new Error("L’intervalle minimum est de 3 minutes.");
      if (typeof input.anchorAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(input.anchorAt) || !Number.isFinite(Date.parse(input.anchorAt))) {
        throw new Error("L’ancrage de l’intervalle doit être un instant ISO avec fuseau.");
      }
      localDate(input.anchorAt.slice(0, 10));
      time(input.anchorAt.slice(11, 16));
      return { kind: "interval", amount, unit: input.unit, anchorAt: new Date(input.anchorAt).toISOString() };
    }
    case "advanced": {
      const months = integers(input.months, 1, 12, "Mois");
      const daysInput = record(input.days);
      const timeInput = record(input.time);
      let days: Extract<RoutineSchedule, { kind: "advanced" }>["days"];
      let advancedTime: Extract<RoutineSchedule, { kind: "advanced" }>["time"];
      if (daysInput.kind === "every-day") days = { kind: "every-day" };
      else if (daysInput.kind === "days-of-week") days = { kind: "days-of-week", days: integers(daysInput.days, 0, 6, "Jours de semaine") };
      else if (daysInput.kind === "days-of-month") days = { kind: "days-of-month", days: integers(daysInput.days, 1, 31, "Jours du mois") };
      else throw new Error("Sélection de jours invalide.");
      if (timeInput.kind === "at-time") advancedTime = { kind: "at-time", time: time(timeInput.time) };
      else if (timeInput.kind === "every") {
        const amount = integer(timeInput.amount, 1, 100_000, "Intervalle");
        if (timeInput.unit !== "minutes" && timeInput.unit !== "hours") throw new Error("Unité de programmation avancée invalide.");
        if (timeInput.unit === "minutes" && amount < 3) throw new Error("L’intervalle minimum est de 3 minutes.");
        advancedTime = { kind: "every", amount, unit: timeInput.unit };
      } else throw new Error("Heure de programmation avancée invalide.");
      result = { kind: "advanced", months, days, time: advancedTime };
      break;
    }
    case "custom":
      if (typeof input.expression !== "string") throw new Error("Expression cron invalide.");
      result = { kind: "custom", expression: input.expression.trim().replace(/\s+/g, " ") };
      parseCron(result.expression);
      break;
    default: throw new Error("Type de programmation inconnu.");
  }
  if (!hasCalendarDay(result)) throw new Error("Cette programmation ne correspond à aucune date existante.");
  if (result.kind === "custom" || (result.kind === "advanced" && result.time.kind === "every")) {
    let previous = nextOccurrence(result, timezone, now);
    if (!previous) throw new Error("Cette programmation n’a aucune prochaine exécution.");
    for (let index = 1; index < 200; index++) {
      const next = nextOccurrence(result, timezone, new Date(previous));
      if (!next) break;
      if (Date.parse(next) - Date.parse(previous) < 3 * MINUTE) throw new Error("La cadence minimum est de 3 minutes (200 occurrences vérifiées).");
      previous = next;
    }
  }
  return result;
}

/** Prochaine échéance strictement après after ; null pour une routine une fois terminée. */
export function nextOccurrence(schedule: RoutineSchedule, timezone: string, after: Date): string | null {
  formatter(timezone);
  const threshold = instant(after);
  if (schedule.kind === "manual") return null;
  if (schedule.kind === "once") {
    const at = onceAt(schedule, timezone);
    return at > threshold ? new Date(at).toISOString() : null;
  }
  if (schedule.kind === "interval") {
    const anchor = Date.parse(schedule.anchorAt);
    const duration = intervalMs(schedule.amount, schedule.unit);
    const at = anchor + Math.max(0, Math.floor((threshold - anchor) / duration) + 1) * duration;
    return Number.isFinite(new Date(at).getTime()) ? new Date(at).toISOString() : null;
  }
  let date: LocalDate = parts(threshold, timezone);
  const endYear = date.year + 400;
  while (date.year <= endYear) {
    if (matchesDay(schedule, date)) {
      const next = occurrencesOnDay(schedule, timezone, date).find((at) => at > threshold);
      if (next !== undefined) return new Date(next).toISOString();
    }
    date = addDay(date);
  }
  // Un calendrier sans candidat sur un cycle grégorien entier est impossible.
  return null;
}

export function upcomingOccurrences(schedule: RoutineSchedule, timezone: string, after: Date, limit: number): string[] {
  if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Nombre de prochaines exécutions invalide.");
  const result: string[] = [];
  let cursor = after;
  for (let index = 0; index < limit; index++) {
    const next = nextOccurrence(schedule, timezone, cursor);
    if (!next) break;
    result.push(next);
    cursor = new Date(next);
  }
  return result;
}
