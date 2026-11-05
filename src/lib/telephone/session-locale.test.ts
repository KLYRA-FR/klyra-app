import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

/* Lit la projection mémoire du hook, sans DOM ni navigateur. */
const relire = vi.hoisted(() => vi.fn());
const effets = vi.hoisted(() => ({ actifs: false }));
vi.mock("react", async (origine) => ({
  ...(await origine<typeof import("react")>()),
  useEffect: (effet: () => void) => { if (effets.actifs) effet(); },
  useSyncExternalStore: <T>(abonner: (rappel: () => void) => () => void, lire: () => T) => {
    abonner(relire);
    return lire();
  },
}));

function stockage() {
  const donnees = new Map<string, string>();
  return {
    get length() { return donnees.size; },
    key: (i: number) => [...donnees.keys()][i] ?? null,
    getItem: (cle: string) => donnees.get(cle) ?? null,
    setItem: (cle: string, valeur: string) => void donnees.set(cle, valeur),
    removeItem: (cle: string) => void donnees.delete(cle),
  };
}

const VPS = "https://vps.essai.invalid";
const message = { adresse: VPS, conversation: "dm-principal", agentId: "principal", titre: "Essai", texte: "Brouillon fictif", modele: null, effort: null };
let local: ReturnType<typeof stockage>;
let temporaire: ReturnType<typeof stockage>;
let fenetre: EventTarget;

beforeEach(() => {
  vi.resetModules();
  relire.mockClear();
  effets.actifs = false;
  local = stockage();
  temporaire = stockage();
  fenetre = new EventTarget();
  vi.stubGlobal("window", fenetre);
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", temporaire);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 202 })));
});
afterEach(() => vi.unstubAllGlobals());

function garderAccesFictifs() {
  local.setItem("klyra:serveurs", JSON.stringify({ actif: VPS, liste: [{ id: VPS, adresse: VPS, nom: "Essai", version: "1", etat: "joint" }] }));
  local.setItem("klyra:jetons-serveurs", JSON.stringify({ [VPS]: "jeton-fictif" }));
  local.setItem("klyra:lieu-actif", VPS);
  local.setItem("klyra-brouillons", JSON.stringify({ "dm-principal": { text: "Essai", fichiers: [] } }));
  local.setItem("klyra:vue:compte-a|poste|reglages|{}", JSON.stringify({ lu: Date.now(), data: { nom: "Essai" } }));
  temporaire.setItem("klyra:lien-attente", "lien-fictif");
  local.setItem("preference-sans-rapport", "gardée");
}

async function verifierPurge() {
  const { jetonAppareil, interroger, lireCarnet } = await import("@/lib/serveur-vps");
  const { useEchangesDirects: lireProjection } = await import("./vps-direct");
  const { lieuParDefaut } = await import("@/lib/lieux");
  expect(jetonAppareil(VPS)).toBeNull();
  expect(lireCarnet(local.getItem("klyra:serveurs")).liste).toEqual([]);
  expect(lieuParDefaut()).toBeNull();
  expect(local.getItem("klyra-brouillons")).toBeNull();
  expect(local.getItem("klyra:vue:compte-a|poste|reglages|{}")).toBeNull();
  expect(local.getItem("klyra:telephone:vps-direct")).toBeNull();
  expect(lireProjection(message.conversation, new Set())).toEqual([]);
  expect(temporaire.getItem("klyra:lien-attente")).toBeNull();
  expect(local.getItem("preference-sans-rapport")).toBe("gardée");
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
  await expect(interroger(VPS)).resolves.toMatchObject({ ok: false });
  expect(vi.mocked(fetch)).not.toHaveBeenCalled();
}

