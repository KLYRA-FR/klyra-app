import { describe, expect, it } from "vitest";
import type { InstantaneExport } from "./export-conversation";
import { DEPART_ROUTINE } from "./message-routine";
import type { Chat, Message, MessagePart } from "@/types/domain";

// Comme test:report : les formateurs retiennent le fuseau lors de leur création.
process.env.TZ = "Europe/Paris";
const { fermerCode, nomExport, preparerExport } = await import("./export-conversation");

// Toutes les attentes sont écrites à la main, avec l'heure locale de Paris.
const maintenant = new Date("2026-10-30T22:41:00.000Z");
const chat: Chat = {
  id: "conversation-privee", kind: "equipe", title: "Devis cuisine Martin", projectId: "projet-prive",
  roleIds: ["principal", "hugo"], updatedAt: "2026-10-30T13:33:00Z", sessions: { principal: "session-privee" },
  luJusqua: "lu-prive", epingleLe: "2026-10-30T12:00:00Z", modele: "modele-prive", effort: "effort-prive", amorce: "Amorce privée",
};
const roles = [
  { id: "principal", name: "Principal", title: "Assistant" },
  { id: "hugo", name: "Hugo", title: "Dev frontend et backend" },
  { id: "ancien", name: "Camille", title: "Ancien agent" },
];
const message = (id: string, parts: MessagePart[], patch: Partial<Message> = {}): Message => ({
  id, chatId: chat.id, author: { kind: "user" }, createdAt: "2026-10-30T13:32:00Z", parts, ...patch,
});
const texte = (text: string): MessagePart => ({ type: "text", text });
const input = (messages: Message[], patch: Partial<InstantaneExport> = {}): InstantaneExport => ({
  chat, messages, moi: { name: "  Camille Roux  " }, roles, project: { name: "Atelier Durand" }, maintenant, ...patch,
});
const exporter = (messages: Message[], patch: Partial<InstantaneExport> = {}) => preparerExport(input(messages, patch));

