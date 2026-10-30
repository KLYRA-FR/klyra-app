import { describe, expect, test } from "vitest";
import type { Chat, Message } from "@/types/domain";
import { analyserRequete, LIMITE, normaliser, rechercher, type Morceau } from "./recherche";

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

const equipe = chat("equipe");
const direct = chat("dm-hugo", { kind: "direct", projectId: null, roleIds: ["hugo"] });

describe("la requête", () => {
  test("vide, en espaces ou d'une lettre : pas de recherche", () => {
    expect(analyserRequete("")).toBeNull();
    expect(analyserRequete("   \n")).toBeNull();
    expect(analyserRequete("a")).toBeNull();
    expect(analyserRequete('""')).toBeNull();
    expect(rechercher(" ", [equipe], [message("equipe", "Bonjour")])).toBeNull();
  });

  test("des mots : chacun cherché à part, sans accents ni majuscules, sans doublon", () => {
    expect(analyserRequete("  Décision   FACTURE décision ")).toEqual({ termes: ["decision", "facture"], phrase: false });
  });

  test("entre guillemets droits, français ou anglais : une phrase exacte", () => {
    expect(analyserRequete('"on garde le prix"')).toEqual({ termes: ["on garde le prix"], phrase: true });
    expect(analyserRequete("« On garde le prix »")).toEqual({ termes: ["on garde le prix"], phrase: true });
    expect(analyserRequete("“on garde”")).toEqual({ termes: ["on garde"], phrase: true });
  });

  test("ni expression régulière, ni HTML : la requête est cherchée telle quelle", () => {
    const messages = [message("equipe", "Le motif .* ne doit rien trouver"), message("equipe", "Une balise <b>gras</b> dans le texte")];
    expect(rechercher(".*", [equipe], messages)?.total).toBe(1);
    expect(rechercher("(", [equipe], [message("equipe", "rien")])).toBeNull();
    expect(rechercher("((", [equipe], [message("equipe", "rien")])?.total).toBe(0);
    const html = rechercher("<b>gras", [equipe], messages)!;
    expect(html.total).toBe(1);
    expect(lu(html.resultats[0].extrait)).toBe("Une balise [<b>gras]</b> dans le texte");
  });
});

describe("la normalisation", () => {
  test("accents, majuscules, ligatures, apostrophes et espaces ne comptent pas", () => {
    expect(normaliser("Œuvre  d’Été À\n\nl’ŒIL").texte).toBe("oeuvre d'ete a l'oeil");
  });

  test("chaque caractère comparé renvoie à sa place dans le texte d'origine", () => {
    const { texte, origine } = normaliser("Œil  é");
    expect(texte).toBe("oeil e");
    expect(origine).toEqual([0, 0, 1, 2, 3, 5]);
  });
});

