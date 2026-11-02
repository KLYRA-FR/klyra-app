import { describe, expect, test } from "vitest";
import { confirmationDeconnexion, detailTelephone, fermeDepuis, maillonAgent, modeleDe, nomModele, phraseChemin, phrasePerdu, phraseVps, quand } from "./mobile";

const maintenant = new Date(2026, 10, 2, 19, 0).getTime();

describe("Réglages › Mobile : textes", () => {
  test("le modèle ne sort de l'userAgent qu'en trois mots", () => {
    expect(modeleDe("Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1")).toBe("iphone");
    expect(modeleDe("Mozilla/5.0 (Linux; Android 15; Pixel 9) Chrome/131.0 Mobile Safari/537.36")).toBe("android");
    expect(modeleDe("Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0")).toBe("navigateur");
    expect([nomModele("iphone"), nomModele("android"), nomModele("navigateur"), nomModele(null)]).toEqual(["iPhone", "Android", "Navigateur web", "Appareil non identifié"]);
  });

  test("dates : aujourd'hui à l'heure, hier, puis le jour", () => {
    expect(quand(new Date(2026, 10, 2, 18, 42).getTime(), maintenant)).toBe("à 18:42");
    expect(quand(new Date(2026, 10, 1, 9, 0).getTime(), maintenant)).toBe("hier");
    expect(quand(new Date(2026, 9, 31, 9, 0).getTime(), maintenant)).toBe("le 31/10");
    expect(detailTelephone(new Date(2026, 10, 2, 8, 0).getTime(), new Date(2026, 10, 2, 18, 42).getTime(), maintenant)).toBe("Connecté le 02/11 · vu à 18:42");
    expect(fermeDepuis(new Date(2026, 10, 2, 18, 42).getTime(), maintenant)).toBe("Fermé depuis 18:42");
    expect(fermeDepuis(new Date(2026, 9, 31, 18, 42).getTime(), maintenant)).toBe("Fermé depuis le 31/10");
  });

  test("Windows : le chemin, le VPS et la confirmation disent « ce PC », jamais « Mac »", () => {
    const vps = ["Klyra-VPS"];
    const textes = [maillonAgent("ce PC", vps), phraseChemin("ce PC", vps), phraseVps("ce PC", 1), phrasePerdu("ce PC", vps), confirmationDeconnexion("iphone", vps).texte];
    for (const t of textes) expect(t).not.toMatch(/Mac/);
    expect(maillonAgent("ce PC", vps)).toBe("L’agent, sur ce PC ou sur Klyra-VPS");
    expect(phraseChemin("ce PC", vps)).toBe(
      "Ce que tu écris sur ton téléphone passe par ton compte. Ce PC le reprend et l’envoie à l’agent, ici ou sur Klyra-VPS selon la conversation. Ce PC fermé, tes messages attendent son ouverture.",
    );
    expect(phraseVps("ce PC", 1)).toContain("Ses routines tournent même ce PC fermé");
    expect(phraseVps("ce PC", 1)).toContain("Ton téléphone ne lui écrit pas encore en direct.");
    expect(confirmationDeconnexion("iphone", vps)).toEqual({
      titre: "Déconnecter cet iPhone ?",
      texte: "Il ne verra plus tes conversations. Pour revenir, il faudra te reconnecter avec ton adresse e-mail. Son lien avec Klyra-VPS ne change pas.",
    });
  });

  test("Mac et sans VPS : les mêmes phrases, sans VPS", () => {
    expect(maillonAgent("ce Mac", [])).toBe("L’agent, sur ce Mac");
    expect(phraseChemin("ce Mac", [])).toBe("Ce que tu écris sur ton téléphone passe par ton compte. Ce Mac le reprend et l’envoie à l’agent. Ce Mac fermé, tes messages attendent son ouverture.");
    expect(phrasePerdu("ce Mac", [])).toBe("Téléphone perdu : déconnecte-le ici.");
    expect(confirmationDeconnexion(null, []).titre).toBe("Déconnecter cet appareil ?");
    expect(maillonAgent("cet ordinateur", ["Klyra-VPS", "Atelier"])).toBe("L’agent, sur cet ordinateur ou sur Klyra-VPS ou Atelier");
  });
});
