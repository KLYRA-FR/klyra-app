/**
 * Routines : calcul des échéances (electron/routines/schedule.ts), fuseaux et changements d'heure.
 * Node seul, sans Electron.
 *   pnpm build:electron && node scripts/test-routine-schedule.cjs
 */
/* eslint-disable @typescript-eslint/no-require-imports -- script Node en CommonJS */
const assert = require("node:assert/strict");
const { validateSchedule, nextOccurrence, upcomingOccurrences } = require("../dist-electron/routines/schedule.js");

let checked = 0;
function test(name, run) { run(); checked++; console.log(`OK — ${name}`); }
const d = (value) => new Date(value);
const next = (schedule, after, zone = "Europe/Paris") => nextOccurrence(schedule, zone, d(after));
const validate = (schedule, zone = "Europe/Paris", now = "2026-01-01T00:00:00Z") => validateSchedule(schedule, zone, d(now));

test("daily : heure d’hiver, heure d’été et seuil strict", () => {
  const schedule = validate({ kind: "daily", time: "12:00" });
  assert.equal(next(schedule, "2026-01-01T10:00:00Z"), "2026-01-01T11:00:00.000Z");
  assert.equal(next(schedule, "2026-07-01T09:00:00Z"), "2026-07-01T10:00:00.000Z");
  assert.equal(next(schedule, "2026-07-01T10:00:00Z"), "2026-07-02T10:00:00.000Z");
});

test("daily : heure inexistante ignorée ; heure doublée exécutée une seule fois", () => {
  const schedule = validate({ kind: "daily", time: "02:30" });
  assert.equal(next(schedule, "2026-03-28T02:00:00Z"), "2026-03-30T00:30:00.000Z");
  assert.deepEqual(upcomingOccurrences(schedule, "Europe/Paris", d("2026-10-24T23:00:00Z"), 3), [
    "2026-10-25T00:30:00.000Z", "2026-10-26T01:30:00.000Z", "2026-10-27T01:30:00.000Z",
  ]);
  // Ouvrir/reprendre pendant le second passage ne crée pas une nouvelle échéance locale.
  assert.equal(next(schedule, "2026-10-25T01:00:00Z"), "2026-10-26T01:30:00.000Z");
});

test("automne : toute récurrence civile garde le premier passage de chaque minute locale", () => {
  const after = "2026-10-25T00:30:00Z";
  const cases = [
    [{ kind: "hourly", minute: 30 }, "2026-10-25T02:30:00.000Z"],
    [{ kind: "weekly", weekday: 0, time: "02:30" }, "2026-11-01T01:30:00.000Z"],
    [{ kind: "monthly", day: 25, time: "02:30" }, "2026-11-25T01:30:00.000Z"],
    [{ kind: "advanced", months: [10], days: { kind: "every-day" }, time: { kind: "at-time", time: "02:30" } }, "2026-10-26T01:30:00.000Z"],
    [{ kind: "custom", expression: "30 2 * * *" }, "2026-10-26T01:30:00.000Z"],
    [{ kind: "advanced", months: [10], days: { kind: "every-day" }, time: { kind: "every", amount: 30, unit: "minutes" } }, "2026-10-25T02:00:00.000Z"],
  ];
  for (const [schedule, expected] of cases) assert.equal(next(validate(schedule), after), expected);
  // Intervalle absolu : le retour d'horloge ne supprime pas une heure réellement écoulée.
  const absolute = validate({ kind: "interval", amount: 1, unit: "hours", anchorAt: after });
  assert.equal(next(absolute, after), "2026-10-25T01:30:00.000Z");
});

test("automne : décalage de trente minutes, sans hypothèse d'un recul d'une heure", () => {
  const schedule = validate({ kind: "daily", time: "01:45" }, "Australia/Lord_Howe");
  assert.deepEqual(upcomingOccurrences(schedule, "Australia/Lord_Howe", d("2026-04-04T13:00:00Z"), 2), [
    "2026-04-04T14:45:00.000Z", "2026-04-05T15:15:00.000Z",
  ]);
});

