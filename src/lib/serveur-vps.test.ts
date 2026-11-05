import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CHEMIN_SERVEUR,
  MESSAGE_INVITATION,
  MESSAGE_REPONSE,
  MESSAGE_VERSION,
  VERSION_CODE_SERVEUR,
  ajouterServeur,
  carnetVide,
  choisirServeur,
  appairer,
  interroger,
  lireCarnet,
  lireCorps,
  lienCopie,
  libelleServeur,
  lireSaisie,
  placePour,
  quitterServeur,
  retardDe,
  retirer,
  retirerServeur,
  serveurEnRetard,
} from "./serveur-vps";

const klyra = { adresse: "https://klyra-vps.exemple:8787", nom: "Klyra-vps", version: "1" };
const autre = { adresse: "https://autre.exemple", nom: "Autre", version: "1" };

describe("adresse d’un VPS", () => {
  test("une adresse https devient l’origine, sans chemin", () => {
    expect(lireSaisie("https://mon-vps.exemple:8787/klyra/v1/serveur")).toEqual({
      ok: true,
      adresse: "https://mon-vps.exemple:8787",
      code: null,
    });
  });

  test("un hôte nu ou une IPv4 ne remplace pas le lien", () => {
    expect(lireSaisie("mon-vps.exemple:8787").ok).toBe(false);
    expect(lireSaisie("2.24.45.214").ok).toBe(false);
    expect(lireSaisie("https://2.24.45.214").ok).toBe(false);
  });

  test("http n’est accepté que sur la machine locale", () => {
    expect(lireSaisie("http://127.0.0.1:8787").ok).toBe(true);
    expect(lireSaisie("http://mon-vps.exemple").ok).toBe(false);
  });

  test("le lien klyra:// porte l’adresse et le code à usage unique", () => {
    const lu = lireSaisie("klyra://rejoindre?adresse=https%3A%2F%2Fmon-vps.exemple%3A8787&code=abcdefgh23");
    expect(lu).toEqual({ ok: true, adresse: "https://mon-vps.exemple:8787", code: "ABCDEFGH23" });
  });

  test("un code illisible est refusé, une ancienne invitation n’est plus lue", () => {
    expect(lireSaisie("klyra://rejoindre?adresse=https%3A%2F%2Fmon-vps.exemple&code=a%20b").ok).toBe(false);
    expect(lireSaisie("klyra://rejoindre?adresse=https%3A%2F%2Fmon-vps.exemple&invitation=ancienne")).toEqual({
      ok: true,
      adresse: "https://mon-vps.exemple",
      code: null,
    });
  });

  test("un mot de passe dans l’adresse est refusé", () => {
    expect(lireSaisie("https://moi:secret@mon-vps.exemple").ok).toBe(false);
  });

  test("le chemin du protocole est fixe", () => {
    expect(CHEMIN_SERVEUR).toBe("/klyra/v1/serveur");
  });
});

describe("réponse du VPS", () => {
  test("un serveur KLYRA de la même version est accepté", () => {
    expect(lireCorps(200, { produit: "klyra-serveur", protocole: 1, nom: "Klyra-vps", version: "1" })).toEqual({
      ok: true,
      nom: "Klyra-vps",
      version: "1",
    });
  });

  test("une invitation refusée, une autre version, ou autre chose", () => {
    expect(lireCorps(401, { erreur: "invitation" })).toEqual({ ok: false, message: MESSAGE_INVITATION });
    expect(lireCorps(200, { produit: "klyra-serveur", protocole: 2, nom: "X", version: "2" })).toEqual({
      ok: false,
      message: MESSAGE_VERSION,
    });
    expect(lireCorps(200, { bonjour: true })).toEqual({ ok: false, message: MESSAGE_REPONSE });
  });
});

