import { describe, expect, it } from "vitest";
import type { Chat } from "@/types/domain";
import { dansEspace, hoteDe, idDirect, lieuDeConversation, lireIdDirect } from "./lieux";

const VPS = "https://klyra-vps.exemple.ts.net:8791";

function chat(partiel: Partial<Chat> = {}): Chat {
  return { id: "dm-principal", kind: "direct", projectId: null, title: "Principal", roleIds: ["principal"], updatedAt: "2026-11-02T00:00:00.000Z", sessions: {}, luJusqua: null, ...partiel };
}

describe("dansEspace", () => {
  it("range sans lieu dans Ce PC, et chaque VPS à part", () => {
    expect(dansEspace(undefined, null)).toBe(true);
    expect(dansEspace(null, null)).toBe(true);
    expect(dansEspace(VPS, null)).toBe(false);
    expect(dansEspace(VPS, VPS)).toBe(true);
    expect(dansEspace(null, VPS)).toBe(false);
  });
});

describe("idDirect", () => {
  it("donne une conversation par agent et par serveur", () => {
    expect(idDirect("hugo")).toBe("dm-hugo");
    expect(idDirect("hugo", VPS)).toBe(`dm-hugo@${hoteDe(VPS)}`);
    expect(hoteDe(VPS)).toBe("klyra-vps.exemple.ts.net:8791");
  });

  it("reprend une conversation d'avant restée sur le VPS, et en ouvre une autre pour ce PC", () => {
    const chats = [chat({ id: "dm-hugo", roleIds: ["hugo"], lieu: VPS })];
    expect(idDirect("hugo", VPS, chats)).toBe("dm-hugo");
    expect(idDirect("hugo", null, chats)).toBe("dm-hugo@pc");
    expect(idDirect("hugo", null, [...chats, chat({ id: "dm-hugo@pc", roleIds: ["hugo"] })])).toBe("dm-hugo@pc");
  });

  it("ne prend ni un fil ni la conversation d'un autre agent", () => {
    const chats = [
      chat({ id: "klyra-fil-1a2b", roleIds: ["hugo"], lieu: VPS, fil: { roleId: "hugo" } as Chat["fil"] }),
      chat({ id: "dm-hugone", roleIds: ["hugone"], lieu: VPS }),
    ];
    expect(idDirect("hugo", VPS, chats)).toBe(`dm-hugo@${hoteDe(VPS)}`);
  });

  it("relit l'agent et l'hôte d'un id", () => {
    expect(lireIdDirect("dm-hugo")).toEqual({ roleId: "hugo", hote: null });
    expect(lireIdDirect("dm-hugo@pc")).toEqual({ roleId: "hugo", hote: null });
    expect(lireIdDirect(idDirect("hugo", VPS))).toEqual({ roleId: "hugo", hote: hoteDe(VPS) });
    expect(lireIdDirect("klyra-fil-1a2b")).toBeNull();
  });
});

describe("lieuDeConversation", () => {
  it("donne la machine d'une conversation, celle d'où part un nouveau fil", () => {
    const chats = [chat({ id: "dm-hugo@pc", roleIds: ["hugo"] }), chat({ id: "dm-hugo", roleIds: ["hugo"], lieu: VPS })];
    expect(lieuDeConversation(chats, "dm-hugo")).toBe(VPS);
    expect(lieuDeConversation(chats, "dm-hugo@pc")).toBeNull();
  });

  it("lit à son id une conversation directe pas encore enregistrée", () => {
    expect(lieuDeConversation([], "dm-iris")).toBeNull();
    expect(lieuDeConversation([], `dm-iris@${hoteDe(VPS)}`)).toBe(`https://${hoteDe(VPS)}`);
    expect(lieuDeConversation([], "klyra-fil-1a2b3c4d")).toBeNull();
  });
});
