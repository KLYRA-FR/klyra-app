import { describe, expect, test } from "vitest";
import type { Tache } from "@/types/domain";

/* Les règles se calculent en heure locale : on fixe le fuseau du poste (heure d'été et d'hiver en France),
   avant de charger les modules, dont les formats de date retiennent le fuseau à leur création. */
process.env.TZ = "Europe/Paris";
const { echeanceReportee, HEURE_MATIN, reporter, reporterParId, reportsProposes } = await import("./report");
const { libelleJourCourt } = await import("./dates");

/** Une horloge fixée : « 2026-10-30 23:30 » en heure de Paris. */
const a = (local: string) => new Date(local);

const rappel = (patch: Partial<Tache> = {}): Tache => ({
  id: "t1",
  titre: "Relancer le devis d’Approv’Halles",
  notes: "Voir le mail du 28",
  liste: "clients",
  date: "2026-10-30",
  heure: "10:00",
  priorite: 2,
  signalee: true,
  faite: false,
  faiteLe: null,
  projectId: "p1",
  creeLe: "2026-10-20T08:00:00.000Z",
  notifiee: true,
  ...patch,
});

describe("le fuseau du test", () => {
  test("Paris : heure d'été puis d'hiver le 25 octobre 2026", () => {
    expect(new Date("2026-10-24T12:00").getTimezoneOffset()).toBe(-120);
    expect(new Date("2026-10-26T12:00").getTimezoneOffset()).toBe(-60);
  });
});

describe("Dans 1 h", () => {
  test("une heure plus tard, à la minute supérieure", () => {
    expect(echeanceReportee("une-heure", a("2026-10-30T14:12"))).toEqual({ date: "2026-10-30", heure: "15:12" });
    expect(echeanceReportee("une-heure", a("2026-10-30T14:12:30"))).toEqual({ date: "2026-10-30", heure: "15:13" });
  });

  test("près de minuit : le jour suit, fin de mois et fin d'année comprises", () => {
    expect(echeanceReportee("une-heure", a("2026-10-30T23:30"))).toEqual({ date: "2026-10-31", heure: "00:30" });
    expect(echeanceReportee("une-heure", a("2026-10-31T23:59"))).toEqual({ date: "2026-11-01", heure: "00:59" });
    expect(echeanceReportee("une-heure", a("2026-12-31T23:15"))).toEqual({ date: "2027-01-01", heure: "00:15" });
    expect(echeanceReportee("une-heure", a("2028-02-28T23:40"))).toEqual({ date: "2028-02-29", heure: "00:40" });
  });

  test("passage à l'heure d'été (29 mars 2026, 02:00 → 03:00) : une vraie heure plus tard", () => {
    expect(echeanceReportee("une-heure", a("2026-03-29T01:30"))).toEqual({ date: "2026-03-29", heure: "03:30" });
  });

  test("passage à l'heure d'hiver (25 octobre 2026, 03:00 → 02:00) : jamais une échéance déjà passée", () => {
    /* 01:30 (été) + 1 h = 02:30 (été), première occurrence : se relit à l'identique. */
    expect(echeanceReportee("une-heure", a("2026-10-25T01:30"))).toEqual({ date: "2026-10-25", heure: "02:30" });
    /* 02:30 (été) + 1 h = 02:30 (hiver), qui se relirait comme 02:30 (été), déjà passé : 03:00. */
    const ete = new Date(Date.UTC(2026, 9, 25, 0, 30));
    const e = echeanceReportee("une-heure", ete);
    expect(e).toEqual({ date: "2026-10-25", heure: "03:00" });
    expect(new Date(`${e.date}T${e.heure}`).getTime()).toBeGreaterThan(ete.getTime() + 60 * 60_000 - 1);
  });
});

