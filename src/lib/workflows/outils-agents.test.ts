import { beforeEach, describe, expect, it } from "vitest";
import type { ExecutionWorkflow, Workflow } from "@/types/workflows";
import { chantierDe, lireChantiers, poserChantier } from "./chantiers";
import { creerOutilsWorkflows } from "./outils-agents";

const iris = { chatId: "dm-designer", roleId: "designer" };
const entree = {
  titre: "Page offres",
  etapes: [
    { id: "depart", type: "declencheur" },
    { id: "maquette", type: "agent", agent: "designer", tache: "Propose la maquette." },
    { id: "fin", type: "sortie", cible: "notification" },
  ],
  liens: [
    { de: "depart", vers: "maquette" },
    { de: "maquette", vers: "fin" },
  ],
};

function monde() {
  const etat = { workflows: [] as Workflow[], executions: [] as ExecutionWorkflow[], projets: [{ id: "p1", name: "Site" }] };
  const pauses: number[] = [];
  const vus: string[][] = [];
  const phases: string[] = [];
  const lances: { id: string; o: unknown }[] = [];
  let n = 0;
  const outils = creerOutilsWorkflows({
    etat: () => etat,
    agents: () => [{ id: "principal", nom: "Lou" }, { id: "designer", nom: "Iris" }],
    enregistrer: (wf) => {
      etat.workflows = [...etat.workflows.filter((w) => w.id !== wf.id), wf];
    },
    lancer: (id, o) => {
      lances.push({ id, o });
      const e: ExecutionWorkflow = { id: `exec-${lances.length}`, workflowId: id, numero: lances.length, declencheurId: null, source: "agent", statut: "en-cours", erreur: null, debut: "2026-11-04T10:00:00Z", fin: null, etapes: [], chatId: `wf-${id}` };
      etat.executions = [e, ...etat.executions];
      return e.id;
    },
    attendre: async (ms) => {
      pauses.push(ms);
      const c = chantierDe(`${iris.chatId}:${iris.roleId}`);
      if (c) vus.push(c.graphe.noeuds.map((x) => x.id));
      if (c) phases.push(c.phase);
    },
    maintenant: () => Date.parse("2026-11-04T10:00:00Z"),
    nouvelId: () => `id-${++n}`,
  });
  return { etat, outils, pauses, vus, lances, phases };
}

beforeEach(() => {
  for (const cle of Object.keys(lireChantiers())) poserChantier(cle, null);
});

describe("un agent construit un workflow", () => {
  it("vu en train de s'écrire : l'aperçu montre les étapes, l'appel enregistre le même workflow sans rejouer", async () => {
    const { etat, outils, pauses, phases } = monde();
    outils.apercu(iris, "toolu_1", { titre: "Page offres", etapes: [{ id: "depart", type: "declencheur" }, { id: "maq" }] });
    const apercu = chantierDe("dm-designer:designer")!;
    expect(apercu.phase).toBe("ecrit");
    expect(apercu.nouveau).toBe(true);
    expect(apercu.graphe.noeuds.map((x) => x.id)).toEqual(["depart"]);
    outils.apercu(iris, "toolu_1", entree);
    const id = chantierDe("dm-designer:designer")!.workflowId;
    const texte = await outils.executer("construire_workflow", entree, iris);
    expect(texte).toMatch(/Workflow créé : « Page offres »/);
    expect(etat.workflows).toHaveLength(1);
    expect(etat.workflows[0].id).toBe(id);
    // Déjà vu : pas de pose une à une, seulement le temps de la fin ; puis le chantier part.
    expect(phases).toEqual(["fini"]);
    expect(pauses).toEqual([2600]);
    await Promise.resolve();
    expect(chantierDe("dm-designer:designer")).toBeNull();
  });

  it("pas vu (autre moteur, VPS) : la page voit les étapes se poser une à une", async () => {
    const { etat, outils, pauses, vus } = monde();
    await outils.executer("construire_workflow", entree, iris);
    expect(etat.workflows).toHaveLength(1);
    expect(vus.slice(0, 3)).toEqual([["depart"], ["depart", "maquette"], ["depart", "maquette", "fin"]]);
    expect(pauses.length).toBeGreaterThan(5);
  });

  it("refuse sans rien enregistrer, et l'aperçu part", async () => {
    const { etat, outils } = monde();
    outils.apercu(iris, "toolu_1", { titre: "X", etapes: [{ id: "a", type: "agent", agent: "fantome", tache: "t" }, { id: "b", type: "sortie" }] });
    await expect(outils.executer("construire_workflow", { titre: "X", etapes: [{ id: "a", type: "agent", agent: "fantome" }] }, iris)).rejects.toThrow(/Rien n'a été enregistré[\s\S]*fantome/);
    expect(etat.workflows).toHaveLength(0);
    expect(chantierDe("dm-designer:designer")).toBeNull();
  });

  it("modifie un workflow : une version garde l'état d'avant, au nom de l'agent", async () => {
    const { etat, outils } = monde();
    await outils.executer("construire_workflow", entree, iris);
    const avant = etat.workflows[0];
    await outils.executer("construire_workflow", { workflow: avant.id, etapes: [{ id: "maquette", tache: "Deux propositions." }] }, iris);
    const apres = etat.workflows[0];
    expect(apres.graphe.noeuds.find((x) => x.id === "maquette")!.champs.tache).toBe("Deux propositions.");
    expect(apres.versions[0]).toMatchObject({ raison: "agent", par: "designer", graphe: avant.graphe });
  });

  it("lance, refuse un second lancement et le lancement depuis une étape de workflow", async () => {
    const { etat, outils, lances } = monde();
    await outils.executer("construire_workflow", entree, iris);
    const id = etat.workflows[0].id;
    expect(await outils.executer("lancer_workflow", { workflow: id, entree: "Pour lundi" }, iris)).toMatch(/Exécution n°1 .* lancée/);
    expect(lances[0].o).toMatchObject({ source: "agent", charge: "Pour lundi", lancePar: iris });
    await expect(outils.executer("lancer_workflow", { workflow: id }, iris)).rejects.toThrow(/tourne déjà/);
    await expect(outils.executer("lancer_workflow", { workflow: id }, { chatId: `wf-${id}`, roleId: "designer" })).rejects.toThrow(/ne lance pas de workflow/);
    const lu = await outils.executer("lire_workflow", { workflow: id }, iris);
    expect(lu).toContain("Exécution n°1");
    expect(await outils.executer("lister_workflows", {}, iris)).toContain("« Page offres »");
  });
});
