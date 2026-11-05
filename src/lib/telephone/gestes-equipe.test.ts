import { describe, expect, test, vi } from "vitest";
import { plierEquipes } from "@/lib/atelier-equipe";
import { vueEquipe } from "@/lib/atelier-compte";
import { ErreurPoste } from "@/lib/poste/types";
import type { Message, MessagePart, Role } from "@/types/domain";
import { gestesEquipe, type DepsEquipe } from "./gestes-equipe";

type PartEquipe = Extract<MessagePart, { type: "atelier-equipe" }>;

const role = (id: string, name: string, tag = ""): Role => ({ id, name, tag, teinte: "vert" }) as Role;

function conversation(): Message[] {
  const m = (id: string, parts: MessagePart[]): Message => ({ id, chatId: "dm-principal", author: { kind: "role", roleId: "principal" }, createdAt: "2026-11-05T10:00:00.000Z", parts });
  return [
    m("m1", [{ type: "atelier-equipe", etapeId: "e1", maj: { nom: "Studio", but: "La newsletter sans y passer le week-end.", membres: [{ nom: "Nina", role: "Rédaction", mission: "Écrit la newsletter." }] } }]),
    m("m2", [
      {
        type: "atelier-equipe",
        etapeId: "e2",
        maj: { membres: [{ nom: "Léo", role: "Visuels", mission: "Fait les visuels." }], existants: [{ id: "dev", raison: "Garde le site." }], exemples: [{ demande: "La newsletter de mai", membre: "nina" }] },
      },
    ]),
  ];
}

function poste(options: { roles?: Role[]; echoue?: string } = {}) {
  const messages = conversation();
  const marquer: DepsEquipe["marquer"] = (messageId, etapeId, patch) => {
    const message = messages.find((x) => x.id === messageId);
    if (!message) return;
    message.parts = message.parts.map((p) => (p.type === "atelier-equipe" && p.etapeId === etapeId ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) } : p));
  };
  const create = vi.fn<DepsEquipe["create"]>(async (id) => {
    if (id === options.echoue) throw new Error("Disque plein.");
  });
  const roles = options.roles ?? [role("principal", "Léa"), role("dev", "Hugo", "Dev")];
  const deps: DepsEquipe = { messages: (c) => (c === "dm-principal" ? messages : null), roles, identifiantLibre: (p) => p, create, marquer: vi.fn(marquer), teinteDe: () => "ocre" };
  const part = (etapeId: string) => messages.flatMap((x) => x.parts).find((p): p is PartEquipe => p.type === "atelier-equipe" && p.etapeId === etapeId)!;
  return { gestes: gestesEquipe(deps), messages, part, create, roles };
}

const ARGS = { conversation: "dm-principal", etapeId: "e2" };
const code = async (p: Promise<unknown>) => {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof ErreurPoste ? e.code : String(e);
  }
};

describe("l'atelier d'une équipe depuis le téléphone", () => {
  test("garder ou laisser de côté un agent, sur la carte relue par l'ordinateur", async () => {
    const { gestes, part } = poste();
    await gestes["atelier.equipeGarder"]({ ...ARGS, membre: "leo", garder: false });
    expect(part("e2").ecartes).toEqual(["leo"]);
    await gestes["atelier.equipeGarder"]({ ...ARGS, membre: "leo", garder: true });
    expect(part("e2").ecartes).toEqual([]);
    expect(await code(gestes["atelier.equipeGarder"]({ ...ARGS, membre: "personne", garder: true }))).toBe("membre_absent");
    expect(await code(gestes["atelier.equipeGarder"]({ ...ARGS, etapeId: "e1", membre: "nina", garder: false }))).toBe("remplacee");
  });

  test("créer l'équipe : chaque agent gardé, sa fiche, noté sur la carte ; une seconde fois est refusée", async () => {
    const { gestes, part, create } = poste();
    await gestes["atelier.equipeGarder"]({ ...ARGS, membre: "leo", garder: false });
    expect(await gestes["atelier.equipeCreer"](ARGS)).toEqual({ ids: ["nina"] });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).toContain("displayName: Nina");
    expect(part("e2").crees).toEqual({ nina: "nina" });
    expect(await code(gestes["atelier.equipeCreer"](ARGS))).toBe("deja_cree");
  });

  test("une erreur au milieu garde ceux qui sont nés", async () => {
    const { gestes, part } = poste({ echoue: "leo" });
    expect(await code(gestes["atelier.equipeCreer"](ARGS))).toBe("Error: Disque plein.");
    expect(part("e2").crees).toEqual({ nina: "nina" });
  });

  test("un prénom déjà pris bloque la création", async () => {
    const { gestes } = poste({ roles: [role("principal", "Léa"), role("dev", "Hugo", "Dev"), role("autre", "Nina")] });
    expect(await code(gestes["atelier.equipeCreer"](ARGS))).toBe("incomplet");
  });
});

describe("la carte d'équipe copiée pour le téléphone", () => {
  test("le dernier appel : la carte entière, calculée par l'ordinateur ; les plus anciens : une ligne", () => {
    const { messages, roles } = poste();
    const contexte = { etats: new Map(), equipes: plierEquipes(messages), roles, teinteDe: () => "ocre" as const, vps: false };
    const net = (t: string, max: number) => t.slice(0, max);
    expect(vueEquipe("e1", contexte, net, false)).toEqual({ type: "atelier-equipe", etapeId: "e1", ligne: { nom: "Studio", arrivent: [{ id: "nina", nom: "Nina", teinte: "ocre" }] } });
    const carte = vueEquipe("e2", contexte, net, false)?.carte;
    expect(carte).toMatchObject({ nom: "Studio", aCreer: 2, nee: false, remplacee: false, manques: [], existants: [{ id: "dev", raison: "Garde le site." }] });
    expect(carte?.membres.map((m) => [m.cle, m.cree, m.ecarte])).toEqual([
      ["nina", false, false],
      ["leo", false, false],
    ]);
    expect(carte?.exemples).toEqual([{ demande: "La newsletter de mai", membre: "nina", nom: "Nina" }]);
    expect(vueEquipe("e2", { ...contexte, equipes: undefined }, net, false)).toBeNull();
  });
});
