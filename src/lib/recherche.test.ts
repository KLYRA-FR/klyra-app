import { describe, expect, test } from "vitest";
import type { Chat, Message } from "@/types/domain";
import { analyserRequete, aplatir, chercher, LIMITE, normaliser, type ConversationCherchable, type Morceau } from "./recherche";

const chat = (id: string, patch: Partial<Chat> = {}): Chat => ({
  id,
  kind: "equipe",
  projectId: "p1",
  title: id,
  roleIds: ["principal"],
  updatedAt: "2026-10-30T09:00:00.000Z",
  sessions: {},
  luJusqua: null,
  ...patch,
});

const conv = (c: Chat, titre = c.title, derniere: string | null = null): ConversationCherchable => ({ chat: c, titre, derniere });

let n = 0;
const message = (chatId: string, texte: string, createdAt = "2026-10-30T10:00:00.000Z", patch: Partial<Message> = {}): Message => ({
  id: `m${++n}`,
  chatId,
  author: { kind: "user" },
  createdAt,
  parts: [{ type: "text", text: texte }],
  ...patch,
});

const lu = (extrait: Morceau[]) => extrait.map((m) => (m.trouve ? `[${m.texte}]` : m.texte)).join("");

const equipe = conv(chat("equipe", { title: "Refonte du site" }));
const direct = conv(chat("dm-hugo", { kind: "direct", projectId: null, roleIds: ["hugo"], title: "" }), "Hugo");
const tout = [equipe, direct];
const total = (brute: string, messages: Message[], conversations = tout) => chercher(conversations, messages, brute)?.totalMessages;

describe("la requête", () => {
  test("vide, en espaces, ou rien que des mots d'une lettre : pas de recherche", () => {
    expect(analyserRequete("")).toBeNull();
    expect(analyserRequete("   \n")).toBeNull();
    expect(analyserRequete("a")).toBeNull();
    expect(analyserRequete("a b")).toBeNull();
    expect(analyserRequete('""')).toBeNull();
    expect(chercher(tout, [message("equipe", "Bonjour")], " ")).toBeNull();
  });

  test("des mots d'au moins 2 caractères : chacun cherché à part, sans accents ni majuscules, sans doublon", () => {
    expect(analyserRequete("  Décision   FACTURE décision ")).toEqual({ termes: ["decision", "facture"], phrase: false });
    expect(analyserRequete("à faire")).toEqual({ termes: ["faire"], phrase: false });
  });

  test("entre guillemets droits, français ou anglais : une phrase exacte", () => {
    expect(analyserRequete('"on garde le prix"')).toEqual({ termes: ["on garde le prix"], phrase: true });
    expect(analyserRequete("« On garde le prix »")).toEqual({ termes: ["on garde le prix"], phrase: true });
    expect(analyserRequete("“à faire”")).toEqual({ termes: ["a faire"], phrase: true });
  });

  test("ni expression régulière, ni HTML : la requête est cherchée telle quelle", () => {
    const messages = [message("equipe", "Le motif (.+) ne doit rien trouver"), message("equipe", "Une balise <b>gras</b> dans le texte")];
    expect(total("(.+)", messages)).toBe(1);
    expect(total("$(rm -rf)", messages)).toBe(0);
    expect(total("((", [message("equipe", "rien")])).toBe(0);
    const html = chercher(tout, messages, "<b>gras")!;
    expect(html.totalMessages).toBe(1);
    expect(lu(html.messages[0].extrait)).toBe("Une balise [<b>gras]</b> dans le texte");
  });
});

describe("la normalisation", () => {
  test("accents, majuscules, ligatures, apostrophes et espaces ne comptent pas", () => {
    expect(normaliser("Œuvre  d’Été\u00a0À\n\nl’ŒIL").texte).toBe("oeuvre d'ete a l'oeil");
  });

  test("chaque caractère comparé renvoie à sa place dans le texte d'origine", () => {
    const { texte, origine } = normaliser("Œil  é");
    expect(texte).toBe("oeil e");
    expect(origine).toEqual([0, 0, 1, 2, 3, 5]);
  });
});