describe("Demain matin", () => {
  test(`le jour suivant à ${HEURE_MATIN}, même juste après minuit`, () => {
    expect(echeanceReportee("demain-matin", a("2026-10-30T14:00"))).toEqual({ date: "2026-10-31", heure: HEURE_MATIN });
    expect(echeanceReportee("demain-matin", a("2026-10-30T00:10"))).toEqual({ date: "2026-10-31", heure: HEURE_MATIN });
  });

  test("fin de mois, fin d'année, 29 février, veille de changement d'heure", () => {
    expect(echeanceReportee("demain-matin", a("2026-10-31T22:00"))).toEqual({ date: "2026-11-01", heure: HEURE_MATIN });
    expect(echeanceReportee("demain-matin", a("2026-12-31T18:00"))).toEqual({ date: "2027-01-01", heure: HEURE_MATIN });
    expect(echeanceReportee("demain-matin", a("2028-02-28T08:00"))).toEqual({ date: "2028-02-29", heure: HEURE_MATIN });
    expect(echeanceReportee("demain-matin", a("2026-10-24T23:00"))).toEqual({ date: "2026-10-25", heure: HEURE_MATIN });
    expect(echeanceReportee("demain-matin", a("2026-03-28T23:00"))).toEqual({ date: "2026-03-29", heure: HEURE_MATIN });
  });
});

describe("Lundi", () => {
  test("le prochain lundi, d'un jour de semaine ou du week-end", () => {
    /* 30 octobre 2026 : un vendredi. */
    expect(echeanceReportee("lundi", a("2026-10-30T10:00"))).toEqual({ date: "2026-11-02", heure: HEURE_MATIN });
    expect(echeanceReportee("lundi", a("2026-10-27T10:00"))).toEqual({ date: "2026-11-02", heure: HEURE_MATIN });
    expect(echeanceReportee("lundi", a("2026-11-01T23:59"))).toEqual({ date: "2026-11-02", heure: HEURE_MATIN });
  });

  test("un lundi, même avant 9 h : le lundi de la semaine suivante", () => {
    expect(echeanceReportee("lundi", a("2026-11-02T07:00"))).toEqual({ date: "2026-11-09", heure: HEURE_MATIN });
    expect(echeanceReportee("lundi", a("2026-11-02T18:00"))).toEqual({ date: "2026-11-09", heure: HEURE_MATIN });
  });

  test("à cheval sur un mois, une année, un changement d'heure", () => {
    expect(echeanceReportee("lundi", a("2026-12-31T12:00"))).toEqual({ date: "2027-01-04", heure: HEURE_MATIN });
    expect(echeanceReportee("lundi", a("2026-10-24T12:00"))).toEqual({ date: "2026-10-26", heure: HEURE_MATIN });
    expect(echeanceReportee("lundi", a("2026-03-28T12:00"))).toEqual({ date: "2026-03-30", heure: HEURE_MATIN });
  });
});

describe("la nouvelle échéance est toujours dans le futur", () => {
  test("toutes les demi-heures d'une année, pour les trois reports", () => {
    const debut = Date.UTC(2026, 0, 1);
    for (let t = debut; t < debut + 366 * 86_400_000; t += 30 * 60_000 + 7_000) {
      const maintenant = new Date(t);
      for (const report of ["une-heure", "demain-matin", "lundi"] as const) {
        const e = echeanceReportee(report, maintenant);
        expect(new Date(`${e.date}T${e.heure}`).getTime(), `${report} depuis ${maintenant.toISOString()}`).toBeGreaterThan(t);
      }
    }
  });
});

