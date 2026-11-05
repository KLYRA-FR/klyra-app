import { describe, expect, test } from "vitest";
import { ErreurPoste } from "@/lib/poste/types";
import type { Role } from "@/types/domain";
import type { Routine } from "@/types/routines";
import {
  essaiPossible,
  quandRelatif,
  routineDejaCreee,
  agentsDesRoutines,
  brouillonValide,
  lireId,
  lireLimite,
  lireRoutineInput,
  lireSchedule,
  nouvelleRoutine,
  patchRoutine,
  routineLue,
  valeursRoutine,
} from "./routines-telephone";

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof ErreurPoste ? err.code : "autre";
  }
}

const routine: Routine = {
  id: "r1",
  agentId: "dev",
  name: "Point",
  instruction: "Fais le point.",
  schedule: { kind: "daily", time: "09:00" },
  timezone: "Europe/Paris",
  active: true,
  nextRunAt: null,
  missedPolicy: "skip",
  projectId: null,
  positions: { r1: { x: 1, y: 2 } },
  createdAt: "c",
  updatedAt: "u",
};

describe("planning envoyé par le téléphone", () => {
  test("chaque forme du bureau passe, recopiée sans champ en trop", () => {
    expect(lireSchedule({ kind: "manual", pirate: true })).toEqual({ kind: "manual" });
    expect(lireSchedule({ kind: "once", date: "2026-11-03", time: "08:00" })).toEqual({ kind: "once", date: "2026-11-03", time: "08:00" });
    expect(lireSchedule({ kind: "hourly", minute: 59 })).toEqual({ kind: "hourly", minute: 59 });
    expect(lireSchedule({ kind: "weekdays", time: "23:59" })).toEqual({ kind: "weekdays", time: "23:59" });
    expect(lireSchedule({ kind: "weekly", weekday: 0, time: "07:00" })).toEqual({ kind: "weekly", weekday: 0, time: "07:00" });
    expect(lireSchedule({ kind: "monthly", day: 31, time: "07:00" })).toEqual({ kind: "monthly", day: 31, time: "07:00" });
    expect(lireSchedule({ kind: "interval", amount: 3, unit: "minutes", anchorAt: "2026-11-02T10:00:00.000Z" })).toEqual({
      kind: "interval",
      amount: 3,
      unit: "minutes",
      anchorAt: "2026-11-02T10:00:00.000Z",
    });
    /* Une programmation avancée ou cron se garde telle quelle quand on modifie autre chose. */
    expect(lireSchedule({ kind: "advanced", months: [1, 6], days: { kind: "days-of-week", days: [1, 3] }, time: { kind: "every", amount: 2, unit: "hours" } })).toEqual({
      kind: "advanced",
      months: [1, 6],
      days: { kind: "days-of-week", days: [1, 3] },
      time: { kind: "every", amount: 2, unit: "hours" },
    });
    expect(lireSchedule({ kind: "custom", expression: "0 9 * * 1" })).toEqual({ kind: "custom", expression: "0 9 * * 1" });
  });

  test("le reste est refusé", () => {
    expect(code(() => lireSchedule({ kind: "daily", time: "9:00" }))).toBe("programmation");
    expect(code(() => lireSchedule({ kind: "once", date: "demain", time: "09:00" }))).toBe("programmation");
    expect(code(() => lireSchedule({ kind: "hourly", minute: 60 }))).toBe("arguments");
    expect(code(() => lireSchedule({ kind: "weekly", weekday: 7, time: "09:00" }))).toBe("arguments");
    expect(code(() => lireSchedule({ kind: "interval", amount: 0, unit: "hours", anchorAt: "2026-11-02T10:00:00Z" }))).toBe("arguments");
    expect(code(() => lireSchedule({ kind: "interval", amount: 1.5, unit: "hours", anchorAt: "2026-11-02T10:00:00Z" }))).toBe("arguments");
    expect(code(() => lireSchedule({ kind: "interval", amount: 1, unit: "semaines", anchorAt: "2026-11-02T10:00:00Z" }))).toBe("arguments");
    expect(code(() => lireSchedule({ kind: "interval", amount: 1, unit: "hours", anchorAt: "jamais" }))).toBe("arguments");
    expect(code(() => lireSchedule({ kind: "advanced", months: [], days: { kind: "every-day" }, time: { kind: "at-time", time: "09:00" } }))).toBe("arguments");
    expect(code(() => lireSchedule({ kind: "advanced", months: [13], days: { kind: "every-day" }, time: { kind: "at-time", time: "09:00" } }))).toBe("arguments");
    expect(code(() => lireSchedule({ kind: "custom", expression: "" }))).toBe("arguments");
    expect(code(() => lireSchedule({ kind: "chaque-lune" }))).toBe("arguments");
    expect(code(() => lireSchedule("daily"))).toBe("arguments");
    expect(code(() => lireSchedule(null))).toBe("arguments");
  });
});

