import { afterEach, describe, expect, test, vi } from "vitest";
import { api } from "./_generated/api";
import { HEURE_MS } from "./model/limites";
import {
  connecter,
  courrielsRecus,
  demanderLien,
  demanderLienDirect,
  dernierLien,
  enSecondes,
  initialiser,
  nouvelEssai,
  ouvrirLien,
  patienter,
} from "./test.utils";

/** Le délai entre deux liens (`model/limites.ts`), sur l'horloge simulée du serveur : on l'avance, on n'attend pas. */

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

const CORENTIN = "corentin@klyra.design";
const PELIN = "pelin@klyra.design";
const ACCEPTEE = { acceptee: true, secondes: 60 };

describe("délai entre deux liens", () => {
  test("redemandé dans la minute : refusé avec l'attente restante, pas de nouvel e-mail, le premier lien reste valable", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    expect(enSecondes(await demanderLien(t, CORENTIN))).toEqual(ACCEPTEE);
    const premier = await dernierLien(t, CORENTIN);

    await patienter(t, 5_000);
    expect(enSecondes(await demanderLien(t, CORENTIN))).toEqual({ acceptee: false, secondes: 55 });
    expect(await courrielsRecus(t, CORENTIN)).toBe(1);
    const { tokens } = await ouvrirLien(t, CORENTIN, premier!.code);
    expect(tokens?.token).toBeTruthy();
  });

  test("double clic, demandes simultanées, même adresse écrite autrement : un seul e-mail", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const reponses = await Promise.all([
      t.mutation(api.connexion.demanderLien, { email: CORENTIN }),
      t.mutation(api.connexion.demanderLien, { email: CORENTIN }),
      t.mutation(api.connexion.demanderLien, { email: " Corentin@klyra.design" }),
    ]);
    await patienter(t, 50);
    expect(reponses.map(enSecondes).filter((r) => r.acceptee)).toEqual([ACCEPTEE]);
    expect(reponses.map(enSecondes).filter((r) => !r.acceptee)).toEqual([
      { acceptee: false, secondes: 60 },
      { acceptee: false, secondes: 60 },
    ]);
    expect(await courrielsRecus(t, CORENTIN)).toBe(1);
  });

  test("fin du délai : un nouveau lien part ; cinq par heure au plus, puis l'attente va jusqu'au bout de l'heure", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    for (let i = 0; i < 4; i++) {
      expect(enSecondes(await demanderLien(t, CORENTIN))).toEqual(ACCEPTEE);
      await patienter(t, 60_000);
    }
    // Le cinquième lien de l'heure part, et la réponse annonce déjà l'attente jusqu'au bout de l'heure.
    const cinquieme = enSecondes(await demanderLien(t, CORENTIN));
    expect(cinquieme).toEqual({ acceptee: true, secondes: 56 * 60 });
    await patienter(t, 60_000);
    expect(await courrielsRecus(t, CORENTIN)).toBe(5);
    const sixieme = enSecondes(await demanderLien(t, CORENTIN));
    expect(sixieme.acceptee).toBe(false);
    expect(sixieme.secondes).toBeGreaterThan(54 * 60);
    expect(sixieme.secondes).toBeLessThanOrEqual(55 * 60);
    await patienter(t, sixieme.secondes * 1000);
    expect(enSecondes(await demanderLien(t, CORENTIN))).toEqual(ACCEPTEE);
    expect(await courrielsRecus(t, CORENTIN)).toBe(6);
  });

  test("membre, invitée, retirée ou inconnue : mêmes réponses au même moment ; seules les admises reçoivent un e-mail", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const corentin = await connecter(t, CORENTIN);
    await corentin.mutation(api.equipe.inviter, { email: "yanis@klyra.design", nom: "Yanis", role: "membre" });
    await connecter(t, "yanis@klyra.design");
    const yanis = (await corentin.query(api.equipe.membres, {})).find((m) => m.email === "yanis@klyra.design")!;
    await corentin.mutation(api.equipe.retirer, { membreId: yanis._id });
    await patienter(t, 60_000);

    const adresses = [CORENTIN, PELIN, "yanis@klyra.design", "inconnu@example.com"];
    const avant = await Promise.all(adresses.map((a) => courrielsRecus(t, a)));
    const premieres = [];
    for (const a of adresses) premieres.push(enSecondes(await t.mutation(api.connexion.demanderLien, { email: a })));
    await patienter(t, 10_000);
    const secondes = [];
    for (const a of adresses) secondes.push(enSecondes(await t.mutation(api.connexion.demanderLien, { email: a })));
    await patienter(t, 50);

    expect(premieres).toEqual(adresses.map(() => ACCEPTEE));
    expect(secondes).toEqual(adresses.map(() => ({ acceptee: false, secondes: 50 })));
    const apres = await Promise.all(adresses.map((a) => courrielsRecus(t, a)));
    expect(apres.map((n, i) => n - avant[i])).toEqual([1, 1, 0, 0]);
  });

  test("une adresse freinée ne freine personne d'autre", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    await demanderLien(t, "inconnu@example.com");
    await demanderLien(t, CORENTIN);
    expect(enSecondes(await demanderLien(t, CORENTIN)).acceptee).toBe(false);
    expect(enSecondes(await demanderLien(t, PELIN))).toEqual(ACCEPTEE);
    expect(await courrielsRecus(t, PELIN)).toBe(1);
  });

  test("l'horloge est celle du serveur : un instant envoyé par l'app est refusé", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    await demanderLien(t, CORENTIN);
    const avecHeure = { email: CORENTIN, maintenant: Date.now() + HEURE_MS } as unknown as { email: string };
    await expect(t.mutation(api.connexion.demanderLien, avecHeure)).rejects.toThrow(/maintenant/);
    expect(await courrielsRecus(t, CORENTIN)).toBe(1);
  });

  test("appel direct à auth:signIn (ancienne version de l'app) : le même délai, aucun contournement", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    await demanderLien(t, CORENTIN);
    const premier = await dernierLien(t, CORENTIN);
    await expect(demanderLienDirect(t, CORENTIN)).rejects.toThrow(/trop_tot/);
    expect(await courrielsRecus(t, CORENTIN)).toBe(1);
    expect((await ouvrirLien(t, CORENTIN, premier!.code)).tokens?.token).toBeTruthy();

    await patienter(t, 60_000);
    await demanderLienDirect(t, CORENTIN);
    expect(await courrielsRecus(t, CORENTIN)).toBe(2);
    expect(enSecondes(await demanderLien(t, CORENTIN))).toEqual({ acceptee: false, secondes: 60 });
  });

  test("envoi en échec (fournisseur absent) : même réponse, rien en double ; après le délai, un nouveau lien part", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    vi.stubEnv("KLYRA_COURRIEL_SIMULE", "");
    expect(enSecondes(await demanderLien(t, CORENTIN))).toEqual(ACCEPTEE);
    expect(await courrielsRecus(t, CORENTIN)).toBe(0);
    expect(enSecondes(await demanderLien(t, CORENTIN)).acceptee).toBe(false);

    vi.unstubAllEnvs();
    await patienter(t, 60_000);
    expect(enSecondes(await demanderLien(t, CORENTIN))).toEqual(ACCEPTEE);
    expect(await courrielsRecus(t, CORENTIN)).toBe(1);
  });

  test("une heure après la dernière demande, l'adresse est oubliée ; les tickets non servis aussi", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    vi.stubEnv("KLYRA_COURRIEL_SIMULE", "");
    await demanderLien(t, "inconnu@example.com");
    await demanderLien(t, CORENTIN);
    vi.unstubAllEnvs();
    expect(await t.run((ctx) => ctx.db.query("demandesLien").take(10))).toHaveLength(2);
    await patienter(t, HEURE_MS + 1_000);
    expect(await t.run((ctx) => ctx.db.query("demandesLien").take(10))).toHaveLength(0);
    expect(await t.run((ctx) => ctx.db.query("ticketsLien").take(10))).toHaveLength(0);
  });
});
