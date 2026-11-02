import { afterEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { envoyerATous, lienValable, lirePreferences, messagePush, PREFERENCES_PAR_DEFAUT } from "./model/push";
import { OUVERT_MS } from "./postes";
import { connecter, connecterSession, initialiser, nouvelEssai, type Essai } from "./test.utils";

/* L'envoi est simulé : aucune requête ne part vers un service de push. */
const envois = vi.hoisted(() => ({ statuts: new Map<string, number>(), recus: [] as { endpoint: string; charge: string }[] }));
vi.mock("web-push", () => ({
  default: {
    sendNotification: async (abonnement: { endpoint: string }, charge: string) => {
      envois.recus.push({ endpoint: abonnement.endpoint, charge });
      const statut = envois.statuts.get(abonnement.endpoint);
      if (statut) throw Object.assign(new Error(`Statut ${statut}`), { statusCode: statut });
      return { statusCode: 201 };
    },
  },
}));

/* Des clés de forme valable, jamais de vraies clés VAPID. */
function cles() {
  vi.stubEnv("VAPID_PUBLIC_KEY", "BPubliqueDEssai-pas-une-vraie-cle");
  vi.stubEnv("VAPID_PRIVATE_KEY", "privee-d-essai");
  vi.stubEnv("VAPID_SUJET", "mailto:essai@example.test");
}

afterEach(() => {
  vi.unstubAllEnvs();
  envois.statuts.clear();
  envois.recus.length = 0;
});

const abonnement = (n: number) => ({
  endpoint: `https://push.example.test/abonnement-${n}`,
  p256dh: `B${"a".repeat(86)}`,
  auth: "authentification-1",
});

async function envoisProgrammes(t: Essai) {
  const jobs = await t.run((ctx) => ctx.db.system.query("_scheduled_functions").collect());
  return jobs
    .filter((job) => job.name.includes("notificationsPushEnvoi") && job.state.kind === "pending")
    .map((job) => job.args[0] as { ids: Id<"abonnementsPush">[]; message: { titre: string; corps: string; lien: string } });
}

describe("règles des notifications", () => {
  test("préférences : défaut, JSON abîmé, valeur gardée", () => {
    expect(lirePreferences("")).toEqual(PREFERENCES_PAR_DEFAUT);
    expect(lirePreferences('{"accord":false,"inconnu":true}')).toEqual({ ...PREFERENCES_PAR_DEFAUT, accord: false });
    expect(PREFERENCES_PAR_DEFAUT.accord).toBe(true);
  });

  test("un lien est un chemin de l'app, jamais une adresse", () => {
    expect(lienValable("/chat?id=dm-hugo&message=abc")).toBe(true);
    expect(lienValable("/routines?vue=workflows&workflow=wf-1")).toBe(true);
    expect(lienValable("//exemple.test/chat")).toBe(false);
    expect(lienValable("https://exemple.test")).toBe(false);
    expect(lienValable("javascript:alert(1)")).toBe(false);
    expect(messagePush("agentFini", "  ", "corps", "/chats")).toBeNull();
    expect(messagePush("agentFini", "Hugo a fini", "x".repeat(400), "/chats")?.corps.length).toBe(240);
  });

  test("envoi simulé : 404 et 410 sont morts, une autre erreur ne retire rien", async () => {
    const statuts: Record<string, number> = { a: 410, b: 404, c: 500 };
    const morts = await envoyerATous(
      ["a", "b", "c", "d"].map((id) => ({ _id: id, endpoint: id, p256dh: "p", auth: "q" })),
      async ({ endpoint }) => {
        if (statuts[endpoint]) throw { statusCode: statuts[endpoint] };
      },
    );
    expect(morts.sort()).toEqual(["a", "b"]);
  });
});

describe("abonnements du téléphone", () => {
  test("s'abonner, choisir par événement, se désabonner", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const telephone = await connecter(t, "corentin@klyra.design");
    expect(await telephone.query(api.notificationsPush.monAbonnement, {})).toBeNull();
    await telephone.mutation(api.notificationsPush.sAbonner, abonnement(1));
    expect(await telephone.query(api.notificationsPush.monAbonnement, {})).toEqual({
      endpoint: abonnement(1).endpoint,
      preferences: PREFERENCES_PAR_DEFAUT,
      ouverturesAttendues: [],
    });
    await telephone.mutation(api.notificationsPush.changerPreference, { evenement: "agentFini", actif: false });
    /* Renouvelé par le navigateur : la même ligne, les choix gardés. */
    await telephone.mutation(api.notificationsPush.sAbonner, abonnement(2));
    const lu = await telephone.query(api.notificationsPush.monAbonnement, {});
    expect(lu?.endpoint).toBe(abonnement(2).endpoint);
    expect(lu?.preferences.agentFini).toBe(false);
    expect(await t.run((ctx) => ctx.db.query("abonnementsPush").collect())).toHaveLength(1);
    await telephone.mutation(api.notificationsPush.seDesabonner, {});
    expect(await telephone.query(api.notificationsPush.monAbonnement, {})).toBeNull();
  });

  test("abonnement invalide ou sans session : refusé", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const telephone = await connecter(t, "corentin@klyra.design");
    await expect(telephone.mutation(api.notificationsPush.sAbonner, { ...abonnement(1), endpoint: "http://push.example.test/x" })).rejects.toThrow(/demande_invalide/);
    await expect(telephone.mutation(api.notificationsPush.sAbonner, { ...abonnement(1), auth: "a b" })).rejects.toThrow(/demande_invalide/);
    await expect(t.mutation(api.notificationsPush.sAbonner, abonnement(1))).rejects.toThrow(/non_connecte/);
    await expect(telephone.mutation(api.notificationsPush.changerPreference, { evenement: "accord", actif: false })).rejects.toThrow(/introuvable/);
  });

  test("le même navigateur repris par une autre session ne garde qu'une ligne", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const avant = await connecter(t, "corentin@klyra.design");
    await avant.mutation(api.notificationsPush.sAbonner, abonnement(1));
    await avant.mutation(api.notificationsPush.changerPreference, { evenement: "workflow", actif: false });
    const apres = await connecter(t, "corentin@klyra.design");
    await apres.mutation(api.notificationsPush.sAbonner, abonnement(1));
    expect(await t.run((ctx) => ctx.db.query("abonnementsPush").collect())).toHaveLength(1);
    expect((await apres.query(api.notificationsPush.monAbonnement, {}))?.preferences.workflow).toBe(false);
  });

  test("sans clés VAPID : pas de clé publique, rien ne part", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const telephone = await connecter(t, "corentin@klyra.design");
    const bureau = await connecter(t, "corentin@klyra.design");
    await telephone.mutation(api.notificationsPush.sAbonner, abonnement(1));
    expect(await telephone.query(api.notificationsPush.clePublique, {})).toBeNull();
    expect(await bureau.mutation(api.notificationsPush.pousser, { evenement: "accord", titre: "Hugo demande ton accord", corps: "Lancer pnpm build", lien: "/chat?id=dm-hugo" })).toBe(0);
    expect(await envoisProgrammes(t)).toEqual([]);
  });

  test("l'ordinateur pousse aux téléphones qui veulent cet événement", async () => {
    cles();
    const t = nouvelEssai();
    await initialiser(t);
    const { client: telephone1 } = await connecterSession(t, "corentin@klyra.design");
    const { client: telephone2 } = await connecterSession(t, "corentin@klyra.design");
    const bureau = await connecter(t, "corentin@klyra.design");
    const autre = await connecter(t, "pelin@klyra.design");
    expect(await telephone1.query(api.notificationsPush.clePublique, {})).toBe("BPubliqueDEssai-pas-une-vraie-cle");
    await telephone1.mutation(api.notificationsPush.sAbonner, abonnement(1));
    await telephone2.mutation(api.notificationsPush.sAbonner, abonnement(2));
    await autre.mutation(api.notificationsPush.sAbonner, abonnement(3));
    await telephone2.mutation(api.notificationsPush.changerPreference, { evenement: "agentFini", actif: false });

    const lien = "/chat?id=dm-hugo&message=m1";
    expect(await bureau.mutation(api.notificationsPush.pousser, { evenement: "agentFini", titre: "Hugo a fini", corps: "Sa réponse t’attend.", lien })).toBe(1);
    expect(await bureau.mutation(api.notificationsPush.pousser, { evenement: "accord", titre: "Hugo demande ton accord", corps: "Lancer pnpm build", lien })).toBe(2);
    const programmes = await envoisProgrammes(t);
    expect(programmes.map((p) => p.ids.length)).toEqual([1, 2]);
    expect(programmes[0]?.message).toMatchObject({ titre: "Hugo a fini", lien });
    await expect(bureau.mutation(api.notificationsPush.pousser, { evenement: "workflow", titre: "Fini", corps: "", lien: "https://exemple.test" })).rejects.toThrow(/demande_invalide/);
  });

  test("un téléphone déconnecté à distance ne reçoit plus rien", async () => {
    cles();
    const t = nouvelEssai();
    await initialiser(t);
    const { client: telephone, sessionId } = await connecterSession(t, "corentin@klyra.design");
    const bureau = await connecter(t, "corentin@klyra.design");
    await telephone.mutation(api.notificationsPush.sAbonner, abonnement(1));
    await bureau.mutation(api.telephones.deconnecter, { sessionId });
    expect(await bureau.mutation(api.notificationsPush.pousser, { evenement: "accord", titre: "Hugo demande ton accord", corps: "", lien: "/chats" })).toBe(0);
    expect(await t.run((ctx) => ctx.db.query("abonnementsPush").collect())).toEqual([]);
  });

  test("abonnements morts (404, 410) retirés après l'envoi simulé", async () => {
    cles();
    const t = nouvelEssai();
    await initialiser(t);
    const telephones = [];
    for (let n = 1; n <= 4; n++) {
      const telephone = await connecter(t, "corentin@klyra.design");
      await telephone.mutation(api.notificationsPush.sAbonner, abonnement(n));
      telephones.push(telephone);
    }
    envois.statuts.set(abonnement(1).endpoint, 410);
    envois.statuts.set(abonnement(2).endpoint, 404);
    envois.statuts.set(abonnement(3).endpoint, 500);
    const ids = (await t.run((ctx) => ctx.db.query("abonnementsPush").collect())).map((a) => a._id);
    const message = { titre: "Hugo a fini", corps: "", lien: "/chats", tag: "agentFini:/chats" };
    await t.action(internal.notificationsPushEnvoi.envoyer, { ids, message });
    expect(envois.recus).toHaveLength(4);
    expect(JSON.parse(envois.recus[0]?.charge ?? "{}")).toEqual(message);
    const restants = (await t.run((ctx) => ctx.db.query("abonnementsPush").collect())).map((a) => a.endpoint).sort();
    expect(restants).toEqual([abonnement(3).endpoint, abonnement(4).endpoint]);
  });
});

