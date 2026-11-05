import { describe, expect, test } from "vitest";
import { ilYa, jourCourt, libelleFini, ligneTravail, projetModifie, quandLisible, statutTravail, texteLisible, travailFiche, travauxDuJournal, TRAVAUX_MAX, type JournalTravaux, type ProjectionJournal } from "./fiche-projet";

const a = (j: number, h = 0, m = 0) => new Date(2026, 10, j, h, m).toISOString();
const maintenant = new Date(2026, 10, 5, 13, 0).getTime();

const projection: ProjectionJournal = {
  travaux: [{ work_id: "w1", fil_id: "c1", titre: "Arrondi de la TVA", owner_agent_id: "dev", status: "blocked", deadline_at: a(6), last_progress_at: a(5, 11), couts: [{ unite: "usd", total: 0.84 }] }],
  alertes: [{ work_id: "w1", type: "bloque", motif: "Travail bloqué, sans résolution plus récente.", prochain_geste: "Lire l'état du fil et décider. Le watchdog ne relance pas." }],
  evenements: [{ event_id: "e1", work_id: "w1", type: "fin_verification", resume: "Les tests passent dans /Users/moi/site/devis/tva.ts pour klyra-fil-1a2b." }],
  couverture: "ok",
};
const preuves = { operations: [{ status: "succeeded" }, { status: "succeeded" }, { status: "planned" }], checkpoints: [{ observed_at: a(5, 10, 47) }] };

describe("un travail lu dans le journal", () => {
  const travail = travailFiche(projection.travaux[0], 0, projection, preuves, (id) => (id === "dev" ? "Léon" : null));

  test("statut lisible, responsable par son nom, coût mesuré, dernière nouvelle", () => {
    expect(travail).toMatchObject({ titre: "Arrondi de la TVA", statut: "Bloqué", ton: "orange", agent: "Léon", cout: "0,84 $", filId: "c1", derniereNouvelle: a(5, 11) });
  });

  test("le suivi : alerte et prochain geste, vérification, preuves comptées ; sans moteur, chemin ni identifiant", () => {
    expect(travail.suivi.map((s) => s.genre)).toEqual(["alerte", "verification", "preuves"]);
    expect(travail.suivi[0]).toMatchObject({ texte: "À surveiller : travail bloqué, sans résolution plus récente.", detail: "Prochain geste : lire l'état du fil et décider." });
    expect(travail.suivi[1].texte).toBe("Vérification : les tests passent dans un fichier pour ce fil.");
    expect(travail.suivi[2]).toMatchObject({ texte: "Preuves : 2 opérations constatées, 1 point de contrôle.", quand: a(5, 10, 47) });
    const tout = JSON.stringify(travail);
    expect(tout).not.toMatch(/w1|watchdog|\/Users|klyra-fil/);
  });

  test("ce qui manque reste absent : ni coût, ni responsable, ni preuve inventés", () => {
    const seul = travailFiche({ work_id: "w2", fil_id: null, titre: "", owner_agent_id: "parti", status: "active", deadline_at: null }, 1, { ...projection, alertes: [], evenements: [] }, null, () => null);
    expect(seul).toMatchObject({ titre: "Sans titre", agent: null, cout: null, derniereNouvelle: null, alerte: null, suivi: [], filId: null });
  });

  test("un statut inconnu reste « Inconnu », jamais son nom interne", () => {
    expect(statutTravail("etat_futur")).toEqual({ libelle: "Inconnu", ton: "neutre" });
  });

  test("texteLisible retire les chemins, y compris Windows", () => {
    expect(texteLisible("Voir C:\\Users\\moi\\a.txt et ~/site/b.md")).toBe("Voir un fichier et un fichier");
  });
});

describe("lire le journal", () => {
  const journal = (data: ProjectionJournal): JournalTravaux => ({ projection: async () => ({ ok: true, data }), preuves: async () => ({ ok: true, data: preuves }) });

  test("au-delà du plafond, le reste est compté, pas caché", async () => {
    const lignes = Array.from({ length: TRAVAUX_MAX + 3 }, (_, i) => ({ ...projection.travaux[0], work_id: `w${i}` }));
    const lu = await travauxDuJournal(journal({ ...projection, travaux: lignes }), "p", "ton Mac");
    expect(lu).toMatchObject({ etat: "ok", coupes: 3 });
    expect(lu.etat === "ok" && lu.liste).toHaveLength(TRAVAUX_MAX);
  });

  test("une erreur de lecture ou une preuve qui échoue ne casse pas la liste", async () => {
    const lu = await travauxDuJournal({ projection: journal(projection).projection, preuves: async () => { throw new Error("non"); } }, "p", "ton Mac");
    expect(lu).toMatchObject({ etat: "ok", liste: [{ titre: "Arrondi de la TVA" }] });
    await expect(travauxDuJournal({ projection: async () => { throw new Error("non"); }, preuves: journal(projection).preuves }, "p", "ton Mac")).resolves.toMatchObject({ etat: "indisponible", raison: "Le journal des travaux n’a pas pu être lu sur ton Mac." });
    await expect(travauxDuJournal(null, "p", "ton Mac")).resolves.toMatchObject({ etat: "indisponible" });
  });
});

describe("les dates et la ligne d'un travail", () => {
  test("jourCourt, ilYa, quandLisible, libelleFini ; une date illisible ne s'invente pas", () => {
    expect(jourCourt(a(6))).toBe("ven. 6 nov.");
    expect(ilYa(a(5, 11), maintenant)).toBe("il y a 2 h");
    expect(ilYa(a(5, 12, 55), maintenant)).toBe("il y a 5 min");
    expect(ilYa(a(2), maintenant)).toBe("lun. 2 nov.");
    expect(quandLisible(a(5, 11, 2), maintenant)).toBe("Aujourd’hui, 11:02");
    expect(quandLisible(a(4, 17, 40), maintenant)).toBe("Hier, 17:40");
    expect(libelleFini(a(4, 17, 40), maintenant)).toBe("fini hier à 17:40");
    expect(libelleFini(a(5, 9, 5), maintenant)).toBe("fini à 09:05");
    expect(jourCourt("pas une date")).toBeNull();
    expect(ilYa(null, maintenant)).toBeNull();
  });

  const t = { cle: "0", titre: "T", statut: "En cours", ton: "bleue" as const, agent: "Maëlle", echeance: a(6), derniereNouvelle: a(4, 17, 40), fini: false, cout: null, alerte: null, filId: null, suivi: [] };
  test("l'alerte passe avant la fin et l'échéance", () => {
    expect(ligneTravail(t, maintenant)).toBe("Maëlle · échéance ven. 6 nov.");
    expect(ligneTravail({ ...t, fini: true }, maintenant)).toBe("Maëlle · fini hier à 17:40");
    expect(ligneTravail({ ...t, alerte: "Sans nouvelles depuis 2 h" }, maintenant)).toBe("Maëlle · à surveiller : sans nouvelles depuis 2 h");
    expect(ligneTravail({ ...t, agent: null, echeance: null }, maintenant)).toBe("");
  });
});

describe("Modifier", () => {
  const initial = { nom: "A", accroche: "B", brief: "C", statut: "en-cours" as const, epingle: false };
  test("inchangé : rien à enregistrer ; un seul champ changé suffit", () => {
    expect(projetModifie(initial, { ...initial })).toBe(false);
    expect(projetModifie(initial, { ...initial, epingle: true })).toBe(true);
    expect(projetModifie(initial, { ...initial, brief: "C " })).toBe(true);
  });
});