describe("document Markdown de la conversation", () => {
  it("reproduit octet pour octet le document de la spec, texte, tableau, code et état compris", () => {
    const donnees = input([
      message("id-user", [texte("Peux-tu reprendre le devis avec les **nouveaux métrés** ?"), { type: "fichiers", chemins: ["/Users/camille/metres_v2.pdf", "C:\\images\\photo cuisine.jpg"] }]),
      message("id-assistant", [texte("Je confie le calcul à Hugo."), { type: "passation", etapeId: "outil-prive", roleId: "hugo", consigne: "Recalculer le devis avec metres_v2.pdf et vérifier la TVA", statut: "en-cours" }], { author: { kind: "role", roleId: "principal" }, createdAt: "2026-10-30T13:33:00Z", statut: "fait" }),
      message("id-hugo", [texte("## Devis mis à jour\n\n| Poste | Montant |\n|---|---|\n| Plan de travail | 1 240 € |\n\n```ts\nconst total = lignes.reduce((s, l) => s + l.montant, 0);\n```\n\nDétail sur [klyra.fr](https://klyra.fr) 🙂")], { author: { kind: "role", roleId: "hugo" }, createdAt: "2026-10-30T13:40:00Z", statut: "fait" }),
      message("id-encours", [texte("Voici le récapitulatif pour Mme Martin…")], { author: { kind: "role", roleId: "principal" }, createdAt: "2026-10-30T13:41:00Z", statut: "en-cours" }),
    ]);
    const avant = JSON.stringify(donnees);
    const attendu = [
      "# Devis cuisine Martin", "",
      "- Projet : Atelier Durand",
      "- Participants : Camille Roux, Principal (Assistant), Hugo (Dev frontend et backend)",
      "- Exporté depuis KLYRA le vendredi 30 octobre 2026 à 23:41", "",
      "---", "", "**Camille Roux** · 30 oct. 2026 à 14:32", "",
      "Peux-tu reprendre le devis avec les **nouveaux métrés** ?", "",
      "Pièces jointes : `metres_v2.pdf`, `photo cuisine.jpg`", "",
      "---", "", "**Principal** · 30 oct. 2026 à 14:33", "",
      "Je confie le calcul à Hugo.", "",
      "_Confié à Hugo · Recalculer le devis avec metres\\_v2.pdf et vérifier la TVA_", "",
      "---", "", "**Hugo** · 30 oct. 2026 à 14:40", "",
      "## Devis mis à jour", "", "| Poste | Montant |", "|---|---|", "| Plan de travail | 1 240 € |", "",
      "```ts", "const total = lignes.reduce((s, l) => s + l.montant, 0);", "```", "",
      "Détail sur [klyra.fr](https://klyra.fr) 🙂", "",
      "---", "", "**Principal** · 30 oct. 2026 à 14:41", "",
      "Voici le récapitulatif pour Mme Martin…", "", "_Réponse en cours d’écriture au moment de l’export._", "",
    ].join("\n");
    expect(preparerExport(donnees)).toEqual({ contenu: attendu, nomPropose: "Devis cuisine Martin - 2026-10-30.md" });
    expect(new TextEncoder().encode(preparerExport(donnees)!.contenu)).toEqual(new TextEncoder().encode(attendu));
    expect(JSON.stringify(donnees)).toBe(avant);
  });

  it("laisse le texte original, ses chemins et liens, en normalisant seulement les blancs permis", () => {
    const result = exporter([message("m", [texte(" \r\n\r\n  * moi # _test_\r\n\r\nC:\\dossier et /home/texte [lien](https://exemple.fr)  \t"), texte("Deuxième bloc\n\n")])])!.contenu;
    expect(result.endsWith("\n\n  * moi # _test_\n\nC:\\dossier et /home/texte [lien](https://exemple.fr)\n\nDeuxième bloc\n")).toBe(true);
    expect(result.startsWith("\ufeff")).toBe(false);
    expect(result.includes("\r")).toBe(false);
    expect(result.endsWith("\n\n")).toBe(false);
  });

  it("échappe seulement les métadonnées, et conserve tous les signes littéraux", () => {
    const result = exporter([message("m", [texte("*texte* [lien](https://a) # _a_ \\ intact")])], {
      chat: { ...chat, title: " Bug #\n *test* <x> [y] | ~ \\ ` " }, moi: { name: "Moi * [x]\n_" }, project: { name: "[Client] | ~" },
    })!.contenu;
    expect(result.startsWith("# Bug \\# \\*test\\* \\<x\\> \\[y\\] \\| \\~ \\\\ \\`\n")).toBe(true);
    expect(result).toContain("- Projet : \\[Client\\] \\| \\~\n");
    expect(result).toContain("**Moi \\* \\[x\\] \\_** ·");
    expect(result).toContain("\n\n*texte* [lien](https://a) # _a_ \\ intact\n");
  });

  it("omet tous les blocs techniques, les autres chats et les messages sans contenu", () => {
    const exclus: MessagePart[] = [
      { type: "etapes", etapes: [{ id: "etape-privee", outil: "OUTIL_PRIVE", libelle: "COMMANDE_PRIVEE", chemin: "/home/prive", statut: "fait", parent: null }] },
      { type: "autorisation", id: "autorisation-privee", outil: "OUTIL_PRIVE", libelle: "LIBELLE_PRIVE", detail: "DETAIL_PRIVE", description: "DESCRIPTION_PRIVEE", statut: "attente" },
      { type: "tasks", tasks: [{ id: "task", roleId: "principal", label: "DEMO_TASK", status: "fait" }] },
      { type: "options", options: [{ id: "option", label: "DEMO_OPTION", layout: "texte", selected: true }] },
      { type: "worklog", durationMin: 45, files: [{ path: "C:\\fichier-prive", added: 5, removed: 6 }] },
      { type: "actions", actions: [{ id: "action", label: "DEMO_ACTION", primary: true }] },
    ];
    const result = exporter([
      message("secret1", exclus, { author: { kind: "role", roleId: "invisible" } }),
      message("secret2", [texte(" \n\t ")]),
      message("secret3", [texte("AUTRE_CONVERSATION")], { chatId: "autre" }),
      message("secret4", [texte("Gardé"), ...exclus], { routineRun: "routine-privee" }),
    ])!.contenu;
    expect(result).toBe([
      "# Devis cuisine Martin", "", "- Projet : Atelier Durand", "- Participants : Camille Roux",
      "- Exporté depuis KLYRA le vendredi 30 octobre 2026 à 23:41", "", "---", "", "**Camille Roux** · 30 oct. 2026 à 14:32", "", "Gardé", "",
    ].join("\n"));
  });

  it("renvoie null pour une conversation vide, étapes seules ou réponse encore vide", () => {
    expect(exporter([])).toBeNull();
    expect(exporter([message("m", [], { statut: "en-cours" })])).toBeNull();
    expect(exporter([message("m", [{ type: "etapes", etapes: [] }])])).toBeNull();
    expect(exporter([message("m", [texte(" \t\r\n")])])).toBeNull();
    expect(exporter([message("m", [{ type: "fichiers", chemins: [] }])])).toBeNull();
  });

  it("garde une erreur vide sans exposer son détail, et une réponse en cours non vide", () => {
    const result = exporter([
      message("m1", [], { author: { kind: "role", roleId: "ancien" }, createdAt: "invalide", statut: "erreur", erreur: "DETAIL_TECHNIQUE_SECRET" }),
      message("m2", [texte("Réponse figée")], { author: { kind: "role", roleId: "principal" }, statut: "en-cours" }),
    ])!.contenu;
    expect(result).toContain("- Participants : Camille (Ancien agent), Principal (Assistant)\n");
    expect(result).toContain("**Camille**\n\n_L’agent s’est arrêté sur une erreur._\n\n---");
    expect(result).not.toContain("DETAIL_TECHNIQUE_SECRET");
    expect(result.endsWith("Réponse figée\n\n_Réponse en cours d’écriture au moment de l’export._\n")).toBe(true);
  });

  it("n'exporte que le nom des pièces jointes, y compris Windows, capture et accents graves", () => {
    const result = exporter([message("m", [{ type: "fichiers", chemins: [
      "/Users/test/metres_v2.pdf", "C:\\Users\\test\\photo cuisine.jpg", "/home/test/collages/capture-2026-10-30.png", "/secret/a`b.md", "/secret/a``b.txt",
    ] }])])!.contenu;
    expect(result.endsWith("Pièces jointes : `metres_v2.pdf`, `photo cuisine.jpg`, `capture-2026-10-30.png`, `` a`b.md ``, ``` a``b.txt ```\n")).toBe(true);
    for (const prive of ["/Users/", "/home/", "C:\\", "/secret/", "file://"]) expect(result).not.toContain(prive);
    expect(exporter([message("seul", [{ type: "fichiers", chemins: ["fichier.pdf"] }])])!.contenu).toContain("Pièce jointe : `fichier.pdf`");
  });

  it("résume passations et propositions sans les consignes complètes, dans l'ordre des blocs", () => {
    const result = exporter([message("m", [
      { type: "passation", etapeId: "etape1", roleId: "hugo", statut: "en-cours", consigne: "  Vérifier\n\tlot_2  " },
      { type: "passation", etapeId: "etape2", roleId: "ancien", statut: "fait", consigne: " 	" },
      { type: "passation", etapeId: "etape3", roleId: "absent", statut: "erreur", consigne: "a".repeat(400) },
      { type: "proposition-agent", etapeId: "etape4", proposition: { id: "AGENT_ID_SECRET", nom: "Agent <1>", role: "Rôle *utile*", description: "  À faire\n[plus]  ", consignes: "CONSIGNES_INTERNES_SECRETES" } },
      { type: "proposition-agent", etapeId: "etape5", proposition: { id: "vide", nom: "Simple", role: " ", description: " ", consignes: "CONSIGNES_INTERNES_SECRETES" } },
    ])])!.contenu;
    expect(result.endsWith([
      "_Confié à Hugo · Vérifier lot\\_2_", "", "_Rendu par Camille_", "",
      `_Arrêté chez absent · ${"a".repeat(200)}…_`, "",
      "_Proposition d’agent : Agent \\<1\\> · Rôle \\*utile\\*_", "", "> À faire \\[plus\\]", "",
      "_Proposition d’agent : Simple_", "",
    ].join("\n"))).toBe(true);
    expect(result).not.toContain("CONSIGNES_INTERNES_SECRETES");
    expect(result).not.toContain("AGENT_ID_SECRET");
    expect(result).toContain("- Participants : Camille Roux\n");
  });

  it("résout les agents désactivés et introuvables, et garde l'ordre de première parole", () => {
    const result = exporter([
      message("a", [texte("Ancien")], { author: { kind: "role", roleId: "ancien" } }),
      message("b", [texte("Absent")], { author: { kind: "role", roleId: "introuvable" } }),
      message("c", [texte("Moi")]),
      message("d", [texte("Encore")], { author: { kind: "role", roleId: "ancien" } }),
    ], { moi: { name: " \t " } })!.contenu;
    expect(result).toContain("- Participants : Camille (Ancien agent), introuvable (Agent introuvable sur ce poste), Moi\n");
    expect(result).toContain("**introuvable** ·");
    expect(result).toContain("**Moi** ·");
  });

  it("conserve l'ordre de l'écran à dates égales, inversées ou invalides", () => {
    const result = exporter([
      message("a", [texte("PREMIER")], { createdAt: "2026-10-30T13:32:00Z" }),
      message("b", [texte("DEUXIEME")], { createdAt: "2026-10-30T13:32:00Z" }),
      message("c", [texte("TROISIEME")], { createdAt: "2020-01-01T13:32:00Z" }),
      message("d", [texte("QUATRIEME")], { createdAt: "non-date" }),
    ])!.contenu;
    expect(result.indexOf("PREMIER")).toBeLessThan(result.indexOf("DEUXIEME"));
    expect(result.indexOf("DEUXIEME")).toBeLessThan(result.indexOf("TROISIEME"));
    expect(result.indexOf("TROISIEME")).toBeLessThan(result.indexOf("QUATRIEME"));
    expect(result.endsWith("**Camille Roux**\n\nQUATRIEME\n")).toBe(true);
  });

  it("nomme les routines, retire leur seul préfixe et garde leurs participants propres", () => {
    const result = exporter([
      message("r1", [texte("Routine « Matin * »\n\nFaire le point."), texte("Deuxième bloc")]),
      message("r2", [texte("Tâche planifiée « Matin * »\n\nAncienne consigne.")]),
      message("u", [texte("Ma réponse")]),
    ])!.contenu;
    expect(result).toContain("- Participants : Routine « Matin \\* », Camille Roux\n");
    expect(result).toContain("**Routine « Matin \\* »** · 30 oct. 2026 à 14:32\n\nFaire le point.\n\nDeuxième bloc");
    expect(result).not.toContain("Tâche planifiée");
    expect(DEPART_ROUTINE.exec("Routine « Matin »\n\nConsigne")?.[1]).toBe("Matin");
  });

  it("exporte une directe sous le nom actuel de son agent sans projet", () => {
    const result = exporter([message("m", [texte("Bonjour")])], { chat: { ...chat, kind: "direct", title: "Nom périmé", roleIds: ["ancien"] } })!;
    expect(result.contenu.startsWith("# Conversation avec Camille\n\n- Participants : Camille Roux\n")).toBe(true);
    expect(result.nomPropose).toBe("Conversation avec Camille - 2026-10-30.md");
    expect(result.contenu).not.toContain("Nom périmé");
    expect(result.contenu).not.toContain("Projet :");
  });

  it("garde le titre du fil archivé et son agent, sans exporter son identifiant", () => {
    const result = exporter([message("m", [texte("Résultat")])], { chat: { ...chat, kind: "direct", title: "Rapport final", roleIds: ["hugo"], fil: { roleId: "hugo", creeLe: "2026-01-01", statut: "archive", lancePar: { roleId: "principal", chatId: "chat-prive" } } } })!;
    expect(result.contenu.startsWith("# Rapport final\n\n- Fil avec Hugo\n- Participants : Camille Roux\n")).toBe(true);
    expect(result.nomPropose).toBe("Rapport final - 2026-10-30.md");
    expect(result.contenu).not.toContain("chat-prive");
  });

  it("omet le projet retiré et capture une chaîne indépendante des mutations ultérieures", () => {
    const source = input([message("m", [texte("Au clic")])], { project: undefined, chat: { ...chat } });
    const result = preparerExport(source)!;
    source.messages[0].parts.push(texte("Après le clic"));
    source.chat.title = "Après le clic";
    expect(result.contenu).not.toContain("Projet :");
    expect(result.contenu).not.toContain("Après le clic");
  });

  it("supporte un historique long sans limite arbitraire de messages", () => {
    const result = exporter(Array.from({ length: 2500 }, (_, n) => message(`id-${n}`, [texte(`Texte ${n} ${"🙂".repeat(100)}`)])))!.contenu;
    expect(result).toContain("Texte 0 ");
    expect(result).toContain("Texte 2499 ");
    expect((result.match(/\*\*Camille Roux\*\*/g) ?? []).length).toBe(2500);
  });
});

