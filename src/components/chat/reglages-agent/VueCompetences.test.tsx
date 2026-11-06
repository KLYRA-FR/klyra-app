// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import type { CompetencesAgent } from "@/lib/bridge";
import type { Role } from "@/types/domain";
import { resumeCompetences, VueCompetences } from "./VueCompetences";

/* Le choix par agent du serveur de la conversation : figé, rien d'allumé en plus. */
vi.mock("@/lib/reglages-agents", () => ({
  useReglagesAgents: () => ({
    lieu: "https://vps.exemple.test",
    reglages: { skillsParAgent: { fige: true, personnellesConnues: ["rangement"], agentsConnus: ["principal", "iris"], coupees: {}, activees: {} } },
    erreur: null,
    changerSkills: vi.fn(async () => true),
  }),
}));

const iris = { id: "iris", name: "Iris", skills: [] } as unknown as Role;
const skill = (nom: string) => ({ nom, description: `Fait ${nom}.`, version: null, dossier: `/home/klyra/.klyra/bibliotheque-skills/${nom}` });
const lues: CompetencesAgent = {
  fiche: [skill("projet-soir")],
  projet: [],
  poste: [skill("graphify"), skill("projet-soir"), skill("rangement")],
  plugins: [],
  coupees: ["graphify", "projet-soir"],
};

function rendre(valeur: CompetencesAgent) {
  return renderToStaticMarkup(
    <VueCompetences role={iris} contexte={{ dossier: null, sessionId: null, lieu: "https://vps.exemple.test" }} lecture={{ etat: "pret", valeur }} attribuer={vi.fn(async () => {})} pourquoiFige={null} onRetour={vi.fn()} />,
  );
}

/** Les noms des skills d'une section, dans l'ordre. */
const section = (html: string, titre: string) => {
  const bloc = html.split(`>${titre}</h3>`)[1]?.split("</section>")[0] ?? "";
  return [...bloc.matchAll(/font-medium text-texte-principal">([^<]+)</g)].map((m) => m[1]);
};

describe("compétences d'un agent dans le panneau d'une conversation", () => {
  test("une skill de sa fiche coupée dans Réglages › Agents est signalée, avec « Lui donner »", () => {
    const html = rendre(lues);
    expect(section(html, "Préchargées par sa fiche")).toEqual(["projet-soir"]);
    expect(html).toContain("Coupée pour Iris dans Réglages › Agents de ce serveur : sa fiche la demande, mais il ne la reçoit pas.");
    expect(html.split(">Préchargées par sa fiche</h3>")[1]?.split("</section>")[0]).toContain("Lui donner");
  });

  test("le serveur ne montre que celles qu'il reçoit ; les autres coupées sont à part", () => {
    const html = rendre(lues);
    expect(section(html, "Du serveur")).toEqual(["rangement"]);
    expect(section(html, "Coupées pour Iris")).toEqual(["graphify"]);
    expect(html).not.toContain("Tous tes agents");
    expect(html).toContain('href="/reglages?section=agents"');
  });

  test("sans rien de coupé (ou un serveur d'avant ce champ) : ni alerte ni section des coupées", () => {
    for (const coupees of [[], undefined]) {
      const html = rendre({ ...lues, coupees });
      expect(html).not.toContain("Coupée pour Iris");
      expect(html).not.toContain(">Coupées pour Iris</h3>");
      expect(html).not.toContain("Lui donner");
    }
  });

  test("la ligne du panneau dit qu'une skill de sa fiche lui est coupée, et ne compte pas les coupées comme disponibles", () => {
    expect(resumeCompetences({ etat: "pret", valeur: lues })).toBe("1 dans sa fiche · coupée");
    expect(resumeCompetences({ etat: "pret", valeur: { ...lues, coupees: [] } })).toBe("1 dans sa fiche");
    expect(resumeCompetences({ etat: "pret", valeur: { ...lues, fiche: [] } })).toBe("1 disponible");
  });
});
