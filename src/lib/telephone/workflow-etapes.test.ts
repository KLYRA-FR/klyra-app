import { describe, expect, test } from "vitest";
import { ErreurPoste } from "@/lib/poste/types";
import type { ExecutionWorkflow, Workflow } from "@/types/workflows";
import {
  appliquerPatch,
  conflitEtape,
  copieWorkflow,
  entreeEtape,
  etapeLue,
  etatsEtapes,
  libelleAnnotations,
  libelleDeclencheur,
  ligneWorkflow,
  lireFrequence,
  lirePatchEtape,
  miseAPlat,
  restaurerVersion,
  resumeExecution,
  SORTIE_MAX,
  texteAnnotation,
  type EtapeLue,
  type LienLu,
  type LigneEtape,
  type NoeudLu,
} from "./workflow-etapes";

const noeud = (id: string, type: NoeudLu["type"], x: number, y = 0, champs: NoeudLu["champs"] = {}): NoeudLu => ({ id, type, at: { x, y }, champs });
const lien = (de: string, vers: string, branche?: "oui" | "non"): LienLu => ({ id: `${de}-${vers}${branche ? `-${branche}` : ""}`, de, vers, ...(branche ? { branche } : {}) });

/** Les lignes en texte : « 3 iris », « · si oui », « · non → retour 5 », avec le retrait. */
function lire(lignes: LigneEtape[]): string[] {
  return lignes.map((l) => {
    const retrait = "  ".repeat(l.niveau);
    if (l.genre === "etape") return `${retrait}${l.numero} ${l.noeud.id}`;
    if (l.genre === "branche") return `${retrait}si ${l.branche}`;
    return `${retrait}${l.branche ?? "lien"} → ${l.retour ? "retour" : "passe"} ${l.vers.numero} ${l.vers.nom}`;
  });
}

function code(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof ErreurPoste ? err.code : "autre";
  }
}

