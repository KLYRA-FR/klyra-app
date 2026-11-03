import { describe, expect, it } from "vitest";
import { calendrierRoutines, estFrequente, lienNouvelleRoutine, lireCreneau } from "./planning-routines";
import type { Routine, RoutineRun, RoutineSchedule } from "@/types/routines";

const routine = (id: string, schedule: RoutineSchedule, autre: Partial<Routine> = {}): Routine => ({
  id,
  agentId: "hugo",
  name: id,
  instruction: "",
  schedule,
  timezone: "Europe/Paris",
  active: true,
  nextRunAt: null,
  missedPolicy: "skip",
  projectId: null,
  createdAt: "2026-11-01T00:00:00.000Z",
  updatedAt: "2026-11-01T00:00:00.000Z",
  ...autre,
});

const run = (routineId: string, scheduledFor: string, status: RoutineRun["status"], autre: Partial<RoutineRun> = {}): RoutineRun => ({
  id: `${routineId}-${scheduledFor}`,
  routineId,
  agentId: "hugo",
  kind: "scheduled",
  scheduledFor,
  routineName: routineId,
  instruction: "",
  projectId: null,
  status,
  error: null,
  dispatchedAt: null,
  delivery: null,
  result: null,
  createdAt: scheduledFor,
  startedAt: null,
  finishedAt: null,
  updatedAt: scheduledFor,
  ...autre,
});

/* La semaine du lundi 2 au lundi 9 novembre 2026, heure du poste ; on est le mercredi 4 à midi. */
const debut = new Date(2026, 10, 2);
const fin = new Date(2026, 10, 9);
const maintenant = new Date(2026, 10, 4, 12);
const iso = (jour: number, heure: number) => new Date(2026, 10, jour, heure).toISOString();

describe("estFrequente", () => {
  it("met sur une ligne ce qui part plusieurs fois par jour", () => {
    expect(estFrequente({ kind: "hourly", minute: 0 })).toBe(true);
    expect(estFrequente({ kind: "interval", amount: 30, unit: "minutes", anchorAt: iso(2, 0) })).toBe(true);
    expect(estFrequente({ kind: "interval", amount: 2, unit: "days", anchorAt: iso(2, 0) })).toBe(false);
    expect(estFrequente({ kind: "daily", time: "09:00" })).toBe(false);
  });
});

describe("calendrierRoutines", () => {
  const quotidienne = routine("revue", { kind: "daily", time: "09:00" });

  it("place les exécutions passées et les départs à venir, sans doublon", () => {
    const { blocs } = calendrierRoutines({
      routines: [quotidienne],
      runs: [run("revue", iso(3, 9), "succeeded"), run("revue", iso(4, 9), "failed")],
      passages: [{ routineId: "revue", at: iso(4, 9) }, { routineId: "revue", at: iso(5, 9) }],
      debut,
      fin,
      maintenant,
    });
    expect(blocs.get("2026-11-03")?.map((b) => b.run?.status)).toEqual(["succeeded"]);
    expect(blocs.get("2026-11-04")?.map((b) => b.run?.status)).toEqual(["failed"]);
    expect(blocs.get("2026-11-05")).toEqual([expect.objectContaining({ run: null, minute: 9 * 60 })]);
  });

  it("résume une routine fréquente sur une ligne par jour, avec ses échecs", () => {
    const horaire = routine("veille", { kind: "hourly", minute: 0 });
    const { blocs, frequentes } = calendrierRoutines({
      routines: [horaire],
      runs: [run("veille", iso(3, 9), "succeeded"), run("veille", iso(3, 10), "failed"), run("veille", iso(3, 11), "cancelled", { missed: { count: 5, capped: false, until: null, reason: "app-closed" } })],
      passages: [{ routineId: "veille", at: iso(4, 13) }],
      debut,
      fin,
      maintenant,
    });
    expect(blocs.size).toBe(0);
    expect(frequentes.get("2026-11-03")).toEqual([expect.objectContaining({ runs: 2, echecs: 1 })]);
    /* À venir : chaque jour à partir d'aujourd'hui ; rien avant, sans exécution. */
    expect(frequentes.has("2026-11-02")).toBe(false);
    expect([...frequentes.keys()].filter((j) => j >= "2026-11-04")).toHaveLength(5);
  });

  it("ne garde que l'agent choisi", () => {
    const autre = routine("mails", { kind: "daily", time: "08:00" }, { agentId: "val" });
    const { blocs } = calendrierRoutines({
      routines: [quotidienne, autre],
      runs: [],
      passages: [{ routineId: "revue", at: iso(5, 9) }, { routineId: "mails", at: iso(5, 8) }],
      debut,
      fin,
      maintenant,
      agent: "val",
    });
    expect(blocs.get("2026-11-05")?.map((b) => b.routine.id)).toEqual(["mails"]);
  });

  it("ignore ce qui sort de la période ou d'une routine supprimée", () => {
    const { blocs } = calendrierRoutines({
      routines: [quotidienne],
      runs: [run("revue", iso(1, 9), "succeeded"), run("disparue", iso(3, 9), "succeeded")],
      passages: [],
      debut,
      fin,
      maintenant,
    });
    expect(blocs.size).toBe(0);
  });
});

describe("créneau du Planning", () => {
  it("fait l'aller-retour jusqu'au formulaire", () => {
    const lien = lienNouvelleRoutine("2026-11-03", "09:30", "hugo");
    expect(lien).toBe("/routines?vue=routines&agent=hugo&creneau=2-09:30");
    expect(lireCreneau(new URLSearchParams(lien.split("?")[1]).get("creneau"))).toEqual({ weekday: 2, time: "09:30" });
    expect(lireCreneau("9-25:00")).toBeNull();
    expect(lireCreneau(null)).toBeNull();
  });
});