describe("reporter un rappel", () => {
  test("le même rappel : texte, notes, catégorie, urgence, drapeau, état et création inchangés ; notification réarmée", () => {
    const avant = rappel();
    const apres = reporter(avant, "demain-matin", a("2026-10-30T14:00"));
    expect(apres).toEqual({ ...avant, date: "2026-10-31", heure: HEURE_MATIN, notifiee: false });
    expect(avant.date).toBe("2026-10-30");
  });

  test("en retard, sans date ou sans heure : il prend la nouvelle date et l'heure du report", () => {
    expect(reporter(rappel({ date: "2026-10-20", heure: "08:00" }), "une-heure", a("2026-10-30T14:00"))).toMatchObject({ date: "2026-10-30", heure: "15:00" });
    expect(reporter(rappel({ date: null, heure: null }), "lundi", a("2026-10-30T14:00"))).toMatchObject({ date: "2026-11-02", heure: HEURE_MATIN });
    expect(reporter(rappel({ heure: null }), "demain-matin", a("2026-10-30T14:00"))).toMatchObject({ date: "2026-10-31", heure: HEURE_MATIN });
  });

  test("une période garde sa durée ; sans date de départ, pas de fin", () => {
    expect(reporter(rappel({ date: "2026-10-28", fin: "2026-10-30" }), "lundi", a("2026-10-30T14:00"))).toMatchObject({ date: "2026-11-02", fin: "2026-11-04" });
    /* Trois jours à cheval sur le passage à l'heure d'hiver : toujours trois jours. */
    expect(reporter(rappel({ date: "2026-10-20", fin: "2026-10-23" }), "demain-matin", a("2026-10-23T20:00"))).toMatchObject({ date: "2026-10-24", fin: "2026-10-27" });
    expect(reporter(rappel({ date: null, fin: "2026-10-30" }), "lundi", a("2026-10-30T14:00"))).toMatchObject({ fin: null });
    expect(reporter(rappel({ fin: null }), "lundi", a("2026-10-30T14:00")).fin).toBeNull();
    expect("fin" in reporter(rappel(), "lundi", a("2026-10-30T14:00"))).toBe(false);
  });

  test("reporté plusieurs fois de suite : chaque report part de maintenant, jamais de l'ancienne échéance", () => {
    const maintenant = a("2026-10-30T14:00");
    let t = rappel();
    for (let i = 0; i < 5; i++) t = reporter(t, "une-heure", maintenant);
    expect(t).toMatchObject({ date: "2026-10-30", heure: "15:00", notifiee: false });
    t = reporter(t, "lundi", maintenant);
    t = reporter(t, "demain-matin", maintenant);
    expect(t).toMatchObject({ date: "2026-10-31", heure: HEURE_MATIN, titre: rappel().titre });
  });
});

describe("les reports proposés", () => {
  test("trois en semaine et le samedi ; deux le dimanche, où Lundi viserait le même jour que Demain matin", () => {
    expect(reportsProposes(a("2026-10-30T14:42"))).toEqual(["une-heure", "demain-matin", "lundi"]);
    expect(reportsProposes(a("2026-10-31T00:40"))).toEqual(["une-heure", "demain-matin", "lundi"]);
    expect(reportsProposes(a("2026-11-01T10:00"))).toEqual(["une-heure", "demain-matin"]);
    expect(reportsProposes(a("2026-11-01T23:59"))).toEqual(["une-heure", "demain-matin"]);
    expect(reportsProposes(a("2026-11-02T08:00"))).toEqual(["une-heure", "demain-matin", "lundi"]);
  });
});

describe("la cible écrite dans le menu", () => {
  test("le jour en clair, même demain, avec l'heure", () => {
    expect(libelleJourCourt("2026-10-31", HEURE_MATIN)).toBe("Sam. 31 oct., 09:00");
    expect(libelleJourCourt("2026-11-01", HEURE_MATIN)).toBe("Dim. 1 nov., 09:00");
    expect(libelleJourCourt("2026-11-02", null)).toBe("Lun. 2 nov.");
  });
});

describe("la garde : le rappel relu par son id au moment du clic", () => {
  test("supprimé ou coché entre-temps : rien à écrire, pas de rappel recréé", () => {
    const maintenant = a("2026-10-30T14:42");
    expect(reporterParId([], "t1", "demain-matin", maintenant)).toBeNull();
    expect(reporterParId([rappel({ id: "autre" })], "t1", "demain-matin", maintenant)).toBeNull();
    expect(reporterParId([rappel({ faite: true, faiteLe: "2026-10-30T13:00:00.000Z" })], "t1", "lundi", maintenant)).toBeNull();
  });

  test("toujours là : le même rappel, dans son état du moment (un titre changé entre-temps est gardé)", () => {
    const maintenant = a("2026-10-30T14:42");
    const actuel = rappel({ titre: "Relancer le devis, version corrigée" });
    expect(reporterParId([rappel({ id: "autre" }), actuel], "t1", "demain-matin", maintenant)).toEqual({
      ...actuel,
      date: "2026-10-31",
      heure: HEURE_MATIN,
      notifiee: false,
    });
  });

  test("cible identique : les mêmes valeurs réécrites, sans cas à part", () => {
    const t = rappel({ date: "2026-10-31", heure: HEURE_MATIN, notifiee: false });
    expect(reporterParId([t], "t1", "demain-matin", a("2026-10-30T14:42"))).toEqual(t);
  });
});
