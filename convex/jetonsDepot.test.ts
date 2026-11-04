import { createPublicKey, createVerify, generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import { HEURE_MS, JETONS_PAR_HEURE, normaliserCle, normaliserDepot } from "./model/depots";
import { connecter, initialiser, nouvelEssai, type Essai } from "./test.utils";

const DEPOT = "KLYRA-FR/klyra-app";
const COR = "corentin@klyra.design";
const PEL = "pelin@klyra.design";

/* Une clé jetable au format que donne GitHub (PKCS#1), jamais une vraie clé. */
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const CLE = privateKey.export({ type: "pkcs1", format: "pem" }).toString();

interface Appel {
  url: string;
  auth: string;
  corps: { repositories: string[]; permissions: Record<string, string> } | null;
}

/** GitHub simulé : aucune requête ne sort. */
function simulerGithub(statuts: { installation?: number; jeton?: number } = {}) {
  const appels: Appel[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    appels.push({
      url,
      auth: new Headers(init.headers).get("authorization") ?? "",
      corps: init.body ? (JSON.parse(init.body as string) as Appel["corps"]) : null,
    });
    if (url.endsWith("/installation")) {
      return new Response(JSON.stringify({ id: 42 }), { status: statuts.installation ?? 200 });
    }
    return new Response(JSON.stringify({ token: "ghs_essai", expires_at: "2026-11-05T00:00:00Z" }), { status: statuts.jeton ?? 201 });
  });
  return appels;
}

/** L'équipe de départ ; une personne n'est membre qu'après sa première connexion. */
async function equipe(t: Essai) {
  await initialiser(t);
  const client = await connecter(t, COR);
  await t.mutation(internal.jetonsDepot.accorder, { email: COR, depot: DEPOT });
  return client;
}

const refuse = (code: string) => (e: unknown) => (e as { data?: unknown }).data === code;

