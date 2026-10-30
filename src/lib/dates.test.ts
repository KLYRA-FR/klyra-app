import { describe, expect, test } from "vitest";
import type { Tache } from "@/types/domain";
import type { ReportRapide } from "./dates";

/* Les règles se calculent en heure locale : on fixe le fuseau du poste (heure d'été et d'hiver en France),
   avant de charger le module, dont les formats de date retiennent le fuseau à leur création. */
process.env.TZ = "Europe/Paris";
const { cibleReport, HEURE_MATIN, libelleJourCourt, reporter, reportsProposes } = await import("./dates");

/** Une horloge fixée, en heure de Paris : « 2026-10-30T14:42 ». */
const a = (local: string) => new Date(local);

const rappel = (patch: Partial<Tache> = {}): Tache => ({
  id: "t1",
  titre: "Relancer le devis d’Approv’Halles",
  notes: "Voir le mail du 28",
  liste: "clients",
  date: "2026-10-29",
  heure: "14:00",
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
  test("maintenant sans les secondes, + 60 min, arrondi aux 5 min supérieures", () => {
    expect(cibleReport("heure", a("2026-10-30T14:42"))).toEqual({ date: "2026-10-30", heure: "15:45" });
    expect(cibleReport("heure", a("2026-10-30T14:42:59"))).toEqual({ date: "2026-10-30", heure: "15:45" });
    expect(cibleReport("heure", a("2026-10-30T14:40"))).toEqual({ date: "2026-10-30", heure: "15:40" });
    expect(cibleReport("heure", a("2026-10-30T14:40:30"))).toEqual({ date: "2026-10-30", heure: "15:40" });
    expect(cibleReport("heure", a("2026-10-30T14:41"))).toEqual({ date: "2026-10-30", heure: "15:45" });
  });

  test("près de minuit : le jour suit, fin de mois, fin d'année et 29 février compris", () => {
    expect(cibleReport("heure", a("2026-10-30T23:30"))).toEqual({ date: "2026-10-31", heure: "00:30" });
    expect(cibleReport("heure", a("2026-10-31T23:58"))).toEqual({ date: "2026-11-01", heure: "01:00" });
    expect(cibleReport("heure", a("2026-12-31T23:12"))).toEqual({ date: "2027-01-01", heure: "00:15" });
    expect(cibleReport("heure", a("2028-02-28T23:40"))).toEqual({ date: "2028-02-29", heure: "00:40" });
  });

  test("passage à l'heure d'été (29 mars 2026, 02:00 → 03:00) : une vraie heure plus tard", () => {
    expect(cibleReport("heure", a("2026-03-29T01:32"))).toEqual({ date: "2026-03-29", heure: "03:35" });
  });

  test("passage à l'heure d'hiver (25 octobre 2026, 03:00 → 02:00) : jamais une échéance déjà passée", () => {
    /* 01:32 (été) + 1 h → 02:35 (été), première occurrence : se relit à l'identique. */
    expect(cibleReport("heure", a("2026-10-25T01:32"))).toEqual({ date: "2026-10-25", heure: "02:35" });
    /* 02:32 (été) + 1 h → 02:35 (hiver), qui se relirait 02:35 (été), déjà passé : 03:00. */
    const ete = new Date(Date.UTC(2026, 9, 25, 0, 32));
    const e = cibleReport("heure", ete);
    expect(e).toEqual({ date: "2026-10-25", heure: "03:00" });
    expect(new Date(`${e.date}T${e.heure}`).getTime()).toBeGreaterThanOrEqual(ete.getTime() + 60 * 60_000);
  });
});

describe("Demain matin", () => {
  test(`le lendemain à ${HEURE_MATIN}, même la nuit (jour de calendrier)`, () => {
    expect(cibleReport("demain", a("2026-10-30T14:42"))).toEqual({ date: "2026-10-31", heure: HEURE_MATIN });
    /* 00:40 dans la nuit de vendredi à samedi : on est samedi 31, demain est dimanche 1er. */
    expect(cibleReport("demain", a("2026-10-31T00:40"))).toEqual({ date: "2026-11-01", heure: HEURE_MATIN });
  });

  test("fin de mois, fin d'année, 29 février, veilles de changement d'heure", () => {
    expect(cibleReport("demain", a("2026-12-31T18:00"))).toEqual({ date: "2027-01-01", heure: HEURE_MATIN });
    expect(cibleReport("demain", a("2028-02-28T08:00"))).toEqual({ date: "2028-02-29", heure: HEURE_MATIN });
    expect(cibleReport("demain", a("2026-10-24T23:00"))).toEqual({ date: "2026-10-25", heure: HEURE_MATIN });
    expect(cibleReport("demain", a("2026-03-28T23:00"))).toEqual({ date: "2026-03-29", heure: HEURE_MATIN });
  });
});

describe("Lundi", () => {
  test("le prochain lundi, d'un vendredi, d'un mardi, d'un samedi", () => {
    expect(cibleReport("lundi", a("2026-10-30T14:42"))).toEqual({ date: "2026-11-02", heure: HEURE_MATIN });
    expect(cibleReport("lundi", a("2026-10-27T10:00"))).toEqual({ date: "2026-11-02", heure: HEURE_MATIN });
    expect(cibleReport("lundi", a("2026-10-31T23:59"))).toEqual({ date: "2026-11-02", heure: HEURE_MATIN });
  });

  test("un lundi, même avant 9 h : le lundi suivant (+7)", () => {
    expect(cibleReport("lundi", a("2026-11-02T07:00"))).toEqual({ date: "2026-11-09", heure: HEURE_MATIN });
    expect(cibleReport("lundi", a("2026-11-02T18:00"))).toEqual({ date: "2026-11-09", heure: HEURE_MATIN });
  });

  test("à cheval sur un mois, une année, un changement d'heure", () => {
    expect(cibleReport("lundi", a("2026-12-31T12:00"))).toEqual({ date: "2027-01-04", heure: HEURE_MATIN });
    expect(cibleReport("lundi", a("2026-10-24T12:00"))).toEqual({ date: "2026-10-26", heure: HEURE_MATIN });
    expect(cibleReport("lundi", a("2026-03-28T12:00"))).toEqual({ date: "2026-03-30", heure: HEURE_MATIN });
  });
});