describe("mise à plat d'un workflow en étapes", () => {
  test("l'exemple du bureau : dans l'ordre des liens, la branche Non qui revient au code devient un retour", () => {
    const n = [
      noeud("fin", "sortie", 2160, 60),
      noeud("d", "declencheur", 40, 120),
      noeud("iris", "agent", 380, 60, { nom: "Maquette", agent: "designer" }),
      noeud("p", "prompt", 40, 380),
      noeud("ok", "approbation", 740, 60),
      noeud("hugo", "agent", 1080, 60, { nom: "Code", agent: "dev" }),
      noeud("qa", "agent", 1440, 60, { nom: "Recette", agent: "qa" }),
      noeud("c", "condition", 1800, 60),
    ];
    const l = [lien("d", "iris"), lien("p", "iris"), lien("iris", "ok"), lien("ok", "hugo"), lien("hugo", "qa"), lien("qa", "c"), lien("c", "fin", "oui"), lien("c", "hugo", "non")];
    expect(lire(miseAPlat(n, l).lignes)).toEqual(["1 d", "2 p", "3 iris", "4 ok", "5 hugo", "6 qa", "7 c", "  si oui", "  8 fin", "  non → retour 5 Code"]);
  });

  test("deux branches qui se rejoignent : chacune en retrait, la suite au niveau de la condition", () => {
    const n = [noeud("d", "declencheur", 0), noeud("c", "condition", 100), noeud("a", "agent", 200, 0), noeud("b", "agent", 200, 200), noeud("m", "sortie", 300)];
    const l = [lien("d", "c"), lien("c", "a", "oui"), lien("c", "b", "non"), lien("a", "m"), lien("b", "m")];
    expect(lire(miseAPlat(n, l).lignes)).toEqual(["1 d", "2 c", "  si oui", "  3 a", "  si non", "  4 b", "5 m"]);
  });

  test("une branche qui va droit à la suite devient un saut vers son numéro, résolu après coup", () => {
    const n = [noeud("c", "condition", 0), noeud("b", "agent", 100), noeud("m", "sortie", 200)];
    const l = [lien("c", "m", "oui"), lien("c", "b", "non"), lien("b", "m")];
    expect(lire(miseAPlat(n, l).lignes)).toEqual(["1 c", "  oui → passe 3 Sortie", "  si non", "  2 b", "3 m"]);
  });

  test("une condition dans une branche : deux niveaux de retrait", () => {
    const n = [noeud("c1", "condition", 0), noeud("c2", "condition", 100), noeud("x", "agent", 200), noeud("y", "agent", 200, 100), noeud("z", "sortie", 100, 300)];
    const l = [lien("c1", "c2", "oui"), lien("c1", "z", "non"), lien("c2", "x", "oui"), lien("c2", "y", "non")];
    expect(lire(miseAPlat(n, l).lignes)).toEqual(["1 c1", "  si oui", "  2 c2", "    si oui", "    3 x", "    si non", "    4 y", "  si non", "  5 z"]);
  });

  test("une boucle hors condition : « retour » sous l'étape d'où elle part", () => {
    const n = [noeud("a", "agent", 0), noeud("b", "agent", 100)];
    const l = [lien("a", "b"), lien("b", "a")];
    expect(lire(miseAPlat(n, l).lignes)).toEqual(["1 a", "2 b", "  lien → retour 1 Agent"]);
  });

  test("notes, textes et formes à part ; étapes isolées gardées, lues de gauche à droite ; liens vers rien ignorés", () => {
    const n = [noeud("note", "note", 0, 0, { texte: "À relire" }), noeud("seule", "llm", 500), noeud("p", "prompt", 10), noeud("forme", "forme", 5, 5, { forme: "losange" })];
    const plat = miseAPlat(n, [lien("p", "note"), lien("p", "fantome"), lien("p", "p")]);
    expect(lire(plat.lignes)).toEqual(["1 p", "2 seule"]);
    expect(plat.annotations.map((a) => a.id)).toEqual(["note", "forme"]);
  });

  test("aucune étape : rien à lire", () => {
    expect(miseAPlat([], []).lignes).toEqual([]);
  });
});

describe("état des étapes d'une exécution", () => {
  const etape = (id: string, noeudId: string, statut: EtapeLue["statut"], sortie = "", passe = 1): EtapeLue => ({ id, noeudId, passe, statut, sortie, branche: null, erreur: null, debut: "", fin: null });

  test("le dernier passage d'un nœud l'emporte (tour de boucle)", () => {
    const etats = etatsEtapes({ etapes: [etape("1", "a", "fait"), etape("2", "a", "en-cours", "", 2)] });
    expect(etats.get("a")?.passe).toBe(2);
    expect(etatsEtapes(null).size).toBe(0);
  });

  test("ce qu'une approbation reçoit : les sorties finies de ce qui y entre", () => {
    const etats = etatsEtapes({ etapes: [etape("1", "x", "fait", "Maquette prête"), etape("2", "y", "erreur", "rien"), etape("3", "ok", "approbation")] });
    expect(entreeEtape("ok", [lien("x", "ok"), lien("y", "ok")], etats)).toBe("Maquette prête");
  });

  test("une sortie trop longue part coupée", () => {
    const longue = etapeLue({ id: "e", noeudId: "n", passe: 1, statut: "fait", sortie: "a".repeat(SORTIE_MAX + 10), branche: null, erreur: null, debut: "", fin: null });
    expect(longue.sortie.length).toBe(SORTIE_MAX + 1);
  });
});