beforeEach(() => {
  vi.stubEnv("GITHUB_APP_AGENTS_CLE", CLE);
  vi.stubEnv("GITHUB_APP_REVIEWER_CLE", CLE);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("les règles pures", () => {
  test("seuls les dépôts de KLYRA-FR sont acceptés, quel que soit le projet", () => {
    expect(normaliserDepot(" KLYRA-FR/Klyra-App ")?.complet).toBe("klyra-fr/klyra-app");
    expect(normaliserDepot("KLYRA-FR/projet-client")).toEqual({ complet: "klyra-fr/projet-client", proprietaire: "klyra-fr", nom: "projet-client" });
    for (const d of ["CorentinQueuche/plateau", "klyra-fr", "klyra-fr/", "klyra-fr/a/b", "klyra-fr/..", "klyra-fr/a b", "../klyra-fr/a", "klyra-fr/a?x=1"]) {
      expect(normaliserDepot(d)).toBeNull();
    }
  });

  test("une clé collée sans ses retours à la ligne est reconstruite ; autre chose est refusé", () => {
    expect(normaliserCle(CLE)).toBe(CLE);
    expect(normaliserCle(CLE.replace(/\n/g, " "))).toBe(CLE);
    expect(normaliserCle(CLE.replace(/\n/g, "\\n"))).toBe(CLE);
    expect(normaliserCle("")).toBeNull();
    expect(normaliserCle("pas_une_cle")).toBeNull();
    expect(normaliserCle("-----BEGIN RSA PRIVATE KEY-----\n-----END RSA PRIVATE KEY-----")).toBeNull();
  });
});

describe("demander un jeton", () => {
  test("agents : jeton limité au dépôt, avec les droits du rôle, signé par la bonne App", async () => {
    const t = nouvelEssai();
    const client = await equipe(t);
    const appels = simulerGithub();

    const r = await client.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" });
    expect(r).toEqual({ jeton: "ghs_essai", expire: "2026-11-05T00:00:00Z" });

    expect(appels.map((a) => a.url)).toEqual([
      "https://api.github.com/repos/klyra-fr/klyra-app/installation",
      "https://api.github.com/app/installations/42/access_tokens",
    ]);
    expect(appels[1].corps).toEqual({
      repositories: ["klyra-app"],
      permissions: { contents: "write", issues: "write", pull_requests: "write", checks: "read", statuses: "read" },
    });

    const [entete, charge, signature] = appels[0].auth.replace("Bearer ", "").split(".");
    const lue = JSON.parse(Buffer.from(charge, "base64url").toString()) as { iss: string; iat: number; exp: number };
    expect(lue.iss).toBe("5618456");
    expect(lue.exp - lue.iat).toBeLessThanOrEqual(600);
    const verifie = createVerify("RSA-SHA256").update(`${entete}.${charge}`).verify(createPublicKey(privateKey), signature, "base64url");
    expect(verifie).toBe(true);
  });

  test("reviewer : l'autre App, et le code en lecture seule", async () => {
    const t = nouvelEssai();
    const client = await equipe(t);
    const appels = simulerGithub();

    await client.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "reviewer" });

    expect(appels[1].corps?.permissions.contents).toBe("read");
    const charge = appels[0].auth.split(".")[1];
    expect((JSON.parse(Buffer.from(charge, "base64url").toString()) as { iss: string }).iss).toBe("5618483");
  });

  test("aucun rôle ne demande administration, workflows ni secrets", async () => {
    const t = nouvelEssai();
    const client = await equipe(t);
    const appels = simulerGithub();
    await client.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" });
    await client.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "reviewer" });
    for (const a of appels.filter((x) => x.corps)) {
      expect(Object.keys(a.corps!.permissions).filter((p) => ["administration", "workflows", "secrets"].includes(p))).toEqual([]);
    }
  });

  test("sans session, sans accès ou sur un autre dépôt : refus, et rien ne part vers GitHub", async () => {
    const t = nouvelEssai();
    const avecAcces = await equipe(t);
    const appels = simulerGithub();

    await expect(t.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" })).rejects.toSatisfy(refuse("non_connecte"));
    const sansAcces = await connecter(t, PEL);
    await expect(sansAcces.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" })).rejects.toSatisfy(refuse("depot_non_autorise"));
    await expect(avecAcces.action(api.jetonsDepotEnvoi.demander, { depot: "KLYRA-FR/klyra-app-versions", role: "agents" })).rejects.toSatisfy(refuse("depot_non_autorise"));
    await expect(avecAcces.action(api.jetonsDepotEnvoi.demander, { depot: "CorentinQueuche/plateau", role: "agents" })).rejects.toSatisfy(refuse("depot_invalide"));

    expect(appels).toEqual([]);
  });

  test("un autre projet de KLYRA-FR marche dès que l'accès est accordé, pour ce seul dépôt", async () => {
    const t = nouvelEssai();
    const client = await equipe(t);
    await t.mutation(internal.jetonsDepot.accorder, { email: COR, depot: "KLYRA-FR/projet-client" });
    const appels = simulerGithub();

    await client.action(api.jetonsDepotEnvoi.demander, { depot: "KLYRA-FR/projet-client", role: "agents" });

    expect(appels[0].url).toBe("https://api.github.com/repos/klyra-fr/projet-client/installation");
    expect(appels[1].corps?.repositories).toEqual(["projet-client"]);
  });

  test("accorder un dépôt hors de KLYRA-FR est refusé", async () => {
    const t = nouvelEssai();
    await equipe(t);
    await expect(t.mutation(internal.jetonsDepot.accorder, { email: COR, depot: "CorentinQueuche/plateau" })).rejects.toSatisfy(refuse("depot_invalide"));
  });

  test("un accès retiré ne donne plus de jeton, et chacun ne voit que ses dépôts", async () => {
    const t = nouvelEssai();
    const cor = await equipe(t);
    const pel = await connecter(t, PEL);
    simulerGithub();
    expect(await cor.query(api.jetonsDepot.mesDepots, {})).toEqual(["klyra-fr/klyra-app"]);
    expect(await pel.query(api.jetonsDepot.mesDepots, {})).toEqual([]);

    await t.mutation(internal.jetonsDepot.retirer, { email: COR, depot: DEPOT });

    expect(await cor.query(api.jetonsDepot.mesDepots, {})).toEqual([]);
    await expect(cor.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" })).rejects.toSatisfy(refuse("depot_non_autorise"));
  });

  test("accorder deux fois ne crée qu'un accès ; une adresse inconnue est refusée", async () => {
    const t = nouvelEssai();
    await equipe(t);
    await t.mutation(internal.jetonsDepot.accorder, { email: COR.toUpperCase(), depot: "klyra-fr/KLYRA-APP" });
    expect(await t.run((ctx) => ctx.db.query("accesDepots").collect())).toHaveLength(1);
    await expect(t.mutation(internal.jetonsDepot.accorder, { email: "inconnu@example.test", depot: DEPOT })).rejects.toSatisfy(refuse("membre_inconnu"));
  });

  test("la limite horaire s'applique, puis se libère", async () => {
    const t = nouvelEssai();
    const client = await equipe(t);
    simulerGithub();
    for (let i = 0; i < JETONS_PAR_HEURE; i++) {
      await client.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" });
    }
    await expect(client.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" })).rejects.toSatisfy(refuse("trop_tot"));
    vi.advanceTimersByTime(HEURE_MS + 1);
    const apres = await connecter(t, COR);
    await expect(apres.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" })).resolves.toBeTruthy();
  });

  test("la trace dit qui, quoi et quand, jamais le jeton", async () => {
    const t = nouvelEssai();
    const client = await equipe(t);
    simulerGithub();
    await client.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "reviewer" });
    const traces = await t.run((ctx) => ctx.db.query("demandesJetonDepot").collect());
    expect(traces).toHaveLength(1);
    expect(traces[0]).toMatchObject({ depot: "klyra-fr/klyra-app", role: "reviewer" });
    expect(JSON.stringify(traces)).not.toContain("ghs_essai");
  });

  test("clé absente ou invalide : un refus clair, sans appel", async () => {
    const t = nouvelEssai();
    const client = await equipe(t);
    const appels = simulerGithub();
    vi.stubEnv("GITHUB_APP_AGENTS_CLE", "");
    await expect(client.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" })).rejects.toSatisfy(refuse("jetons_non_configures"));
    vi.stubEnv("GITHUB_APP_AGENTS_CLE", "-----BEGIN RSA PRIVATE KEY-----\nAAAA\n-----END RSA PRIVATE KEY-----");
    await expect(client.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" })).rejects.toSatisfy(refuse("jetons_non_configures"));
    expect(appels).toEqual([]);
  });

  test("les réponses de GitHub deviennent des refus lisibles", async () => {
    const t = nouvelEssai();
    const client = await equipe(t);
    const cas: [{ installation?: number; jeton?: number }, string][] = [
      [{ installation: 404 }, "app_non_installee"],
      [{ jeton: 422 }, "app_non_installee"],
      [{ installation: 401 }, "jetons_non_configures"],
      [{ jeton: 500 }, "github_indisponible"],
    ];
    for (const [statuts, code] of cas) {
      simulerGithub(statuts);
      await expect(client.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" })).rejects.toSatisfy(refuse(code));
    }
    vi.stubGlobal("fetch", async () => {
      throw new Error("réseau coupé");
    });
    await expect(client.action(api.jetonsDepotEnvoi.demander, { depot: DEPOT, role: "agents" })).rejects.toSatisfy(refuse("github_indisponible"));
  });
});
