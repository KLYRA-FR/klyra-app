import { describe, expect, test } from "vitest";
import type { Categorie, Tache } from "@/types/domain";

/* Les règles se calculent en heure locale : on fixe le fuseau (heure d'hiver en France depuis le 25 octobre 2026)
   avant de charger les modules, dont les formats de date retiennent le fuseau à leur création. */
process.env.TZ = "Europe/Paris";
const {
  ajouterJours,
  cibleReport,
  decaler,
  depuisCompte,
  depuisPoste,
  fenetreAgenda,
  grilleDuMois,
  joursDeLaSemaine,
  joursOccupes,
  lundiDe,
  placerDepart,
  rappelsDuJour,
  regrouperParJour,
  reportCompte,
  sectionsRappels,
  trierJour,
  trierRappels,
} = await import("./planning");
type RappelTelephone = import("./planning").RappelTelephone;

const MOI = "membre-moi";
const LEA = "membre-lea";

const rappel = (patch: Partial<RappelTelephone> = {}): RappelTelephone => ({
  id: "r1",
  source: "compte",
  titre: "Relancer le devis",
  notes: "",
  jour: null,
  heure: null,
  fin: null,
  priorite: 0,
  faite: false,
  liste: null,
  retard: false,
  createur: true,
  assigneAMoi: true,
  recu: false,
  autre: null,
  assigneA: MOI,
  ...patch,
});

const tache = (patch: Partial<Tache> = {}): Tache => ({
  id: "t1",
  titre: "Appeler l’école",
  notes: "",
  liste: "perso",
  date: "2026-11-02",
  heure: "10:00",
  fin: null,
  priorite: 1,
  signalee: false,
  faite: false,
  faiteLe: null,
  projectId: null,
  creeLe: "2026-10-20T08:00:00.000Z",
  notifiee: false,
  ...patch,
});

const CATEGORIES: Categorie[] = [
  { id: "perso", nom: "Perso", teinte: "violet", icone: "home-01" },
  { id: "clients", nom: "Clients", teinte: "bleu-k2", icone: "users-profiles-01" },
];

