import { describe, expect, test } from "vitest";
import { clePageTelephone, ongletDe, rangDansLApp } from "./retour";

describe("retour du téléphone (C-3)", () => {
  test("le rang vient de l'historique, 0 pour une page ouverte par un lien", () => {
    expect(rangDansLApp(null)).toBe(0);
    expect(rangDansLApp({ __NA: true })).toBe(0);
    expect(rangDansLApp({ __NA: true, klyraIdx: 3 })).toBe(3);
    expect(rangDansLApp({ klyraIdx: "2" })).toBe(0);
    expect(rangDansLApp({ klyraIdx: -1 })).toBe(0);
  });
});

describe("transitions des sous-pages du téléphone", () => {
  const cle = (url: string) => {
    const u = new URL(url, "https://app.exemple.test");
    return clePageTelephone(u.pathname, u.searchParams);
  };
  test("fiche, Compétences et souvenir sont des pages distinctes sur le même chemin", () => {
    const fiche = cle("/equipe?agent=dev");
    expect(cle("/equipe?agent=dev&mode=competences")).not.toBe(fiche);
    expect(cle("/equipe?agent=dev&section=competences")).toBe(cle("/equipe?agent=dev&mode=competences"));
    expect(cle("/equipe?agent=dev&mode=souvenirs&souvenir=un")).not.toBe(cle("/equipe?agent=dev&mode=souvenirs"));
  });
  test("un filtre, une recherche ou un onglet segmenté garde l'écran et son défilement", () => {
    expect(cle("/equipe?vue=bibliotheque&q=dev")).toBe(cle("/equipe"));
    expect(cle("/projet?id=p&onglet=fichiers&q=css")).toBe(cle("/projet?id=p"));
    expect(cle("/chat?id=c&message=m")).toBe(cle("/chat?id=c"));
    expect(cle("/routines?agent=dev&formulaire=1")).toBe(cle("/routines?agent=dev"));
  });
  test("conversation, fichier, dossier et section de réglages changent de page", () => {
    expect(cle("/chat?id=a")).not.toBe(cle("/chat?id=b"));
    expect(cle("/projet?id=p&fichier=a.md")).not.toBe(cle("/projet?id=p&dossier=src"));
    expect(cle("/reglages?section=mobile")).not.toBe(cle("/reglages?section=equipe"));
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
