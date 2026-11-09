import { describe, expect, it } from "vitest";
import { ajouterReflexion, cheminAffiche, fermerReflexion, fichiersModifies, majEtape, marquerModifs, modificationsDepuis, noteAnnulations, retourAvant, sessionsApresRetour, sortieGardee, duree } from "./session-agent";
import { arobaseEnCours, fichiersProposes, mentionFichier } from "./arobase";
import { regleEnMots } from "./regles-autorisation";
import type { Chat, Etape, Message, MessagePart } from "@/types/domain";

const modif = (ajouts: number, retraits: number, extra: Partial<NonNullable<Etape["modif"]>> = {}) => ({ lignes: ["@@ -1 +1 @@", "-a", "+b"], ajouts, retraits, tronque: false, cree: false, annulable: true, ...extra });
const etape = (id: string, chemin: string, m = modif(1, 1), statut: Etape["statut"] = "fait"): Etape => ({ id, outil: "Edit", libelle: `Modifie ${chemin}`, statut, parent: null, chemin, modif: m });
const chat = (extra: Partial<Chat> = {}): Chat => ({ id: "c", kind: "equipe", projectId: "p", title: "t", roleIds: ["principal"], updatedAt: "", sessions: { principal: "s1", iris: "s2" }, luJusqua: null, ...extra });
const message = (id: string, author: Message["author"], parts: MessagePart[] = [], extra: Partial<Message> = {}): Message => ({ id, chatId: "c", author, createdAt: `2026-11-09T10:00:0${id.slice(-1)}Z`, parts, ...extra });

describe("réflexion", () => {
  it("se poursuit, s'ouvre en nouveau bloc, et se ferme quand la réponse continue", () => {
    let parts: MessagePart[] = [];
    parts = ajouterReflexion(parts, "", true, 1000);
    parts = ajouterReflexion(parts, "Je pèse", false, 1100);
    parts = ajouterReflexion(parts, " la question", false, 1200);
    expect(parts).toEqual([{ type: "reflexion", texte: "Je pèse la question", debut: 1000 }]);
    parts = fermerReflexion(parts, 4000);
    expect(parts[0]).toMatchObject({ fin: 4000 });
    parts = ajouterReflexion(parts, "Encore", false, 5000);
    expect(parts).toHaveLength(2);
    expect(parts[1]).toEqual({ type: "reflexion", texte: "Encore", debut: 5000 });
    expect(duree(3000)).toBe("3 s");
    expect(duree(64_000)).toBe("1 min 04");
  });
});

describe("étapes et modifications", () => {
  it("change une étape par son id, garde la fin de la sortie", () => {
    const parts: MessagePart[] = [{ type: "etapes", etapes: [etape("a", "/p/x.ts")] }];
    expect(majEtape(parts, "a", (e) => ({ ...e, sortie: "ok" }))[0]).toMatchObject({ etapes: [{ id: "a", sortie: "ok" }] });
    expect(sortieGardee("x".repeat(5000))).toHaveLength(4096 + 2);
  });

  it("regroupe les modifications d'une réponse par fichier, avec ce que la personne en a fait", () => {
    const m = message("r1", { kind: "role", roleId: "principal" }, [
      { type: "etapes", etapes: [etape("a", "/p/x.ts", modif(2, 1)), etape("b", "/p/x.ts", modif(1, 0)), etape("c", "/p/y.ts", modif(5, 0, { cree: true })), etape("d", "/p/z.ts", modif(1, 1), "erreur")] },
    ]);
    const fichiers = fichiersModifies(m);
    expect(fichiers.map((f) => [f.chemin, f.ids, f.ajouts, f.retraits, f.cree, f.etat])).toEqual([
      ["/p/x.ts", ["a", "b"], 3, 1, false, "a-revoir"],
      ["/p/y.ts", ["c"], 5, 0, true, "a-revoir"],
    ]);
    const marque = { ...m, parts: marquerModifs(m.parts, new Set(["a", "b"]), "annulee", "le") };
    expect(fichiersModifies(marque)[0].etat).toBe("annulee");
    const garde = { ...m, parts: marquerModifs(m.parts, new Set(["c"]), "gardee", "le") };
    expect(fichiersModifies(garde)[1].etat).toBe("gardee");
    // Une modification annulée ne redevient pas « gardée ».
    expect(fichiersModifies({ ...marque, parts: marquerModifs(marque.parts, new Set(["a", "b"]), "gardee", "le") })[0].etat).toBe("annulee");
    expect(cheminAffiche("/p/src/x.ts", "/p")).toBe("src/x.ts");
    expect(cheminAffiche("/home/moi/autre.ts", "/p")).toBe("~/autre.ts");
  });
});

