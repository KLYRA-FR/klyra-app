import { describe, expect, test, vi } from "vitest";
import type { Acces, Reglages } from "@/lib/bridge";
import { ErreurPoste } from "@/lib/poste/types";
import { CONFIGURATION_PAR_DEFAUT } from "../../../electron/configuration-klyra";
import { SKILLS_PAR_DEFAUT } from "../../../electron/skills-par-agent";
import { gestesReglages, type DepsReglages } from "./gestes-reglages";
import { RAISONS } from "./reglages";

function poste(acces: Acces = "projet", computerUse = true) {
  let reglages: Reglages = {
    notifications: { actives: true, pastille: true, son: true, agentFini: true, agentErreur: true, workflow: true, majPrete: true, mcpDefaut: true },
    computerUse: { actif: computerUse },
    navigateur: { agents: true, moteur: "integre" },
    sons: { finDeTache: true, theme: "chaleureux", volume: 0.7 },
    configuration: CONFIGURATION_PAR_DEFAUT,
    skillsParAgent: SKILLS_PAR_DEFAUT,
    suggestions: { actives: true },
  };
  const deps = {
    ton: "ton Mac",
    acces: () => acces,
    choisirAcces: vi.fn((a: Acces) => {
      acces = a;
    }),
    reglages: async () => reglages,
    changerNotification: vi.fn(async (cle, valeur) => {
      reglages = { ...reglages, notifications: { ...reglages.notifications, [cle]: valeur } };
    }),
    changerComputerUse: vi.fn(async (actif: boolean) => {
      reglages = { ...reglages, computerUse: { actif } };
    }),
    changerSonFinTache: vi.fn(async () => undefined),
    essaiNotification: vi.fn(async () => undefined),
    autorisations: async () => null,
    maj: async () => null,
    verifierMaj: async () => null,
    claude: async () => ({ compte: null, utilisation: null }),
    consommation: async () => null,
    agents: () => ({ acces, assistant: { nom: "Léa", teinte: "bleu-k1" }, agents: [{ id: "dev", nom: "Hugo", tag: "Dev", teinte: "vert", modele: "opus" }] }),
    changerModele: vi.fn(async () => undefined),
  } satisfies DepsReglages;
  return { deps, gestes: gestesReglages(deps) };
}

async function refus(promesse: Promise<unknown>): Promise<ErreurPoste> {
  const erreur = await promesse.then(
    () => null,
    (e: unknown) => e,
  );
  expect(erreur).toBeInstanceOf(ErreurPoste);
  return erreur as ErreurPoste;
}

describe("gestes « reglages » : aucune élévation de pouvoir depuis le téléphone (M-13)", () => {
  test("« Tout accepter » est refusé par le poste, même demandé tel quel", async () => {
    for (const depart of ["demander", "projet", "tout"] as Acces[]) {
      const { deps, gestes } = poste(depart);
      const e = await refus(gestes["reglages.acces"]({ acces: "tout" }));
      expect(e.code).toBe("ordinateur");
      expect(e.message).toBe(`Sur ton Mac : ${RAISONS.toutAccepter}`);
      expect(deps.choisirAcces).not.toHaveBeenCalled();
    }
  });

  test("monter de « Me demander » à « Le projet en autonomie » est refusé aussi", async () => {
    const { deps, gestes } = poste("demander");
    expect((await refus(gestes["reglages.acces"]({ acces: "projet" }))).code).toBe("ordinateur");
    expect(deps.choisirAcces).not.toHaveBeenCalled();
  });

  test("descendre le niveau d'accès est permis", async () => {
    const { deps, gestes } = poste("tout");
    await expect(gestes["reglages.acces"]({ acces: "demander" })).resolves.toEqual({ acces: "demander" });
    expect(deps.choisirAcces).toHaveBeenCalledWith("demander");
  });

  test("un niveau inconnu est illisible", async () => {
    const { gestes } = poste();
    expect((await refus(gestes["reglages.acces"]({ acces: "admin" }))).code).toBe("arguments");
    expect((await refus(gestes["reglages.acces"](null))).code).toBe("arguments");
  });

  test("activer Computer Use est refusé ; le couper est permis", async () => {
    const { deps, gestes } = poste("projet", false);
    const e = await refus(gestes["reglages.computerUse"]({ actif: true }));
    expect(e.code).toBe("ordinateur");
    expect(e.message).toBe(`Sur ton Mac : ${RAISONS.computerUse}`);
    expect(deps.changerComputerUse).not.toHaveBeenCalled();

    const allume = poste("projet", true);
    await expect(allume.gestes["reglages.computerUse"]({ actif: false })).resolves.toEqual({ actif: false });
    expect(allume.deps.changerComputerUse).toHaveBeenCalledWith(false);
  });

  test("« Computer Use » mal formé ne passe pas", async () => {
    const { deps, gestes } = poste();
    expect((await refus(gestes["reglages.computerUse"]({ actif: "true" }))).code).toBe("arguments");
    expect(deps.changerComputerUse).not.toHaveBeenCalled();
  });

  test("installer une mise à jour reste devant l'ordinateur", async () => {
    const { gestes } = poste();
    const e = await refus(gestes["reglages.installerMaj"]({}));
    expect(e.message).toBe(`Sur ton Mac : ${RAISONS.maj}`);
  });

  test("une notification se change, une clé inconnue non", async () => {
    const { deps, gestes } = poste();
    await expect(gestes["reglages.notification"]({ cle: "agentFini", valeur: false })).resolves.toEqual({ cle: "agentFini", valeur: false });
    expect((await refus(gestes["reglages.notification"]({ cle: "computerUse", valeur: true }))).code).toBe("arguments");
    expect(deps.changerNotification).toHaveBeenCalledTimes(1);
  });

  test("un changement qui n'a pas pris est dit au téléphone", async () => {
    const { deps, gestes } = poste();
    deps.changerNotification.mockImplementationOnce(async () => undefined);
    expect((await refus(gestes["reglages.notification"]({ cle: "son", valeur: false }))).code).toBe("erreur");
  });

  test("le modèle d'un agent : seulement un agent actif et un modèle connu", async () => {
    const { deps, gestes } = poste();
    await expect(gestes["reglages.modele"]({ id: "dev", modele: "sonnet" })).resolves.toEqual({ id: "dev", modele: "sonnet" });
    expect((await refus(gestes["reglages.modele"]({ id: "dev", modele: "gpt-5" }))).code).toBe("arguments");
    expect((await refus(gestes["reglages.modele"]({ id: "inconnu", modele: "opus" }))).code).toBe("introuvable");
    expect(deps.changerModele).toHaveBeenCalledTimes(1);
  });
});
