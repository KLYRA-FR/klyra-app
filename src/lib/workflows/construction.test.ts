import { describe, expect, it } from "vitest";
import { GRAPHE_VIDE, type ExecutionWorkflow, type Graphe, type Workflow } from "@/types/workflows";
import { largeurNoeud } from "@/components/workflows/catalogue";
import { construire, decrireWorkflow, etatsSuccessifs, hauteurEstimee, lireDemande, problemesWorkflow, reponseConstruction } from "./construction";

const ctx = { agents: [{ id: "principal", nom: "Lou" }, { id: "designer", nom: "Iris" }, { id: "dev", nom: "Hugo" }] };

const demandePage = {
  titre: "De la maquette au code",
  etapes: [
    { id: "depart", type: "declencheur", nom: "Départ", declencheur: "manuel" },
    { id: "brief", type: "prompt", texte: "Une page « Nos offres »." },
    { id: "maquette", type: "agent", nom: "Maquette", agent: "designer", tache: "Propose la maquette." },
    { id: "accord", type: "approbation", question: "La maquette te convient ?" },
    { id: "code", type: "agent", nom: "Code", agent: "dev", tache: "Code-la." },
    { id: "verdict", type: "condition", regle: "Le code passe les tests." },
    { id: "fin", type: "sortie", cible: "notification", titre: "Page prête" },
  ],
  liens: [
    { de: "depart", vers: "maquette" },
    { de: "brief", vers: "maquette" },
    { de: "maquette", vers: "accord" },
    { de: "accord", vers: "code" },
    { de: "code", vers: "verdict" },
    { de: "verdict", vers: "fin", branche: "oui" },
    { de: "verdict", vers: "code", branche: "non" },
  ],
};

const chevauchent = (g: Graphe) => {
  for (const a of g.noeuds)
    for (const b of g.noeuds) {
      if (a === b) continue;
      if (a.at.x < b.at.x + largeurNoeud(b) && b.at.x < a.at.x + largeurNoeud(a) && a.at.y < b.at.y + hauteurEstimee(b) && b.at.y < a.at.y + hauteurEstimee(a)) return [a.id, b.id];
    }
  return null;
};

