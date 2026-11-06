// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useEnvoyerMessage } from "./envoi";
import { useDirectEspace } from "./espace";

const simule = vi.hoisted(() => ({
  ouvert: true,
  conversations: [] as { origine: string; titre: string; lieu: string | null }[],
  mutation: vi.fn(),
  jeton: "acces-fictif",
  lieu: null as string | null,
  serveurChat: null as { fournisseur: string; modele: string | null; effort: string | null; compteClaude?: string } | null,
  comptesTelephone: true,
}));
const adresse = "https://vps.exemple.test:8791";
const origine = "dm-dev@vps.exemple.test:8791";

vi.mock("convex/react", () => ({
  useConvex: () => ({ mutation: simule.mutation }),
  useQuery: () => simule.conversations,
}));
vi.mock("@/components/telephone/poste", () => ({ usePostes: () => ({ ouvert: simule.ouvert }) }));
vi.mock("@/lib/serveur-vps", () => ({ jetonAppareil: () => simule.jeton, CLE_CARNET: "carnet-fictif", lireCarnet: () => ({ liste: [] }) }));
vi.mock("@/lib/lieux", async (importer) => ({
  ...(await importer<typeof import("@/lib/lieux")>()),
  useLieuActif: () => simule.lieu,
}));

function porteEnvoi() {
  let envoyer!: ReturnType<typeof useEnvoyerMessage>;
  function Porte() {
    envoyer = useEnvoyerMessage();
    return null;
  }
  renderToStaticMarkup(<Porte />);
  return envoyer;
}

beforeEach(() => {
  simule.ouvert = true;
  simule.jeton = "acces-fictif";
  simule.lieu = null;
  simule.serveurChat = null;
  simule.comptesTelephone = true;
  simule.conversations = [];
  simule.mutation.mockReset().mockResolvedValue("message-en-file");
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: vi.fn() });
  vi.stubGlobal("fetch", vi.fn(async (url: string) => url.endsWith("/espace/lire")
    ? Response.json({ resultat: { revision: 0, choixModeleTelephone: true, ...(simule.comptesTelephone ? { compteClaudeTelephone: true } : {}), elements: simule.serveurChat ? [{ type: "conversation", id: origine, valeur: { chat: simule.serveurChat } }] : [] } })
    : new Response(null, { status: 202 })));
});