describe("carnet de serveurs", () => {
  test("on en ajoute un, puis un autre, sans doublon", () => {
    const un = ajouterServeur(carnetVide(), klyra);
    const deux = ajouterServeur(un, autre);
    expect(deux.liste.map((serveur) => serveur.nom)).toEqual(["Klyra-vps", "Autre"]);
    expect(deux.actif).toBe(autre.adresse);
    expect(deux.liste[0]?.etat).toBe("joint");
    const encore = ajouterServeur(deux, { ...klyra, nom: "Klyra-vps" });
    expect(encore.liste).toHaveLength(2);
    expect(encore.actif).toBe(klyra.adresse);
  });

  test("quitter laisse le serveur, retirer l’enlève", () => {
    const deux = ajouterServeur(ajouterServeur(carnetVide(), klyra), autre);
    const quitte = quitterServeur(deux, klyra.adresse);
    expect(quitte.liste).toHaveLength(2);
    expect(quitte.liste.find((serveur) => serveur.id === klyra.adresse)?.etat).toBe("quitte");
    expect(quitte.actif).toBe(autre.adresse);
    const choisi = choisirServeur(quitte, klyra.adresse);
    expect(choisi.actif).toBe(autre.adresse);
    const retire = retirerServeur(quitte, autre.adresse);
    expect(retire.liste.map((serveur) => serveur.id)).toEqual([klyra.adresse]);
    expect(retire.actif).toBeNull();
  });

  test("un carnet illisible repart de zéro, et la vingtième place est la dernière", () => {
    expect(lireCarnet("pas du json")).toEqual(carnetVide());
    expect(lireCarnet(JSON.stringify({ actif: klyra.adresse, liste: [{ ...klyra, id: klyra.adresse, etat: "joint" }] })).actif).toBe(klyra.adresse);
    let carnet = carnetVide();
    for (let i = 0; i < 20; i += 1) carnet = ajouterServeur(carnet, { ...klyra, adresse: `https://s${i}.exemple`, nom: `S${i}` });
    expect(placePour(carnet, "https://nouveau.exemple")).toBe(false);
    expect(ajouterServeur(carnet, { ...klyra, adresse: "https://nouveau.exemple", nom: "Nouveau" }).liste).toHaveLength(20);
    expect(placePour(carnet, "https://s0.exemple")).toBe(true);
  });
});

describe("lien copié", () => {
  test("un lien klyra://rejoindre lisible est repris", () => {
    const lien = "klyra://rejoindre?adresse=https%3A%2F%2Fmon-vps.exemple&code=ABCDEFGH23";
    expect(lienCopie(`  ${lien}\n`)).toBe(lien);
  });

  test("tout autre texte est ignoré", () => {
    expect(lienCopie("https://mon-vps.exemple")).toBeNull();
    expect(lienCopie("un mot de passe")).toBeNull();
    expect(lienCopie("klyra://rejoindre?invitation=abc")).toBeNull();
    expect(lienCopie("klyra://rejoindre?adresse=https%3A%2F%2Fmon-vps.exemple&invitation=ancienne")).toBeNull();
    expect(lienCopie("klyra://connexion?code=abc")).toBeNull();
    expect(lienCopie(null)).toBeNull();
  });
});

