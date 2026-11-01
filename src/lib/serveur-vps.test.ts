import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CHEMIN_SERVEUR,
  MESSAGE_INVITATION,
  MESSAGE_REPONSE,
  MESSAGE_VERSION,
  ajouterServeur,
  carnetVide,
  choisirServeur,
  interroger,
  lireCarnet,
  lireCorps,
  lienCopie,
  lireSaisie,
  placePour,
  quitterServeur,
  retirerServeur,
} from "./serveur-vps";

const klyra = { adresse: "https://klyra-vps.exemple:8787", invitation: null, nom: "Klyra-vps", version: "1" };
const autre = { adresse: "https://autre.exemple", invitation: "abc", nom: "Autre", version: "1" };

describe("adresse d’un VPS", () => {
  test("une adresse https devient l’origine, sans chemin", () => {
    expect(lireSaisie("https://mon-vps.exemple:8787/klyra/v1/serveur", "")).toEqual({
      ok: true,
      adresse: "https://mon-vps.exemple:8787",
      invitation: null,
    });
  });

  test("un hôte nu ou une IPv4 ne remplace pas le lien", () => {
    expect(lireSaisie("mon-vps.exemple:8787", "").ok).toBe(false);
    expect(lireSaisie("2.24.45.214", "").ok).toBe(false);
    expect(lireSaisie("https://2.24.45.214", "").ok).toBe(false);
  });

  test("http n’est accepté que sur la machine locale", () => {
    expect(lireSaisie("http://127.0.0.1:8787", "").ok).toBe(true);
    expect(lireSaisie("http://mon-vps.exemple", "").ok).toBe(false);
  });

  test("l’invitation klyra:// porte l’adresse et le code", () => {
    const lu = lireSaisie("klyra://rejoindre?adresse=https%3A%2F%2Fmon-vps.exemple%3A8787&invitation=code", "");
    expect(lu).toEqual({ ok: true, adresse: "https://mon-vps.exemple:8787", invitation: "code" });
  });

  test("le champ invitation remplace celui du lien, et ne se retrouve pas dans l’adresse", () => {
    const lu = lireSaisie("klyra://rejoindre?adresse=https%3A%2F%2Fmon-vps.exemple&invitation=lien", "champ");
    expect(lu).toEqual({ ok: true, adresse: "https://mon-vps.exemple", invitation: "champ" });
  });

  test("un mot de passe dans l’adresse est refusé", () => {
    expect(lireSaisie("https://moi:secret@mon-vps.exemple", "").ok).toBe(false);
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
    const lien = "klyra://rejoindre?adresse=https%3A%2F%2Fmon-vps.exemple&invitation=abc";
    expect(lienCopie(`  ${lien}\n`)).toBe(lien);
  });

  test("tout autre texte est ignoré", () => {
    expect(lienCopie("https://mon-vps.exemple")).toBeNull();
    expect(lienCopie("un mot de passe")).toBeNull();
    expect(lienCopie("klyra://rejoindre?invitation=abc")).toBeNull();
    expect(lienCopie("klyra://connexion?code=abc")).toBeNull();
    expect(lienCopie(null)).toBeNull();
  });
});

describe("appel au VPS", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { window?: unknown }).window;
  });

  test("la fenêtre n’appelle pas fetch : une coupure connect-src ne donne plus le silence", async () => {
    const fetchMock = vi.fn(() => {
      throw new Error("Refused to connect because it violates the document's Content Security Policy.");
    });
    vi.stubGlobal("fetch", fetchMock);
    (globalThis as { window?: unknown }).window = {
      klyra: {
        serveur: {
          interroger: async () => ({ ok: true, data: { ok: true, nom: "Klyra-VPS", version: "1" } }),
        },
      },
    };
    await expect(interroger("https://exemple.test", "code")).resolves.toEqual({ ok: true, nom: "Klyra-VPS", version: "1" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("hors Electron, le téléphone appelle en fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ produit: "klyra-serveur", protocole: 1, nom: "Klyra-VPS", version: "1" }), { status: 200 })),
    );
    await expect(interroger("https://exemple.test", null)).resolves.toEqual({ ok: true, nom: "Klyra-VPS", version: "1" });
    expect(fetch).toHaveBeenCalledOnce();
  });
});