test("once : trou DST déplacé à la première minute valide ; doublon premier passage seulement", () => {
  const spring = validate({ kind: "once", date: "2026-03-29", time: "02:30" });
  const autumn = validate({ kind: "once", date: "2026-10-25", time: "02:30" });
  assert.equal(next(spring, "2026-03-28T00:00:00Z"), "2026-03-29T01:00:00.000Z");
  assert.equal(next(autumn, "2026-10-24T00:00:00Z"), "2026-10-25T00:30:00.000Z");
  assert.equal(next(autumn, "2026-10-25T00:30:00Z"), null);
});

test("once : dates impossibles, passées, heures et fuseaux invalides refusés", () => {
  assert.throws(() => validate({ kind: "once", date: "2026-02-29", time: "12:00" }), /existe/);
  assert.throws(() => validate({ kind: "once", date: "2025-12-31", time: "12:00" }), /futures/);
  assert.throws(() => validate({ kind: "daily", time: "24:00" }), /Heure/);
  assert.throws(() => validate({ kind: "daily", time: "12:00" }, "Paris"), /IANA/);
  assert.throws(() => validate({ kind: "daily", time: "12:00" }, "+01:00"), /IANA/);
});

test("hourly, weekdays et weekly restent dans le fuseau de la routine", () => {
  assert.equal(next(validate({ kind: "hourly", minute: 15 }), "2026-01-02T10:16:00Z"), "2026-01-02T11:15:00.000Z");
  assert.equal(next(validate({ kind: "weekdays", time: "12:00" }), "2026-01-02T12:00:00Z"), "2026-01-05T11:00:00.000Z");
  assert.equal(next(validate({ kind: "weekly", weekday: 0, time: "12:00" }), "2026-01-02T12:00:00Z"), "2026-01-04T11:00:00.000Z");
});

test("monthly : le 31 saute février et avril, sans reporter au mois suivant", () => {
  const schedule = validate({ kind: "monthly", day: 31, time: "12:00" });
  assert.equal(next(schedule, "2026-01-31T11:00:00Z"), "2026-03-31T10:00:00.000Z");
  assert.equal(next(schedule, "2026-03-31T10:00:00Z"), "2026-05-31T10:00:00.000Z");
});

test("interval : ancrage conservé, cadence absolue même après DST", () => {
  const schedule = validate({ kind: "interval", amount: 3, unit: "minutes", anchorAt: "2026-01-01T12:01:00+01:00" });
  assert.equal(schedule.anchorAt, "2026-01-01T11:01:00.000Z");
  assert.equal(next(schedule, "2026-01-01T11:01:00Z"), "2026-01-01T11:04:00.000Z");
  assert.equal(next(schedule, "2026-01-01T10:00:00Z"), "2026-01-01T11:01:00.000Z");
  const days = validate({ kind: "interval", amount: 1, unit: "days", anchorAt: "2026-03-28T11:00:00Z" });
  assert.equal(next(days, "2026-03-28T11:00:00Z"), "2026-03-29T11:00:00.000Z");
  assert.throws(() => validate({ kind: "interval", amount: 2, unit: "minutes", anchorAt: "2026-01-01T00:00:00Z" }), /3 minutes/);
  assert.throws(() => validate({ kind: "interval", amount: 3, unit: "minutes", anchorAt: "2026-01-01" }), /ISO/);
  assert.throws(() => validate({ kind: "interval", amount: 3, unit: "minutes", anchorAt: "2026-02-30T00:00:00Z" }), /existe/);
});

test("advanced : mois, jours de semaine et heure choisis", () => {
  const schedule = validate({ kind: "advanced", months: [3], days: { kind: "days-of-week", days: [1] }, time: { kind: "at-time", time: "12:00" } });
  assert.equal(next(schedule, "2026-01-01T00:00:00Z"), "2026-03-02T11:00:00.000Z");
});

