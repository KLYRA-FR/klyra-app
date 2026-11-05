// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ConversationLue } from "./chats";
import { agentPourLibelle } from "./libelles-fil";

const simule = vi.hoisted(() => ({ modele: "sonnet", lisible: true }));

vi.mock("convex/react", () => ({ useQuery: () => undefined, useMutation: () => vi.fn(), useConvex: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }), useSearchParams: () => new URLSearchParams() }));
vi.mock("@/lib/telephone/envoi", () => ({ useEnvoyerMessage: () => vi.fn() }));
vi.mock("@/lib/telephone/espace", () => ({ useCartesEspace: () => [{ origine: "cicco", nom: "Cicco", roleCourt: "Coordination", actif: true, teinte: "ocre" }] }));
vi.mock("@/lib/poste/client", () => ({
  useGestePoste: () => ({ faire: vi.fn(), occupe: false }),
  useLecturePoste: (type: string) => type === "agents.fiche" && simule.lisible
    ? { etat: "ok", data: { type: "agent", contenu: `---\nname: cicco\nmodel: ${simule.modele}\n---\n# Cicco` } }
    : { etat: "aucun" },
}));
vi.mock("@/components/telephone/poste", () => {
  const poste = { cle: "poste-essai", systeme: "mac", nom: "Mac de test", ouvert: true, dernierSignal: 0 };
  return { usePostes: () => ({ postes: [poste, { ...poste, cle: "poste-2", nom: "PC de test" }], principal: poste, ouvert: true, charge: false }), useSupport: () => "ton Mac" };
});

const { ComposeurFil } = await import("@/components/telephone/ComposeurFil");
const conversation = (origine: string, modele: string | null = null): ConversationLue => ({
  origine, kind: "direct", titre: "Cicco", roleIds: ["cicco"], modele,
  projetId: null, projetNom: null, contexte: null, ticket: null, contratTickets: null, ticketLu: null,
  misAJour: "2026-11-05T13:00:00Z", epingleLe: null, extrait: "", extraitLe: null, nonLus: 0, taches: "[]",
  lieu: null, parent: null, archiveLe: null, activite: null,
});
const rendu = (origine: string, modele: string | null = null) => renderToStaticMarkup(
  <ComposeurFil origine={origine} conversation={conversation(origine, modele)} equipe={false} nouveauProjet={null} agentId={origine.slice(3)} activite={null} />,
);

beforeEach(() => { simule.modele = "sonnet"; simule.lisible = true; });

describe("identité au bas du fil téléphone", () => {
  test("l’identité affichée enlève l’hôte sans réécrire l’origine ni le parent du fil", () => {
    const origine = "dm-cicco@serveur.exemple:8791";
    const fil = { parent: origine, roleIds: ["cicco"] };
    expect(agentPourLibelle(origine)).toBe("cicco");
    expect(agentPourLibelle("dm-cicco@pc")).toBe("cicco");
    expect(agentPourLibelle("klyra-fil-test", fil)).toBe("cicco");
    expect(fil.parent).toBe(origine);
  });
  test("nomme l’agent direct et le modèle hérité de sa fiche", () => {
    const html = rendu("dm-cicco");
    expect(html).toContain('aria-label="Agent : Cicco"');
    expect(html).toContain("Claude Sonnet 5.5");
  });
  test("une fiche héritée et un identifiant complet reprennent les alias du bureau", () => {
    simule.modele = "inherit";
    expect(rendu("dm-cicco")).toContain("Claude Opus 5.5");
    simule.modele = "claude-haiku-5-5";
    const html = rendu("dm-cicco");
    expect(html).toContain("Claude Haiku 5.5");
    expect(html).not.toContain("Élevé");
  });
  test("une fiche illisible n’invente pas un modèle et ne masque pas un choix explicite", () => {
    simule.lisible = false;
    expect(rendu("dm-cicco")).toContain("Modèle de la fiche indisponible");
    expect(rendu("dm-cicco", '{"modele":"opus","effort":"high"}')).toContain("Claude Opus 5.5");
  });
  test("un suffixe VPS ne remplace pas le prénom par Un agent ; le choix du fil prime", () => {
    const html = rendu("dm-cicco@serveur.exemple:8791", '{"modele":"opus","effort":"high"}');
    expect(html).toContain('aria-label="Agent : Cicco"');
    expect(html).toContain("Claude Opus 5.5");
    expect(html).not.toContain("Écris à Un agent");
    expect(html).not.toContain("Sur serveur.exemple");
    expect(html).toMatch(/<span[^>]*aria-label="Agent : Cicco"/);
    expect(html).not.toContain('aria-label="Destinataire');
  });
  test("le chemin direct garde un nom statique même si un ancien indicateur dit équipe", () => {
    const origine = "dm-cicco@serveur.exemple:8791";
    const html = renderToStaticMarkup(<ComposeurFil origine={origine} conversation={conversation(origine)} equipe nouveauProjet={null} agentId={null} activite={null} />);
    expect(html).toMatch(/<span[^>]*aria-label="Agent : Cicco"/);
    expect(html).toContain("Écris à Cicco…");
    expect(html).not.toContain('aria-label="Destinataire');
    expect(html).not.toContain('aria-label="Mentionner un agent"');
  });
  test("le nom d’un modèle ChatGPT n’est pas traduit en modèle Claude", () => {
    const html = rendu("dm-cicco", '{"fournisseur":"codex","modele":"gpt-exemple","effort":"ultra"}');
    expect(html).toContain("gpt-exemple");
    expect(html).not.toContain("Claude Sonnet");
  });
  test("aucune puce de machine avec deux postes ou un VPS ; le bandeau reste", () => {
    expect(rendu("dm-cicco")).not.toMatch(/>Sur /);
    const origine = "dm-cicco@srv2083864";
    const html = renderToStaticMarkup(<ComposeurFil origine={origine} conversation={{ ...conversation(origine), lieu: "https://srv2083864" }} equipe={false} nouveauProjet={null} agentId="cicco" activite={null} />);
    expect(html).not.toMatch(/>Sur /);
    expect(html).toContain("Ce téléphone n’est plus relié à ce VPS");
    expect(html).toMatch(/<span[^>]*aria-label="Agent : Cicco"/);
  });
});