describe("textes de la lecture en étapes", () => {
  test("le pied compte les notes, textes et formes", () => {
    expect(libelleAnnotations([])).toBeNull();
    expect(libelleAnnotations([noeud("a", "note", 0), noeud("b", "note", 0)])).toBe("2 notes sur le canevas");
    expect(libelleAnnotations([noeud("a", "note", 0), noeud("b", "texte", 0), noeud("c", "forme", 0), noeud("d", "forme", 0)])).toBe("1 note, 1 texte et 2 formes sur le canevas");
    expect(texteAnnotation(noeud("f", "forme", 0, 0, { forme: "losange", texte: "Décision" }))).toBe("Losange : Décision");
    expect(texteAnnotation(noeud("n", "note", 0, 0, { texte: " " }))).toBe("Note vide");
  });

  test("le déclencheur en mots", () => {
    expect(libelleDeclencheur([])).toBe("Sans déclencheur");
    expect(libelleDeclencheur([noeud("d", "declencheur", 0, 0, { declencheur: "manuel" })])).toBe("Manuel");
    const planifie = { ...noeud("d", "declencheur", 0, 0, { declencheur: "planifie" }), frequence: { type: "jour" as const, heure: "08:30" } };
    expect(libelleDeclencheur([planifie, noeud("w", "declencheur", 50, 0, { declencheur: "webhook" })])).toBe("Planifié · Tous les jours à 08:30 · +1");
  });

  test("une ligne de la liste : la dernière exécution, celle en cours d'abord", () => {
    const wf: Workflow = { id: "w", titre: "T", graphe: { noeuds: [{ ...noeud("a", "agent", 0), at: { x: 0, y: 0 } }], liens: [], traits: [] }, projectId: null, creeLe: "", majLe: "", versions: [] };
    const exec = (id: string, debut: string, statut: ExecutionWorkflow["statut"]): ExecutionWorkflow => ({
      id,
      workflowId: "w",
      numero: Number(id),
      declencheurId: null,
      source: "manuel",
      statut,
      erreur: null,
      debut,
      fin: null,
      etapes: statut === "approbation" ? [{ id: "s", noeudId: "a", passe: 1, statut: "approbation", sortie: null, branche: null, erreur: null, debut, fin: null }] : [],
      chatId: null,
    });
    const ligne = ligneWorkflow(wf, [exec("1", "2026-11-01T10:00:00Z", "approbation"), exec("2", "2026-11-02T10:00:00Z", "fait"), { ...exec("3", "2026-11-03T10:00:00Z", "fait"), workflowId: "autre" }]);
    expect(ligne.derniere?.id).toBe("1");
    expect(ligne.derniere?.arret).toBe("Agent");
    expect(ligne.etapes).toBe(1);
    expect(resumeExecution(exec("2", "", "fait"), wf.graphe.noeuds).arret).toBeNull();
  });
});

