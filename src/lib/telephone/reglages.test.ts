import { describe, expect, test } from "vitest";
import { SECTIONS } from "@/components/reglages/catalogue";
import { ROLE_TEINTES } from "@/types/domain";
import {
  accesPermis,
  computerUsePermis,
  confirmationAcces,
  dateCourte,
  ETATS_LIGNES,
  etatLigne,
  groupesReglages,
  iconeLigne,
  initialesDe,
  libelleModele,
  NOMS_TEINTES,
  RAISONS,
  remiseAZero,
  resultatsTelephone,
  sectionAuPoste,
  sectionsTelephone,
} from "./reglages";

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

describe("la liste des Réglages (lot 8, E8-15 à E8-18)", () => {
  test("trois groupes par source, et aucune section du catalogue n'est perdue", () => {
    const { compte, poste, restent } = groupesReglages();
    expect(compte.map((l) => l.id)).toEqual(["mobile", "profil", "equipe"]);
    expect(poste.map((l) => l.id)).toEqual(["claude", "agents", "notifications", "computer-use", "mises-a-jour"]);
    expect([...compte, ...poste, ...restent].map((l) => l.id).sort()).toEqual(SECTIONS.map((s) => s.id).sort());
    expect(restent.map((l) => l.id)).toContain("coffre");
    expect(compte[0].titre).toBe("Ce téléphone");
  });

  test("le poste vient de useSupport, jamais écrit en dur", () => {
    const { poste, restent } = groupesReglages();
    expect(poste.find((l) => l.id === "notifications")!.detail("ton PC")).toBe("Celles de ton PC");
    for (const l of [...poste, ...restent]) expect(l.detail("ton PC")).not.toMatch(/Mac/);
  });

  test("recherche « son » : les sons du téléphone d'abord dans Ce téléphone, l'ordinateur dit, le micro « Sur ton Mac »", () => {
    const r = resultatsTelephone("son", "ton Mac");
    const de = (titre: string) => r.find((x) => x.titre === titre)!;
    expect(de("Sons des actions")).toMatchObject({ ligne2: "Ce téléphone", surPoste: false, href: "/reglages?section=mobile&reglage=sons-actions" });
    expect(de("Volume des sons")).toMatchObject({ ligne2: "Ce téléphone", surPoste: false });
    expect(de("Son")).toMatchObject({ ligne2: "Notifications · ton Mac", surPoste: false });
    expect(de("Tester le micro")).toMatchObject({ ligne2: "Voix", surPoste: true });
    expect(r.every((x) => !x.titre.includes("reglage="))).toBe(true);
  });

  test("recherche sans résultat : rien, sans lecture réseau", () => {
    expect(resultatsTelephone("imprimante", "ton Mac")).toEqual([]);
    expect(resultatsTelephone("  ", "ton Mac")).toEqual([]);
  });

  test("une section au poste a son état, une section lue d'ici n'en a pas", () => {
    expect(sectionAuPoste("voix", "ton Mac")?.titre).toBe("La voix se règle sur ton Mac");
    expect(sectionAuPoste("claude", "ton Mac")).toBeNull();
    for (const id of ["voix", "autres-ia", "navigateur", "marketplace", "coffre"] as const) expect(sectionAuPoste(id, "ton PC")).not.toBeNull();
  });

  test("une clé porte le cadenas", () => {
    expect(iconeLigne("cle-elevenlabs", "microphone-01")).toBe("lock-01");
    expect(iconeLigne("moteur", "microphone-01")).toBe("microphone-01");
  });
});

describe("réduire un accès, choisir un modèle (E8-32 à E8-35)", () => {
  test("la confirmation dit qu'on ne remonte pas d'ici", () => {
    const c = confirmationAcces({ id: "demander", nom: "Me demander à chaque fois" }, "ton Mac");
    expect(c.titre).toBe("Passer à « Me demander à chaque fois » ?");
    expect(c.texte).toContain("Revenir au niveau actuel se fera devant ton Mac.");
    expect(c.confirmer).toBe("Réduire l’accès");
  });

  test("le modèle d'une ligne : un nom lisible, jamais un identifiant", () => {
    expect(libelleModele("sonnet")).toBe("Sonnet");
    expect(libelleModele("inherit")).toBe("Session");
    expect(libelleModele("claude-essai-4-5")).toBe("Autre modèle");
  });
});

describe("dates et couleurs", () => {
  const maintenant = new Date(2026, 10, 5, 14, 0).getTime();
  test("remise à zéro, en français", () => {
    expect(remiseAZero(new Date(2026, 10, 5, 16, 0).getTime(), maintenant)).toBe("remise à zéro à 16:00");
    expect(remiseAZero(new Date(2026, 10, 6, 9, 0).getTime(), maintenant)).toBe("remise à zéro demain à 09:00");
    expect(remiseAZero(new Date(2026, 10, 9, 9, 0).getTime(), maintenant)).toBe("remise à zéro lundi à 09:00");
    expect(remiseAZero(new Date(2026, 10, 20, 9, 0).getTime(), maintenant)).toBe("remise à zéro le 20 nov. à 09:00");
  });
  test("dernière vérification", () => {
    expect(dateCourte(new Date(2026, 10, 5, 13, 40).getTime(), maintenant)).toBe("aujourd’hui, 13:40");
    expect(dateCourte(new Date(2026, 10, 4, 18, 2).getTime(), maintenant)).toBe("hier, 18:02");
    expect(dateCourte(new Date(2026, 10, 2, 9, 0).getTime(), maintenant)).toBe("le 2 nov., 09:00");
  });
  test("chaque couleur d'équipe a un nom humain, jamais son token", () => {
    for (const t of ROLE_TEINTES) {
      expect(NOMS_TEINTES[t]).toBeTruthy();
      expect(NOMS_TEINTES[t]).not.toMatch(/-k\d/);
    }
  });
  test("initiales d'une personne", () => {
    expect(initialesDe("Camille Essai")).toBe("CE");
    expect(initialesDe("Sam")).toBe("S");
    expect(initialesDe("  ")).toBe("?");
  });
});