describe("« Me prévenir à l'ouverture »", () => {
  test("le poste qui revient prévient une seule fois", async () => {
    cles();
    const t = nouvelEssai();
    await initialiser(t);
    const telephone = await connecter(t, "corentin@klyra.design");
    const bureau = await connecter(t, "corentin@klyra.design");
    const poste = { cle: "poste-mac-1", systeme: "mac" as const, nom: "MacBook de Corentin" };
    await bureau.mutation(api.postes.signaler, poste);
    await telephone.mutation(api.notificationsPush.sAbonner, abonnement(1));
    await telephone.mutation(api.notificationsPush.changerPreference, { evenement: "ouverture", actif: false });

    /* Ouvert : rien n'est gardé. */
    expect(await telephone.mutation(api.notificationsPush.attendreOuverture, { cle: poste.cle })).toBe("ouvert");
    vi.advanceTimersByTime(OUVERT_MS + 1000);
    expect(await telephone.mutation(api.notificationsPush.attendreOuverture, { cle: poste.cle })).toBe("attente");
    const lu = await telephone.query(api.notificationsPush.monAbonnement, {});
    expect(lu?.ouverturesAttendues).toEqual([poste.cle]);
    /* Demander rallume « Ton Mac s'est ouvert ». */
    expect(lu?.preferences.ouverture).toBe(true);
    await expect(telephone.mutation(api.notificationsPush.attendreOuverture, { cle: "poste-inconnu" })).rejects.toThrow(/poste_invalide/);

    /* Le poste revient après plus de 25 s sans signal. */
    await bureau.mutation(api.postes.signaler, poste);
    let programmes = await envoisProgrammes(t);
    expect(programmes).toHaveLength(1);
    expect(programmes[0]?.message).toMatchObject({ titre: "Ton Mac s’est ouvert", corps: "KLYRA est ouverte sur ton Mac.", lien: "/chats" });
    expect((await telephone.query(api.notificationsPush.monAbonnement, {}))?.ouverturesAttendues).toEqual([]);
    /* Un signal régulier (moins de 25 s) n'est pas un retour. */
    await bureau.mutation(api.postes.signaler, poste);
    expect(await envoisProgrammes(t)).toHaveLength(1);
    vi.advanceTimersByTime(10);
    await t.finishInProgressScheduledFunctions();
    expect(envois.recus).toHaveLength(1);

    /* Absent puis de retour encore : plus rien, la demande a servi. */
    vi.advanceTimersByTime(OUVERT_MS + 1000);
    await t.finishInProgressScheduledFunctions();
    await bureau.mutation(api.postes.signaler, poste);
    programmes = await envoisProgrammes(t);
    expect(programmes).toHaveLength(0);
  });

  test("le nom du poste quand ce n'est ni un Mac ni un PC", async () => {
    cles();
    const t = nouvelEssai();
    await initialiser(t);
    const telephone = await connecter(t, "corentin@klyra.design");
    const bureau = await connecter(t, "corentin@klyra.design");
    const poste = { cle: "poste-linux-1", systeme: "autre" as const, nom: "Station" };
    await bureau.mutation(api.postes.signaler, poste);
    await telephone.mutation(api.notificationsPush.sAbonner, abonnement(1));
    vi.advanceTimersByTime(OUVERT_MS + 1000);
    await telephone.mutation(api.notificationsPush.attendreOuverture, { cle: poste.cle });
    await bureau.mutation(api.postes.signaler, poste);
    expect((await envoisProgrammes(t))[0]?.message.titre).toBe("Station s’est ouvert");
  });
});
