// @vitest-environment node
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";
import { COMMANDE_SERVEUR, VERSION_CODE_SERVEUR } from "@/lib/serveur-vps";
import { AvisMiseAJour } from "./AvisMiseAJour";

vi.mock("@/lib/sons/sons", () => ({ jouer: () => {} }));

const texte = (html: string) => html.replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/&gt;/g, ">");

describe("l’avis d’un serveur en retard", () => {
  test("donne la commande à relancer", () => {
    expect(texte(renderToStaticMarkup(<AvisMiseAJour versionCode={1} />))).toContain(COMMANDE_SERVEUR);
  });

  test("dit l’écart quand le serveur annonce sa version", () => {
    const html = renderToStaticMarkup(<AvisMiseAJour versionCode={1} />);
    expect(html).toContain(`Il a la version 1, cette app attend la version ${VERSION_CODE_SERVEUR}.`);
    expect(html).toContain("plus ancien que cette app");
  });

  test("le dit aussi pour un ancien serveur, qui n’annonce rien", () => {
    const html = renderToStaticMarkup(<AvisMiseAJour />);
    expect(html).toContain("Il n’annonce pas sa version");
    expect(html).toContain(`attend la version ${VERSION_CODE_SERVEUR}.`);
    expect(texte(html)).toContain(COMMANDE_SERVEUR);
  });

  test("prévient du redémarrage et rassure sur les appareils reliés", () => {
    const html = renderToStaticMarkup(<AvisMiseAJour versionCode={1} />);
    expect(html).toContain("Elle redémarre le serveur");
    expect(html).toContain("Les appareils reliés le restent");
  });
});