test("advanced : heures depuis minuit, minutes depuis chaque heure et cadences réelles contrôlées", () => {
  const schedule = validate({ kind: "advanced", months: [1], days: { kind: "every-day" }, time: { kind: "every", amount: 3, unit: "hours" } });
  assert.equal(next(schedule, "2026-01-01T01:01:00Z"), "2026-01-01T02:00:00.000Z");
  assert.throws(() => validate({ kind: "advanced", months: [2], days: { kind: "days-of-month", days: [30] }, time: { kind: "at-time", time: "12:00" } }), /aucune date/);
  assert.throws(() => validate({ kind: "advanced", months: [1], days: { kind: "every-day" }, time: { kind: "every", amount: 2, unit: "minutes" } }), /3 minutes/);
  assert.throws(() => validate({ kind: "advanced", months: [1], days: { kind: "every-day" }, time: { kind: "every", amount: 59, unit: "minutes" } }), /3 minutes/);
  const seven = validate({ kind: "advanced", months: [1], days: { kind: "every-day" }, time: { kind: "every", amount: 7, unit: "minutes" } });
  assert.equal(next(seven, "2026-01-01T00:56:00Z"), "2026-01-01T01:00:00.000Z");
});

test("cron : pas, listes, plages, noms et dimanche 7", () => {
  assert.equal(next(validate({ kind: "custom", expression: "*/3 * * * *" }), "2026-01-01T00:00:00Z"), "2026-01-01T00:03:00.000Z");
  assert.equal(next(validate({ kind: "custom", expression: "15,45 9-11/2 * JAN MON-FRI" }), "2026-01-02T09:00:00Z"), "2026-01-02T10:15:00.000Z");
  assert.equal(next(validate({ kind: "custom", expression: "0 12 * * 7" }), "2026-01-02T00:00:00Z"), "2026-01-04T11:00:00.000Z");
});

test("cron : jour du mois OU jour de semaine quand les deux sont restreints", () => {
  const schedule = validate({ kind: "custom", expression: "0 12 15 * MON" });
  assert.equal(next(schedule, "2026-01-12T12:00:00Z"), "2026-01-15T11:00:00.000Z");
});

test("cron : cadence trop courte, syntaxe et date impossible refusées", () => {
  for (const expression of ["*/2 * * * *", "0,1 * * * *", "* * * * *"]) assert.throws(() => validate({ kind: "custom", expression }), /3 minutes/);
  for (const expression of ["0 0 0 * * *", "60 * * * *", "0 0 * * WAT", "0 0 * * 9", "0 0 * * MON#2", "0 0 * * 5-1", "*/0 * * * *"]) assert.throws(() => validate({ kind: "custom", expression }));
  assert.throws(() => validate({ kind: "custom", expression: "0 12 30 FEB *" }), /aucune date/);
});

test("cron : leap day au-delà du siècle non bissextile 2100", () => {
  const schedule = validate({ kind: "custom", expression: "0 12 29 FEB *" });
  assert.equal(next(schedule, "2096-03-01T00:00:00Z"), "2104-02-29T11:00:00.000Z");
});

test("fuseaux : décalage de 45 minutes et saut d’une journée IANA", () => {
  const daily = validate({ kind: "daily", time: "12:00" }, "Asia/Kathmandu");
  assert.equal(next(daily, "2026-01-01T00:00:00Z", "Asia/Kathmandu"), "2026-01-01T06:15:00.000Z");
  const once = validate({ kind: "once", date: "2011-12-30", time: "12:00" }, "Pacific/Apia", "2011-01-01T00:00:00Z");
  assert.equal(next(once, "2011-12-29T00:00:00Z", "Pacific/Apia"), "2011-12-30T10:00:00.000Z");
});

console.log(`${checked} scénarios de programmation vérifiés.`);
