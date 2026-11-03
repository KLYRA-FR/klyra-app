import { describe, expect, it } from "vitest";
import {
  COMMANDE_RESUME_AUTO,
  conseilContexte,
  DUREE_CACHE_MS,
  estCommandeCompacter,
  formaterJetons,
  nouvelleMesure,
  resumeAvantEnvoi,
  resumePause,
  SEUIL_LOURD,
  SEUIL_REPRISE,
  SEUIL_RESUME_ENVOI,
  SEUIL_RESUME_PAUSE,
} from "./contexte";
import { aReprendre } from "./fournisseurs";
import type { Chat, Message } from "@/types/domain";

const MAINTENANT = Date.parse("2026-11-03T15:00:00Z");
const ilYa = (ms: number) => new Date(MAINTENANT - ms).toISOString();

function chat(contexte: Chat["contexte"], autres: Partial<Chat> = {}): Chat {
  return {
    id: "dm-dev",
    kind: "direct",
    projectId: null,
    title: "Hugo",
    roleIds: ["dev"],
    updatedAt: ilYa(0),
    sessions: { dev: "s1" },
    luJusqua: null,
    contexte,
    ...autres,
  };
}

describe("conseilContexte", () => {
  it("rien sans mesure, ou pour une conversation légère et récente", () => {
    expect(conseilContexte(chat(undefined), MAINTENANT)).toBeNull();
    expect(conseilContexte(chat({ dev: { jetons: 40_000, le: ilYa(60_000), session: "s1" } }), MAINTENANT)).toBeNull();
  });

  it("une conversation lourde : résumer", () => {
    expect(conseilContexte(chat({ dev: { jetons: SEUIL_LOURD, le: ilYa(60_000), session: "s1" } }), MAINTENANT)).toEqual({
      roleId: "dev",
      jetons: SEUIL_LOURD,
      raison: "lourde",
      cacheExpire: false,
      filPossible: true,
    });
  });

  it("après plus d'une heure, une conversation moyenne : un fil neuf plutôt qu'un résumé", () => {
    const pause = chat({ dev: { jetons: SEUIL_REPRISE, le: ilYa(DUREE_CACHE_MS + 1), session: "s1" } });
    expect(conseilContexte(pause, MAINTENANT)).toMatchObject({ raison: "pause", cacheExpire: true, filPossible: true });
    const petite = chat({ dev: { jetons: SEUIL_REPRISE - 1, le: ilYa(DUREE_CACHE_MS + 1), session: "s1" } });
    expect(conseilContexte(petite, MAINTENANT)).toBeNull();
  });

  it("une conversation d'équipe n'a pas de fil : pas de conseil de pause, mais le résumé si elle est lourde", () => {
    const equipe = { kind: "equipe" as const, projectId: "p", roleIds: ["principal"], sessions: { principal: "s1" } };
    expect(conseilContexte(chat({ principal: { jetons: 40_000, le: ilYa(DUREE_CACHE_MS + 1), session: "s1" } }, equipe), MAINTENANT)).toBeNull();
    expect(conseilContexte(chat({ principal: { jetons: 90_000, le: ilYa(DUREE_CACHE_MS + 1), session: "s1" } }, equipe), MAINTENANT)).toMatchObject({
      raison: "lourde",
      cacheExpire: true,
      filPossible: false,
    });
  });

  it("le socle (consignes, outils) ne compte pas : seuls les échanges déclenchent le conseil", () => {
    const socle = 30_000;
    const legere = chat({ dev: { jetons: socle + 10_000, base: socle, le: ilYa(DUREE_CACHE_MS + 1), session: "s1" } });
    expect(conseilContexte(legere, MAINTENANT)).toBeNull();
    const lourde = chat({ dev: { jetons: socle + SEUIL_LOURD, base: socle, le: ilYa(0), session: "s1" } });
    expect(conseilContexte(lourde, MAINTENANT)).toMatchObject({ raison: "lourde", jetons: socle + SEUIL_LOURD });
  });

  it("une mesure d'une autre session (autre lieu, autre moteur) ne compte pas", () => {
    expect(conseilContexte(chat({ dev: { jetons: 120_000, le: ilYa(0), session: "ancienne" } }), MAINTENANT)).toBeNull();
  });

  it("« Plus tard » : masqué jusqu'à ce que la conversation grossisse encore", () => {
    const mesure = { dev: { jetons: 90_000, le: ilYa(0), session: "s1" } };
    expect(conseilContexte(chat(mesure, { contexteMasqueJusqua: 110_000 }), MAINTENANT)).toBeNull();
    expect(conseilContexte(chat({ dev: { ...mesure.dev, jetons: 115_000 } }, { contexteMasqueJusqua: 110_000 }), MAINTENANT)?.raison).toBe("lourde");
  });

  it("dans une conversation d'équipe, l'agent dont le contexte pèse le plus", () => {
    const equipe = chat(
      { dev: { jetons: 85_000, le: ilYa(0), session: "s1" }, designer: { jetons: 95_000, le: ilYa(0), session: "s2" } },
      { kind: "equipe", roleIds: ["principal", "dev", "designer"], sessions: { dev: "s1", designer: "s2" } },
    );
    expect(conseilContexte(equipe, MAINTENANT)?.roleId).toBe("designer");
  });
});