describe("construire un workflow", () => {
  it("pose les étapes et les liens, et place les cartes en colonnes qui suivent les liens", () => {
    const c = construire(GRAPHE_VIDE, lireDemande(demandePage), ctx);
    expect(c.problemes).toEqual([]);
    expect(c.nouveaux).toEqual(["depart", "brief", "maquette", "accord", "code", "verdict", "fin"]);
    expect(c.graphe.liens).toHaveLength(7);
    const at = Object.fromEntries(c.graphe.noeuds.map((n) => [n.id, n.at]));
    // Le brief et le départ alimentent la maquette : même colonne, à sa gauche.
    expect(at.depart.x).toBe(at.brief.x);
    expect(at.brief.y).toBeGreaterThan(at.depart.y);
    expect(at.maquette.x).toBeGreaterThan(at.depart.x);
    // Le flux va de gauche à droite, la boucle (verdict → code) ne repousse rien.
    expect(at.accord.x).toBeGreaterThan(at.maquette.x);
    expect(at.code.x).toBeGreaterThan(at.accord.x);
    expect(at.fin.x).toBeGreaterThan(at.verdict.x);
    expect(chevauchent(c.graphe)).toBeNull();
    // Les champs et le nom sont gardés, la condition sort par ses branches.
    const maquette = c.graphe.noeuds.find((n) => n.id === "maquette")!;
    expect(maquette.champs).toMatchObject({ agent: "designer", tache: "Propose la maquette.", nom: "Maquette" });
    expect(c.graphe.liens.filter((l) => l.de === "verdict").map((l) => l.branche).sort()).toEqual(["non", "oui"]);
    expect(problemesWorkflow(c.graphe, ctx)).toEqual([]);
  });

  it("refuse un agent inactif, un type inconnu, un lien sans branche depuis une condition", () => {
    const c = construire(
      GRAPHE_VIDE,
      lireDemande({
        etapes: [
          { id: "a", type: "agent", agent: "fantome", tache: "x" },
          { id: "b", type: "image" },
          { id: "c", type: "condition", regle: "r" },
          { id: "d", type: "sortie" },
        ],
        liens: [{ de: "c", vers: "d" }, { de: "d", vers: "c" }],
      }),
      ctx,
    );
    expect(c.problemes.join("\n")).toMatch(/aucun agent actif « fantome »/);
    expect(c.problemes.join("\n")).toMatch(/type image inconnu/);
    expect(c.problemes.join("\n")).toMatch(/branche oui ou non/);
    expect(c.problemes.join("\n")).toMatch(/n’a pas de sortie/);
  });

  it("modifie une étape existante sans la déplacer, retire et relie", () => {
    const base = construire(GRAPHE_VIDE, lireDemande(demandePage), ctx).graphe;
    const avant = base.noeuds.find((n) => n.id === "code")!;
    const c = construire(
      base,
      lireDemande({
        etapes: [{ id: "code", tache: "Code-la, avec les tests." }, { id: "revue", type: "agent", agent: "principal", tache: "Relis." }],
        liens: [{ de: "code", vers: "revue" }],
        retirer: ["accord"],
      }),
      ctx,
    );
    expect(c.problemes).toEqual([]);
    const code = c.graphe.noeuds.find((n) => n.id === "code")!;
    expect(code.at).toEqual(avant.at);
    expect(code.champs.tache).toBe("Code-la, avec les tests.");
    expect(c.modifies).toEqual(["code"]);
    expect(c.graphe.noeuds.some((n) => n.id === "accord")).toBe(false);
    expect(c.graphe.liens.some((l) => l.de === "accord" || l.vers === "accord")).toBe(false);
    const revue = c.graphe.noeuds.find((n) => n.id === "revue")!;
    expect(revue.at.x).toBeGreaterThan(code.at.x);
    expect(chevauchent(c.graphe)).toBeNull();
  });

  it("l'aperçu en direct ne prend une étape qu'une fois son id écrit, et finit comme l'enregistrement", () => {
    // Le modèle écrit encore l'id de la 2e étape : seule la 1re compte.
    const enCours = lireDemande({ titre: "T", etapes: [{ id: "depart", type: "declencheur" }, { id: "maq" }] }, true);
    expect(enCours.etapes.map((e) => e.id)).toEqual(["depart"]);
    // Le texte d'une tâche qui s'écrit : la carte est là, sa tâche grandit.
    const tache = construire(GRAPHE_VIDE, lireDemande({ etapes: [{ id: "maquette", type: "agent", agent: "designer", tache: "Propo" }] }, true), ctx, true);
    expect(tache.enEcriture).toBe("maquette");
    expect(tache.graphe.noeuds[0].champs.tache).toBe("Propo");
    const apercu = construire(GRAPHE_VIDE, lireDemande(demandePage, true), ctx, true);
    const final = construire(GRAPHE_VIDE, lireDemande(demandePage), ctx);
    expect(apercu.graphe).toEqual(final.graphe);
  });

  it("joue la construction geste par geste, chaque carte à sa place finale", () => {
    const c = construire(GRAPHE_VIDE, lireDemande(demandePage), ctx);
    const etats = etatsSuccessifs(GRAPHE_VIDE, c);
    // Le titre ne pose rien : une image par carte et par lien, puis l'état final.
    expect(etats).toHaveLength(c.gestes.filter((g) => g.type !== "titre").length + 1);
    expect(etats[0].noeuds.map((n) => n.id)).toEqual(["depart"]);
    expect(etats[6].liens).toHaveLength(0);
    expect(etats[7].liens).toHaveLength(1);
    const final = new Map(c.graphe.noeuds.map((n) => [n.id, n.at]));
    for (const g of etats) for (const n of g.noeuds) expect(n.at).toEqual(final.get(n.id));
    expect(etats.at(-1)).toEqual(c.graphe);
  });
});

describe("ce que l'agent lit", () => {
  it("décrit les étapes, les liens, la boucle et l'exécution", () => {
    const c = construire(GRAPHE_VIDE, lireDemande(demandePage), ctx);
    const wf: Workflow = { id: "w1", titre: "Page", graphe: c.graphe, projectId: null, creeLe: "", majLe: "", versions: [] };
    const exec: ExecutionWorkflow = {
      id: "e1",
      workflowId: "w1",
      numero: 2,
      declencheurId: null,
      source: "agent",
      lancePar: { roleId: "designer", chatId: "c" },
      statut: "approbation",
      erreur: null,
      debut: new Date().toISOString(),
      fin: null,
      chatId: "wf-w1",
      etapes: [
        { id: "s1", noeudId: "maquette", passe: 1, statut: "fait", sortie: "Voici la maquette", branche: null, erreur: null, debut: "", fin: "" },
        { id: "s2", noeudId: "accord", passe: 1, statut: "approbation", sortie: null, branche: null, erreur: null, debut: "", fin: null },
      ],
    };
    const texte = decrireWorkflow(wf, exec, { ctx, projet: null, nomAgent: (id) => ctx.agents.find((a) => a.id === id)?.nom ?? id });
    expect(texte).toContain("- maquette [agent] « Maquette » — agent : designer (Iris)");
    expect(texte).toContain("- verdict —non→ code (boucle)");
    expect(texte).toContain("lancée par Iris");
    expect(texte).toContain("Voici la maquette");
    expect(texte).toContain("accord : attend l'accord de la personne");
    expect(reponseConstruction(wf, c, true, ctx)).toMatch(/Workflow créé.*7 étapes ajoutées, 7 liens/);
  });
});
