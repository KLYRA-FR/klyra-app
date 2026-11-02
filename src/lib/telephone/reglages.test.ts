import { describe, expect, test } from "vitest";
import { SECTIONS } from "@/components/reglages/catalogue";
import { accesPermis, computerUsePermis, ETATS_LIGNES, etatLigne, RAISONS, sectionsTelephone } from "./reglages";

describe("états des lignes de Réglages sur le téléphone (T-22, § 7)", () => {
  test("chaque ligne du catalogue a un état déclaré, et rien d'autre n'est déclaré", () => {
    const ids = SECTIONS.flatMap((s) => s.entrees.map((e) => e.id));
    expect(ids.filter((id) => !(id in ETATS_LIGNES))).toEqual([]);
    expect(Object.keys(ETATS_LIGNES).filter((id) => !ids.includes(id))).toEqual([]);
  });

  test("les raisons « Sur ton Mac » sont celles du § 7, mot pour mot", () => {
    expect(RAISONS.cles).toBe("les clés ne quittent pas l’ordinateur.");
    expect(RAISONS.toutAccepter).toBe("ouvrir tous les accès se décide devant l’ordinateur.");
    expect(RAISONS.computerUse).toBe("piloter l’ordinateur s’autorise devant lui.");
    expect(RAISONS.dictee).toBe("la dictée du téléphone passe par son clavier.");
    expect(RAISONS.maj).toBe("la relancer à distance couperait le lien avec ce téléphone.");
    expect(RAISONS.ordinateur).toBe("réglage de cet ordinateur.");
  });

  test("les clés restent sur l'ordinateur", () => {
    for (const id of ["cle-admin", "autres-ia", "cle-elevenlabs"]) expect(etatLigne(id)).toEqual({ type: "ordinateur", raison: RAISONS.cles });
  });

  test("Profil : nom et rôle en ligne, photo sur l'ordinateur, consommation lue sur l'ordinateur", () => {
    expect(etatLigne("nom")).toEqual({ type: "compte" });
    expect(etatLigne("photo")).toEqual({ type: "ordinateur", raison: RAISONS.ordinateur });
    expect(etatLigne("chiffres").type).toBe("lecture");
  });

  test("Équipe : tout en ligne ; Voix : tout sur l'ordinateur", () => {
    const section = (id: string) => SECTIONS.find((s) => s.id === id)!.entrees.map((e) => etatLigne(e.id));
    expect(section("equipe").every((e) => e.type === "compte")).toBe(true);
    expect(section("voix").every((e) => e.type === "ordinateur")).toBe(true);
    expect(section("autres-ia").every((e) => e.type === "ordinateur")).toBe(true);
  });

  test("Agents et Computer Use : réduire depuis le téléphone, élargir devant l'ordinateur (M-13)", () => {
    expect(etatLigne("acces")).toEqual({ type: "poste", elevation: RAISONS.toutAccepter });
    expect(etatLigne("computer-use-actif")).toEqual({ type: "poste", elevation: RAISONS.computerUse });
    expect(etatLigne("autorisation-ecran")).toEqual({ type: "lecture", elevation: RAISONS.computerUse });
    expect(etatLigne("assistant").type).toBe("poste");
    expect(etatLigne("dossier-agents")).toEqual({ type: "ordinateur", raison: RAISONS.montrer });
  });

  test("Mises à jour : l'état se lit, l'installation reste devant l'ordinateur", () => {
    expect(etatLigne("version-installee").type).toBe("lecture");
    expect(etatLigne("rechercher-maj").type).toBe("poste");
    expect(etatLigne("installer-maj")).toEqual({ type: "ordinateur", raison: RAISONS.maj });
  });

  test("Général : la version de l'app web se lit sur le téléphone, le reste règle l'ordinateur", () => {
    expect(etatLigne("version")).toEqual({ type: "telephone" });
    for (const id of ["lancement", "raccourcis", "dossier-donnees", "dossier-klyra"]) expect(etatLigne(id)).toEqual({ type: "ordinateur", raison: RAISONS.ordinateur });
  });

  test("une ligne inconnue reste sur l'ordinateur", () => {
    expect(etatLigne("nouveau-reglage")).toEqual({ type: "ordinateur", raison: RAISONS.ordinateur });
  });

  test("« Ce téléphone » (la section Mobile) vient en tête, le reste dans l'ordre du bureau", () => {
    const sections = sectionsTelephone();
    expect(sections[0]).toMatchObject({ id: "mobile", titreTelephone: "Ce téléphone" });
    expect(sections.slice(1).map((s) => s.id)).toEqual(SECTIONS.filter((s) => s.id !== "mobile").map((s) => s.id));
  });
});

describe("pouvoirs des agents depuis le téléphone (M-13)", () => {
  test("le niveau d'accès ne fait que descendre, jamais vers « Tout accepter »", () => {
    expect(accesPermis("tout", "projet")).toBe(true);
    expect(accesPermis("tout", "demander")).toBe(true);
    expect(accesPermis("projet", "demander")).toBe(true);
    expect(accesPermis("projet", "projet")).toBe(true);
    expect(accesPermis("demander", "projet")).toBe(false);
    expect(accesPermis("projet", "tout")).toBe(false);
    expect(accesPermis("tout", "tout")).toBe(false);
  });

  test("Computer Use se coupe, il ne s'active pas", () => {
    expect(computerUsePermis(false)).toBe(true);
    expect(computerUsePermis(true)).toBe(false);
  });
});