describe("nouvelleMesure", () => {
  const le = ilYa(0);
  it("le socle est pris au premier appel de la session, puis gardé", () => {
    const premiere = nouvelleMesure(undefined, "s1", { jetons: 30_000 }, le);
    expect(premiere).toEqual({ jetons: 30_000, base: 30_000, le, session: "s1" });
    expect(nouvelleMesure(premiere, "s1", { jetons: 70_000 }, le)).toMatchObject({ jetons: 70_000, base: 30_000 });
  });

  it("une session neuve repart de son propre socle", () => {
    const ancienne = { jetons: 90_000, base: 30_000, le, session: "s1" };
    expect(nouvelleMesure(ancienne, "s2", { jetons: 31_000 }, le)).toMatchObject({ jetons: 31_000, base: 31_000, session: "s2" });
  });

  it("après un résumé : socle + résumé, en attendant la mesure suivante", () => {
    const avant = { jetons: 95_000, base: 30_000, le, session: "s1" };
    expect(nouvelleMesure(avant, "s1", { resume: 4_000 }, le)).toMatchObject({ jetons: 34_000, base: 30_000 });
  });
});

describe("commande et format", () => {
  it("reconnaît /compact, seul ou avec une consigne", () => {
    expect(estCommandeCompacter(" /compact ")).toBe(true);
    expect(estCommandeCompacter("/compact garde les décisions")).toBe(true);
    expect(estCommandeCompacter("/compacter")).toBe(false);
    expect(estCommandeCompacter("peux-tu /compact")).toBe(false);
  });

  it("formate en milliers", () => {
    expect(formaterJetons(82_400)).toBe("82 k");
    expect(formaterJetons(640)).toBe("640");
  });
});

describe("aReprendre après un résumé", () => {
  const msg = (id: string, auteur: Message["author"], extra: Partial<Message> = {}): Message => ({
    id,
    chatId: "c",
    author: auteur,
    createdAt: ilYa(0),
    parts: [{ type: "text", text: id }],
    ...extra,
  });

  it("le résumé n'est pas une réponse : ce que l'agent n'a pas lu reste à lire", () => {
    const fil = [
      msg("reponse-dev", { kind: "role", roleId: "dev" }),
      msg("message-iris", { kind: "role", roleId: "designer" }),
      msg("/compact", { kind: "user" }),
      msg("resume", { kind: "role", roleId: "dev" }, { compaction: true }),
    ];
    expect(aReprendre(fil, "dev", "claude").map((m) => m.id)).toEqual(["message-iris", "/compact", "resume"]);
  });
});

describe("résumé automatique", () => {
  const socle = 15_000;
  const mesure = (echanges: number, minutes: number) => ({ dev: { jetons: socle + echanges, base: socle, le: ilYa(minutes * 60_000), session: "s1" } });

  it("pendant une pause : entre 25 et 55 minutes, pour une conversation d'au moins 40 k jetons d'échanges", () => {
    expect(resumePause(chat(mesure(SEUIL_RESUME_PAUSE, 26)), MAINTENANT)).toBe("dev");
    expect(resumePause(chat(mesure(SEUIL_RESUME_PAUSE - 1, 26)), MAINTENANT)).toBeNull();
    expect(resumePause(chat(mesure(SEUIL_RESUME_PAUSE, 10)), MAINTENANT)).toBeNull();
    // Poste en veille : le cache a sans doute expiré, le résumé coûterait autant que la relecture.
    expect(resumePause(chat(mesure(SEUIL_RESUME_PAUSE, 70)), MAINTENANT)).toBeNull();
  });

  it("pas pour un fil archivé, ni pour la mesure d'une ancienne session", () => {
    const fil = { roleId: "dev", statut: "archive" } as unknown as Chat["fil"];
    expect(resumePause(chat(mesure(60_000, 30), { fil }), MAINTENANT)).toBeNull();
    expect(resumePause(chat(mesure(60_000, 30), { sessions: { dev: "autre" } }), MAINTENANT)).toBeNull();
  });

  it("avant un message : seulement au-delà de 80 k jetons d'échanges", () => {
    expect(resumeAvantEnvoi(chat(mesure(SEUIL_RESUME_ENVOI, 0)), "dev")).toBe(true);
    expect(resumeAvantEnvoi(chat(mesure(SEUIL_RESUME_ENVOI - 1, 0)), "dev")).toBe(false);
    expect(resumeAvantEnvoi(chat(mesure(SEUIL_RESUME_ENVOI, 0)), "designer")).toBe(false);
  });

  it("la commande est un /compact avec ce qu'il faut garder", () => {
    expect(estCommandeCompacter(COMMANDE_RESUME_AUTO)).toBe(true);
    expect(COMMANDE_RESUME_AUTO).toMatch(/décisions.*chemins.*tâches en cours.*accords/);
  });
});
