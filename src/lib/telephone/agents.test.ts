import { describe, expect, test } from "vitest";
import { agentDeLaBibliotheque, libelleRetour, listeMesAgents, roleLisible, tagLisible, teinteSure, texteConversations, texteErreurFiche } from "./agents";

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
