import { describe, expect, it } from "vitest";
import type { Chat, Message } from "@/types/domain";
import { aReprendre, changerDeMoteur, limiterReprise, moteurDe } from "./fournisseurs";

const chat = (patch: Partial<Chat> = {}): Chat => ({
  id: "c1",
  kind: "direct",
  projectId: null,
  title: "Hugo",
  roleIds: ["hugo"],
  updatedAt: "2026-11-02T10:00:00Z",
  sessions: {},
  luJusqua: null,
  ...patch,
});

let n = 0;
const message = (auteur: "moi" | "hugo" | "iris", moteur?: string): Message => ({
  id: `m${++n}`,
  chatId: "c1",
  author: auteur === "moi" ? { kind: "user" } : { kind: "role", roleId: auteur },
  createdAt: "2026-11-02T10:00:00Z",
  parts: [{ type: "text", text: auteur }],
  ...(moteur ? { moteur } : {}),
});

describe("moteurDe", () => {
  it("Claude Code par défaut, ChatGPT quand la conversation l'a choisi", () => {
    expect(moteurDe(chat())).toBe("claude");
    expect(moteurDe(chat({ fournisseur: "codex" }))).toBe("codex");
  });
  it("sur un VPS, Claude Code seul pour l'instant", () => {
    expect(moteurDe(chat({ fournisseur: "codex", lieu: "https://vps.exemple" }))).toBe("claude");
  });
});

describe("changerDeMoteur", () => {
  it("met de côté les sessions de Claude et part sans session sur ChatGPT", () => {
    const suivant = changerDeMoteur(chat({ sessions: { hugo: "claude-1" } }), "codex");
    expect(suivant.fournisseur).toBe("codex");
    expect(suivant.sessions).toEqual({});
    expect(suivant.sessionsParMoteur).toEqual({ claude: { hugo: "claude-1" } });
  });
  it("retrouve les sessions laissées en revenant, et garde celles de l'autre", () => {
    const aller = changerDeMoteur(chat({ sessions: { hugo: "claude-1" } }), "codex");
    const retour = changerDeMoteur({ ...aller, sessions: { hugo: "codex-1" } }, "claude");
    expect(retour.fournisseur).toBeUndefined();
    expect(retour.sessions).toEqual({ hugo: "claude-1" });
    expect(retour.sessionsParMoteur).toEqual({ codex: { hugo: "codex-1" } });
  });
  it("ne change rien quand on reste sur le même", () => {
    const c = chat({ sessions: { hugo: "claude-1" } });
    expect(changerDeMoteur(c, "claude")).toBe(c);
  });
  it("sans session nulle part, rien n'est rangé", () => {
    expect(changerDeMoteur(chat(), "codex").sessionsParMoteur).toBeUndefined();
  });
});

describe("aReprendre", () => {
  it("un moteur qui n'a jamais répondu reprend toute la conversation", () => {
    const fil = [message("moi"), message("hugo"), message("moi")];
    expect(aReprendre(fil, "hugo", "codex")).toEqual(fil);
  });
  it("de retour sur Claude, l'agent reçoit ce qui a suivi sa dernière réponse avec Claude, ChatGPT compris", () => {
    const avant = [message("moi"), message("hugo")];
    const pendant = [message("moi"), message("hugo", "codex"), message("moi")];
    expect(aReprendre([...avant, ...pendant], "hugo", "claude")).toEqual(pendant);
  });
  it("les réponses des autres agents ne comptent pas comme les siennes", () => {
    const fil = [message("moi"), message("iris"), message("moi")];
    expect(aReprendre(fil, "hugo", "claude")).toEqual(fil);
  });
});

describe("limiterReprise", () => {
  it("garde tout sous la limite", () => {
    expect(limiterReprise(["a", "b"], 10)).toEqual(["a", "b"]);
  });
  it("laisse les plus anciens au-delà, et le dit", () => {
    expect(limiterReprise(["aaaa", "bbbb", "cccc"], 9)).toEqual(["[… 1 message plus ancien non repris]", "bbbb", "cccc"]);
    expect(limiterReprise(["aaaa", "bbbb", "cccc"], 4)).toEqual(["[… 2 messages plus anciens non repris]", "cccc"]);
  });
});