describe("session locale de ce téléphone", () => {
  test("compte A puis B : aucune copie ni accès de A, y compris la projection déjà lue", async () => {
    const { actualiserSessionTelephone } = await import("./session-locale");
    const { envoyerAuVps, useEchangesDirects } = await import("./vps-direct");
    actualiserSessionTelephone({ membre: "compte-a", deconnecte: false, revoque: false });
    garderAccesFictifs();
    await envoyerAuVps(message);
    expect(useEchangesDirects(message.conversation, new Set())).toHaveLength(1);
    vi.mocked(fetch).mockClear();
    const carnetChange = vi.fn();
    fenetre.addEventListener("klyra:carnet", carnetChange);

    actualiserSessionTelephone({ membre: "compte-b", deconnecte: false, revoque: false });

    await verifierPurge();
    expect(local.getItem("klyra:telephone:compte-local")).toBe("compte-b");
    expect(relire).toHaveBeenCalled();
    expect(carnetChange).toHaveBeenCalledOnce();
  });

  test.each(["déconnexion", "révocation", "compte retiré"])("%s : seules les copies de cet appareil sont oubliées, sans appel au VPS", async (cause) => {
    const { actualiserSessionTelephone } = await import("./session-locale");
    actualiserSessionTelephone({ membre: "compte-a", deconnecte: false, revoque: false });
    garderAccesFictifs();
    actualiserSessionTelephone({ membre: null, deconnecte: cause !== "compte retiré", revoque: cause !== "déconnexion" });
    await verifierPurge();
    expect(local.getItem("klyra:telephone:compte-local")).toBeNull();
  });

  test("après rechargement, le propriétaire gardé permet de nettoyer avant le compte B", async () => {
    local.setItem("klyra:telephone:compte-local", "compte-a");
    garderAccesFictifs();
    const { actualiserSessionTelephone } = await import("./session-locale");
    actualiserSessionTelephone({ membre: "compte-b", deconnecte: false, revoque: false });
    await verifierPurge();
  });

  test("chargement/hors réseau conserve la vue ; première liaison sans compte reste possible", async () => {
    const { actualiserSessionTelephone } = await import("./session-locale");
    garderAccesFictifs();
    actualiserSessionTelephone({ membre: null, deconnecte: true, revoque: false });
    expect(local.getItem("klyra:jetons-serveurs")).not.toBeNull();
    actualiserSessionTelephone({ membre: "compte-a", deconnecte: false, revoque: false });
    actualiserSessionTelephone({ membre: null, deconnecte: false, revoque: false });
    expect(local.getItem("klyra:jetons-serveurs")).not.toBeNull();
    expect(local.getItem("klyra:telephone:compte-local")).toBe("compte-a");
    actualiserSessionTelephone({ membre: "compte-a", deconnecte: false, revoque: false });
    expect(local.getItem("klyra:jetons-serveurs")).not.toBeNull();
  });

  test("la purge d'accès téléphone ne touche pas aux accès du bureau Electron", async () => {
    const appairerBureau = vi.fn();
    vi.stubGlobal("window", { klyra: { serveur: { appairer: appairerBureau } } });
    garderAccesFictifs();
    const { oublierAccesServeursTelephone } = await import("@/lib/serveur-vps");
    oublierAccesServeursTelephone();
    expect(local.getItem("klyra:jetons-serveurs")).not.toBeNull();
    expect(local.getItem("klyra:serveurs")).not.toBeNull();
    expect(appairerBureau).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  test("un envoi déjà parti ne remet pas l'échange de A dans les copies de B", async () => {
    const { actualiserSessionTelephone } = await import("./session-locale");
    const { envoyerAuVps } = await import("./vps-direct");
    actualiserSessionTelephone({ membre: "compte-a", deconnecte: false, revoque: false });
    garderAccesFictifs();
    const reponse = Promise.withResolvers<Response>();
    vi.mocked(fetch).mockReturnValueOnce(reponse.promise);
    const envoi = envoyerAuVps(message);
    actualiserSessionTelephone({ membre: "compte-b", deconnecte: false, revoque: false });
    reponse.resolve(new Response(null, { status: 202 }));
    await expect(envoi).resolves.toMatchObject({ ok: false });
    vi.mocked(fetch).mockClear();
    await verifierPurge();
  });

  test("un appairage tardif ne restaure pas l'accès après révocation", async () => {
    const { actualiserSessionTelephone } = await import("./session-locale");
    const { appairer } = await import("@/lib/serveur-vps");
    actualiserSessionTelephone({ membre: "compte-a", deconnecte: false, revoque: false });
    garderAccesFictifs();
    const reponse = Promise.withResolvers<Response>();
    vi.mocked(fetch).mockReturnValueOnce(reponse.promise);
    const appairage = appairer(VPS, "CODEFICTIF");
    actualiserSessionTelephone({ membre: null, deconnecte: true, revoque: true });
    reponse.resolve(new Response(JSON.stringify({ produit: "klyra-serveur", protocole: 1, nom: "Essai", version: "1", jeton: "j".repeat(43) }), { status: 200 }));
    await expect(appairage).resolves.toMatchObject({ ok: false });
    vi.mocked(fetch).mockClear();
    await verifierPurge();
  });

  test("un flux déjà suivi est coupé et une réponse tardive ne repeuple pas le cache après révocation", async () => {
    const { actualiserSessionTelephone } = await import("./session-locale");
    const { envoyerAuVps, useEchangesDirects } = await import("./vps-direct");
    actualiserSessionTelephone({ membre: "compte-a", deconnecte: false, revoque: false });
    garderAccesFictifs();
    await envoyerAuVps(message);
    let flux!: ReadableStreamDefaultController<Uint8Array>;
    const corps = new ReadableStream<Uint8Array>({ start: (controle) => { flux = controle; } });
    vi.mocked(fetch).mockResolvedValueOnce(new Response(corps));
    effets.actifs = true;
    const [echange] = useEchangesDirects(message.conversation, new Set());
    effets.actifs = false;
    await Promise.resolve();
    const signal = vi.mocked(fetch).mock.calls.at(-1)?.[1]?.signal;
    expect(signal?.aborted).toBe(false);

    actualiserSessionTelephone({ membre: null, deconnecte: true, revoque: true });
    expect(signal?.aborted).toBe(true);
    flux.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ requestId: echange.requestId, seq: 1, event: { type: "texte", delta: "Ancien compte" } })}\n\n`));
    flux.close();
    await Promise.resolve();
    await Promise.resolve();
    vi.mocked(fetch).mockClear();
    await verifierPurge();
  });
});