describe("jours et semaines", () => {
  test("le lundi d'un jour, dimanche compris, à cheval sur deux mois", () => {
    expect(lundiDe("2026-11-02")).toBe("2026-11-02");
    expect(lundiDe("2026-11-01")).toBe("2026-10-26");
    expect(lundiDe("2026-11-05")).toBe("2026-11-02");
    expect(ajouterJours("2026-12-31", 1)).toBe("2027-01-01");
  });

  test("la bande de 7 jours part du lundi", () => {
    expect(joursDeLaSemaine("2026-10-29")).toEqual(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31", "2026-11-01"]);
  });

  test("‹ et › : une semaine en jour et en semaine, un mois en mois (jour ramené à la fin d'un mois court)", () => {
    expect(decaler("2026-11-02", "jour", 1)).toBe("2026-11-09");
    expect(decaler("2026-11-02", "semaine", -1)).toBe("2026-10-26");
    expect(decaler("2026-11-15", "mois", 1)).toBe("2026-12-15");
    expect(decaler("2027-01-31", "mois", 1)).toBe("2027-02-28");
    expect(decaler("2028-03-31", "mois", -1)).toBe("2028-02-29");
    expect(decaler("2026-01-15", "mois", -1)).toBe("2025-12-15");
  });
});

describe("fenêtre lue dans le compte", () => {
  test("jour et semaine : la semaine du jour choisi, fin exclue", () => {
    const fenetre = fenetreAgenda("jour", "2026-11-04");
    expect(fenetre).toEqual({ debut: "2026-11-02", fin: "2026-11-09", finMs: new Date(2026, 10, 9).getTime() });
    expect(fenetreAgenda("semaine", "2026-11-04")).toEqual(fenetre);
  });

  test("mois : les 42 jours de la grille (novembre 2026 commence un dimanche)", () => {
    expect(fenetreAgenda("mois", "2026-11-18")).toEqual({ debut: "2026-10-26", fin: "2026-12-07", finMs: new Date(2026, 11, 7).getTime() });
  });
});

describe("grille du mois", () => {
  test("42 cases, lundi d'abord, les jours du bord marqués hors du mois, un point par jour occupé", () => {
    const cases = grilleDuMois("2026-11-18", new Set(["2026-11-03", "2026-10-30"]));
    expect(cases).toHaveLength(42);
    expect(cases[0]).toEqual({ cle: "2026-10-26", numero: 26, dansLeMois: false, occupe: false });
    expect(cases[4]).toEqual({ cle: "2026-10-30", numero: 30, dansLeMois: false, occupe: true });
    expect(cases[6]).toEqual({ cle: "2026-11-01", numero: 1, dansLeMois: true, occupe: false });
    expect(cases[8]).toMatchObject({ cle: "2026-11-03", occupe: true });
    expect(cases[41]).toMatchObject({ cle: "2026-12-06", dansLeMois: false });
    expect(cases.filter((c) => c.dansLeMois)).toHaveLength(30);
  });

  test("février d'une année bissextile qui commence un lundi", () => {
    const cases = grilleDuMois("2027-02-10", new Set());
    expect(cases[0].cle).toBe("2027-02-01");
    expect(cases.filter((c) => c.dansLeMois).map((c) => c.numero).at(-1)).toBe(28);
    expect(grilleDuMois("2028-02-10", new Set()).filter((c) => c.dansLeMois)).toHaveLength(29);
  });

  test("jours occupés : chaque événement, chaque jour d'un rappel à faire ; ni les terminés ni les sans date", () => {
    const occupes = joursOccupes(
      [{ jour: "2026-11-03" }, { jour: "2026-11-03" }],
      [
        { jour: "2026-11-05", fin: "2026-11-07", faite: false },
        { jour: "2026-11-10", fin: null, faite: true },
        { jour: null, fin: null, faite: false },
        { jour: "2026-11-12", fin: "2026-11-11", faite: false },
      ],
    );
    expect([...occupes].sort()).toEqual(["2026-11-03", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-12"]);
  });
});

describe("liste du jour et de la semaine", () => {
  const el = (jour: string, debut: string | null, titre: string) => ({ jour, debut, titre });

  test("toute la journée d'abord, puis dans l'ordre des heures ; l'ordre reçu à égalité", () => {
    const tries = trierJour([el("2026-11-02", "14:00", "Démo"), el("2026-11-02", "09:30", "Point"), el("2026-11-02", null, "Férié"), el("2026-11-02", "09:30", "Routine")]);
    expect(tries.map((e) => e.titre)).toEqual(["Férié", "Point", "Routine", "Démo"]);
  });

  test("groupée par jour : chaque jour demandé, même vide, dans l'ordre ; le reste est écarté", () => {
    const jours = joursDeLaSemaine("2026-11-02");
    const groupes = regrouperParJour(
      [el("2026-11-04", "14:00", "Démo"), el("2026-11-02", "09:00", "Weekly"), el("2026-11-04", "08:00", "Café"), el("2026-11-12", "10:00", "Plus tard")],
      jours,
    );
    expect(groupes.map((g) => g.cle)).toEqual(jours);
    expect(groupes[0].elements.map((e) => e.titre)).toEqual(["Weekly"]);
    expect(groupes[1].elements).toEqual([]);
    expect(groupes[2].elements.map((e) => e.titre)).toEqual(["Café", "Démo"]);
    expect(groupes.flatMap((g) => g.elements)).toHaveLength(3);
  });

  test("un départ de routine (instant UTC) se pose à son jour et son heure locaux", () => {
    expect(placerDepart("2026-11-02T08:30:00.000Z")).toEqual({ jour: "2026-11-02", debut: "09:30" });
    expect(placerDepart("2026-11-01T23:15:00.000Z")).toEqual({ jour: "2026-11-02", debut: "00:15" });
    expect(placerDepart("pas une date")).toBeNull();
  });
});

describe("À faire du jour", () => {
  const liste = [
    rappel({ id: "periode", jour: "2026-10-31", fin: "2026-11-03" }),
    rappel({ id: "retard", jour: "2026-10-28", heure: "09:00", priorite: 2 }),
    rappel({ id: "fait-hier", jour: "2026-11-01", faite: true }),
    rappel({ id: "fait-ce-jour", jour: "2026-11-02", faite: true }),
    rappel({ id: "heure", jour: "2026-11-02", heure: "08:00" }),
    rappel({ id: "demain", jour: "2026-11-03" }),
    rappel({ id: "sans-date" }),
  ];

  test("aujourd'hui : la période qui couvre le jour, ceux en retard d'avant, les terminés du jour barrés", () => {
    expect(rappelsDuJour(liste, "2026-11-02", "2026-11-02").map((r) => r.id)).toEqual(["retard", "periode", "heure", "fait-ce-jour"]);
  });

  test("un autre jour : seulement ce qui tombe ce jour-là", () => {
    expect(rappelsDuJour(liste, "2026-11-03", "2026-11-02").map((r) => r.id)).toEqual(["periode", "demain"]);
  });

  test("tri des rappels : datés d'abord par échéance (sans heure en fin de journée), puis l'urgence", () => {
    const tries = trierRappels([
      rappel({ id: "a", jour: "2026-11-02" }),
      rappel({ id: "b" }),
      rappel({ id: "c", jour: "2026-11-02", heure: "18:00" }),
      rappel({ id: "d", jour: "2026-11-02", priorite: 3 }),
      rappel({ id: "e", jour: "2026-11-01" }),
    ]);
    expect(tries.map((r) => r.id)).toEqual(["e", "c", "d", "a", "b"]);
  });
});

describe("rappels du compte et de l'ordinateur", () => {
  const duCompte = (patch: Partial<Parameters<typeof depuisCompte>[0]> = {}) => ({
    _id: "c1",
    titre: "Préparer la démo",
    notes: "",
    jour: "2026-11-02",
    heure: null,
    fin: null,
    creePar: MOI,
    assigneA: MOI,
    statut: "a_faire" as const,
    priorite: 0 as const,
    liste: "clients",
    ...patch,
  });

  test("du compte : droits, autre personne et retard du serveur", () => {
    expect(depuisCompte(duCompte(), MOI)).toMatchObject({ source: "compte", createur: true, assigneAMoi: true, recu: false, autre: null, faite: false });
    expect(depuisCompte(duCompte({ assigneA: LEA }), MOI)).toMatchObject({ createur: true, assigneAMoi: false, autre: LEA, assigneA: LEA });
    expect(depuisCompte(duCompte({ creePar: LEA, statut: "en_retard" }), MOI)).toMatchObject({ createur: false, recu: true, autre: LEA, retard: true });
    expect(depuisCompte(duCompte({ statut: "fait" }), MOI).faite).toBe(true);
  });

  test("de l'ordinateur : sans date ni heure ni fin incohérentes, en retard selon la règle du bureau", () => {
    expect(depuisPoste(tache({ date: null, heure: "10:00" }))).toMatchObject({ source: "poste", jour: null, heure: null, fin: null, retard: false, createur: true });
    expect(depuisPoste(tache({ date: "2026-11-02", fin: "2026-11-01" })).fin).toBeNull();
    expect(depuisPoste(tache({ date: "2020-01-01", heure: null })).retard).toBe(true);
    expect(depuisPoste(tache({ date: "2020-01-01", faite: true })).retard).toBe(false);
  });
});

describe("sections de T-06", () => {
  const mes = [
    rappel({ id: "perso", liste: "perso", jour: "2026-11-03" }),
    rappel({ id: "client", liste: "clients" }),
    rappel({ id: "inconnue", liste: "supprimee" }),
    rappel({ id: "sans", liste: null }),
    rappel({ id: "recu", liste: null, createur: false, recu: true, autre: LEA }),
    rappel({ id: "recu-range", liste: "clients", createur: false, recu: true, autre: LEA }),
    rappel({ id: "fait", liste: "perso", faite: true }),
  ];
  const assignes = [rappel({ id: "pour-lea", assigneA: LEA, assigneAMoi: false, autre: LEA })];

  test("une section par catégorie (inconnue ou sans catégorie : la première), puis assignés, puis reçus", () => {
    const sections = sectionsRappels({ mes, assignes, categories: CATEGORIES, voirFaits: false });
    expect(sections.map((s) => [s.id, s.groupe, s.titre])).toEqual([
      ["perso", "mes", "Perso"],
      ["clients", "mes", "Clients"],
      ["assignes", "assignes", "Ceux que j’ai assignés"],
      ["recus", "recus", "Assignés par l’équipe"],
    ]);
    expect(sections[0].rappels.map((r) => r.id)).toEqual(["perso", "inconnue", "sans"]);
    expect(sections[0].aFaire).toBe(3);
    expect(sections[1].rappels.map((r) => r.id)).toEqual(["client", "recu-range"]);
    expect(sections[2].rappels.map((r) => r.id)).toEqual(["pour-lea"]);
    expect(sections[3].rappels.map((r) => r.id)).toEqual(["recu"]);
  });

  test("les terminés : masqués, sauf ceux cochés à l'instant ; tous avec « Afficher les terminés »", () => {
    expect(sectionsRappels({ mes, assignes: [], categories: CATEGORIES, voirFaits: false, gardes: new Set(["fait"]) })[0].rappels.map((r) => r.id)).toContain("fait");
    expect(sectionsRappels({ mes, assignes: [], categories: CATEGORIES, voirFaits: true })[0].rappels.map((r) => r.id)).toContain("fait");
    expect(sectionsRappels({ mes, assignes: [], categories: CATEGORIES, voirFaits: false })[0].rappels.map((r) => r.id)).not.toContain("fait");
  });

  test("ordinateur fermé (catégories inconnues) : une seule section « Mes rappels » ; rien de vide", () => {
    const sections = sectionsRappels({ mes, assignes: [], categories: null, voirFaits: false });
    expect(sections.map((s) => s.id)).toEqual(["mes", "recus"]);
    expect(sections[0].titre).toBe("Mes rappels");
    expect(sections[0].rappels.map((r) => r.id)).toEqual(["perso", "client", "inconnue", "sans"]);
    expect(sections[1].rappels.map((r) => r.id)).toEqual(["recu", "recu-range"]);
    expect(sectionsRappels({ mes: [], assignes: [], categories: null, voirFaits: false })).toEqual([]);
    expect(sectionsRappels({ mes: [], assignes: [], categories: CATEGORIES, voirFaits: false }).map((s) => s.rappels.length)).toEqual([0, 0]);
  });
});

describe("reporter un rappel du compte", () => {
  const a = (local: string) => new Date(local);

  test("Demain matin et Lundi, avec l'instant du retard recalculé dans ce fuseau", () => {
    expect(reportCompte({ jour: "2026-10-30", heure: "10:00", fin: null }, "demain-matin", a("2026-10-30T14:12"))).toEqual({
      jour: "2026-10-31",
      heure: "09:00",
      fin: null,
      echeance: new Date("2026-10-31T09:00").getTime(),
    });
    expect(reportCompte({ jour: null, heure: null, fin: null }, "lundi", a("2026-10-30T14:12"))).toMatchObject({ jour: "2026-11-02", heure: "09:00" });
  });

  test("Dans 1 h, à la minute supérieure, le jour suit", () => {
    expect(reportCompte({ jour: "2026-10-30", heure: null, fin: null }, "une-heure", a("2026-10-30T23:30:20"))).toMatchObject({ jour: "2026-10-31", heure: "00:31" });
  });

  test("une période garde sa durée ; une fin incohérente est retirée", () => {
    expect(reportCompte({ jour: "2026-10-28", heure: null, fin: "2026-10-30" }, "lundi", a("2026-10-30T14:00"))).toEqual({
      jour: "2026-11-02",
      heure: "09:00",
      fin: "2026-11-04",
      echeance: new Date("2026-11-02T09:00").getTime(),
    });
    expect(reportCompte({ jour: "2026-10-28", heure: null, fin: "2026-10-27" }, "demain-matin", a("2026-10-30T14:00")).fin).toBeNull();
  });

  test("la cible écrite dans la feuille, comme au bureau", () => {
    expect(cibleReport("demain-matin", a("2026-10-30T14:12"))).toBe("Sam. 31 oct., 09:00");
    expect(cibleReport("lundi", a("2026-10-30T14:12"))).toBe("Lun. 2 nov., 09:00");
  });
});
