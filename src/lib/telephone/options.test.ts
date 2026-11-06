import { describe, expect, test } from "vitest";
import { ecrireOptions, lireModele, lireOptions, pourCePoste } from "./options";
import { ajouterPieces, MAX_PIECES, nomCapture, taillePiece, texteParDefaut, TAILLE_MAX_PIECE } from "./pieces";
import { exporterDepuisLeCompte } from "./export";

describe("options d'un message (File)", () => {
  test("écrites sans champ vide, relues champ par champ", () => {
    const json = ecrireOptions({ a: "hugo", modele: "sonnet", effort: "low", reessayer: { messageId: "m1", facon: "concis" }, nouveau: { projetId: "p1" } });
    expect(lireOptions(json)).toEqual({ a: "hugo", modele: "sonnet", effort: "low", reessayer: { messageId: "m1", facon: "concis" }, nouveau: { projetId: "p1" } });
    expect(ecrireOptions({})).toBeNull();
    expect(ecrireOptions({ a: undefined })).toBeNull();
  });

  test("l'ordinateur ne croit rien : un champ mal formé est ignoré", () => {
    expect(lireOptions('{"a":"../../etc","reessayer":{"messageId":"m1","facon":"rm -rf"},"modele":"Opus; rm","poste":"x"}')).toEqual({ modele: null });
    expect(lireOptions("pas du json")).toEqual({});
    expect(lireOptions("[1]")).toEqual({});
    expect(lireOptions(null)).toEqual({});
    /* Le modèle remis à celui de la fiche : null, pas absent. */
    expect(lireOptions('{"modele":null,"effort":null}')).toEqual({ modele: null, effort: null });
  });

  test("un message visant un autre ordinateur n'est pas pris ici", () => {
    expect(pourCePoste(lireOptions('{"poste":"poste-mac-0001"}'), "poste-mac-0001")).toBe(true);
    expect(pourCePoste(lireOptions('{"poste":"poste-mac-0001"}'), "poste-pc-00002")).toBe(false);
    expect(pourCePoste({}, "poste-pc-00002")).toBe(true);
  });

  test("le compte Claude choisi sur le téléphone : un id de compte ou null, jamais autre chose", () => {
    const compte = "11111111-1111-4111-8111-111111111111";
    expect(lireOptions(ecrireOptions({ fournisseur: "claude", modele: null, effort: null, compteClaude: compte }))).toEqual({ fournisseur: "claude", modele: null, effort: null, compteClaude: compte });
    /* Revenir au compte des agents : null, pas absent. */
    expect(lireOptions('{"compteClaude":null}')).toEqual({ compteClaude: null });
    for (const brut of ['"poste"', '"../claude-comptes"', "3", '"11111111-1111-1111-1111-111111111111"']) expect(lireOptions(`{"compteClaude":${brut}}`)).toEqual({});
    expect(lireModele(JSON.stringify({ modele: "opus", effort: "high", compteClaude: compte }))).toEqual({ modele: "opus", effort: "high", compteClaude: compte });
    expect(lireModele('{"modele":"opus","effort":"high","compteClaude":"poste"}')).toEqual({ modele: "opus", effort: "high" });
  });

  test("le modèle d'une conversation copiée", () => {
    expect(lireModele('{"modele":"opus","effort":"high"}')).toEqual({ modele: "opus", effort: "high" });
    expect(lireModele(null)).toBeNull();
    expect(lireModele("{")).toBeNull();
  });
  test.each(["claude", "codex", "grok"] as const)("le fournisseur %s et ses identifiants de modèle passent sans altération", (fournisseur) => {
    const choix = { fournisseur, modele: "fournisseur/modele-v2:latest", effort: "ultra" };
    expect(lireOptions(ecrireOptions(choix))).toEqual(choix);
    expect(lireModele(JSON.stringify(choix))).toEqual(choix);
    expect(lireOptions('{"fournisseur":"inconnu"}')).toEqual({});
  });
});

