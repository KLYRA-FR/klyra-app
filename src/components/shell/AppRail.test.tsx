// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { AppRail } from "./AppRail";

vi.mock("next/navigation", () => ({
  usePathname: () => "/chat",
  useSearchParams: () => new URLSearchParams("id=dm-principal"),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/workspace", () => ({
  useProjects: () => [],
  useChatsEspace: () => [],
  useWorkspace: () => ({ state: { travail: {} } }),
  estConversationAgent: () => true,
  FIL: "fil-",
}));
vi.mock("@/components/project/MenuProjet", () => ({
  useMenuProjet: () => ({ ouvrirMenu: vi.fn(), menuProjet: null }),
}));
vi.mock("./CarteCompte", () => ({ CarteCompteRail: () => <button>Compte</button> }));
vi.mock("@/components/chat/CarteUtilisation", () => ({
  UtilisationRail: () => <button>Utilisation</button>,
}));
vi.mock("@/lib/maj", () => ({
  useMaj: () => ({ etat: { statut: "prete", nouvelle: "0.0.99" }, installer: vi.fn(), erreur: null }),
}));
// Même avec deux MCP en défaut, le rail ne doit plus proposer cette fenêtre.
vi.mock("@/lib/sante-mcp", () => ({
  useSanteMcp: () => ({
    defauts: [
      { lieu: null, agent: "principal", mcp: "mcp-un", etat: "authentification", depuis: 1 },
      { lieu: "https://vps.example.test", agent: "dev", mcp: "mcp-deux", etat: "echec", depuis: 1 },
    ],
  }),
}));

describe("rail sans carte Connexion", () => {
  test("deux défauts MCP ne montrent ni carte ni entrée vers les connexions des agents", () => {
    const html = renderToStaticMarkup(<AppRail />);
    expect(html).toContain('aria-label="Navigation principale"');
    expect(html).not.toContain(">Connexion<");
    expect(html).not.toContain("connexions d’agents à reprendre");
    expect(html).not.toContain("Connexions des agents");
    expect(html).not.toContain('aria-haspopup="dialog"');
  });

  test("la mise à jour prête, l’utilisation, le compte et les liens restent dans le rail", () => {
    const html = renderToStaticMarkup(<AppRail />);
    expect(html).toContain('aria-label="Mettre à jour KLYRA vers la version 0.0.99 : installe et relance l’app"');
    expect(html).toContain(">Utilisation</button>");
    expect(html).toContain(">Compte</button>");
    expect(html).toContain('href="/projets"');
    expect(html).toContain('href="/chats"');
  });
});
