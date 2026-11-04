import { describe, expect, test } from "vitest";
import { ongletDe, rangDansLApp } from "./retour";

describe("retour du téléphone (C-3)", () => {
  test("le rang vient de l'historique, 0 pour une page ouverte par un lien", () => {
    expect(rangDansLApp(null)).toBe(0);
    expect(rangDansLApp({ __NA: true })).toBe(0);
    expect(rangDansLApp({ __NA: true, klyraIdx: 3 })).toBe(3);
    expect(rangDansLApp({ klyraIdx: "2" })).toBe(0);
    expect(rangDansLApp({ klyraIdx: -1 })).toBe(0);
  });
});

describe("onglet allumé (C-4)", () => {
  test("chaque route allume l'onglet qui la contient ; l'inconnue va dans Plus", () => {
    expect(ongletDe("/")).toBe("/chats");
    expect(ongletDe("/chat")).toBe("/chats");
    expect(ongletDe("/planning")).toBe("/planning");
    expect(ongletDe("/equipe")).toBe("/equipe");
    expect(ongletDe("/projet")).toBe("/projets");
    expect(ongletDe("/fichiers")).toBe("/projets");
    for (const route of ["/plus", "/routines", "/artefacts", "/reglages", "/serveurs", "/tickets", "/marketplace", "/serveur", "/inconnue"]) {
      expect(ongletDe(route)).toBe("/plus");
    }
    expect(ongletDe("/projets/")).toBe("/projets");
  });
});
