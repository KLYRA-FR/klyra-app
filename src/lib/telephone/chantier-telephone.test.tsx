// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Chantier } from "@/lib/workflows/chantiers";
import { construire, lireDemande } from "@/lib/workflows/construction";
import { GRAPHE_VIDE, type Workflow } from "@/types/workflows";
import { chantierLu, etatChantier, grapheLu, listeWorkflows, RELECTURE_CHANTIER_MS, type LigneWorkflow, type WorkflowLu } from "./workflow-etapes";

/* Un agent construit un workflow, vu du téléphone : ce que l'ordinateur envoie, et les écrans T-18 et T-19 rendus. */
const simule = vi.hoisted(() => ({
  lecture: { etat: "attente", lent: false } as Record<string, unknown>,
  options: [] as { intervalle?: unknown; suivre?: unknown }[],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/routines",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/poste/client", () => ({
  useLecturePoste: () => ({ ...simule.lecture, relancer: () => undefined }),
  useGestePoste: () => ({ faire: vi.fn(), occupe: false }),
}));
vi.mock("@/lib/telephone/lecture-suivie", () => ({
  useLectureSuivie: (_type: string, _args: unknown, options: { intervalle?: unknown; suivre?: unknown }) => {
    simule.options.push(options);
    return { ...simule.lecture, relancer: () => undefined, relecture: false };
  },
  messageGeste: () => "",
}));
vi.mock("@/components/telephone/poste", () => {
  const poste = () => ({ cle: "poste-essai", systeme: "mac", nom: "MacBook", ouvert: true, dernierSignal: 0 });
  return { usePostes: () => ({ postes: [poste()], principal: poste(), ouvert: true, charge: false }), useSupport: () => "ton Mac" };
});

const { WorkflowsListeTelephone, WorkflowTelephone } = await import("@/components/telephone/WorkflowsTelephone");

const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const ctx = { agents: [{ id: "principal", nom: "Cicco" }, { id: "designer", nom: "Iris" }] };
const iris = (id: string) => (id === "designer" ? { name: "Iris", teinte: "rose" } : null);

/** Un chantier comme `outils-agents.ts` le pose : l'agent écrit encore sa troisième étape. */
function chantier(phase: Chantier["phase"] = "ecrit", base = GRAPHE_VIDE, workflowId = "wf-neuf"): Chantier {
  const c = construire(
    base,
    lireDemande(
      {
        titre: "Page offres",
        etapes: [
          { id: "depart", type: "declencheur" },
          { id: "maquette", type: "agent", agent: "designer", tache: "Propose la maquette." },
          { id: "fin", type: "sortie", titre: "Prête" },
        ],
        liens: [{ de: "depart", vers: "maquette" }],
      },
      true,
    ),
    ctx,
    true,
  );
  return {
    cle: "dm-designer:designer",
    roleId: "designer",
    chatId: "dm-designer",
    etapeId: "toolu_1",
    workflowId,
    nouveau: base === GRAPHE_VIDE,
    titre: "Page offres",
    graphe: c.graphe,
    nouveaux: c.nouveaux,
    modifies: c.modifies,
    liensNouveaux: c.liensNouveaux,
    gestes: c.gestes,
    enEcriture: phase === "fini" ? null : "fin",
    phase,
    debut: 1,
  };
}

beforeEach(() => {
  simule.lecture = { etat: "attente", lent: false };
  simule.options = [];
});

describe("ce que l'ordinateur envoie au téléphone", () => {
  test("le chantier : l'agent, ses trois derniers gestes, l'étape qu'il écrit (un lien : son arrivée)", () => {
    const lu = chantierLu(chantier(), iris("designer"));
    expect(lu.agent).toEqual({ id: "designer", name: "Iris", teinte: "rose" });
    expect(lu.gestes).toEqual(["Relie Déclencheur à Agent", "Ajoute Sortie", "Ajoute Agent"]);
    expect([lu.etapes, lu.liens, lu.enEcriture, lu.nouveau]).toEqual([3, 1, "fin", true]);
    const surLien = chantierLu({ ...chantier(), enEcriture: "depart~maquette" }, null);
    expect(surLien.enEcriture).toBe("maquette");
    expect(surLien.agent.name).toBe("designer");
    expect(chantierLu(chantier("fini"), null).enEcriture).toBeNull();
  });

  test("ce que la construction fait d'une étape", () => {
    const lu = chantierLu(chantier(), null);
    expect(["depart", "fin", "ailleurs"].map((id) => etatChantier(lu, id))).toEqual(["fantome", "ecrit", null]);
    expect(etatChantier(chantierLu(chantier("fini"), null), "depart")).toBe("ne");
    expect(etatChantier(null, "depart")).toBeNull();
  });

  test("la liste : le workflow que l'agent crée en tête, puis les autres avec leur chantier", () => {
    const ancien: Workflow = { id: "wf-ancien", titre: "Ancien", graphe: GRAPHE_VIDE, projectId: null, creeLe: "", majLe: "2026-11-01", versions: [] };
    const modifie: Workflow = { ...ancien, id: "wf-modifie", titre: "Modifié", majLe: "2026-11-02" };
    const lignes = listeWorkflows([ancien, modifie], [], [chantier(), { ...chantier("pose", GRAPHE_VIDE, "wf-modifie"), nouveau: false }], iris, "2026-11-04T10:00:00Z");
    expect(lignes.map((l) => [l.id, !!l.chantier])).toEqual([
      ["wf-neuf", true],
      ["wf-modifie", true],
      ["wf-ancien", false],
    ]);
    expect(lignes[0]).toMatchObject({ titre: "Page offres", etapes: 3, derniere: null, declencheur: "Manuel" });
    // Une fois enregistré, le nouveau workflow n'est plus en double.
    const enregistre: Workflow = { ...ancien, id: "wf-neuf", titre: "Page offres", majLe: "2026-11-04" };
    expect(listeWorkflows([enregistre], [], [chantier("fini")], iris, "").map((l) => l.id)).toEqual(["wf-neuf"]);
  });
});

describe("les écrans du téléphone pendant qu'un agent construit", () => {
  const lu = (phase: Chantier["phase"] = "ecrit"): WorkflowLu => {
    const c = chantier(phase);
    return {
      id: c.workflowId,
      titre: c.titre,
      majLe: "",
      ...grapheLu(c.graphe),
      prochaines: {},
      version: null,
      executions: [],
      plus: 0,
      vue: null,
      enCours: null,
      agents: [{ id: "designer", name: "Iris", tag: "Design", teinte: "rose", actif: true }],
      chantier: chantierLu(c, iris("designer")),
    };
  };

  test("T-19 : le bandeau, les étapes de l'agent marquées, celle qu'il écrit ; rien à lancer ni à modifier", () => {
    simule.lecture = { etat: "ok", data: lu() };
    const html = renderToStaticMarkup(<WorkflowTelephone id="wf-neuf" versionId={null} />);
    const t = texte(html);
    expect(t).toContain("Iris construit ce workflow");
    expect(t).toContain("Relie Déclencheur à Agent");
    expect(t).toContain("3 étapes · 1 lien");
    expect(html.match(/data-chantier="fantome"/g)).toHaveLength(2);
    expect(html).toContain('data-chantier="ecrit"');
    expect(html).toContain("klyra-wf-ligne-ecrit");
    expect(t).toContain("En construction…");
    expect(t).not.toContain("Lancer le workflow");
    expect(html).not.toContain('aria-label="Actions du workflow"');
    // Relu chaque seconde tant que l'agent construit.
    const options = simule.options.at(-1) as { intervalle: (w: WorkflowLu) => number; suivre: (w: WorkflowLu) => boolean };
    expect(options.intervalle(lu())).toBe(RELECTURE_CHANTIER_MS);
    expect(options.suivre(lu())).toBe(true);
    expect(options.intervalle({ ...lu(), chantier: null })).toBe(4000);
  });

  test("T-19 : enregistré, le bandeau le dit et les étapes s'éclairent ; on peut lancer", () => {
    simule.lecture = { etat: "ok", data: { ...lu("fini"), chantier: { ...lu("fini").chantier!, nouveau: true } } };
    const html = renderToStaticMarkup(<WorkflowTelephone id="wf-neuf" versionId={null} />);
    expect(texte(html)).toContain("Iris a construit ce workflow");
    expect(html.match(/data-chantier="ne"/g)).toHaveLength(3);
    expect(texte(html)).toContain("Lancer le workflow");
  });

  test("T-18 : la ligne du workflow en construction, sans menu tant qu'il n'existe pas", () => {
    const c = chantier();
    const ligne: LigneWorkflow = { id: c.workflowId, titre: "Page offres", majLe: "", declencheur: "Manuel", etapes: 3, derniere: null, chantier: chantierLu(c, iris("designer")) };
    simule.lecture = { etat: "ok", data: [ligne] };
    const html = renderToStaticMarkup(<WorkflowsListeTelephone onglets={null} />);
    const t = texte(html);
    expect(t).toContain("Page offres");
    expect(t).toContain("Iris construit ce workflow · 3 étapes");
    expect(t).toContain("Relie Déclencheur à Agent");
    expect(html).not.toContain("Actions de Page offres");
    const options = simule.options.at(-1) as { intervalle: (l: LigneWorkflow[]) => number };
    expect(options.intervalle([ligne])).toBe(RELECTURE_CHANTIER_MS);
    expect(options.intervalle([{ ...ligne, chantier: null }])).toBe(5000);
  });
});