describe("appel au VPS", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { window?: unknown }).window;
  });

  test("la fenêtre n’appelle pas fetch : le processus principal appaire et garde le jeton", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("Refused to connect because it violates the document's Content Security Policy.");
    });
    vi.stubGlobal("fetch", fetchMock);
    const appels: unknown[][] = [];
    (globalThis as { window?: unknown }).window = {
      klyra: {
        serveur: {
          interroger: async (...args: unknown[]) => (appels.push(["interroger", ...args]), { ok: true, data: { ok: true, nom: "Klyra-VPS", version: "1" } }),
          appairer: async (...args: unknown[]) => (appels.push(["appairer", ...args]), { ok: true, data: { ok: true, nom: "Klyra-VPS", version: "1" } }),
          retirer: async (...args: unknown[]) => (appels.push(["retirer", ...args]), { ok: true, data: true }),
        },
      },
    };
    await expect(appairer("https://exemple.test", "ABCDEFGH23")).resolves.toEqual({ ok: true, nom: "Klyra-VPS", version: "1" });
    await expect(interroger("https://exemple.test")).resolves.toEqual({ ok: true, nom: "Klyra-VPS", version: "1" });
    await retirer("https://exemple.test");
    expect(appels).toEqual([
      ["appairer", "https://exemple.test", "ABCDEFGH23"],
      ["interroger", "https://exemple.test"],
      ["retirer", "https://exemple.test"],
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("hors Electron, le téléphone appaire en fetch puis envoie son jeton", async () => {
    const memoire = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (cle: string) => memoire.get(cle) ?? null,
      setItem: (cle: string, valeur: string) => void memoire.set(cle, valeur),
    });
    const corps = { produit: "klyra-serveur", protocole: 1, nom: "Klyra-VPS", version: "1" };
    const jeton = "j".repeat(43);
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith("/klyra/v1/appairer")) return new Response(JSON.stringify({ ...corps, jeton }), { status: 200 });
      if (url.endsWith("/klyra/v1/appareil")) return new Response(null, { status: 204 });
      const auth = (init?.headers as Record<string, string> | undefined)?.Authorization;
      return auth === `Bearer ${jeton}` ? new Response(JSON.stringify(corps), { status: 200 }) : new Response("{}", { status: 401 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(interroger("https://exemple.test")).resolves.toEqual({ ok: false, message: MESSAGE_INVITATION });
    await expect(appairer("https://exemple.test", "ABCDEFGH23")).resolves.toEqual({ ok: true, nom: "Klyra-VPS", version: "1" });
    await expect(interroger("https://exemple.test")).resolves.toEqual({ ok: true, nom: "Klyra-VPS", version: "1" });
    await retirer("https://exemple.test");
    await expect(interroger("https://exemple.test")).resolves.toEqual({ ok: false, message: MESSAGE_INVITATION });
  });
});

describe("la version du code du serveur", () => {
  const corps = { produit: "klyra-serveur", protocole: 1, nom: "Klyra-VPS", version: "1" };

  test("elle est lue à part du protocole", () => {
    const lu = lireCorps(200, { ...corps, versionCode: 7 });
    expect(lu).toEqual({ ok: true, nom: "Klyra-VPS", version: "1", versionCode: 7 });
  });

  test("un ancien serveur, qui n’en renvoie pas, reste accepté mais n’est pas à jour", () => {
    const lu = lireCorps(200, corps);
    expect(lu).toEqual({ ok: true, nom: "Klyra-VPS", version: "1" });
    expect(retardDe(lu)).toBe(true);
  });

  test.each([["texte", "9999"], ["zéro", 0], ["négative", -1], ["décimale", 1.5], ["nulle", null]])("une version illisible (%s) compte comme absente", (_nom, versionCode) => {
    const lu = lireCorps(200, { ...corps, versionCode });
    expect(lu).toEqual({ ok: true, nom: "Klyra-VPS", version: "1" });
    expect(retardDe(lu)).toBe(true);
  });

  test("seul un code plus ancien que celui attendu est en retard", () => {
    expect(serveurEnRetard(undefined)).toBe(true);
    expect(serveurEnRetard(VERSION_CODE_SERVEUR - 1)).toBe(true);
    expect(serveurEnRetard(VERSION_CODE_SERVEUR)).toBe(false);
    expect(serveurEnRetard(VERSION_CODE_SERVEUR + 1)).toBe(false);
  });

  test("un serveur qui ne répond pas n’a pas d’âge connu", () => {
    expect(retardDe({ ok: false, message: MESSAGE_VERSION })).toBe(false);
  });

  test("le libellé le dit, seulement quand le serveur répond", () => {
    expect(libelleServeur("joint", "repond", "pret", true)).toBe("Répond · à mettre à jour");
    expect(libelleServeur("joint", "repond", "pret", false)).toBe("Répond · agents prêts");
    expect(libelleServeur("joint", "repond", "pret")).toBe("Répond · agents prêts");
    expect(libelleServeur("joint", "silence", undefined, true)).toBe("Ne répond pas");
    expect(libelleServeur("quitte", "repond", "pret", true)).toBe("Quitté");
  });
});
