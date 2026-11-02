import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { extraitAutour, PIECE_TAILLE_MAX, PIECES_VIE_MS } from "./conversationsCompte";
import { connecter, initialiser, nouvelEssai, patienter, type Essai } from "./test.utils";

const base = {
  projetId: null,
  projetNom: null,
  misAJour: "2026-11-01T00:00:00.000Z",
  epingleLe: null,
  extrait: "",
  extraitLe: null,
  nonLus: 0,
  taches: "[]",
};
const direct = { ...base, origine: "dm-hugo", kind: "direct" as const, titre: "Hugo", roleIds: ["hugo"] };
const equipe = { ...base, origine: "c0ffee00-0000-4000-8000-000000000001", kind: "equipe" as const, titre: "Refonte devis", projetId: "p1", projetNom: "KLYRA", roleIds: ["principal"] };

async function compte() {
  const t = nouvelEssai();
  await initialiser(t);
  const moi = await connecter(t, "corentin@klyra.design");
  await moi.mutation(api.conversationsCompte.importerAgents, { lot: [{ origine: "hugo", nom: "Hugo", teinte: "bleu-k1", roleCourt: "Dev", actif: true }] });
  await moi.mutation(api.conversationsCompte.importerProjets, { lot: [{ origine: "p1", nom: "KLYRA", accroche: "Le site", statut: "en-cours", epingle: false }] });
  await moi.mutation(api.conversationsCompte.importerConversations, { lot: [direct, equipe] });
  return { t, moi };
}

async function deposer(t: Essai, octets: number): Promise<Id<"_storage">> {
  return await t.run((ctx) => ctx.storage.store(new Blob([new Uint8Array(octets)], { type: "image/png" })));
}

const existe = (t: Essai, fichier: Id<"_storage">) => t.run(async (ctx) => (await ctx.db.system.get("_storage", fichier)) !== null);