describe("routine envoyée par le formulaire du téléphone", () => {
  const valide = { agentId: "dev", name: "Point", instruction: "Fais le point.", schedule: { kind: "daily", time: "09:00" }, timezone: "Europe/Paris", active: true, missedPolicy: "skip", projectId: null, lieu: null };

  test("passe, recopiée champ par champ", () => {
    expect(lireRoutineInput({ ...valide, pirate: "x" })).toEqual(valide);
    expect(lireRoutineInput({ ...valide, lieu: "https://vps.exemple.ts.net:8791", projectId: "p1" }).lieu).toBe("https://vps.exemple.ts.net:8791");
  });

  test("refuse un agent, un nom, une consigne, une machine ou un état de la mauvaise forme", () => {
    expect(code(() => lireRoutineInput({ ...valide, agentId: "../agents" }))).toBe("agent");
    expect(code(() => lireRoutineInput({ ...valide, agentId: 3 }))).toBe("arguments");
    expect(code(() => lireRoutineInput({ ...valide, name: "x".repeat(201) }))).toBe("arguments");
    expect(code(() => lireRoutineInput({ ...valide, instruction: "x".repeat(100_001) }))).toBe("arguments");
    expect(code(() => lireRoutineInput({ ...valide, active: "oui" }))).toBe("arguments");
    expect(code(() => lireRoutineInput({ ...valide, missedPolicy: "tout" }))).toBe("arguments");
    expect(code(() => lireRoutineInput({ ...valide, lieu: "file:///etc" }))).toBe("arguments");
    expect(code(() => lireRoutineInput({ ...valide, projectId: 4 }))).toBe("arguments");
    expect(code(() => lireRoutineInput({ ...valide, schedule: { kind: "daily" } }))).toBe("programmation");
    expect(code(() => lireRoutineInput([valide]))).toBe("arguments");
  });

  test("identifiants et paquets d'historique", () => {
    expect(lireId({ runId: "r1~vps-3" }, "runId")).toBe("r1~vps-3");
    expect(code(() => lireId({ id: "" }, "id"))).toBe("arguments");
    expect(code(() => lireId({ id: "x".repeat(201) }, "id"))).toBe("arguments");
    expect(code(() => lireId({}, "id"))).toBe("arguments");
    expect(lireLimite({})).toBe(50);
    expect(lireLimite({ limite: 100 })).toBe(100);
    expect(code(() => lireLimite({ limite: 0 }))).toBe("arguments");
    expect(code(() => lireLimite({ limite: 1001 }))).toBe("arguments");
    expect(code(() => lireLimite({ limite: "50" }))).toBe("arguments");
  });

  test("seuls les champs changés partent au moteur ; une machine absente vaut « ce poste »", () => {
    expect(patchRoutine(routine, valeursRoutine(routine))).toEqual({});
    expect(patchRoutine(routine, { ...valeursRoutine(routine), name: "Point du lundi", schedule: { kind: "weekly", weekday: 1, time: "09:00" } })).toEqual({
      name: "Point du lundi",
      schedule: { kind: "weekly", weekday: 1, time: "09:00" },
    });
  });
});