describe("destination réelle des messages du téléphone", () => {
  test.each([true, false])("nouvelle directe du VPS, ordinateur ouvert=%s : POST sur ce VPS, aucune file PC", async (ouvert) => {
    simule.ouvert = ouvert;
    simule.lieu = adresse;
    simule.conversations = [{ origine: "dm-dev", titre: "Dev sur PC", lieu: null }];
    let id!: string;
    function OuvrirAgent() {
      id = useDirectEspace()("dev");
      return null;
    }
    renderToStaticMarkup(<OuvrirAgent />);
    expect(id).toBe(origine);
    expect(await porteEnvoi()({ conversationOrigine: id, texte: "Vérifie le build" })).toBeNull();
    expect(fetch).toHaveBeenCalledWith(`${adresse}/klyra/v1/agent/envoyer`, expect.objectContaining({ method: "POST" }));
    const corps = JSON.parse(vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/agent/envoyer"))![1]!.body as string);
    expect(corps).toMatchObject({ options: { agent: "dev", prompt: "Vérifie le build" }, contexte: { chatId: origine } });
    expect(simule.mutation).not.toHaveBeenCalled();
  });

  test.each(["claude", "codex", "grok"])("le fournisseur %s, le modèle et l’effort du fil sur le VPS sont conservés", async (fournisseur) => {
    simule.serveurChat = { fournisseur, modele: "modele-fictif", effort: "high" };
    await porteEnvoi()({ conversationOrigine: origine, texte: "Bonjour" });
    const corps = JSON.parse(vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/agent/envoyer"))![1]!.body as string);
    expect(corps.options).toMatchObject({ moteur: fournisseur, modele: "modele-fictif", effort: "high" });
    expect(simule.mutation).not.toHaveBeenCalled();
  });

  test("un choix explicite remplace les réglages du VPS, null revient à la fiche", async () => {
    simule.serveurChat = { fournisseur: "claude", modele: "opus", effort: "high" };
    await porteEnvoi()({ conversationOrigine: origine, texte: "Bonjour", options: { modele: null, effort: null } });
    const corps = JSON.parse(vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/agent/envoyer"))![1]!.body as string);
    expect(corps.options).toMatchObject({ moteur: "claude", modele: null, effort: null });
  });
  test.each(["codex", "grok", "claude"] as const)("le choix %s remplace celui du VPS et est transmis pour être conservé", async (fournisseur) => {
    simule.serveurChat = { fournisseur: "codex", modele: "ancien-modele", effort: "high" };
    const choix = { fournisseur, modele: fournisseur === "claude" ? null : "modele-fictif", effort: fournisseur === "claude" ? null : "ultra" };
    await porteEnvoi()({ conversationOrigine: origine, texte: "Bonjour", options: choix });
    const corps = JSON.parse(vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith("/agent/envoyer"))![1]!.body as string);
    expect(corps.choix).toEqual(choix);
    expect(corps.options).toMatchObject({ moteur: fournisseur, modele: choix.modele, effort: choix.effort });
    expect(simule.mutation).not.toHaveBeenCalled();
  });
  test("le compte Claude choisi part au VPS, ou celui de la conversation sans nouveau choix", async () => {
    const compte = "11111111-1111-4111-8111-111111111111";
    const corpsEnvoye = () => JSON.parse(vi.mocked(fetch).mock.calls.filter(([url]) => String(url).endsWith("/agent/envoyer")).at(-1)![1]!.body as string);
    simule.serveurChat = { fournisseur: "claude", modele: "opus", effort: "high" };
    await porteEnvoi()({ conversationOrigine: origine, texte: "Bonjour", options: { fournisseur: "claude", modele: "opus", effort: "high", compteClaude: compte } });
    expect(corpsEnvoye().choix).toEqual({ fournisseur: "claude", modele: "opus", effort: "high", compteClaude: compte });
    expect(corpsEnvoye().options).toMatchObject({ moteur: "claude", compteClaude: compte });
    /* Sans nouveau choix : le compte gardé sur le VPS pour cette conversation, sans choix à réécrire. */
    simule.serveurChat = { fournisseur: "claude", modele: "opus", effort: "high", compteClaude: compte };
    await porteEnvoi()({ conversationOrigine: origine, texte: "Encore" });
    expect(corpsEnvoye().choix).toBeUndefined();
    expect(corpsEnvoye().options.compteClaude).toBe(compte);
    /* Retour au compte des agents. */
    await porteEnvoi()({ conversationOrigine: origine, texte: "Avec les agents", options: { fournisseur: "claude", modele: "opus", effort: "high", compteClaude: null } });
    expect(corpsEnvoye().choix.compteClaude).toBeNull();
    expect(corpsEnvoye().options.compteClaude).toBeUndefined();
    expect(simule.mutation).not.toHaveBeenCalled();
  });

  test("un VPS qui ne sait pas faire répondre le compte choisi refuse avant d'envoyer", async () => {
    simule.comptesTelephone = false;
    simule.serveurChat = { fournisseur: "claude", modele: "opus", effort: "high" };
    await expect(porteEnvoi()({ conversationOrigine: origine, texte: "Bonjour", options: { fournisseur: "claude", modele: "opus", effort: "high", compteClaude: "11111111-1111-4111-8111-111111111111" } })).rejects.toThrow("choisir le compte Claude");
    expect(vi.mocked(fetch).mock.calls.some(([url]) => String(url).endsWith("/agent/envoyer"))).toBe(false);
  });

  test("un VPS ancien refuse le changement de fournisseur sans prendre le message", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ resultat: { elements: [] } })));
    await expect(porteEnvoi()({ conversationOrigine: origine, texte: "Bonjour", options: { fournisseur: "grok", modele: "modele-test", effort: "high" } })).rejects.toThrow("Mets à jour ce serveur");
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(simule.mutation).not.toHaveBeenCalled();
  });

  test("une ancienne directe garde le VPS inscrit dans sa conversation", async () => {
    simule.conversations = [{ origine: "dm-dev", titre: "Dev", lieu: adresse }];
    await porteEnvoi()({ conversationOrigine: "dm-dev", texte: "Bonjour" });
    expect(fetch).toHaveBeenCalledWith(`${adresse}/klyra/v1/agent/envoyer`, expect.anything());
    expect(simule.mutation).not.toHaveBeenCalled();
  });

  test("un VPS qui ne répond pas ne détourne jamais le message vers le PC", async () => {
    vi.mocked(fetch).mockRejectedValue(new TypeError("hors réseau"));
    await expect(porteEnvoi()({ conversationOrigine: origine, texte: "Bonjour" })).rejects.toThrow("Le VPS ne répond pas");
    expect(simule.mutation).not.toHaveBeenCalled();
  });

  test("un accès VPS perdu demande de le relier, sans envoyer au PC", async () => {
    simule.jeton = "";
    await expect(porteEnvoi()({ conversationOrigine: origine, texte: "Bonjour" })).rejects.toThrow("plus relié");
    expect(fetch).not.toHaveBeenCalled();
    expect(simule.mutation).not.toHaveBeenCalled();
  });

  test("une conversation de l’ordinateur conserve sa file", async () => {
    expect(await porteEnvoi()({ conversationOrigine: "dm-dev", texte: "Bonjour" })).toBe("message-en-file");
    expect(fetch).not.toHaveBeenCalled();
    expect(simule.mutation).toHaveBeenCalledOnce();
  });
});
