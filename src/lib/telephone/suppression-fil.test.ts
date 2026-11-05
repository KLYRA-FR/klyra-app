import { describe, expect, test, vi } from "vitest";
import { prevoirSuppression, type EtatSuppression } from "./suppression-fil";

function essai(supprimer: () => Promise<unknown> = () => Promise.resolve(null)) {
  const appel = vi.fn(supprimer);
  const etats: EtatSuppression[] = [];
  const s = prevoirSuppression({ supprimer: appel, suivre: (e) => etats.push(e) });
  return { s, appel, etats };
}

describe("suppression différée d'un fil (lot 2, E2-51)", () => {
  test("annulée avant l'échéance : aucune mutation, et l'échéance qui suit n'envoie rien", () => {
    const { s, appel, etats } = essai();
    s.annuler();
    s.echeance();
    expect(appel).not.toHaveBeenCalled();
    expect(etats).toEqual(["restauree"]);
  });

  test("écran quitté avant l'échéance : abandonnée, jamais envoyée plus tard", () => {
    const { s, appel, etats } = essai();
    s.abandonner();
    s.echeance();
    s.annuler();
    expect(appel).not.toHaveBeenCalled();
    expect(etats).toEqual(["abandonnee"]);
  });

  test("à l'échéance : une seule demande, « en cours » puis « faite » ; plus d'annulation possible", async () => {
    const { s, appel, etats } = essai();
    s.echeance();
    s.echeance();
    s.annuler();
    s.abandonner();
    await Promise.resolve();
    await Promise.resolve();
    expect(appel).toHaveBeenCalledTimes(1);
    expect(etats).toEqual(["en-cours", "faite"]);
  });

  test("échec du compte : le fil est restauré avec l'erreur", async () => {
    const erreur = new Error("hors ligne");
    const etats: [EtatSuppression, unknown][] = [];
    const s = prevoirSuppression({ supprimer: () => Promise.reject(erreur), suivre: (e, err) => etats.push([e, err]) });
    s.echeance();
    await Promise.resolve();
    await Promise.resolve();
    expect(etats).toEqual([
      ["en-cours", undefined],
      ["restauree", erreur],
    ]);
  });
});
