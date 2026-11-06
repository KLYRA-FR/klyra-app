// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { describe, expect, test, vi } from "vitest";
import { activiteDe, messageCompte, type Activite } from "@/lib/copie-compte";
import type { Message } from "@/types/domain";

/* « Iris continue en arrière-plan » dans le fil du téléphone, d'après ce que l'ordinateur copie (cf. fond-agents.ts). */
vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) =>
    getFunctionName(ref) === "conversationsCompte:agents" ? [{ origine: "iris", nom: "Iris", teinte: "lavande", roleCourt: "Design", actif: true }] : undefined,
  useMutation: () => vi.fn(),
  useConvex: () => ({}),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/chat",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/poste/client", () => ({
  useLecturePoste: () => ({ etat: "attente", relancer: () => undefined }),
  useGestePoste: () => ({ faire: vi.fn(), occupe: false }),
}));
vi.mock("@/components/telephone/poste", () => {
  const poste = () => ({ cle: "poste-essai", systeme: "mac", nom: "MacBook", ouvert: true, dernierSignal: 0 });
  return { usePostes: () => ({ postes: [poste()], principal: poste(), ouvert: true, charge: false }), useSupport: () => "ton Mac" };
});

const { MessagesFil } = await import("@/components/telephone/MessagesFil");

const reponse: Message = { id: "m1", chatId: "dm-iris", author: { kind: "role", roleId: "iris" }, createdAt: "2026-11-06T10:00:00.000Z", statut: "fait", parts: [{ type: "text", text: "La capture est en cours." }] };

function rendre(activite: Activite | null) {
  return renderToStaticMarkup(
    <MessagesFil
      messages={[messageCompte(reponse)]}
      enFile={[] as never}
      contexte={{ origine: "dm-iris", projetId: null, activite, modele: null, reagir: vi.fn(), conversation: undefined, envoyer: vi.fn(), onBandeau: vi.fn() }}
      vide={null}
    />,
  );
}

const fond = (taches: { description: string; genre: "commande" | "agent" }[], reprise = false) =>
  activiteDe([reponse], null, 0, null, { roleId: "iris", reprise, taches: taches.map((t, i) => ({ ...t, debut: Date.parse("2026-11-06T10:00:00.000Z") + i })) });

describe("ce qu'un agent fait en fond, sur le téléphone", () => {
  test("une tâche : son nom sur la ligne, la roue qui tourne", () => {
    const html = rendre(fond([{ description: "Capture de la vidéo", genre: "commande" }]));
    expect(html).toContain("Iris continue en arrière-plan");
    expect(html).toContain("· Capture de la vidéo");
    expect(html).toContain('data-en-fond="iris"');
    expect(html).toContain("animate-spin");
  });

  test("plusieurs tâches : le compte, puis chacune", () => {
    const html = rendre(fond([{ description: "Capture", genre: "commande" }, { description: "Build", genre: "commande" }, { description: "Relire", genre: "agent" }]));
    expect(html).toContain("· 2 commandes et 1 agent en cours");
    for (const t of ["Capture", "Build", "Relire"]) expect(html).toContain(`>${t}</span>`);
  });

  test("la reprise, et rien sans tâche de fond", () => {
    expect(rendre(fond([], true))).toContain("Iris reprend…");
    expect(rendre(fond([], true))).toContain("une tâche de fond est terminée");
    expect(rendre(null)).not.toContain("data-en-fond");
  });
});
