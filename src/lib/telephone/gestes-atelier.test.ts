import { describe, expect, test, vi } from "vitest";
import type { EssayerAtelier, MarquerAtelier } from "@/lib/epreuve-atelier";
import type { Message, MessagePart, Role } from "@/types/domain";
import type { CasEpreuve, ResultatCas } from "../../../electron/epreuve";
import { gestesAtelier, type DepsAtelier } from "./gestes-atelier";

type PartAtelier = Extract<MessagePart, { type: "atelier-agent" }>;

const role = (id: string, name: string, tag = ""): Role => ({ id, name, tag, teinte: "vert" }) as Role;

const EPREUVE = { normal: "Fais la veille de la semaine.", floue: "Regarde un peu ce qui se passe.", horsMetier: "Réserve-moi un train." };

function conversation(): Message[] {
  const m = (id: string, parts: MessagePart[], kind: "role" | "user" = "role"): Message => ({
    id,
    chatId: "dm-principal",
    author: kind === "role" ? { kind: "role", roleId: "principal" } : { kind: "user" },
    createdAt: "2026-11-03T10:00:00.000Z",
    parts,
  });
  return [
    m("m1", [{ type: "atelier-agent", etapeId: "e1", maj: { nom: "Zoé", role: "Veille", mission: "Surveille les concurrents chaque semaine.", epreuve: EPREUVE } }]),
    m("m2", [{ type: "text", text: "Elle ne publie jamais rien." }], "user"),
    m("m3", [{ type: "atelier-agent", etapeId: "e2", maj: { limites: ["Ne publie rien sans accord."] } }]),
  ];
}

function poste(options: { messages?: Message[]; roles?: Role[]; essayer?: EssayerAtelier | null } = {}) {
  const messages = options.messages ?? conversation();
  const marquer: MarquerAtelier = (messageId, etapeId, patch) => {
    const message = messages.find((x) => x.id === messageId);
    if (!message) return;
    message.parts = message.parts.map((p) => (p.type === "atelier-agent" && p.etapeId === etapeId ? { ...p, ...(typeof patch === "function" ? patch(p) : patch) } : p));
  };
  const create = vi.fn(async () => undefined);
  const deps: DepsAtelier = {
    messages: (c) => (c === "dm-principal" ? messages : null),
    lieu: () => null,
    roles: options.roles ?? [role("principal", "Léa"), role("dev", "Hugo", "Dev")],
    identifiantLibre: (propose) => propose,
    create,
    marquer: vi.fn(marquer),
    essayer: options.essayer === undefined ? null : options.essayer,
    teinteDe: () => "ocre",
  };
  const part = (etapeId: string) => messages.flatMap((x) => x.parts).find((p): p is PartAtelier => p.type === "atelier-agent" && p.etapeId === etapeId)!;
  return { gestes: gestesAtelier(deps), deps, messages, part, create };
}

const ARGS = { conversation: "dm-principal", etapeId: "e2" };

/** Un essai qu'on termine à la main : on voit la carte pendant qu'il tourne. */
function essaisEnAttente() {
  const fins: (() => void)[] = [];
  const essayer = vi.fn(
    (_id: string, brouillon: { fiche: string }, cas: CasEpreuve) =>
      new Promise<{ ok: true; data: ResultatCas }>((resolve) =>
        fins.push(() =>
          resolve({
            ok: true,
            data: { ...cas, reponse: `Réponse à ${cas.type}`, verdict: cas.type === "hors-metier" ? "ko" : "ok", raison: "", correction: null, jetons: 120, empreinte: brouillon.fiche.length.toString() },
          }),
        ),
      ),
  ) as unknown as EssayerAtelier;
  return { essayer, finir: () => fins.splice(0).forEach((f) => f()) };
}

