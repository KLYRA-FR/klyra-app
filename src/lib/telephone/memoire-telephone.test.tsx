// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { SouvenirsRecents } from "./gestes-memoire";

/* L'écran Mémoire du téléphone rendu en texte, avec un poste et des lectures simulés. */
const simule = vi.hoisted(() => ({
  lectures: {} as Record<string, Record<string, unknown>>,
  demandes: [] as { type: string; args: unknown }[],
  ouvert: true,
}));

vi.mock("convex/react", () => ({ useQuery: () => undefined, useMutation: () => vi.fn(), useConvex: () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/memoire",
}));
vi.mock("next/link", () => ({ default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a> }));
vi.mock("@/lib/poste/client", () => ({
  useLecturePoste: (type: string, args: unknown) => {
    if (args !== null) simule.demandes.push({ type, args });
    return { ...(args === null ? { etat: "attente", lent: false } : simule.lectures[type] ?? { etat: "attente", lent: false }), relancer: () => undefined };
  },
  useGestePoste: () => ({ faire: vi.fn(), occupe: false }),
}));
vi.mock("@/components/telephone/poste", () => {
  const poste = () => ({ cle: "poste-essai", systeme: "mac", nom: "MacBook", ouvert: simule.ouvert, dernierSignal: 0 });
  return { usePostes: () => ({ postes: [poste()], principal: poste(), ouvert: simule.ouvert, horsLigne: false, charge: false }), useSupport: () => "ton Mac" };
});
vi.mock("@/lib/lieux", async (original) => ({ ...(await original<typeof import("@/lib/lieux")>()), useServeursRelies: () => [], useLieuActif: () => null }));
vi.mock("@/lib/compte", () => ({ useCompte: () => ({ etat: "connecte", moi: { _id: "moi", email: "camille.essai@example.test" } }), messageErreur: () => "", codeErreur: () => null }));

const { MemoireTelephone } = await import("@/components/telephone/MemoireTelephone");
const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

beforeEach(() => {
  simule.lectures = {};
  simule.demandes = [];
  simule.ouvert = true;
});

describe("Mémoire sur le téléphone", () => {
  test("sans recherche : les souvenirs récents de tous les agents, lus dans l'espace choisi", () => {
    const recents: SouvenirsRecents = {
      total: 12, tronque: true,
      souvenirs: [{ id: "souvenir:dev:1", nom: "Client Acme", agent: "dev", nomAgent: "Hugo", type: "project", resume: "Livraison le vendredi", date: "2026-11-08T10:00:00.000Z", projet: null, liens: 2 }],
    };
    simule.lectures["memoire.souvenirs"] = { etat: "ok", data: recents };
    const t = texte(renderToStaticMarkup(<MemoireTelephone />));
    expect(t).toContain("Souvenirs récents des agents");
    expect(t).toContain("Client Acme");
    expect(t).toContain("Hugo · Livraison le vendredi");
    expect(t).toContain("Projet");
    expect(t).toContain("Les plus récents seulement");
    expect(simule.demandes).toEqual([{ type: "memoire.souvenirs", args: { lieu: null } }]);
  });

  test("aucun souvenir : il le dit, et rappelle que chercher trouve aussi notes et documents", () => {
    simule.lectures["memoire.souvenirs"] = { etat: "ok", data: { souvenirs: [], total: 0, tronque: false } };
    expect(texte(renderToStaticMarkup(<MemoireTelephone />))).toContain("Aucun souvenir");
  });

  test("ordinateur fermé, sans vue gardée : pas de faux « rien », la raison", () => {
    simule.ouvert = false;
    simule.lectures["memoire.souvenirs"] = { etat: "ferme", gardee: null };
    const t = texte(renderToStaticMarkup(<MemoireTelephone />));
    expect(t).not.toContain("Aucun souvenir");
    expect(t).toMatch(/ton Mac/i);
  });
});
