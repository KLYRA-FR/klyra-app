import { describe, expect, test } from "vitest";
import { appliquerEvenement, envoiSimple, voieEnvoi, type EchangeDirect } from "./vps-direct";

const echange: EchangeDirect = {
  conversation: "dm-hugo",
  messageId: "tel-1",
  texte: "Relance le build",
  creeLe: "2026-11-02T10:00:00.000Z",
  adresse: "https://vps.exemple.test",
  requestId: "r1",
  agentId: "hugo",
  reponse: "",
  statut: "en-cours",
  erreur: null,
  autorisation: null,
};

describe("voie directe vers le VPS", () => {
  test("la conversation choisit sa destination ; un accès VPS perdu ne revient pas au PC", () => {
    expect(voieEnvoi({ lieu: "https://vps.exemple.test", jeton: "j" })).toBe("vps");
    expect(voieEnvoi({ lieu: "https://vps.exemple.test", jeton: null })).toBe("non-relie");
    expect(voieEnvoi({ lieu: null, jeton: "j" })).toBe("file");
  });

  test("le texte s'écrit, l'accord s'affiche puis se retire, la fin garde le texte complet", () => {
    let e = appliquerEvenement(echange, { type: "texte", delta: "Je " });
    e = appliquerEvenement(e, { type: "texte", delta: "lance." });
    expect(e.reponse).toBe("Je lance.");
    e = appliquerEvenement(e, { type: "autorisation", id: "d1", outil: "Bash", description: "pnpm build" });
    expect(e.autorisation).toEqual({ id: "d1", outil: "Bash", description: "pnpm build" });
    e = appliquerEvenement(e, { type: "autorisation-fin", id: "d1" });
    expect(e.autorisation).toBeNull();
    e = appliquerEvenement(e, { type: "fin", ok: true, texte: "Build lancé." });
    expect(e).toMatchObject({ statut: "fait", reponse: "Build lancé." });
  });

  test("seul un simple message part au VPS : ni pièce, ni réessai, ni branche, ni nouvelle conversation", () => {
    expect(envoiSimple({}, 0)).toBe(true);
    expect(envoiSimple({ modele: "sonnet" } as never, 0)).toBe(true);
    expect(envoiSimple({}, 1)).toBe(false);
    expect(envoiSimple({ reessayer: { messageId: "m" } }, 0)).toBe(false);
    expect(envoiSimple({ brancher: { messageId: "m" } }, 0)).toBe(false);
    expect(envoiSimple({ nouveau: { projetId: "p" } }, 0)).toBe(false);
  });

  test("une erreur de l'agent est dite en clair", () => {
    const e = appliquerEvenement(echange, { type: "fin", ok: false, texte: "", erreur: "Claude Code n’est pas connecté sur le VPS." });
    expect(e).toMatchObject({ statut: "erreur", erreur: "Claude Code n’est pas connecté sur le VPS." });
  });

  test("un nouveau bloc de texte est séparé du précédent", () => {
    const e = appliquerEvenement({ ...echange, reponse: "Avant." }, { type: "texte", delta: "Après.", nouveauBloc: true });
    expect(e.reponse).toBe("Avant.\n\nAprès.");
  });
});
