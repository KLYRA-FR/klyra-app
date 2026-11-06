// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { cibleFil } from "@/lib/liens-fils";

const simule = vi.hoisted(() => ({ conversations: [{ origine: "klyra-fil-0f830d35", titre: "Clic droit" }] as { origine: string; titre: string }[] | undefined }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/telephone/espace", () => ({ useConversationsEspace: () => simule.conversations }));

const { Markdown } = await import("@/components/ui/Markdown");
const { AvecLiensFilsTelephone } = await import("@/components/telephone/LienFilTelephone");

const rendu = (source: string) =>
  renderToStaticMarkup(
    <AvecLiensFilsTelephone>
      <Markdown source={source} />
    </AvecLiensFilsTelephone>,
  );
const boutons = (html: string) => [...html.matchAll(/<button[^>]*>([^<]+)<\/button>/g)].map((m) => m[1]);

describe("identifiants de fils dans une réponse, sur le téléphone", () => {
  test("dans une phrase et entre parenthèses : un bouton par fil, avec son titre s'il est connu", () => {
    const html = rendu("Voir klyra-fil-0f830d35 et (klyra-fil-a1468c9b).");
    expect(boutons(html)).toEqual(["klyra-fil-0f830d35", "klyra-fil-a1468c9b"]);
    expect(html).toContain("Ouvrir le fil « Clic droit »");
  });

  test("rien dans un bloc de code, un `code` ou un lien ; un id invalide reste du texte", () => {
    const html = rendu("```\nklyra-fil-0f830d35\n```\n\n`klyra-fil-0f830d35` [lien](https://exemple.fr/klyra-fil-0f830d35) klyra-fil-0f830d3 klyra-fil-0F830D35");
    expect(boutons(html)).toEqual([]);
  });

  test("au clic : ouvrir un fil connu, dire qu'un autre est introuvable, attendre la liste", () => {
    expect(cibleFil("klyra-fil-0f830d35", simule.conversations)).toBe("ouvrir");
    expect(cibleFil("klyra-fil-a1468c9b", simule.conversations)).toBe("introuvable");
    expect(cibleFil("klyra-fil-0f830d35", undefined)).toBe("attente");
  });
});
