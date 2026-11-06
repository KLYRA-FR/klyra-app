// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import { Markdown, RenduFil } from "@/components/ui/Markdown";
import { decouperFils } from "./liens-fils";

const fils = (texte: string) => decouperFils(texte).filter((m) => m.fil).map((m) => m.texte);

/** Le Markdown d'un message, les fils rendus en `<a data-fil>` pour les compter. */
const rendu = (source: string) =>
  renderToStaticMarkup(
    <RenduFil.Provider value={(id) => <a data-fil={id}>{id}</a>}>
      <Markdown source={source} />
    </RenduFil.Provider>,
  );
const liens = (html: string) => [...html.matchAll(/data-fil="([^"]+)"/g)].map((m) => m[1]);

describe("identifiants de fils dans un message", () => {
  test("dans une phrase", () => {
    expect(fils("Voir klyra-fil-0f830d35 pour la suite.")).toEqual(["klyra-fil-0f830d35"]);
    expect(decouperFils("Voir klyra-fil-0f830d35 pour la suite.").map((m) => m.texte).join("")).toBe("Voir klyra-fil-0f830d35 pour la suite.");
  });

  test("entre parenthèses, plusieurs dans la même ligne", () => {
    expect(fils("Clic droit… (klyra-fil-0f830d35) et Dictée (klyra-fil-a1468c9b).")).toEqual(["klyra-fil-0f830d35", "klyra-fil-a1468c9b"]);
  });

  test("id invalide : trop court, trop long, pas hexadécimal, en majuscules, collé à un mot", () => {
    expect(fils("klyra-fil-0f830d3 klyra-fil-0f830d35a klyra-fil-0f830g35 klyra-fil-0F830D35 xklyra-fil-0f830d35 klyra-fil-0f830d35-b")).toEqual([]);
  });

  test("pendant le streaming : un id pas encore fini reste du texte", () => {
    expect(fils("Ticket (klyra-fil-0f83")).toEqual([]);
  });

  test("rendu : lien dans le texte, en gras et dans une liste", () => {
    expect(liens(rendu("- **Clic droit** (klyra-fil-0f830d35)\n- Vu **klyra-fil-a1468c9b**"))).toEqual(["klyra-fil-0f830d35", "klyra-fil-a1468c9b"]);
  });

  test("rendu : rien dans un bloc de code, un `code` ou un lien existant", () => {
    const html = rendu("```\nklyra-fil-0f830d35\n```\n\nEn code `klyra-fil-0f830d35` et [le fil klyra-fil-0f830d35](https://exemple.fr/klyra-fil-0f830d35).");
    expect(liens(html)).toEqual([]);
    expect(html).toContain("klyra-fil-0f830d35");
  });

  test("rendu : sans fournisseur (fiches, aperçus), l'id reste du texte", () => {
    expect(renderToStaticMarkup(<Markdown source="Voir klyra-fil-0f830d35." />)).not.toContain("data-fil");
  });
});