describe("rechercher", () => {
  test("un mot, quelle que soit sa forme : accents, majuscules, milieu de mot", () => {
    const messages = [message("equipe", "La DÉCISION est prise : on facture en novembre.")];
    expect(rechercher("decision", [equipe], messages)?.total).toBe(1);
    expect(rechercher("Décision", [equipe], messages)?.total).toBe(1);
    expect(rechercher("factur", [equipe], messages)?.total).toBe(1);
    expect(rechercher("décembre", [equipe], messages)?.total).toBe(0);
  });

  test("plusieurs mots : tous dans le message, dans n'importe quel ordre", () => {
    const messages = [message("equipe", "Le prix reste à 1 200 € pour Approv’Halles."), message("equipe", "Le prix change.")];
    const r = rechercher("approv'halles prix", [equipe], messages)!;
    expect(r.total).toBe(1);
    expect(lu(r.resultats[0].extrait)).toBe("Le [prix] reste à 1 200 € pour [Approv’Halles].");
  });

  test("une phrase exacte : les mots dans l'ordre, même à cheval sur un retour à la ligne", () => {
    const messages = [message("equipe", "On garde\nle prix actuel."), message("equipe", "Le prix, on le garde.")];
    expect(rechercher('"on garde le prix"', [equipe], messages)?.total).toBe(1);
    expect(rechercher("on garde le prix", [equipe], messages)?.total).toBe(2);
  });

  test("un lien, entier ou en partie", () => {
    const messages = [message("equipe", "La maquette est sur https://klyra.fr/prix/accompagnement?v=2, à relire.")];
    expect(rechercher("https://klyra.fr/prix/accompagnement?v=2", [equipe], messages)?.total).toBe(1);
    expect(rechercher("klyra.fr/prix", [equipe], messages)?.total).toBe(1);
    expect(rechercher("klyra.fr/tarifs", [equipe], messages)?.total).toBe(0);
  });

  test("équipe, directes et fils ; pas un fil supprimé ni un message sans conversation", () => {
    const fil = chat("fil-1", { kind: "direct", fil: { roleId: "hugo", statut: "archive", creeLe: "2026-10-30T08:00:00.000Z" } });
    const supprime = chat("fil-2", { kind: "direct", fil: { roleId: "hugo", statut: "archive", supprime: true, creeLe: "2026-10-30T08:00:00.000Z" } });
    const messages = ["equipe", "dm-hugo", "fil-1", "fil-2", "inconnue"].map((id) => message(id, "Le mot repère est ici"));
    const r = rechercher("repère", [equipe, direct, fil, supprime], messages)!;
    expect(r.resultats.map((x) => x.chat.id).sort()).toEqual(["dm-hugo", "equipe", "fil-1"]);
  });

  test("seulement le texte : ni les pièces jointes, ni les étapes, ni les erreurs", () => {
    const m = message("equipe", "Voici le devis", undefined, {
      author: { kind: "role", roleId: "principal" },
      parts: [
        { type: "text", text: "Voici le devis" },
        { type: "fichiers", chemins: ["/Users/corentin/devis-secret.pdf"] },
        { type: "etapes", etapes: [{ id: "e1", outil: "Read", libelle: "Lit devis-secret.pdf", statut: "fait", parent: null }] },
      ],
      statut: "erreur",
      erreur: "secret dans l’erreur",
    });
    expect(rechercher("devis", [equipe], [m])?.total).toBe(1);
    expect(rechercher("secret", [equipe], [m])?.total).toBe(0);
  });

  test("les plus récents d'abord, `LIMITE` au plus, avec le total", () => {
    const debut = Date.parse("2026-01-01T00:00:00.000Z");
    const messages = Array.from({ length: LIMITE + 20 }, (_, i) => message("equipe", `Compte rendu ${i}`, new Date(debut + i * 60_000).toISOString()));
    const r = rechercher("compte rendu", [equipe], messages)!;
    expect(r.total).toBe(LIMITE + 20);
    expect(r.resultats).toHaveLength(LIMITE);
    expect(lu(r.resultats[0].extrait)).toBe(`[Compte] [rendu] ${LIMITE + 19}`);
    const dates = r.resultats.map((x) => x.message.createdAt);
    expect(dates).toEqual([...dates].sort().reverse());
  });

  test("le premier et le plus ancien message d'une longue conversation sont trouvés", () => {
    const messages = Array.from({ length: 2000 }, (_, i) =>
      message("equipe", i === 0 ? "Tout premier message : nom de code Orchidée." : `Message ${i}`, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString()),
    );
    messages.push(message("equipe", "Dernier : orchidee aussi.", "2026-10-30T12:00:00.000Z"));
    const r = rechercher("orchidée", [equipe], messages)!;
    expect(r.resultats.map((x) => x.message.id)).toEqual([messages[2000].id, messages[0].id]);
  });

  test("un message long : trouvé loin dans le texte, extrait autour du passage, coupé entre deux mots", () => {
    const long = `${"Introduction sans intérêt. ".repeat(400)}Ici la décision : on publie vendredi. ${"Suite sans intérêt. ".repeat(400)}`;
    const r = rechercher("publie vendredi", [equipe], [message("equipe", long)])!;
    const texte = lu(r.resultats[0].extrait);
    expect(texte.startsWith("…")).toBe(true);
    expect(texte.endsWith("…")).toBe(true);
    expect(texte).toContain("Ici la décision : on [publie] [vendredi].");
    expect(texte.length).toBeLessThan(220);
    const premierMot = texte.slice(1).split(" ")[0];
    expect(["Introduction", "sans", "intérêt."]).toContain(premierMot);
    const dernierMot = texte.slice(0, -1).split(" ").at(-1);
    expect(["Suite", "sans", "intérêt."]).toContain(dernierMot);
  });

  test("le résultat suit le message : modifié, il est retrouvé par son nouveau texte, plus par l'ancien", () => {
    const avant = message("equipe", "Brouillon de réponse");
    expect(rechercher("brouillon", [equipe], [avant])?.total).toBe(1);
    const apres: Message = { ...avant, parts: [{ type: "text", text: "Réponse finale envoyée" }] };
    expect(rechercher("brouillon", [equipe], [apres])?.total).toBe(0);
    expect(rechercher("finale", [equipe], [apres])?.total).toBe(1);
    expect(rechercher("finale", [equipe], [])?.total).toBe(0);
  });

  test("un extrait garde les accents et la casse d'origine, et surligne chaque correspondance", () => {
    const r = rechercher("ete", [equipe], [message("equipe", "Été comme été, l’ÉTÉ.")])!;
    expect(lu(r.resultats[0].extrait)).toBe("[Été] comme [été], l’[ÉTÉ].");
  });
});