describe("revenir à avant un message", () => {
  const messages = [
    message("m1", { kind: "user" }, [{ type: "text", text: "Fais A" }]),
    message("m2", { kind: "role", roleId: "principal" }, [{ type: "etapes", etapes: [etape("a", "/p/a.ts")] }], { uuidFin: "u-avant", statut: "fait" }),
    message("m3", { kind: "user" }, [{ type: "text", text: "Fais B" }]),
    message("m4", { kind: "role", roleId: "principal" }, [{ type: "etapes", etapes: [etape("b", "/p/b.ts"), etape("c", "/p/a.ts", modif(1, 1, { etat: "annulee" }))] }], { uuidFin: "u-apres", statut: "fait" }),
    message("m5", { kind: "role", roleId: "iris" }, [{ type: "etapes", etapes: [etape("d", "/p/d.ts")] }], { uuidFin: "u-iris", statut: "fait" }),
  ];

  it("les modifications faites depuis ce message, sans celles déjà annulées", () => {
    expect(modificationsDepuis(messages, "m3")).toEqual({ ids: ["b", "d"], chemins: ["/p/b.ts", "/p/d.ts"] });
    expect(modificationsDepuis(messages, "inconnu")).toEqual({ ids: [], chemins: [] });
  });

  it("retire ce message et la suite, rend son texte, et dit d'où chaque agent reprend", () => {
    const r = retourAvant(chat(), messages, "m3");
    expect(r).toEqual({ retires: ["m3", "m4", "m5"], texte: "Fais B", reprises: { principal: "u-avant", iris: null } });
    expect(retourAvant(chat(), messages, "m2")).toBeNull();
    const suite = sessionsApresRetour(chat({ reprises: { iris: "vieux" } }), r!.reprises);
    expect(suite).toEqual({ sessions: { principal: "s1" }, reprises: { principal: "u-avant" } });
  });

  it("dit à l'agent les fichiers remis comme avant depuis sa dernière réponse", () => {
    const c = chat({ annulations: [{ le: "2026-11-09T09:00:00Z", fichiers: ["/p/vieux.ts"] }, { le: "2026-11-09T11:00:00Z", fichiers: ["/p/a.ts", "/p/b.ts"] }] });
    expect(noteAnnulations(c, "2026-11-09T10:00:00Z")).toMatch(/\/p\/a\.ts, \/p\/b\.ts sont revenus comme avant/);
    expect(noteAnnulations(c, "2026-11-09T12:00:00Z")).toBeNull();
    expect(noteAnnulations(chat(), null)).toBeNull();
  });
});

describe("« @ » : agents et fichiers", () => {
  it("lit la saisie après @, chemins compris", () => {
    expect(arobaseEnCours("regarde @src/ap", 15)).toEqual({ debut: 8, requete: "src/ap" });
    expect(arobaseEnCours("mail@exemple", 12)).toBeNull();
    expect(arobaseEnCours("@", 1)).toEqual({ debut: 0, requete: "" });
  });

  it("propose les fichiers : le nom d'abord, puis le chemin, puis les lettres dans l'ordre", () => {
    const fichiers = ["src/app/page.tsx", "src/components/PageHeader.tsx", "docs/pages.md", "README.md", "src/lib/pagination.ts"];
    expect(fichiersProposes(fichiers, "page")).toEqual(["docs/pages.md", "src/app/page.tsx", "src/components/PageHeader.tsx"]);
    expect(fichiersProposes(fichiers, "pagin")).toEqual(["src/lib/pagination.ts"]);
    expect(fichiersProposes(fichiers, "src/comp")).toEqual(["src/components/PageHeader.tsx"]);
    expect(fichiersProposes(fichiers, "rdm")).toEqual(["README.md"]);
    expect(fichiersProposes(fichiers, "")).toEqual(["README.md"]);
    expect(mentionFichier("src/a.ts")).toBe("@src/a.ts");
    expect(mentionFichier("lisez moi.md")).toBe('@"lisez moi.md"');
  });
});

describe("règles d'autorisation en mots", () => {
  it("dit chaque règle simplement", () => {
    expect(regleEnMots("Bash(npm run test:*)")).toBe("les commandes « npm run test… »");
    expect(regleEnMots("Bash(git status)")).toBe("la commande « git status »");
    expect(regleEnMots("WebFetch(domain:klyra.fr)")).toBe("le site klyra.fr");
    expect(regleEnMots("Read(./src/**)")).toBe("lire ./src/**");
    expect(regleEnMots("Edit(./docs/**)")).toBe("modifier ./docs/**");
    expect(regleEnMots("mcp__klyra__publier_artefact")).toBe("l’outil klyra · publier_artefact");
    expect(regleEnMots("Bash")).toBe("toutes les commandes");
  });
});