describe("contenu d'une étape modifié depuis le téléphone", () => {
  const connus = { agents: ["principal", "dev"], modeles: ["sonnet", "opus", "haiku"] };

  test("accepte les champs de son type, avec des valeurs de la bonne forme", () => {
    expect(lirePatchEtape("agent", { champs: { agent: "dev", tache: "Code la page" } }, connus)).toEqual({ champs: { agent: "dev", tache: "Code la page" } });
    expect(lirePatchEtape("llm", { champs: { modele: "opus", effort: "" } }, connus).champs).toEqual({ modele: "opus", effort: "" });
    expect(lirePatchEtape("declencheur", { champs: { declencheur: "planifie" }, frequence: { type: "semaine", jour: 1, heure: "09:00" } }, connus)).toEqual({
      champs: { declencheur: "planifie" },
      frequence: { type: "semaine", jour: 1, heure: "09:00" },
    });
  });

  test("refuse tout le reste", () => {
    expect(code(() => lirePatchEtape("agent", { champs: { agent: "inconnu" } }, connus))).toBe("agent");
    expect(code(() => lirePatchEtape("agent", { champs: { at: "0" } }, connus))).toBe("arguments");
    expect(code(() => lirePatchEtape("prompt", { champs: { texte: 3 } }, connus))).toBe("arguments");
    expect(code(() => lirePatchEtape("prompt", { champs: { texte: "a".repeat(100_001) } }, connus))).toBe("trop-long");
    expect(code(() => lirePatchEtape("sortie", { champs: { cible: "mail" } }, connus))).toBe("arguments");
    expect(code(() => lirePatchEtape("llm", { champs: { modele: "gpt" } }, connus))).toBe("arguments");
    expect(code(() => lirePatchEtape("prompt", { champs: { texte: "x" }, frequence: { type: "heure" } }, connus))).toBe("arguments");
    expect(code(() => lirePatchEtape("prompt", { champs: {} }, connus))).toBe("arguments");
    expect(code(() => lirePatchEtape("ressource", { champs: { chemins: "/etc/passwd" } }, connus))).toBe("structure");
    expect(code(() => lirePatchEtape("note", { champs: { texte: "x" } }, connus))).toBe("structure");
    expect(code(() => lirePatchEtape("prompt", null, connus))).toBe("arguments");
    expect(code(() => lirePatchEtape("prompt", { champs: ["texte"] }, connus))).toBe("arguments");
  });

  test("fréquence d'un déclencheur planifié", () => {
    expect(lireFrequence({ type: "heure", heure: "ignorée" })).toEqual({ type: "heure" });
    expect(lireFrequence({ type: "mois", jour: 28, heure: "23:59" })).toEqual({ type: "mois", jour: 28, heure: "23:59" });
    expect(code(() => lireFrequence({ type: "mois", jour: 29, heure: "09:00" }))).toBe("arguments");
    expect(code(() => lireFrequence({ type: "semaine", jour: 0, heure: "09:00" }))).toBe("arguments");
    expect(code(() => lireFrequence({ type: "jour", heure: "24:00" }))).toBe("frequence");
    expect(code(() => lireFrequence({ type: "annee" }))).toBe("arguments");
  });

  test("conflit seulement sur les champs envoyés qui ont changé depuis la lecture", () => {
    const n = { champs: { agent: "dev", tache: "Nouvelle tâche écrite au bureau" }, frequence: undefined };
    expect(conflitEtape(n, { champs: { agent: "principal" } }, { champs: { agent: "dev" } })).toBe(false);
    expect(conflitEtape(n, { champs: { tache: "Du téléphone" } }, { champs: { tache: "Ancienne tâche" } })).toBe(true);
    expect(conflitEtape({ champs: {} }, { champs: { modele: "opus" } }, { champs: {} })).toBe(false);
    const d = { champs: {}, frequence: { type: "jour" as const, heure: "09:00" } };
    expect(conflitEtape(d, { champs: {}, frequence: { type: "heure" } }, { champs: {}, frequence: { type: "jour", heure: "08:00" } })).toBe(true);
  });

  test("appliquer, dupliquer, rendre une version actuelle", () => {
    expect(appliquerPatch({ champs: { agent: "dev", tache: "a" } }, { champs: { tache: "b" } })).toEqual({ champs: { agent: "dev", tache: "b" } });
    const graphe = { noeuds: [], liens: [], traits: [] };
    const ancien = { noeuds: [noeud("x", "prompt", 0)].map((n) => ({ ...n })), liens: [], traits: [] };
    const wf: Workflow = { id: "w", titre: "Recette", graphe, projectId: "p", creeLe: "", majLe: "", versions: [{ id: "v1", at: "t", raison: "auto", graphe: ancien }] };
    expect(copieWorkflow(wf, "w2", "maintenant")).toEqual({ id: "w2", titre: "Copie de Recette", graphe, projectId: "p", creeLe: "maintenant", majLe: "maintenant", versions: [] });
    const restaure = restaurerVersion(wf, "v1", "v2", "maintenant");
    expect(restaure.graphe).toBe(ancien);
    expect(restaure.versions.map((v) => [v.id, v.raison])).toEqual([
      ["v2", "restauration"],
      ["v1", "auto"],
    ]);
    expect(restaure.versions[0].graphe).toBe(graphe);
    expect(code(() => restaurerVersion(wf, "absente", "v3", ""))).toBe("introuvable");
  });
});