describe("gestes de l'atelier, faits par l'ordinateur pour le téléphone", () => {
  test("la carte est relue sur l'ordinateur : une carte remplacée, absente ou d'une conversation partie est refusée", async () => {
    const { gestes } = poste();
    await expect(gestes["atelier.creer"]({ conversation: "dm-principal", etapeId: "e1" })).rejects.toMatchObject({ code: "remplacee" });
    await expect(gestes["atelier.creer"]({ conversation: "dm-principal", etapeId: "e9" })).rejects.toMatchObject({ code: "carte_absente" });
    await expect(gestes["atelier.creer"]({ conversation: "dm-autre", etapeId: "e2" })).rejects.toMatchObject({ code: "conversation_absente" });
    await expect(gestes["atelier.creer"]({ conversation: 42 })).rejects.toMatchObject({ code: "arguments" });
  });

  test("couleur : une teinte connue seulement, posée sur le dernier appel", async () => {
    const { gestes, part } = poste();
    await expect(gestes["atelier.teinte"]({ ...ARGS, teinte: "fuchsia" })).rejects.toMatchObject({ code: "arguments" });
    await gestes["atelier.teinte"]({ ...ARGS, teinte: "violet" });
    expect(part("e2").teinte).toBe("violet");
  });

  test("créer : la fiche pliée de la conversation, sa couleur, puis la carte marquée ; une fois seulement", async () => {
    const { gestes, create, part } = poste();
    await gestes["atelier.teinte"]({ ...ARGS, teinte: "violet" });
    await expect(gestes["atelier.creer"](ARGS)).resolves.toEqual({ id: "zoe" });
    expect(create).toHaveBeenCalledTimes(1);
    const [id, fiche, reglage] = create.mock.calls[0] as unknown as [string, string, { tag: string; teinte: string }];
    expect(id).toBe("zoe");
    expect(fiche).toContain("displayName: Zoé");
    expect(fiche).toContain("Ne publie rien sans accord.");
    expect(fiche).not.toContain("memory");
    expect(reglage).toEqual({ tag: "Veille", teinte: "violet" });
    expect(part("e2").cree).toBe("zoe");
    await expect(gestes["atelier.creer"](ARGS)).rejects.toMatchObject({ code: "deja_cree" });
    await expect(gestes["atelier.teinte"]({ ...ARGS, teinte: "rose" })).rejects.toMatchObject({ code: "deja_cree" });
  });

  test("créer : refusé s'il manque un pilier, si le prénom est pris, pendant que l'assistant écrit", async () => {
    const sansNom = conversation();
    sansNom[0].parts = [{ type: "atelier-agent", etapeId: "e1", maj: { role: "Veille", mission: "Surveille." } }];
    await expect(poste({ messages: sansNom }).gestes["atelier.creer"](ARGS)).rejects.toMatchObject({ code: "incomplet", message: "Il lui manque un prénom." });

    const pris = poste({ roles: [role("principal", "Léa"), role("zoe-2", "Zoé")] });
    await expect(pris.gestes["atelier.creer"](ARGS)).rejects.toMatchObject({ code: "nom_pris" });
    expect(pris.create).not.toHaveBeenCalled();

    const ecrit = poste();
    ecrit.part("e2").provisoire = true;
    await expect(ecrit.gestes["atelier.creer"](ARGS)).rejects.toMatchObject({ code: "provisoire" });
  });

  test("épreuve : lancée sans attendre, les essais notés sur la carte pendant qu'ils tournent, puis les résultats", async () => {
    const { essayer, finir } = essaisEnAttente();
    const { gestes, part } = poste({ essayer });
    await expect(gestes["atelier.essayer"](ARGS)).resolves.toEqual({ ok: true });
    expect(part("e2").essais).toEqual(["normal", "floue", "hors-metier"]);
    expect(essayer).toHaveBeenCalledTimes(3);
    await expect(gestes["atelier.essayer"](ARGS)).rejects.toMatchObject({ code: "en_cours" });
    finir();
    await vi.waitFor(() => expect(part("e2").essais).toEqual([]));
    expect(part("e2").resultats?.map((r) => [r.type, r.verdict])).toEqual([
      ["normal", "ok"],
      ["floue", "ok"],
      ["hors-metier", "ko"],
    ]);
  });

  test("épreuve : sans Claude Code ou sans demandes proposées, rien ne part", async () => {
    await expect(poste().gestes["atelier.essayer"](ARGS)).rejects.toMatchObject({ code: "indisponible" });
    const sans = conversation();
    sans[0].parts = [{ type: "atelier-agent", etapeId: "e1", maj: { nom: "Zoé", role: "Veille", mission: "Surveille." } }];
    const { essayer } = essaisEnAttente();
    await expect(poste({ messages: sans, essayer }).gestes["atelier.essayer"](ARGS)).rejects.toMatchObject({ code: "sans_epreuve" });
    expect(essayer).not.toHaveBeenCalled();
  });

  test("correction : la phrase rejoint la fiche (une fois) et seul cet essai est rejoué, avec elle", async () => {
    const { essayer, finir } = essaisEnAttente();
    const { gestes, part } = poste({ essayer });
    const correction = { pilier: "limites" as const, texte: "Hors de la veille, il renvoie vers l’assistant." };
    part("e2").resultats = [{ type: "hors-metier", demande: EPREUVE.horsMetier, reponse: "Je réserve.", verdict: "ko", raison: "Hors métier.", correction, jetons: 90, empreinte: "x" }];
    await expect(gestes["atelier.corriger"]({ ...ARGS, type: "normal" })).rejects.toMatchObject({ code: "sans_correction" });
    await gestes["atelier.corriger"]({ ...ARGS, type: "hors-metier" });
    expect(part("e2").ajouts).toEqual([correction]);
    expect(essayer).toHaveBeenCalledTimes(1);
    const [, brouillon, cas, contexte] = (essayer as unknown as { mock: { calls: [string, { fiche: string }, CasEpreuve, { ajouts: unknown[] }][] } }).mock.calls[0];
    expect(cas.type).toBe("hors-metier");
    expect(brouillon.fiche).toContain(correction.texte);
    expect(contexte.ajouts).toEqual([correction]);
    await expect(gestes["atelier.corriger"]({ ...ARGS, type: "hors-metier" })).rejects.toMatchObject({ code: "deja_ajoutee" });
    finir();
    await vi.waitFor(() => expect(part("e2").essais).toEqual([]));
  });
});