describe("ce que le téléphone affiche et garde", () => {
  const role = (id: string, name: string): Role => ({ id, name, tag: "Dev", title: "Dev web", teinte: "bleu-k1" }) as Role;

  test("les agents de la colonne : Mes agents, puis ceux qui ont des routines sans être actifs", () => {
    const agents = agentsDesRoutines([role("principal", "Léa"), role("dev", "Hugo")], [{ role: role("val", "Val") }], [{ agentId: "dev" }, { agentId: "val" }, { agentId: "parti" }, { agentId: "val" }]);
    expect(agents.map((a) => [a.id, a.actif, a.connu])).toEqual([
      ["principal", true, true],
      ["dev", true, true],
      ["val", false, true],
      ["parti", false, false],
    ]);
    expect(agents[3].name).toBe("Agent indisponible");
  });

  test("une routine part sans les places de l'ancien canevas", () => {
    expect(routineLue(routine)).not.toHaveProperty("positions");
    expect(routine.positions).toBeDefined();
  });

  test("une nouvelle routine prend le fuseau et la machine de l'ordinateur", () => {
    expect(nouvelleRoutine("dev", "America/Montreal", "https://vps.exemple")).toMatchObject({ agentId: "dev", timezone: "America/Montreal", lieu: "https://vps.exemple", schedule: { kind: "daily", time: "09:00" } });
  });

  test("un brouillon illisible est oublié", () => {
    const valeurs = valeursRoutine(routine);
    expect(brouillonValide({ initiale: null, valeurs })).toEqual({ initiale: null, base: valeurs, valeurs, champAgent: false });
    expect(brouillonValide({ initiale: { id: "r1", name: "Point", updatedAt: "u" }, valeurs, base: valeurs, champAgent: true })?.champAgent).toBe(true);
    expect(brouillonValide({ initiale: null, valeurs: { ...valeurs, schedule: null } })).toBeNull();
    expect(brouillonValide({ initiale: { id: 3 }, valeurs })).toBeNull();
    expect(brouillonValide("brouillon")).toBeNull();
  });
});

describe("ce que dit une carte de routine", () => {
  const maintenant = new Date("2026-11-05T10:00:00Z");
  test("une date proche se dit en mots, dans le fuseau de la routine ; un autre jour, la date", () => {
    expect(quandRelatif("2026-11-05T08:00:00Z", "Europe/Paris", maintenant)).toBe("aujourd’hui, 09:00");
    expect(quandRelatif("2026-11-06T08:00:00Z", "Europe/Paris", maintenant)).toBe("demain, 09:00");
    expect(quandRelatif("2026-11-04T08:00:00Z", "Europe/Paris", maintenant)).toBe("hier, 09:00");
    expect(quandRelatif("2026-11-10T08:00:00Z", "Europe/Paris", maintenant)).toContain("10 nov.");
    /* À Tokyo, ce même instant est déjà demain. */
    expect(quandRelatif("2026-11-05T16:00:00Z", "Asia/Tokyo", maintenant)).toBe("demain, 01:00");
    expect(quandRelatif(null, "Europe/Paris", maintenant)).toBe("—");
  });

  test("une création sans réponse a pu aboutir : retrouvée par son agent, son nom, sa consigne, et sa date", () => {
    const routines = [{ agentId: "dev", name: "Point", instruction: "Fais le point", createdAt: "2026-11-05T10:00:00Z" }] as never[];
    const input = { agentId: "dev", name: "Point", instruction: "Fais le point" };
    expect(routineDejaCreee(routines, input, "2026-11-05T09:59:00Z")).toBeDefined();
    expect(routineDejaCreee(routines, input, "2026-11-05T10:00:01Z")).toBeUndefined();
    expect(routineDejaCreee(routines, { ...input, name: "Autre" }, "2026-11-05T09:59:00Z")).toBeUndefined();
  });

  test("« Réessayer » attend la relecture, et ne relance pas une routine dont l'exécution est arrivée", () => {
    expect(essaiPossible("routines.executer", false, true)).toBe(false);
    expect(essaiPossible("routines.executer", true, false)).toBe(false);
    expect(essaiPossible("routines.executer", false, false)).toBe(true);
    expect(essaiPossible("routines.pause", true, false)).toBe(true);
  });
});
