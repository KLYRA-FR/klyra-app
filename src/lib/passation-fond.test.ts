import { describe, expect, test } from "vitest";
import type { Message } from "@/types/domain";
import { finTacheDeFond, sansFondOrphelin } from "./passation-fond";

const message = (statut: "en-cours" | "fait", fond?: boolean): Message => ({
  id: "m1",
  chatId: "dm-camille",
  author: { kind: "role", roleId: "camille" },
  createdAt: "2026-11-06T09:00:00.000Z",
  parts: [{ type: "passation", etapeId: "toolu_1", roleId: "hugo", consigne: "Brancher Qonto", statut, ...(fond ? { fond } : {}) }],
});

describe("passation en arrière-plan", () => {
  test("le retour de l'agent la passe rendue, ou arrêtée", () => {
    expect(finTacheDeFond(message("en-cours", true).parts, "toolu_1", "fait")[0]).toMatchObject({ statut: "fait" });
    expect(finTacheDeFond(message("en-cours", true).parts, "toolu_1", "erreur")[0]).toMatchObject({ statut: "erreur" });
    expect(finTacheDeFond(message("en-cours", true).parts, "toolu_2", "fait")[0]).toMatchObject({ statut: "en-cours" });
  });

  test("au chargement, un agent d'arrière-plan de ce PC n'attend plus ; sur un VPS, il attend son retour", () => {
    expect(sansFondOrphelin(message("en-cours", true), true).parts[0]).toMatchObject({ statut: "erreur" });
    expect(sansFondOrphelin(message("en-cours", true), false).parts[0]).toMatchObject({ statut: "en-cours" });
    const ordinaire = message("en-cours");
    expect(sansFondOrphelin(ordinaire, true)).toBe(ordinaire);
  });
});
