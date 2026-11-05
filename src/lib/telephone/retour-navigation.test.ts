// @vitest-environment node
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { marquerFeuille, useNumeroterNavigation, useRetour } from "@/components/telephone/retour";

const simule = vi.hoisted(() => ({ effet: null as (() => void | (() => void)) | null, replace: vi.fn(), back: vi.fn() }));
vi.mock("react", async (importer) => ({
  ...(await importer<typeof import("react")>()),
  useEffect: (effet: () => void | (() => void)) => { simule.effet = effet; },
  useCallback: (fonction: unknown) => fonction,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: simule.replace, back: simule.back }) }));

function navigateur(etat: Record<string, unknown> = {}) {
  const cible = new EventTarget();
  const pile = [{ url: "/equipe?agent=dev&mode=competences", etat }];
  let position = 0;
  const historique = {
    get state() { return pile[position].etat; },
    get length() { return pile.length; },
    pushState(data: Record<string, unknown>, _titre: string, url?: string | URL | null) {
      pile.splice(position + 1);
      pile.push({ url: url?.toString() ?? pile[position].url, etat: data });
      position++;
    },
    replaceState(data: Record<string, unknown>, _titre: string, url?: string | URL | null) {
      pile[position] = { url: url?.toString() ?? pile[position].url, etat: data };
    },
    back: vi.fn(() => {
      if (!position) return;
      position--;
      cible.dispatchEvent(new Event("popstate"));
    }),
    forward: vi.fn(() => {
      if (position + 1 >= pile.length) return;
      position++;
      cible.dispatchEvent(new Event("popstate"));
    }),
  };
  vi.stubGlobal("window", { history: historique, addEventListener: cible.addEventListener.bind(cible), removeEventListener: cible.removeEventListener.bind(cible) });
  simule.back.mockImplementation(() => historique.back());
  return historique;
}

let nettoyer: (() => void) | void;
function monter() {
  // eslint-disable-next-line react-hooks/rules-of-hooks -- Effet exécuté par ce banc d’historique, hooks React simulés.
  useNumeroterNavigation();
  nettoyer = simule.effet?.();
}
beforeEach(() => { vi.clearAllMocks(); });
afterEach(() => { nettoyer?.(); nettoyer = undefined; vi.unstubAllGlobals(); });

describe("retour depuis Compétences", () => {
  test("une ouverture avec un ancien rang repart à zéro, garde Next et revient à la fiche", () => {
    const historique = navigateur({ __NA: true, arbre: ["equipe"], klyraIdx: 4 });
    monter();
    expect(historique.state).toEqual({ __NA: true, arbre: ["equipe"], klyraIdx: 0 });
    useRetour("/equipe?agent=dev")();
    expect(simule.replace).toHaveBeenCalledWith("/equipe?agent=dev");
    expect(simule.back).not.toHaveBeenCalled();
  });

  test("une sous-page poussée revient à la page précédente et conserve le rang au replace", () => {
    const historique = navigateur();
    monter();
    historique.pushState({ __NA: true }, "", "/equipe?agent=dev&mode=competences");
    historique.replaceState({ __NA: true }, "", "/equipe?agent=dev&section=competences");
    expect(historique.state.klyraIdx).toBe(1);
    useRetour("/equipe?agent=dev")();
    expect(historique.state.klyraIdx).toBe(0);
    expect(simule.back).toHaveBeenCalledOnce();
    expect(simule.replace).not.toHaveBeenCalled();
  });

  test("une feuille déjà fermée est sautée au retour vers la page", () => {
    const historique = navigateur();
    monter();
    marquerFeuille("details", true);
    historique.pushState({ klyraFeuille: "details" }, "");
    historique.pushState({}, "", "/equipe?agent=dev&section=competences");
    marquerFeuille("details", false);
    useRetour("/equipe?agent=dev")();
    expect(historique.state.klyraIdx).toBe(0);
    expect(historique.back).toHaveBeenCalledTimes(2);
  });
});
