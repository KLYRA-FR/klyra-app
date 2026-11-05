import { describe, expect, test } from "vitest";
import { agentDeLaBibliotheque, classerActifs, competencesCarte, libelleRetour, seriesUtilisation, syntheseUtilisation, listeMesAgents, nonLusAgent, roleLisible, tagLisible, teinteSure, texteConversations, texteErreurFiche } from "./agents";

const cartes = [
  { origine: "dev", nom: "Hugo", teinte: "vert", roleCourt: "Dev", actif: true },
  { origine: "principal", nom: "Léa", teinte: "rose", roleCourt: "Assistant", actif: true },
  { origine: "design", nom: "Iris", teinte: "violet", roleCourt: "Design", actif: true },
  { origine: "mails", nom: "Val", teinte: "inconnue", roleCourt: "Mails", actif: false },
];
const conversations = [{ roleIds: ["principal"] }, { roleIds: ["dev"] }, { roleIds: ["dev", "design"] }];

describe("Mes agents sur le téléphone (T-08)", () => {
  test("l'assistant d'abord, puis les actifs par nom, puis « Hors de Mes agents »", () => {
    const { assistant, actifs, hors } = listeMesAgents(cartes, conversations);
    expect(assistant).toMatchObject({ id: "principal", nom: "Léa", teinte: "rose", conversations: 1 });
    expect(actifs.map((a) => a.nom)).toEqual(["Hugo", "Iris"]);
    expect(actifs.map((a) => a.conversations)).toEqual([2, 1]);
    expect(hors).toMatchObject([{ id: "mails", nom: "Val", actif: false, conversations: 0 }]);
  });

  test("sans carte de l'assistant (ordinateur d'avant cette version) : son nom par défaut", () => {
    const { assistant } = listeMesAgents(cartes.filter((c) => c.origine !== "principal"), conversations);
    expect(assistant).toMatchObject({ id: "principal", nom: "Assistant", actif: true });
  });

  test("une teinte inconnue ne casse pas le visuel", () => {
    expect(teinteSure("inconnue")).toBe("bleu-k2");
    expect(teinteSure("vert")).toBe("vert");
    expect(listeMesAgents(cartes, []).hors[0].teinte).toBe("bleu-k2");
  });

  test("les mots des lignes", () => {
    expect(texteConversations(0)).toBe("Aucune conversation");
    expect(texteConversations(1)).toBe("1 conversation");
    expect(texteConversations(12)).toBe("12 conversations");
    expect(libelleRetour({ id: "mails", statut: "desactive", desactiveLe: 1, definitionId: null, modele: null })).toBe("Réactiver");
    expect(libelleRetour({ id: "mails", statut: "disponible", desactiveLe: null, definitionId: null, modele: null })).toBe("Ajouter à mes agents");
    expect(libelleRetour(undefined)).toBe("Ajouter à mes agents");
  });

  test("le conflit de la fiche est dit avec le nom du poste", () => {
    expect(texteErreurFiche("conflit", "", "ton PC")).toBe("La fiche a changé sur ton PC depuis son ouverture");
    expect(texteErreurFiche("invalide", "Donne-lui un nom.", "ton Mac")).toBe("Donne-lui un nom.");
  });

  test("retrouver l'agent d'une définition ou d'un modèle", () => {
    const etats = [
      { id: "juriste-2", statut: "actif" as const, desactiveLe: null, definitionId: "d1", modele: null },
      { id: "prompty", statut: "desactive" as const, desactiveLe: 1, definitionId: null, modele: "prompty" },
    ];
    expect(agentDeLaBibliotheque(etats, { definitionId: "d1" })?.id).toBe("juriste-2");
    expect(agentDeLaBibliotheque(etats, { modele: "prompty" })?.statut).toBe("desactive");
    expect(agentDeLaBibliotheque(undefined, { modele: "prompty" })).toBeNull();
  });
});

