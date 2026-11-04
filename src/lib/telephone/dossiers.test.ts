// @vitest-environment node
import { describe, expect, test } from "vitest";
import { ErreurPoste } from "@/lib/poste/types";
import type { FileNode } from "@/types/domain";
import {
  cheminDemande,
  dossierAffiche,
  ELEMENTS_MAX,
  erreurLecture,
  etatTirage,
  filAriane,
  montrerDans,
  niveauDossier,
  ouvrableADistance,
  parentDe,
  SEUIL_TIRAGE,
  statutValide,
  tailleLisible,
  texteCoupure,
  urlDossier,
  urlFichier,
  urlProjet,
  urlRetourFichier,
  vueProjet,
} from "./dossiers";

/** Le code de l'erreur levée, ou null si le chemin passe. */
function refus(valeur: unknown, racine = false): string | null {
  try {
    cheminDemande(valeur, { racine });
    return null;
  } catch (e) {
    if (!(e instanceof ErreurPoste)) throw e;
    return e.code;
  }
}

describe("garde des chemins du téléphone (geste du poste)", () => {
  test.each([
    ["README.md", "README.md"],
    ["00_CONTROL/DASHBOARD.md", "00_CONTROL/DASHBOARD.md"],
    ["./a//b/./c.txt", "a/b/c.txt"],
    ["a\\b\\c.txt", "a/b/c.txt"],
    ["dossier avec espace/Mon fichier.csv", "dossier avec espace/Mon fichier.csv"],
    [".github/workflows/ci.yml", ".github/workflows/ci.yml"],
    ["a/..b/c", "a/..b/c"],
  ])("%s passe", (valeur, attendu) => expect(cheminDemande(valeur, { racine: false })).toBe(attendu));

  test.each([
    "../secret.txt",
    "a/../../secret.txt",
    "a/..",
    "..\\..\\Windows\\win.ini",
    "/etc/passwd",
    "\\\\serveur\\partage\\x",
    "C:\\Users\\moi\\x",
    "c:x",
    "a\u0000b",
    "a\nb",
    "",
    ".",
    "./",
  ])("%j est refusé", (valeur) => expect(refus(valeur)).toBe("chemin"));

  test("la racine n'est permise que pour un dossier", () => {
    expect(cheminDemande("", { racine: true })).toBe("");
    expect(cheminDemande("./", { racine: true })).toBe("");
    expect(refus("", false)).toBe("chemin");
    expect(refus("..", true)).toBe("chemin");
  });

  test("ce qui n'est pas une chaîne, ou trop long, est illisible", () => {
    expect(refus(undefined)).toBe("arguments");
    expect(refus(42)).toBe("arguments");
    expect(refus(["a"])).toBe("arguments");
    expect(refus("a/".repeat(600))).toBe("arguments");
    expect(refus(`${"x".repeat(256)}/a`)).toBe("chemin");
  });

  test("le refus est dit en clair", () => {
    expect(() => cheminDemande("../x", { racine: false })).toThrow("Ce chemin n’est pas dans le projet.");
  });
});

describe("« Ouvrir sur ton Mac » depuis le téléphone", () => {
  test.each(["docs/devis.pdf", "README.md", "maquette.PNG", "budget.xlsx", "film.mov", "Présentation.key"])("%s s'ouvre", (chemin) =>
    expect(ouvrableADistance(chemin)).toBe(true),
  );
  test.each(["outils/lancer.command", "Mon App.app", "install.sh", "setup.exe", "script.ps1", "a.bat", "x.js", "tache.py", "raccourci.webloc", "Makefile", "bin/outil", "archive.dmg", ".env"])(
    "%s ne s'ouvre pas à distance",
    (chemin) => expect(ouvrableADistance(chemin)).toBe(false),
  );
});

describe("erreurs de lecture dites au téléphone", () => {
  test.each([
    ["ENOENT: no such file or directory, scandir '/Users/moi/site/a'", "dossier", "introuvable", "Ce dossier n’existe plus sur ton Mac."],
    ["EACCES: permission denied, open '/Users/moi/site/a.txt'", "fichier", "acces", "KLYRA n’a pas le droit de lire ce fichier sur ton Mac."],
    ["ENOTDIR: not a directory, scandir '/Users/moi/site/a.txt'", "dossier", "introuvable", "Ce chemin mène à un fichier, pas à un dossier."],
    ["EIO: i/o error, read", "fichier", "lecture", "Ce fichier n’a pas pu être lu sur ton Mac."],
    ["Le VPS ne répond pas.", "dossier", "lecture", "Le VPS ne répond pas."],
    ["Ce fichier n’existe pas (ou plus) dans le projet.", "fichier", "lecture", "Ce fichier n’existe pas (ou plus) dans le projet."],
  ] as const)("%s", (message, quoi, code, texte) => {
    const e = erreurLecture(message, quoi, "ton Mac");
    expect(e.code).toBe(code);
    expect(e.message).toBe(texte);
    expect(e.message).not.toContain("/Users/");
  });
});

