import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import { VIE_DEMANDE_MS } from "./demandesPoste";
import { connecter, initialiser, nouvelEssai, patienter } from "./test.utils";

describe("demandes au poste", () => {
  test("le téléphone demande, l'ordinateur prend et répond, la lecture efface tout", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const moi = await connecter(t, "corentin@klyra.design");
    const id = await moi.mutation(api.demandesPoste.demander, { type: "fichiers.lire", args: JSON.stringify({ chemin: "a.md" }) });
    expect(await moi.query(api.demandesPoste.aTraiter, { posteCle: "poste-mac-1" })).toEqual([{ _id: id, type: "fichiers.lire" }]);
    expect(await moi.mutation(api.demandesPoste.prendre, { id, posteCle: "poste-mac-1" })).toEqual({ type: "fichiers.lire", args: '{"chemin":"a.md"}' });
    /* Un second ordinateur ne la reprend pas. */
    expect(await moi.mutation(api.demandesPoste.prendre, { id, posteCle: "poste-pc-22" })).toBeNull();
    expect(await moi.query(api.demandesPoste.aTraiter, { posteCle: "poste-pc-22" })).toEqual([]);
    await moi.mutation(api.demandesPoste.repondre, { id, reponse: JSON.stringify({ texte: "# Bonjour" }) });
    expect(await moi.query(api.demandesPoste.suivre, { id })).toMatchObject({ statut: "faite", reponse: '{"texte":"# Bonjour"}' });
    await moi.mutation(api.demandesPoste.oublier, { id });
    expect(await moi.query(api.demandesPoste.suivre, { id })).toBeNull();
  });

  test("une demande visant un ordinateur n'est pas prise par un autre", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const moi = await connecter(t, "corentin@klyra.design");
    const id = await moi.mutation(api.demandesPoste.demander, { type: "routines.liste", args: "{}", posteCle: "poste-mac-1" });
    expect(await moi.query(api.demandesPoste.aTraiter, { posteCle: "poste-pc-22" })).toEqual([]);
    expect(await moi.mutation(api.demandesPoste.prendre, { id, posteCle: "poste-pc-22" })).toBeNull();
    expect(await moi.mutation(api.demandesPoste.prendre, { id, posteCle: "poste-mac-1" })).not.toBeNull();
  });

  test("l'erreur de l'ordinateur arrive au téléphone", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const moi = await connecter(t, "corentin@klyra.design");
    const id = await moi.mutation(api.demandesPoste.demander, { type: "fichiers.lire", args: "{}" });
    await moi.mutation(api.demandesPoste.prendre, { id, posteCle: "poste-mac-1" });
    await moi.mutation(api.demandesPoste.repondre, { id, erreur: { code: "introuvable", message: "Ce fichier n'existe plus sur ton Mac." } });
    expect(await moi.query(api.demandesPoste.suivre, { id })).toMatchObject({
      statut: "erreur",
      erreur: { code: "introuvable", message: "Ce fichier n'existe plus sur ton Mac." },
    });
  });

  test("une demande expire si personne ne la lit", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const moi = await connecter(t, "corentin@klyra.design");
    const id = await moi.mutation(api.demandesPoste.demander, { type: "routines.liste", args: "{}" });
    await patienter(t, VIE_DEMANDE_MS + 1000);
    expect(await moi.query(api.demandesPoste.suivre, { id })).toBeNull();
  });

  test("un autre membre ne voit ni ne prend la demande", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const moi = await connecter(t, "corentin@klyra.design");
    const id = await moi.mutation(api.demandesPoste.demander, { type: "fichiers.lire", args: "{}" });
    const autre = await connecter(t, "pelin@klyra.design");
    expect(await autre.query(api.demandesPoste.suivre, { id })).toBeNull();
    expect(await autre.query(api.demandesPoste.aTraiter, { posteCle: "poste-mac-1" })).toEqual([]);
    expect(await autre.mutation(api.demandesPoste.prendre, { id, posteCle: "poste-mac-1" })).toBeNull();
  });

  test("type ou arguments invalides : refusés", async () => {
    const t = nouvelEssai();
    await initialiser(t);
    const moi = await connecter(t, "corentin@klyra.design");
    await expect(moi.mutation(api.demandesPoste.demander, { type: "rm -rf", args: "{}" })).rejects.toThrow(/demande_invalide/);
    await expect(moi.mutation(api.demandesPoste.demander, { type: "fichiers.lire", args: "pas du json" })).rejects.toThrow(/demande_invalide/);
  });
});