describe("cartes du lot 5", () => {
  const hugo = { id: "dev", nom: "Hugo" };
  const iris = { id: "design", nom: "Iris" };

  test("sans préférences lues, personne n'est masqué", () => {
    expect(classerActifs([hugo, iris], null)).toEqual({ visibles: [hugo, iris], masques: [] });
  });

  test("un masqué quitte les cartes, un épinglé passe devant", () => {
    const { visibles, masques } = classerActifs([hugo, iris], [
      { id: "dev", masque: true, epingle: false },
      { id: "design", masque: false, epingle: true },
    ]);
    expect(masques).toEqual([hugo]);
    expect(visibles).toEqual([iris]);
  });

  test("les non-lus viennent des conversations du compte", () => {
    expect(nonLusAgent("dev", [{ roleIds: ["dev"], nonLus: 2 }, { roleIds: ["design"], nonLus: 4 }])).toBe(2);
  });
});

describe("rôle court affiché (C-2a)", () => {
  test("jamais l'id de l'agent : le rôle lisible, sinon le rôle de la fiche, sinon rien", () => {
    expect(roleLisible("redaction", "redaction")).toBe("");
    expect(roleLisible("Plume", "redaction")).toBe("Plume");
    expect(roleLisible(undefined, "dev")).toBe("");
    expect(tagLisible({ id: "redaction", tag: "redaction", title: "Rédacteur" })).toBe("Rédacteur");
    expect(tagLisible({ id: "dev", tag: "Dev", title: "Développeur" })).toBe("Dev");
    expect(tagLisible({ id: "x", tag: "x" })).toBe("");
    const [carte] = listeMesAgents([{ origine: "redaction", nom: "Basile", teinte: "ocre", roleCourt: "redaction", actif: true }], []).actifs;
    expect(carte.roleCourt).toBe("");
  });
});

describe("cartes et utilisation du lot 5", () => {
  test("les compétences de la carte tiennent en entier", () => {
    expect(competencesCarte(["Portail client", "Devis en ligne", "Tests"], 32)).toBe("Portail client · Devis en ligne");
    expect(competencesCarte([])).toBe("");
  });

  const maintenant = new Date(2026, 10, 5, 12).getTime();
  const ligne = (jour: string, modele: string, entree: number, coutUsd: number, appelsSansCout = 0) => ({ jour, modele, appels: 1 + appelsSansCout, entree, sortie: 0, cacheLu: 0, cacheEcrit: 0, coutUsd, appelsSansCout });

  test("une période ne compte que ses jours, le coût absent reste à part", () => {
    const s = syntheseUtilisation({ jours: [ligne("2026-11-04", "a", 100, 0.5), ligne("2026-11-03", "b", 300, 0, 1), ligne("2026-09-01", "a", 900, 2)] }, "7", maintenant);
    expect(s.jetons).toBe(400);
    expect(s.appels).toBe(3);
    expect(s.appelsSansCout).toBe(1);
    expect(s.coutUsd).toBe(0.5);
    expect(s.modeles.map((m) => m.modele)).toEqual(["b", "a"]);
  });

  test("sans journal : aucun appel, jamais un coût à zéro présenté comme connu", () => {
    const s = syntheseUtilisation({ jours: [] }, "30", maintenant);
    expect(s.appels).toBe(0);
    expect(s.appelsAvecCout).toBe(0);
  });

  test("une barre par jour, jours vides compris ; douze mois sur un an", () => {
    const jours = seriesUtilisation({ jours: [ligne("2026-11-05", "a", 10, 0)] }, "7", maintenant);
    expect(jours).toHaveLength(7);
    expect(jours.at(-1)?.jetons).toBe(10);
    expect(jours[0].jetons).toBe(0);
    const mois = seriesUtilisation({ jours: [ligne("2026-11-05", "a", 10, 0), ligne("2026-10-02", "a", 5, 0)] }, "365", maintenant);
    expect(mois).toHaveLength(12);
    expect(mois.at(-1)?.jetons).toBe(10);
    expect(mois.at(-2)?.jetons).toBe(5);
  });
});
