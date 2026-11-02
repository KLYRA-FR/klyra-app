import { describe, expect, it } from "vitest";
import type { Chat } from "@/types/domain";
import { changerDeLieu } from "./lieux";

const VPS = "https://klyra-vps.exemple.ts.net:8791";

function chat(partiel: Partial<Chat> = {}): Chat {
  return { id: "dm-principal", kind: "direct", projectId: null, title: "Principal", roleIds: ["principal"], updatedAt: "2026-11-02T00:00:00.000Z", sessions: {}, luJusqua: null, ...partiel };
}

describe("changerDeLieu", () => {
  it("ne change rien sur la même machine", () => {
    const avant = chat({ lieu: VPS, sessions: { principal: "s-vps" } });
    expect(changerDeLieu(avant, VPS)).toBe(avant);
    const pc = chat({ sessions: { principal: "s-pc" } });
    expect(changerDeLieu(pc, null)).toBe(pc);
  });

  it("garde de côté les sessions du PC et part d'une session neuve sur le VPS", () => {
    const apres = changerDeLieu(chat({ sessions: { principal: "s-pc" } }), VPS);
    expect(apres.lieu).toBe(VPS);
    expect(apres.sessions).toEqual({});
    expect(apres.sessionsParLieu).toEqual({ pc: { principal: "s-pc" } });
  });

  it("reprend les sessions laissées quand la conversation revient", () => {
    const surVps = changerDeLieu(chat({ sessions: { principal: "s-pc" } }), VPS);
    const travaille = { ...surVps, sessions: { principal: "s-vps" } };
    const retour = changerDeLieu(travaille, null);
    expect(retour.lieu).toBeNull();
    expect(retour.sessions).toEqual({ principal: "s-pc" });
    expect(retour.sessionsParLieu).toEqual({ [VPS]: { principal: "s-vps" } });
    const encore = changerDeLieu(retour, VPS);
    expect(encore.sessions).toEqual({ principal: "s-vps" });
    expect(encore.sessionsParLieu).toEqual({ pc: { principal: "s-pc" } });
  });

  it("n'écrit rien de vide", () => {
    const apres = changerDeLieu(chat(), VPS);
    expect(apres.sessions).toEqual({});
    expect("sessionsParLieu" in apres).toBe(false);
  });
});