describe("pièces jointes du téléphone", () => {
  const fichier = (name: string, size: number, lastModified = 1) => ({ name, size, type: "image/jpeg", lastModified });

  test("sans doublon, 20 Mo au plus chacune, 10 au plus, avec une phrase pour ce qui reste dehors", () => {
    const une = fichier("photo.jpg", 2_000_000);
    expect(ajouterPieces([une], [une])).toEqual({ pieces: [une], alerte: null });
    const lourde = ajouterPieces([], [fichier("video.mov", TAILLE_MAX_PIECE + 5 * 1024 * 1024)]);
    expect(lourde.pieces).toEqual([]);
    expect(lourde.alerte).toBe("video.mov est trop lourd (25 Mo) : 20 Mo au plus par fichier.");
    const onze = Array.from({ length: 11 }, (_, i) => fichier(`${i}.jpg`, 10, i));
    const trop = ajouterPieces([], onze);
    expect(trop.pieces).toHaveLength(MAX_PIECES);
    expect(trop.alerte).toBe("10 fichiers au plus par message.");
    expect(ajouterPieces([], [fichier("vide.txt", 0)]).alerte).toBe("vide.txt est vide.");
  });

  test("noms, tailles, texte par défaut", () => {
    expect(nomCapture("image/png", new Date(2026, 10, 2, 11, 42, 5))).toBe("capture-2026-11-02-114205.png");
    expect(taillePiece(830 * 1024)).toBe("830 Ko");
    expect(taillePiece(2.4 * 1024 * 1024)).toBe("2,4 Mo");
    expect(texteParDefaut("  ", 2)).toBe("Regarde ces fichiers.");
    expect(texteParDefaut("", 1)).toBe("Regarde ce fichier.");
    expect(texteParDefaut(" Salut ", 1)).toBe("Salut");
  });
});

describe("la citation d'une réponse (E2-40)", () => {
  test("part avec le message, relue champ par champ ; incomplète, ignorée", () => {
    const citation = { messageId: "m1", roleId: "hugo", extrait: "Le début de la réponse" };
    expect(lireOptions(ecrireOptions({ citation }))).toEqual({ citation });
    expect(lireOptions(JSON.stringify({ citation: { messageId: "m1", roleId: "hugo", extrait: "   " } }))).toEqual({});
    expect(lireOptions(JSON.stringify({ citation: { messageId: "../x y", roleId: "hugo", extrait: "a" } }))).toEqual({});
    expect(lireOptions(JSON.stringify({ citation: { messageId: "m1", roleId: "hugo", extrait: "a".repeat(400) } })).citation?.extrait).toHaveLength(280);
  });
});

describe("export Markdown depuis le compte (T-03)", () => {
  test("le même document qu'au bureau, à partir de la copie du compte", () => {
    const document = exporterDepuisLeCompte({
      conversation: undefined,
      origine: "dm-hugo",
      messages: [
        { origine: "m1", auteurKind: "user", auteurId: null, creeLe: "2026-11-01T10:00:00.000Z", texte: "Relance le build", parties: '[{"type":"text","text":"Relance le build"}]', statut: null, reactions: [], compaction: false },
        {
          origine: "m2",
          auteurKind: "role",
          auteurId: "hugo",
          creeLe: "2026-11-01T10:01:00.000Z",
          texte: "C'est relancé.",
          parties: '[{"type":"etapes","n":2},{"type":"text","text":"C\'est relancé."},{"type":"fichiers","fichiers":[{"nom":"log.txt","chemin":null}]}]',
          statut: "fait",
          reactions: [],
          compaction: false,
        },
      ],
      cartes: [{ origine: "hugo", nom: "Hugo", teinte: "vert", roleCourt: "Dev", actif: true }],
      moi: "Corentin",
      maintenant: new Date("2026-11-02T12:00:00.000Z"),
    });
    expect(document?.nomPropose).toBe("Conversation avec Hugo - 2026-11-02.md");
    expect(document?.contenu).toContain("# Conversation avec Hugo");
    expect(document?.contenu).toContain("**Corentin**");
    expect(document?.contenu).toContain("Relance le build");
    expect(document?.contenu).toContain("C'est relancé.");
    expect(document?.contenu).toContain("Pièce jointe : `log.txt`");
    expect(exporterDepuisLeCompte({ conversation: undefined, origine: "dm-hugo", messages: [], cartes: [], moi: "Corentin", maintenant: new Date() })).toBeNull();
  });
});