describe("le Markdown aplati", () => {
  test("le libellé des liens sans leur syntaxe, les adresses à part, sans les marques de mise en forme", () => {
    expect(aplatir("## Titre\n\n- **Gras** et *italique* : voir [la maquette](https://figma.com/file/abc \"Figma\") ou `pnpm build`.\n> cité")).toEqual({
      texte: "Titre\n\nGras et italique : voir la maquette ou pnpm build.\ncité",
      adresses: ["https://figma.com/file/abc"],
    });
  });

  test("un lien automatique garde son adresse dans le texte, un identifiant garde ses tirets bas", () => {
    expect(aplatir("Voir <https://klyra.fr/prix> et nom_de_fichier.ts")).toEqual({
      texte: "Voir https://klyra.fr/prix et nom_de_fichier.ts",
      adresses: [],
    });
  });
});

describe("chercher", () => {
  test("un mot, quelle que soit sa forme : accents, majuscules, apostrophes, milieu de mot", () => {
    const messages = [message("equipe", "La DÉCISION est prise : on facture en novembre, d’après l’aperçu.")];
    expect(total("decision", messages)).toBe(1);
    expect(total("Décision", messages)).toBe(1);
    expect(total("factur", messages)).toBe(1);
    expect(total("l'aperçu", messages)).toBe(1);
    expect(total("décembre", messages)).toBe(0);
  });

  test("plusieurs mots : tous dans le message, dans n'importe quel ordre", () => {
    const messages = [message("equipe", "Le prix reste à 1 200 € pour Approv’Halles."), message("equipe", "Le prix change.")];
    const r = chercher(tout, messages, "approv'halles prix")!;
    expect(r.totalMessages).toBe(1);
    expect(lu(r.messages[0].extrait)).toBe("Le [prix] reste à 1 200 € pour [Approv’Halles].");
  });

  test("une phrase exacte : les mots dans l'ordre, même à cheval sur un retour à la ligne ou une mise en forme", () => {
    const messages = [message("equipe", "On garde\nle **prix** actuel."), message("equipe", "Le prix, on le garde.")];
    expect(total('"on garde le prix"', messages)).toBe(1);
    expect(total("on garde le prix", messages)).toBe(2);
  });

  test("un lien : dans le texte, ou seulement dans l'adresse d'un lien Markdown, et l'extrait montre l'adresse", () => {
    const messages = [
      message("equipe", "La maquette est sur https://klyra.fr/prix/accompagnement?v=2, à relire.", "2026-10-30T11:00:00.000Z"),
      message("equipe", "Voir [la maquette](https://figma.com/file/zq7Recherche) avant lundi.", "2026-10-30T10:00:00.000Z"),
    ];
    expect(total("https://klyra.fr/prix/accompagnement?v=2", messages)).toBe(1);
    expect(total("klyra.fr/prix", messages)).toBe(1);
    const adresse = chercher(tout, messages, "figma.com")!;
    expect(adresse.messages.map((m) => [m.genre, lu(m.extrait)])).toEqual([["adresse", "https://[figma.com]/file/zq7Recherche"]]);
    const libelle = chercher(tout, messages, "maquette")!;
    expect(libelle.messages.map((m) => lu(m.extrait))).toEqual([
      "La [maquette] est sur https://klyra.fr/prix/accompagnement?v=2, à relire.",
      "Voir la [maquette] avant lundi.",
    ]);
  });

  test("pas les pièces jointes : ni leur nom, ni leur dossier", () => {
    const m = message("equipe", "Voici le document", undefined, {
      parts: [
        { type: "text", text: "Voici le document" },
        { type: "fichiers", chemins: ["/Users/corentin/Clients/devis-v2.pdf", "C:\\Users\\pelin\\notes.txt"] },
      ],
    });
    expect(total("document", [m])).toBe(1);
    expect(total("devis-v2", [m])).toBe(0);
    expect(total("notes.txt", [m])).toBe(0);
    expect(total("corentin", [m])).toBe(0);
  });

  test("pas les étapes, autorisations, passations, erreurs, ni une réponse en cours d'écriture", () => {
    const fini = message("equipe", "Voici le devis", undefined, {
      author: { kind: "role", roleId: "principal" },
      parts: [
        { type: "text", text: "Voici le devis" },
        { type: "etapes", etapes: [{ id: "e1", outil: "Read", libelle: "Lit secret.pdf", statut: "fait", parent: null }] },
        { type: "autorisation", id: "a1", outil: "Bash", libelle: "Lance secret", detail: "secret", description: "secret", statut: "acceptee" },
        { type: "passation", etapeId: "e1", roleId: "hugo", consigne: "secret", statut: "fait" },
      ],
      statut: "erreur",
      erreur: "secret dans l’erreur",
    });
    const enCours = message("equipe", "Réponse provisoire en cours", undefined, { author: { kind: "role", roleId: "principal" }, statut: "en-cours" });
    expect(total("devis", [fini, enCours])).toBe(1);
    expect(total("secret", [fini, enCours])).toBe(0);
    expect(total("provisoire", [fini, enCours])).toBe(0);
    expect(total("provisoire", [fini, { ...enCours, statut: "fait" }])).toBe(1);
  });

  test("équipe, directes et fils, archivés compris ; pas un fil supprimé ni un message sans conversation", () => {
    const fil = conv(chat("fil-1", { kind: "direct", fil: { roleId: "hugo", statut: "archive", creeLe: "2026-10-30T08:00:00.000Z" } }));
    const supprime = conv(chat("fil-2", { kind: "direct", fil: { roleId: "hugo", statut: "archive", supprime: true, creeLe: "2026-10-30T08:00:00.000Z" } }));
    const messages = ["equipe", "dm-hugo", "fil-1", "fil-2", "inconnue"].map((id) => message(id, "Le mot repère est ici"));
    const r = chercher([equipe, direct, fil, supprime], messages, "repère")!;
    expect(r.messages.map((x) => x.conversation.chat.id).sort()).toEqual(["dm-hugo", "equipe", "fil-1"]);
  });

  test("les portées : agents (directes et fils), projets, cette conversation ; et leurs compteurs", () => {
    const fil = conv(chat("fil-1", { kind: "direct", fil: { roleId: "hugo", statut: "ouvert", creeLe: "2026-10-30T08:00:00.000Z" } }));
    const autre = conv(chat("equipe-2", { title: "Refonte du logo" }));
    const conversations = [equipe, autre, direct, fil];
    const messages = ["equipe", "equipe", "equipe-2", "dm-hugo", "fil-1"].map((id) => message(id, "Point sur la refonte"));
    const ids = (p: Parameters<typeof chercher>[3], courant: string | null = null) =>
      chercher(conversations, messages, "refonte", p, courant)!.messages.map((m) => m.conversation.chat.id);
    expect(ids("agents")).toEqual(["dm-hugo", "fil-1"]);
    expect(ids("projets")).toEqual(["equipe", "equipe", "equipe-2"]);
    expect(ids("conversation", "equipe")).toEqual(["equipe", "equipe"]);
    expect(ids("conversation")).toHaveLength(5);
    const r = chercher(conversations, messages, "refonte", "tout", "equipe")!;
    expect(r.conversations.map((c) => c.conversation.chat.id).sort()).toEqual(["equipe", "equipe-2"]);
    expect(r.parPortee).toEqual({ tout: 7, agents: 2, projets: 5, conversation: 2 });
    expect(chercher(conversations, messages, "refonte", "conversation", "equipe")!.conversations).toEqual([]);
    expect(chercher(conversations, messages, "refonte")!.parPortee.conversation).toBe(0);
  });

  test("les titres : 3 conversations au plus, la plus récente d'abord, le nom de l'agent pour une conversation directe", () => {
    const conversations = [
      conv(chat("a", { title: "Devis Approv’Halles" }), "Devis Approv’Halles", "2026-10-01T00:00:00.000Z"),
      conv(chat("b", { title: "Devis Qualion" }), "Devis Qualion", "2026-10-29T00:00:00.000Z"),
      conv(chat("c", { title: "Devis Plateau" }), "Devis Plateau", null),
      conv(chat("d", { title: "Devis KLYRA · branche" }), "Devis KLYRA · branche", "2026-10-20T00:00:00.000Z"),
      direct,
    ];
    const r = chercher(conversations, [], "devis")!;
    expect(r.conversations.map((c) => c.conversation.chat.id)).toEqual(["b", "d", "a"]);
    expect(lu(r.conversations[0].titre)).toBe("[Devis] Qualion");
    expect(chercher(conversations, [], "hugo")!.conversations.map((c) => c.conversation.chat.id)).toEqual(["dm-hugo"]);
  });

  test("les messages les plus récents d'abord, `LIMITE` au plus, avec le total", () => {
    const debut = Date.parse("2026-01-01T00:00:00.000Z");
    const messages = Array.from({ length: LIMITE + 20 }, (_, i) => message("equipe", `Compte rendu ${i}`, new Date(debut + i * 60_000).toISOString()));
    const r = chercher(tout, messages, "compte rendu")!;
    expect(r.totalMessages).toBe(LIMITE + 20);
    expect(r.messages).toHaveLength(LIMITE);
    expect(lu(r.messages[0].extrait)).toBe(`[Compte] [rendu] ${LIMITE + 19}`);
    const dates = r.messages.map((x) => x.message.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  test("le premier et le plus ancien message d'une longue conversation sont trouvés", () => {
    const messages = Array.from({ length: 2000 }, (_, i) =>
      message("equipe", i === 0 ? "Tout premier message : nom de code Orchidée." : `Message ${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()),
    );
    messages.push(message("equipe", "Dernier : orchidee aussi.", "2026-10-30T12:00:00.000Z"));
    expect(chercher(tout, messages, "orchidée")!.messages.map((x) => x.message.id)).toEqual([messages[2000].id, messages[0].id]);
  });

  test("un message long : trouvé loin dans le texte, extrait autour du passage, coupé entre deux mots", () => {
    const long = `${"Introduction sans intérêt. ".repeat(400)}Ici la décision : on publie vendredi. ${"Suite sans intérêt. ".repeat(400)}`;
    const texte = lu(chercher(tout, [message("equipe", long)], "publie vendredi")!.messages[0].extrait);
    expect(texte.startsWith("…")).toBe(true);
    expect(texte.endsWith("…")).toBe(true);
    expect(texte).toContain("Ici la décision : on [publie] [vendredi].");
    expect(texte.length).toBeLessThan(240);
    expect(["Introduction", "sans", "intérêt."]).toContain(texte.slice(1).split(" ")[0]);
    expect(["Suite", "sans", "intérêt."]).toContain(texte.slice(0, -1).split(" ").at(-1));
  });

  test("le résultat suit l'état : un message modifié est retrouvé par son nouveau texte, une conversation vidée ne donne plus rien", () => {
    const avant = message("equipe", "Brouillon de réponse");
    expect(total("brouillon", [avant])).toBe(1);
    const apres: Message = { ...avant, parts: [{ type: "text", text: "Réponse finale envoyée" }] };
    expect(total("brouillon", [apres])).toBe(0);
    expect(total("finale", [apres])).toBe(1);
    expect(total("finale", [])).toBe(0);
  });

  test("un extrait garde les accents et la casse d'origine, et surligne chaque correspondance", () => {
    expect(lu(chercher(tout, [message("equipe", "Été comme été, l’ÉTÉ.")], "ete")!.messages[0].extrait)).toBe("[Été] comme [été], l’[ÉTÉ].");
  });
});