describe("pièces jointes du téléphone", () => {
  test("elles partent avec le message, l'ordinateur les reçoit, puis elles sont effacées du compte", async () => {
    const { t, moi } = await compte();
    const fichier = await deposer(t, 2048);
    const id = await moi.mutation(api.conversationsCompte.laisser, {
      conversationOrigine: "dm-hugo",
      texte: "Regarde ce fichier.",
      options: JSON.stringify({ modele: "sonnet", effort: "low" }),
      pieces: [{ fichier, nom: "../../capture.png", type: "image/png" }],
    });
    const [attente] = await moi.query(api.conversationsCompte.enAttente, {});
    expect(attente).toMatchObject({ texte: "Regarde ce fichier.", options: '{"modele":"sonnet","effort":"low"}', pieces: [{ nom: "capture.png", taille: 2048 }] });

    const recu = await moi.mutation(api.conversationsCompte.prendre, { id });
    expect(recu).toMatchObject({ conversationOrigine: "dm-hugo", options: '{"modele":"sonnet","effort":"low"}' });
    expect(recu?.pieces).toHaveLength(1);
    expect(recu?.pieces?.[0]).toMatchObject({ nom: "capture.png", type: "image/png", taille: 2048 });
    expect(recu?.pieces?.[0].url).toMatch(/^https?:\/\//);
    expect(await existe(t, fichier)).toBe(true);

    await moi.mutation(api.conversationsCompte.terminer, { id });
    expect(await existe(t, fichier)).toBe(false);
    expect(await moi.query(api.conversationsCompte.enAttente, {})).toEqual([]);
  });

  test("prises mais jamais terminées (ordinateur fermé entre-temps), elles sont effacées après le délai", async () => {
    const { t, moi } = await compte();
    const fichier = await deposer(t, 10);
    const id = await moi.mutation(api.conversationsCompte.laisser, { conversationOrigine: "dm-hugo", texte: "Photo", pieces: [{ fichier, nom: "photo.jpg", type: "image/jpeg" }] });
    await moi.mutation(api.conversationsCompte.prendre, { id });
    await patienter(t, PIECES_VIE_MS + 1000);
    expect(await existe(t, fichier)).toBe(false);
  });

  test("« Annuler l'envoi » efface aussi les pièces", async () => {
    const { t, moi } = await compte();
    const fichier = await deposer(t, 10);
    const id = await moi.mutation(api.conversationsCompte.laisser, { conversationOrigine: "dm-hugo", texte: "Photo", pieces: [{ fichier, nom: "photo.jpg", type: "image/jpeg" }] });
    await moi.mutation(api.conversationsCompte.annuler, { id });
    expect(await existe(t, fichier)).toBe(false);
    expect(await moi.query(api.conversationsCompte.enAttente, {})).toEqual([]);
  });

  test("plus de 10 pièces, ou une pièce trop lourde : refusé", async () => {
    const { t, moi } = await compte();
    const petites = await Promise.all(Array.from({ length: 11 }, () => deposer(t, 1)));
    await expect(
      moi.mutation(api.conversationsCompte.laisser, {
        conversationOrigine: "dm-hugo",
        texte: "Trop",
        pieces: petites.map((fichier, i) => ({ fichier, nom: `${i}.png`, type: "image/png" })),
      }),
    ).rejects.toThrow(/conversation_invalide/);
    const lourde = await deposer(t, PIECE_TAILLE_MAX + 1);
    await expect(
      moi.mutation(api.conversationsCompte.laisser, { conversationOrigine: "dm-hugo", texte: "Lourd", pieces: [{ fichier: lourde, nom: "video.mov", type: "video/quicktime" }] }),
    ).rejects.toThrow(/fichier_trop_lourd/);
  });

  test("des options illisibles sont refusées", async () => {
    const { moi } = await compte();
    await expect(moi.mutation(api.conversationsCompte.laisser, { conversationOrigine: "dm-hugo", texte: "Salut", options: "[1,2]" })).rejects.toThrow(/conversation_invalide/);
  });
});

describe("nouvelle conversation d'équipe depuis le téléphone", () => {
  test("le premier message la crée dans le compte, et l'alignement la garde jusqu'à sa reprise", async () => {
    const { moi } = await compte();
    const origine = "0a1b2c3d-0000-4000-8000-00000000abcd";
    const id = await moi.mutation(api.conversationsCompte.laisser, {
      conversationOrigine: origine,
      texte: "Prépare le devis du client Acclaro pour la refonte complète du site",
      options: JSON.stringify({ nouveau: { projetId: "p1" }, a: "hugo" }),
    });
    const creee = (await moi.query(api.conversationsCompte.liste, {})).find((c) => c.origine === origine);
    expect(creee).toMatchObject({ kind: "equipe", projetId: "p1", projetNom: "KLYRA", roleIds: ["principal", "hugo"], titre: "Prépare le devis du client Acclaro pour…" });
    await moi.mutation(api.conversationsCompte.alignerConversations, { origines: [direct.origine, equipe.origine] });
    expect((await moi.query(api.conversationsCompte.liste, {})).some((c) => c.origine === origine)).toBe(true);
    await moi.mutation(api.conversationsCompte.prendre, { id });
    await moi.mutation(api.conversationsCompte.alignerConversations, { origines: [direct.origine, equipe.origine] });
    expect((await moi.query(api.conversationsCompte.liste, {})).some((c) => c.origine === origine)).toBe(false);
  });

  test("un projet inconnu est refusé", async () => {
    const { moi } = await compte();
    await expect(
      moi.mutation(api.conversationsCompte.laisser, {
        conversationOrigine: "0a1b2c3d-0000-4000-8000-00000000abce",
        texte: "Bonjour",
        options: JSON.stringify({ nouveau: { projetId: "inconnu" } }),
      }),
    ).rejects.toThrow(/introuvable/);
  });
});

describe("copie des champs du téléphone", () => {
  test("activité, modèle, fil et archive passent ; une version d'avant ne les efface pas", async () => {
    const { moi } = await compte();
    const activite = JSON.stringify({ etat: "accord", roleId: "hugo", messageId: "m1", depuis: "2026-11-01T10:00:00.000Z", accord: { id: "a1", libelle: "Lance pnpm build", detail: "pnpm build", description: "" } });
    await moi.mutation(api.conversationsCompte.importerConversations, { lot: [{ ...direct, activite, modele: '{"modele":"opus","effort":"high"}' }] });
    expect((await moi.query(api.conversationsCompte.liste, {})).find((c) => c.origine === "dm-hugo")).toMatchObject({ activite, modele: '{"modele":"opus","effort":"high"}', parent: null });
    await moi.mutation(api.conversationsCompte.importerConversations, { lot: [direct] });
    expect((await moi.query(api.conversationsCompte.liste, {})).find((c) => c.origine === "dm-hugo")?.activite).toBe(activite);
    await expect(moi.mutation(api.conversationsCompte.importerConversations, { lot: [{ ...direct, activite: "pas du json" }] })).rejects.toThrow(/conversation_invalide/);
  });
});

describe("recherche dans les conversations du compte", () => {
  const message = (origine: string, conversationOrigine: string, texte: string, creeLe: string, statut: "fait" | "en-cours" | null = null) => ({
    conversationOrigine,
    origine,
    auteurKind: "role" as const,
    auteurId: "hugo",
    creeLe,
    texte,
    parties: JSON.stringify([{ type: "text", text: texte }]),
    statut,
  });

  async function avecMessages() {
    const { t, moi } = await compte();
    await moi.mutation(api.conversationsCompte.importerMessages, {
      lot: [
        message("m1", "dm-hugo", "La facture du client est envoyée", "2026-11-01T09:00:00.000Z"),
        message("m2", equipe.origine, "Il manque la facture de septembre", "2026-11-01T10:00:00.000Z"),
        message("m3", equipe.origine, "Rien à voir avec ça", "2026-11-01T11:00:00.000Z"),
        message("m4", "dm-hugo", "Je prépare la facture", "2026-11-01T12:00:00.000Z", "en-cours"),
      ],
    });
    return { t, moi };
  }

  test("les messages trouvés, les plus récents d'abord, sans la réponse en cours d'écriture", async () => {
    const { moi } = await avecMessages();
    const trouves = await moi.query(api.conversationsCompte.chercher, { requete: "facture", portee: "tout" });
    expect(trouves.map((m) => m.origine)).toEqual(["m2", "m1"]);
    expect(trouves[0].extrait).toContain("facture de septembre");
  });

  test("les portées : agents, projets, cette conversation", async () => {
    const { moi } = await avecMessages();
    expect((await moi.query(api.conversationsCompte.chercher, { requete: "facture", portee: "agents" })).map((m) => m.origine)).toEqual(["m1"]);
    expect((await moi.query(api.conversationsCompte.chercher, { requete: "facture", portee: "projets" })).map((m) => m.origine)).toEqual(["m2"]);
    expect(
      (await moi.query(api.conversationsCompte.chercher, { requete: "facture", portee: "conversation", conversationOrigine: "dm-hugo" })).map((m) => m.origine),
    ).toEqual(["m1"]);
  });

  test("une lettre ne cherche rien ; un autre membre ne trouve rien", async () => {
    const { t, moi } = await avecMessages();
    expect(await moi.query(api.conversationsCompte.chercher, { requete: "f", portee: "tout" })).toEqual([]);
    const autre = await connecter(t, "pelin@klyra.design");
    expect(await autre.query(api.conversationsCompte.chercher, { requete: "facture", portee: "tout" })).toEqual([]);
  });

  test("l'extrait se centre sur le mot trouvé", () => {
    const long = `${"Avant ".repeat(30)}la Facture arrive ${"après ".repeat(60)}`;
    const extrait = extraitAutour(long, "facture");
    expect(extrait.startsWith("…")).toBe(true);
    expect(extrait.endsWith("…")).toBe(true);
    expect(extrait).toContain("la Facture arrive");
    expect(extraitAutour("Court", "rien")).toBe("Court");
  });
});