describe("les reports proposés", () => {
  test("trois en semaine et le samedi, deux le dimanche (Lundi = Demain matin)", () => {
    expect(reportsProposes(a("2026-10-30T14:42"))).toEqual(["heure", "demain", "lundi"]);
    expect(reportsProposes(a("2026-10-31T10:00"))).toEqual(["heure", "demain", "lundi"]);
    expect(reportsProposes(a("2026-11-01T10:00"))).toEqual(["heure", "demain"]);
    expect(reportsProposes(a("2026-11-02T10:00"))).toEqual(["heure", "demain", "lundi"]);
  });
});

describe("la cible est toujours dans le futur", () => {
  test("toutes les demi-heures d'une année, pour les trois choix", () => {
    const debut = Date.UTC(2026, 0, 1);
    for (let t = debut; t < debut + 366 * 86_400_000; t += 30 * 60_000 + 7_000) {
      const maintenant = new Date(t);
      for (const choix of ["heure", "demain", "lundi"] as ReportRapide[]) {
        const e = cibleReport(choix, maintenant);
        expect(new Date(`${e.date}T${e.heure}`).getTime(), `${choix} depuis ${maintenant.toISOString()}`).toBeGreaterThan(t);
      }
    }
  });
});

describe("le libellé du jour en clair", () => {
  test("le jour écrit, même demain, avec l'heure", () => {
    expect(libelleJourCourt("2026-10-31", HEURE_MATIN)).toBe("Sam. 31 oct., 09:00");
    expect(libelleJourCourt("2026-11-02", null)).toBe("Lun. 2 nov.");
  });
});

describe("reporter un rappel", () => {
  test("le même rappel : seuls la date, l'heure et la notification changent", () => {
    const avant = rappel();
    const apres = reporter(avant, "demain", a("2026-10-30T14:42"));
    expect(apres).toEqual({ ...avant, date: "2026-10-31", heure: HEURE_MATIN, notifiee: false });
    expect(avant).toEqual(rappel());
  });

  test("en retard, sans date ou toute la journée : une date et une heure sont posées", () => {
    expect(reporter(rappel({ date: "2026-10-20", heure: "08:00" }), "heure", a("2026-10-30T14:42"))).toMatchObject({ date: "2026-10-30", heure: "15:45" });
    expect(reporter(rappel({ date: null, heure: null }), "lundi", a("2026-10-30T14:42"))).toMatchObject({ date: "2026-11-02", heure: HEURE_MATIN });
    expect(reporter(rappel({ heure: null }), "demain", a("2026-10-30T14:42"))).toMatchObject({ date: "2026-10-31", heure: HEURE_MATIN });
  });

  test("une période est décalée en bloc et garde sa durée", () => {
    /* « Du 22 au 25 oct. » → Lundi → « Lun. 2 nov., 09:00 → Jeu. 5 nov. ». */
    expect(reporter(rappel({ date: "2026-10-22", heure: null, fin: "2026-10-25" }), "lundi", a("2026-10-30T14:42"))).toMatchObject({
      date: "2026-11-02",
      heure: HEURE_MATIN,
      fin: "2026-11-05",
    });
    /* À cheval sur le passage à l'heure d'hiver : toujours trois jours. */
    expect(reporter(rappel({ date: "2026-10-20", fin: "2026-10-23" }), "demain", a("2026-10-23T20:00"))).toMatchObject({ date: "2026-10-24", fin: "2026-10-27" });
    expect(reporter(rappel({ date: null, fin: "2026-10-30" }), "lundi", a("2026-10-30T14:42"))).toMatchObject({ fin: null });
    expect(reporter(rappel({ fin: null }), "lundi", a("2026-10-30T14:42"))!.fin).toBeNull();
    expect("fin" in reporter(rappel(), "lundi", a("2026-10-30T14:42"))!).toBe(false);
  });

  test("la cible est déjà son échéance : rien à écrire", () => {
    expect(reporter(rappel({ date: "2026-10-31", heure: HEURE_MATIN }), "demain", a("2026-10-30T14:42"))).toBeNull();
    expect(reporter(rappel({ date: "2026-10-30", heure: "15:45" }), "heure", a("2026-10-30T14:42"))).toBeNull();
  });

  test("reporté plusieurs fois de suite : chaque report part de maintenant, jamais de l'ancienne échéance", () => {
    const maintenant = a("2026-10-30T14:42");
    let t: Tache = rappel();
    for (let i = 0; i < 5; i++) t = reporter(t, "heure", maintenant) ?? t;
    expect(t).toMatchObject({ date: "2026-10-30", heure: "15:45", notifiee: false });
    t = reporter(t, "lundi", maintenant)!;
    t = reporter(t, "demain", maintenant)!;
    expect(t).toEqual({ ...rappel(), date: "2026-10-31", heure: HEURE_MATIN, notifiee: false });
  });
});