describe("un niveau du dossier", () => {
  const noeud = (path: string, kind: FileNode["kind"]): FileNode => ({ name: path.split("/").pop()!, path, kind });

  test("les marques suivent les fichiers modifiés, comme l'arbre du bureau", () => {
    const modifies = new Set(["src/app/page.tsx", "README.md"]);
    const niveau = niveauDossier([noeud("src", "dossier"), noeud("public", "dossier"), noeud("README.md", "fichier"), noeud("package.json", "fichier")], modifies);
    expect(niveau.total).toBe(4);
    expect(niveau.elements).toEqual([
      { nom: "src", chemin: "src", type: "dossier", modifie: false, contientModifies: true },
      { nom: "public", chemin: "public", type: "dossier", modifie: false, contientModifies: false },
      { nom: "README.md", chemin: "README.md", type: "fichier", modifie: true, contientModifies: false },
      { nom: "package.json", chemin: "package.json", type: "fichier", modifie: false, contientModifies: false },
    ]);
    const sous = niveauDossier([noeud("src/app", "dossier"), noeud("src/lib", "dossier")], modifies);
    expect(sous.elements.map((e) => e.contientModifies)).toEqual([true, false]);
  });

  test("au-delà de 1000 éléments, le reste est compté et la coupure dite", () => {
    const noeuds = Array.from({ length: 1234 }, (_, i) => noeud(`f${i}.txt`, "fichier"));
    const niveau = niveauDossier(noeuds, new Set());
    expect(niveau.elements).toHaveLength(ELEMENTS_MAX);
    expect(niveau.total).toBe(1234);
    expect(texteCoupure(niveau)).toBe("Liste coupée : 234 autres éléments non affichés. Ouvre le dossier sur l’ordinateur pour tout voir.");
    expect(texteCoupure(niveauDossier(noeuds.slice(0, 1000), new Set()))).toBeNull();
  });
});

describe("la descente", () => {
  test("parent d'un chemin", () => {
    expect(parentDe("")).toBeNull();
    expect(parentDe("README.md")).toBe("");
    expect(parentDe("a/b/c.md")).toBe("a/b");
  });

  test("le chemin en haut : chaque segment ramène à son niveau", () => {
    expect(filAriane("DIGITAL-OS", "")).toEqual([{ nom: "DIGITAL-OS", chemin: "" }]);
    expect(filAriane("DIGITAL-OS", "30_CLIENTS/CL-0001")).toEqual([
      { nom: "DIGITAL-OS", chemin: "" },
      { nom: "30_CLIENTS", chemin: "30_CLIENTS" },
      { nom: "CL-0001", chemin: "30_CLIENTS/CL-0001" },
    ]);
  });

  test("adresses des écrans", () => {
    expect(urlProjet("site")).toBe("/projet?id=site");
    expect(urlProjet("site", "fichiers")).toBe("/projet?id=site&onglet=fichiers");
    expect(urlDossier("site", "")).toBe("/projet?id=site&onglet=fichiers");
    expect(urlDossier("site", "a b/c")).toBe("/projet?id=site&dossier=a+b%2Fc");
    expect(urlFichier("site", "a/b.md", { ancre: "titre", retour: ["x.md", "y/z.md"] })).toBe(
      "/projet?id=site&fichier=a%2Fb.md&ancre=titre&retour=x.md&retour=y%2Fz.md",
    );
  });

  test("« ‹ » de la visionneuse : la pile des liens, puis le dossier", () => {
    expect(urlRetourFichier("site", "c.md", ["a.md", "docs/b.md"])).toBe(urlFichier("site", "docs/b.md", { retour: ["a.md"] }));
    expect(urlRetourFichier("site", "docs/b.md", [])).toBe(urlDossier("site", "docs"));
    expect(urlRetourFichier("site", "README.md", [])).toBe(urlProjet("site", "fichiers"));
  });

  test("l'adresse relue donne l'écran, sans chemin douteux", () => {
    const lire = (url: string) => vueProjet(new URL(url, "https://app.klyra.fr").searchParams);
    expect(lire(urlFichier("site", "a/b.md", { ancre: "t", retour: ["x.md"] }))).toEqual({ vue: "fichier", chemin: "a/b.md", ancre: "t", retour: ["x.md"] });
    expect(lire(urlDossier("site", "a/b"))).toEqual({ vue: "dossier", chemin: "a/b" });
    expect(lire(urlProjet("site", "fichiers"))).toEqual({ vue: "onglet", onglet: "fichiers" });
    expect(lire("/projet?id=site")).toEqual({ vue: "onglet", onglet: "chats" });
    expect(lire("/projet?id=site&dossier=../x")).toEqual({ vue: "onglet", onglet: "chats" });
    expect(lire("/projet?id=site&fichier=a.md&retour=/etc/passwd&retour=b.md")).toEqual({ vue: "fichier", chemin: "a.md", ancre: null, retour: ["b.md"] });
  });
});

describe("affichage", () => {
  test("tailles", () => {
    expect(tailleLisible(512)).toBe("512 o");
    expect(tailleLisible(21_500)).toBe("21 Ko");
    expect(tailleLisible(15 * 1024 * 1024)).toBe("15,0 Mo");
  });

  test("dossier sous le titre", () => {
    expect(dossierAffiche("DIGITAL-OS", "00_CONTROL/DASHBOARD.md")).toBe("00_CONTROL");
    expect(dossierAffiche("DIGITAL-OS", "README.md")).toBe("DIGITAL-OS");
  });

  test("le système du poste, pas celui du téléphone", () => {
    expect(montrerDans("mac")).toBe("Montrer dans le Finder");
    expect(montrerDans("windows")).toBe("Montrer dans l’Explorateur");
    expect(montrerDans(null)).toBe("Montrer dans le gestionnaire de fichiers");
  });

  test("statuts", () => {
    expect(statutValide("en-revue")).toBe(true);
    expect(statutValide("archive")).toBe(false);
  });

  test("tirer vers le bas : résistance, plafond, seuil", () => {
    expect(etatTirage(-20)).toEqual({ hauteur: 0, pret: false });
    expect(etatTirage(40)).toEqual({ hauteur: 40, pret: false });
    expect(etatTirage(SEUIL_TIRAGE)).toEqual({ hauteur: SEUIL_TIRAGE, pret: true });
    expect(etatTirage(100).hauteur).toBe(82);
    expect(etatTirage(1000).hauteur).toBe(96);
  });
});