describe("code interrompu", () => {
  it.each([
    ["```ts\nconst a = 1;", "```ts\nconst a = 1;\n```"],
    ["~~~~\ntexte\n~~~", "~~~~\ntexte\n~~~\n~~~~"],
    ["- étape\n\n  ```js\n  code();", "- étape\n\n  ```js\n  code();\n  ```"],
    ["   ~~~js\n x", "   ~~~js\n x\n   ~~~"],
    ["```js\na\n```\ntexte", "```js\na\n```\ntexte"],
    ["~~~\na\n~~~~", "~~~\na\n~~~~"],
    ["```inline``` dans une phrase", "```inline``` dans une phrase"],
    ["    ```\ncode indenté", "    ```\ncode indenté"],
    ["texte `inline`", "texte `inline`"],
  ])("ferme seulement le bloc nécessaire : %s", (source, attendu) => expect(fermerCode(source)).toBe(attendu));

  it("joint les blocs texte avant clôture, puis protège pièces jointes et note d'état", () => {
    const result = exporter([message("m", [texte("```js\nligne 1"), { type: "etapes", etapes: [] }, texte("ligne 2"), { type: "fichiers", chemins: ["preuve.txt"] }], { statut: "en-cours" })])!.contenu;
    expect(result.endsWith("```js\nligne 1\n\nligne 2\n```\n\nPièce jointe : `preuve.txt`\n\n_Réponse en cours d’écriture au moment de l’export._\n")).toBe(true);
    const ferme = exporter([message("m", [texte("```js\nligne 1"), texte("ligne 2\n```")])])!.contenu;
    expect((ferme.match(/```/g) ?? []).length).toBe(2);
  });
});

describe("nom du document", () => {
  it.each([
    ["Devis: v2/final?", "Devis v2 final - 2026-10-30.md"],
    [".notes", "notes - 2026-10-30.md"],
    ["???", "Conversation - 2026-10-30.md"],
    ["...  ", "Conversation - 2026-10-30.md"],
    ["CON", "CON - 2026-10-30.md"],
    ["NUL", "NUL - 2026-10-30.md"],
    ["COM1", "COM1 - 2026-10-30.md"],
    ["CON.txt", "Conversation CON.txt - 2026-10-30.md"],
    ["NUL.log", "Conversation NUL.log - 2026-10-30.md"],
    ["lpt².txt", "Conversation lpt².txt - 2026-10-30.md"],
    ["a\\b: c* d? e\" f< g> h| i\u0000j\n", "a b c d e f g h i j - 2026-10-30.md"],
    ["  .. .notes...  ", "notes - 2026-10-30.md"],
  ])("nettoie %s", (source, attendu) => expect(nomExport(source, maintenant)).toBe(attendu));

  it("coupe à 80 caractères visibles sans casser l'emoji placé en dernière position", () => {
    expect(nomExport(`${"a".repeat(79)}🙂${"b".repeat(40)}`, maintenant)).toBe(`${"a".repeat(79)}🙂 - 2026-10-30.md`);
    expect(nomExport(`${"a".repeat(79)}👨‍👩‍👧‍👦suite`, maintenant)).toBe(`${"a".repeat(79)}👨‍👩‍👧‍👦 - 2026-10-30.md`);
  });

  it("utilise le jour local du clic, y compris après minuit et au changement d'heure", () => {
    expect(nomExport("Minuit", new Date("2026-12-31T23:30:00Z"))).toBe("Minuit - 2027-01-01.md");
    expect(nomExport("Été", new Date("2026-03-29T01:30:00Z"))).toBe("Été - 2026-03-29.md");
  });
});
