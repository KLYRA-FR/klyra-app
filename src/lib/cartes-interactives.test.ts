import { describe, expect, it } from "vitest";
import type { Evenement, Message, MessagePart } from "@/types/domain";
import { messageCompte, lireParties } from "./copie-compte";
import { appelCarte, dateLisible, dureeLisible, lireCarte, manquantsCarte, occupations, reponseNette, texteReponse, valeurDepart, type Carte } from "./cartes-interactives";

const carte = (entree: Record<string, unknown>): Carte => {
  const r = lireCarte(entree);
  if (!("carte" in r)) throw new Error(r.refus);
  return r.carte;
};

const BRIEF = carte({
  genre: "formulaire",
  titre: "Le brief du site",
  champs: [
    { id: "client", libelle: "Client", type: "texte", requis: true, valeur: "Acme" },
    { libelle: "Budget", type: "curseur", min: 1000, max: 9000, pas: 500, unite: "€" },
    { libelle: "Pages", type: "multiple", options: ["Accueil", "Offre", "Contact"], valeur: ["Accueil", "Inconnue"] },
    { libelle: "Livraison", type: "date" },
    { libelle: "Ton", type: "choix", options: ["Sobre"] },
    { libelle: "Blog", type: "interrupteur" },
  ],
});

describe("lire une carte", () => {
  it("un formulaire : champs nettoyés, ids stables, valeurs pré-remplies valides seulement ; un choix sans deux réponses écarté", () => {
    expect(BRIEF.genre).toBe("formulaire");
    if (BRIEF.genre !== "formulaire") return;
    expect(BRIEF.champs.map((c) => c.id)).toEqual(["client", "champ2", "champ3", "champ4", "champ6"]);
    expect(BRIEF.champs[2].valeur).toEqual(["Accueil"]);
    expect(valeurDepart(BRIEF.champs[1])).toBe(5000);
    expect(valeurDepart(BRIEF.champs[4])).toBe(false);
  });

  it("une comparaison : 2 à 4 pistes, une seule recommandée", () => {
    const c = carte({ genre: "comparaison", titre: "Quelle piste ?", options: [{ titre: "A", recommandee: true }, { titre: "B", recommandee: true, pour: "Rapide" }, { titre: "" }] });
    if (c.genre !== "comparaison") throw new Error();
    expect(c.options.map((o) => [o.titre, o.recommandee, o.pour])).toEqual([
      ["A", true, []],
      ["B", false, ["Rapide"]],
    ]);
    expect(lireCarte({ genre: "comparaison", titre: "x", options: [{ titre: "A" }] })).toHaveProperty("refus");
  });

  it("une liste : cochée par défaut sauf coche: false ; des créneaux triés, valides et distincts", () => {
    const l = carte({ genre: "liste", titre: "Le plan", elements: ["Intro", { texte: "Annexe", coche: false }] });
    if (l.genre !== "liste") throw new Error();
    expect(l.elements.map((e) => e.coche)).toEqual([true, false]);
    const c = carte({ genre: "creneaux", titre: "Le point", creneaux: [{ date: "2026-11-12", heure: "14:00" }, { date: "2026-11-10", heure: "09:30", duree: 30 }, { date: "2026-11-12", heure: "14:00" }, { date: "demain", heure: "9h" }] });
    if (c.genre !== "creneaux") throw new Error();
    expect(c.creneaux).toEqual([
      { date: "2026-11-10", heure: "09:30", duree: 30 },
      { date: "2026-11-12", heure: "14:00", duree: 60 },
    ]);
  });

  it("refus : genre inconnu, titre absent ; l'outil répond ou refuse", () => {
    expect(lireCarte({ genre: "sondage", titre: "x" })).toHaveProperty("refus");
    expect(lireCarte({ genre: "liste", elements: ["a", "b"] })).toHaveProperty("refus");
    expect(appelCarte({ genre: "liste", titre: "Le plan", elements: ["a", "b"] })).toEqual({ texte: expect.stringContaining("Carte affichée"), erreur: false });
    expect(appelCarte({ genre: "formulaire", titre: "Vide", champs: [] }).erreur).toBe(true);
  });
});

