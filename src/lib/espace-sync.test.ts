import { describe, expect, it } from "vitest";
import type { Chat, Message, Project, Rendu } from "@/types/domain";
import { changements, elementsDuServeur, fusionner, memoDe, paquets, type EtatEspace } from "./espace-sync";

const VPS = "https://vps";
const chat = (id: string, lieu: string | null, updatedAt = "2026-11-05T10:00:00Z"): Chat => ({ id, kind: "direct", projectId: null, title: id, roleIds: ["principal"], updatedAt, sessions: {}, luJusqua: null, ...(lieu ? { lieu } : {}) }) as Chat;
const message = (id: string, chatId: string): Message => ({ id, chatId, author: { kind: "user" }, createdAt: "2026-11-05T10:00:00Z", parts: [] }) as unknown as Message;
const vide = (patch: Partial<EtatEspace> = {}): EtatEspace => ({ chats: [], messages: [], projects: [], workflows: [], executions: [], rendus: [], ...patch });

describe("ce qui appartient à un serveur", () => {
  it("ne prend rien de ce PC ni d'un autre serveur", () => {
    const etat = vide({
      chats: [chat("a", VPS), chat("b", null), chat("c", "https://autre")],
      messages: [message("m1", "a"), message("m2", "b")],
      projects: [{ id: "p", lieu: VPS } as unknown as Project, { id: "q" } as unknown as Project],
      workflows: [{ id: "w", lieu: VPS } as never, { id: "x" } as never],
      executions: [{ id: "e1", workflowId: "w" } as never, { id: "e2", workflowId: "x" } as never],
      rendus: [{ id: "r1", origine: `${VPS}#/a` } as unknown as Rendu, { id: "r2", origine: "/chemin" } as unknown as Rendu],
    });
    const { elements } = elementsDuServeur(etat, VPS);
    expect(elements.map((e) => `${e.type}:${e.id}`).sort()).toEqual(["conversation:a", "execution:e1", "projet:p", "rendu:r1", "workflow:w"]);
    expect((elements.find((e) => e.id === "a")!.valeur as { messages: Message[] }).messages.map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("ce qui part au serveur", () => {
  it("n'envoie que ce qui a changé, et dit ce qui a été retiré", () => {
    const a = vide({ chats: [chat("a", VPS), chat("b", VPS)] });
    const premier = changements(elementsDuServeur(a, VPS).elements, new Map());
    expect(premier.aEcrire.map((e) => e.id)).toEqual(["a", "b"]);
    const memo = premier.suivant;
    expect(changements(elementsDuServeur(a, VPS).elements, memo).aEcrire).toEqual([]);
    const c = vide({ chats: [chat("a", VPS, "2026-11-05T11:00:00Z")] });
    const suite = changements(elementsDuServeur(c, VPS).elements, memo);
    expect(suite.aEcrire.map((e) => e.id)).toEqual(["a"]);
    expect(suite.aRetirer).toEqual([{ type: "conversation", id: "b" }]);
  });

  it("une conversation où un agent écrit part sans sa réponse en cours, et n'envoie rien à chaque mot", () => {
    const enCours = (texte: string) => ({ ...message("r", "a"), statut: "en-cours", parts: [{ type: "text", text: texte }] }) as Message;
    const etat = (texte: string) => vide({ chats: [chat("a", VPS)], messages: [message("u", "a"), enCours(texte)] });
    const travaille = (id: string) => id === "a";
    const { elements } = elementsDuServeur(etat("Bon"), VPS, travaille);
    expect((elements[0].valeur as { messages: Message[] }).messages.map((m) => m.id)).toEqual(["u"]);
    const { aEcrire, suivant } = changements(elements, new Map());
    expect(aEcrire).toHaveLength(1);
    expect(changements(elementsDuServeur(etat("Bonjour"), VPS, travaille).elements, suivant).aEcrire).toEqual([]);
  });

  it("découpe un gros envoi", () => {
    const e = (id: string, n: number) => ({ type: "projet" as const, id, valeur: "x".repeat(n) });
    expect(paquets([e("a", 60), e("b", 60), e("c", 10)], 100).map((p) => p.map((x) => x.id))).toEqual([["a"], ["b", "c"]]);
  });
});

describe("ce qui revient du serveur", () => {
  it("le plus récent gagne, et ce qui n'est qu'ici reste pour être envoyé", () => {
    const local = vide({ chats: [chat("vieux", VPS, "2026-11-01T00:00:00Z"), chat("neuf", VPS, "2026-11-05T12:00:00Z"), chat("ici", VPS), chat("pc", null)], messages: [message("mv", "vieux"), message("mn", "neuf"), message("mp", "pc")] });
    const lu = {
      revision: 3,
      elements: [
        { type: "conversation" as const, id: "vieux", valeur: { chat: chat("vieux", VPS, "2026-11-04T00:00:00Z"), messages: [message("sv", "vieux")] } },
        { type: "conversation" as const, id: "neuf", valeur: { chat: chat("neuf", VPS, "2026-11-02T00:00:00Z"), messages: [message("sn", "neuf")] } },
        { type: "conversation" as const, id: "autre-appareil", valeur: { chat: chat("autre-appareil", null), messages: [message("sa", "autre-appareil")] } },
      ],
    };
    const r = fusionner(local, lu, VPS);
    expect(r.chats.map((c) => c.id).sort()).toEqual(["autre-appareil", "ici", "neuf", "pc", "vieux"]);
    expect(r.messages.map((m) => m.id).sort()).toEqual(["mn", "mp", "sa", "sv"]);
    expect(r.chats.find((c) => c.id === "autre-appareil")!.lieu).toBe(VPS);
    expect(r.chats.find((c) => c.id === "pc")!.lieu).toBeUndefined();
  });

  it("un élément retiré sur le serveur part ici aussi, sans toucher à un autre serveur ni à ce qui travaille", () => {
    const local = vide({ chats: [chat("parti", VPS), chat("pc", null), chat("occupe", VPS)], messages: [message("m", "parti")] });
    const r = fusionner(local, { revision: 2, elements: [], supprimes: { conversation: { parti: 1, pc: 1, occupe: 1 } } }, VPS, (id) => id === "occupe");
    expect(r.chats.map((c) => c.id).sort()).toEqual(["occupe", "pc"]);
    expect(r.messages).toEqual([]);
  });

  it("ne remplace pas une conversation où un agent écrit", () => {
    const local = vide({ chats: [chat("a", VPS, "2026-11-01T00:00:00Z")], messages: [message("m", "a")] });
    const r = fusionner(local, { revision: 2, elements: [{ type: "conversation", id: "a", valeur: { chat: chat("a", VPS, "2026-11-05T00:00:00Z"), messages: [] } }] }, VPS, () => true);
    expect(r.messages.map((m) => m.id)).toEqual(["m"]);
  });

  it("ce que rend le serveur sert de point de départ : rien à renvoyer", () => {
    const etat = vide({ chats: [chat("a", VPS)], messages: [message("m", "a")] });
    const { elements } = elementsDuServeur(etat, VPS);
    expect(changements(elements, memoDe(elements)).aEcrire).toEqual([]);
  });
});