describe("la réponse de la personne", () => {
  it("un formulaire : ce qui manque, puis le message lisible", () => {
    expect(manquantsCarte(BRIEF, { valeurs: {} })).toEqual(["Client"]);
    const r = { valeurs: { client: "Acme", champ2: 6500, champ3: ["Accueil", "Contact"], champ4: "2026-12-01", champ6: true } };
    expect(manquantsCarte(BRIEF, r)).toEqual([]);
    expect(texteReponse(BRIEF, r)).toBe("Le brief du site\n- Client : Acme\n- Budget : 6500 €\n- Pages : Accueil, Contact\n- Livraison : mardi 1er décembre\n- Blog : oui");
  });

  it("une comparaison, une liste, un créneau, avec un mot", () => {
    const c = carte({ genre: "comparaison", titre: "Quelle piste ?", options: [{ id: "a", titre: "Sobre" }, { id: "b", titre: "Audacieuse" }] });
    expect(manquantsCarte(c, {})).toEqual(["une piste"]);
    expect(texteReponse(c, { choix: "b", mot: " Mais plus de blanc. " })).toBe("Quelle piste ? : je choisis « Audacieuse ».\n\nMais plus de blanc.");
    const l = carte({ genre: "liste", titre: "Le plan", elements: [{ id: "i", texte: "Intro" }, { id: "c", texte: "Chiffres" }, { id: "a", texte: "Annexe" }] });
    expect(texteReponse(l, { coches: ["i", "a"] })).toBe("Le plan : 2 sur 3 gardés.\nGardés :\n- Intro\n- Annexe\nRetirés :\n- Chiffres");
    expect(reponseNette(l, { coches: ["a", "x", "i"] })).toEqual({ coches: ["i", "a"] });
    const cr = carte({ genre: "creneaux", titre: "Le point", creneaux: [{ date: "2026-11-10", heure: "09:30", duree: 90 }, { date: "2026-11-12", heure: "14:00" }] });
    expect(manquantsCarte(cr, {})).toEqual(["un créneau"]);
    expect(texteReponse(cr, { creneau: 0 })).toBe("Le point : le mardi 10 novembre à 09:30 (1 h 30).");
  });

  it("dates et durées lisibles", () => {
    expect(dateLisible("2026-11-05")).toBe("jeudi 5 novembre");
    expect(dureeLisible(45)).toBe("45 min");
    expect(dureeLisible(120)).toBe("2 h");
  });
});

describe("le planning de la personne face aux créneaux", () => {
  const ev = (e: Partial<Evenement>): Evenement => ({ id: e.titre ?? "e", titre: "Rendez-vous", date: "2026-11-12", debut: null, fin: null, notes: "", projectId: null, notifie: false, ...e }) as Evenement;
  it("chevauchement des heures, journée entière, rendez-vous de chaque semaine", () => {
    const c = { date: "2026-11-12", heure: "14:00", duree: 60 };
    expect(occupations(c, [ev({ titre: "Avant", debut: "13:00", fin: "14:00" })])).toHaveLength(0);
    expect(occupations(c, [ev({ titre: "Pendant", debut: "14:30", fin: "15:30" })])).toHaveLength(1);
    expect(occupations(c, [ev({ titre: "Journée" })])).toHaveLength(1);
    expect(occupations(c, [ev({ titre: "Hebdo", date: "2026-11-05", debut: "14:00", fin: "14:30", repete: true })])).toHaveLength(1);
    expect(occupations(c, [ev({ titre: "Autre jour", date: "2026-11-13", debut: "14:00" })])).toHaveLength(0);
  });
});

describe("la carte copiée pour le téléphone", () => {
  it("part avec ses textes, sans chemin ; une carte en cours d'écriture ne part pas", () => {
    const part = (extra: Partial<Extract<MessagePart, { type: "carte" }>> = {}): MessagePart => ({
      type: "carte",
      etapeId: "toolu_1",
      carte: carte({ genre: "liste", titre: "Les fichiers", elements: ["/Users/pelin/secret/plan.md", "Intro"] }),
      ...extra,
    });
    const m = (parts: MessagePart[]): Message => ({ id: "m", chatId: "dm-principal", author: { kind: "role", roleId: "principal" }, createdAt: "2026-11-05T10:00:00.000Z", parts });
    const [copie] = lireParties(messageCompte(m([part()])).parties);
    expect(copie).toMatchObject({ type: "carte", etapeId: "toolu_1" });
    expect(JSON.stringify(copie)).not.toContain("/Users/pelin");
    expect(lireParties(messageCompte(m([part({ provisoire: true })])).parties)).toEqual([]);
  });
});
