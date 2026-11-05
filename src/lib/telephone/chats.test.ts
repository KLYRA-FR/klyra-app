import { describe, expect, test } from "vitest";
import {
  actionsConversation,
  actionsReponse,
  agentsPourFil,
  conseilDuFil,
  estDemandeResume,
  aTraiter,
  auTravail,
  dureeDepuis,
  etatLigne,
  tachesDe,
  mentionDans,
  mentionEnCours,
  nombreATraiter,
  nouvelIdFil,
  parentDe,
  sections,
  type CarteAgentLue,
  type ConversationLue,
  type MessageEnAttente,
} from "./chats";
import type { Id } from "../../../convex/_generated/dataModel";

const conversation = (origine: string, extra: Partial<ConversationLue> = {}): ConversationLue => ({
  origine,
  kind: origine.startsWith("dm-") || origine.startsWith("klyra-fil-") ? "direct" : "equipe",
  titre: origine,
  projetId: null,
  projetNom: null,
  contexte: null,
  roleIds: origine.startsWith("dm-") ? [origine.slice(3)] : ["principal"],
  misAJour: "2026-11-01T10:00:00.000Z",
  epingleLe: null,
  extrait: "",
  extraitLe: null,
  nonLus: 0,
  taches: "[]",
  lieu: null,
  parent: null,
  archiveLe: null,
  activite: null,
  modele: null,
  ...extra,
});

const activite = (etat: string, depuis: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ etat, roleId: "hugo", messageId: "m1", depuis, ...extra });
const accord = (depuis: string) => activite("accord", depuis, { accord: { id: "a1", libelle: "Lance pnpm build", detail: "pnpm build", description: "" } });

const cartes: CarteAgentLue[] = [
  { origine: "principal", nom: "Sam", teinte: "bleu-k1", roleCourt: "Assistant", actif: true },
  { origine: "hugo", nom: "Hugo", teinte: "vert", roleCourt: "Dev", actif: true },
  { origine: "iris", nom: "Iris", teinte: "rose", roleCourt: "Design", actif: true },
  { origine: "ancien", nom: "Ancien", teinte: "ocre", roleCourt: "Retraité", actif: false },
];
const nom = (id: string) => cartes.find((c) => c.origine === id)?.nom ?? id;

const enAttente = (conversationOrigine: string, creeLe: number): MessageEnAttente => ({
  _id: `m${creeLe}` as Id<"messagesFile">,
  conversationOrigine,
  texte: "Relance le build",
  creeLe,
  options: null,
  pieces: [],
});

describe("Chats (T-01)", () => {
  test("sections : épinglées dans l'ordre de pose, l'assistant d'abord puis les agents actifs, puis l'équipe", () => {
    const liste = [
      conversation("c1", { epingleLe: "2026-10-01T00:00:00.000Z" }),
      conversation("c2", { epingleLe: "2026-10-05T00:00:00.000Z" }),
      conversation("c3", { misAJour: "2026-11-02T00:00:00.000Z" }),
      conversation("c4"),
      conversation("dm-hugo", { activite: activite("ecrit", "2026-11-01T10:00:00.000Z") }),
      conversation("klyra-fil-00000001", { roleIds: ["iris"], parent: "dm-iris", activite: activite("reflechit", "2026-11-01T10:00:00.000Z") }),
    ];
    const { epinglees, agents, equipe } = sections(liste, cartes, nom);
    expect(epinglees.map((c) => c.origine)).toEqual(["c2", "c1"]);
    expect(equipe.map((c) => c.origine)).toEqual(["c3", "c4"]);
    expect(agents.map((a) => a.carte.origine)).toEqual(["principal", "hugo", "iris"]);
    expect(agents[1].etat).toEqual({ texte: "Écrit sa réponse…", enCours: true });
    /* Iris travaille dans un de ses fils : sa ligne le dit. */
    expect(agents[2].etat?.texte).toBe("Réfléchit…");
  });

  test("états de ligne comme au bureau ; ordinateur fermé, la question reste et l'accord est expiré", () => {
    expect(etatLigne(conversation("dm-hugo", { activite: accord("x") }), nom)?.texte).toBe("Attend ton accord");
    expect(etatLigne(conversation("c1", { kind: "equipe", activite: accord("x") }), nom)?.texte).toBe("Hugo attend ton accord");
    expect(etatLigne(conversation("dm-hugo", { activite: activite("etape", "x", { libelle: "Lit README.md" }) }), nom)?.texte).toBe("Lit README.md…");
    expect(etatLigne(conversation("dm-hugo", { activite: activite("collegue", "x") }), nom)?.texte).toBe("Attend un collègue…");
    expect(etatLigne(conversation("dm-hugo", { activite: activite("question", "x") }), nom)).toEqual({ texte: "Attend ta réponse", enCours: false });
    expect(etatLigne(conversation("dm-hugo", { activite: activite("ecrit", "x") }), nom, false)).toBeNull();
    expect(etatLigne(conversation("dm-hugo", { activite: accord("x") }), nom, false)).toEqual({ texte: "Demande d’accord expirée", enCours: false });
  });

  test("À traiter : accords puis questions, les plus anciens d'abord, puis les messages en attente ; une question déjà répondue sort", () => {
    const liste = [
      conversation("dm-hugo", { activite: accord("2026-11-01T10:05:00.000Z") }),
      conversation("dm-iris", { activite: accord("2026-11-01T10:01:00.000Z") }),
      conversation("c1", { activite: activite("question", "2026-11-01T09:00:00.000Z") }),
      conversation("c2", { activite: activite("question", "2026-11-01T09:00:00.000Z") }),
      conversation("klyra-fil-00000002", { archiveLe: "2026-11-01T00:00:00.000Z", activite: accord("2026-11-01T08:00:00.000Z") }),
    ];
    const elements = aTraiter(liste, [enAttente("c2", 2), enAttente("dm-hugo", 3), enAttente("c2", 1)]);
    expect(elements.map((e) => (e.genre === "attente" ? `attente:${e.conversationOrigine}:${e.messages.length}` : `${e.genre}:${e.conversation.origine}`))).toEqual([
      "accord:dm-iris",
      "accord:dm-hugo",
      "question:c1",
      "attente:c2:2",
      "attente:dm-hugo:1",
    ]);
    expect(nombreATraiter(liste)).toBe(4);
  });

  test("menus « ⋯ » : renommer l'équipe et les fils, épingler l'équipe seulement, le projet s'il y en a un", () => {
    expect(actionsConversation(conversation("dm-hugo"))).toEqual(["exporter"]);
    expect(actionsConversation(conversation("dm-hugo"), { dansLeFil: true })).toEqual(["details", "rechercher", "exporter", "reglages"]);
    expect(actionsConversation(conversation("klyra-fil-00000003", { roleIds: ["hugo"] }))).toEqual(["renommer", "exporter"]);
    expect(actionsConversation(conversation("c1", { projetId: "p1" }))).toEqual(["epingler", "renommer", "projet", "exporter"]);
    expect(actionsConversation(conversation("c1", { epingleLe: "x" }))).toEqual(["desepingler", "renommer", "exporter"]);
    expect(actionsConversation(undefined)).toEqual(["exporter"]);
    /* E2-08 : « Marquer comme lu » s'il y a du non-lu, « Arrêter » seulement si l'agent travaille. */
    expect(actionsConversation(conversation("dm-hugo", { nonLus: 2 }))).toEqual(["lu", "exporter"]);
    expect(actionsConversation(conversation("dm-hugo"), { actif: true })).toEqual(["exporter", "arreter"]);
  });

  test("Au travail (D2-2) : seulement ordinateur ouvert, ni accord ni question, les plus récents d'abord, tâches comptées", () => {
    const taches = JSON.stringify([
      { texte: "Lire", statut: "fait" },
      { texte: "Corriger", statut: "en-cours" },
      { texte: "Tester", statut: "a-faire" },
    ]);
    const liste = [
      conversation("dm-hugo", { activite: activite("ecrit", "2026-11-04T10:00:00.000Z") }),
      conversation("c1", { titre: "Arrondi de la TVA", taches, activite: activite("etape", "2026-11-04T11:00:00.000Z", { libelle: "Corrige le calcul", roleId: "iris" }) }),
      conversation("c2", { activite: accord("2026-11-04T09:00:00.000Z") }),
      conversation("c3", { activite: activite("question", "2026-11-04T09:00:00.000Z") }),
      conversation("c4", { archiveLe: "2026-11-01", activite: activite("ecrit", "2026-11-04T12:00:00.000Z") }),
    ];
    expect(auTravail(liste, false)).toEqual([]);
    expect(auTravail(liste, true).map((a) => [a.origine, a.roleId, a.sujet, a.texte, a.taches])).toEqual([
      ["c1", "iris", "Arrondi de la TVA", "Corrige le calcul…", { faites: 1, total: 3 }],
      ["dm-hugo", "hugo", null, "Écrit sa réponse…", null],
    ]);
    expect(tachesDe(conversation("x", { taches: "pas du json" }))).toEqual([]);
  });

  test("durée depuis le début du travail", () => {
    const maintenant = new Date("2026-11-04T12:00:00.000Z");
    expect(dureeDepuis("2026-11-04T11:59:40.000Z", maintenant)).toBe("à l’instant");
    expect(dureeDepuis("2026-11-04T11:48:00.000Z", maintenant)).toBe("12 min");
    expect(dureeDepuis("2026-11-04T10:55:00.000Z", maintenant)).toBe("1 h 05");
  });
});

describe("Conseil de contexte (E2-42)", () => {
  const mesure = (extra: Record<string, unknown> = {}) => JSON.stringify({ roleId: "hugo", jetons: 64_000, echanges: 52_000, le: "2026-11-04T12:00:00.000Z", masqueJusqua: 0, ...extra });
  const maintenant = Date.parse("2026-11-04T12:10:00.000Z");

  test("mêmes seuils que le bureau, jamais sans mesure ni pendant une réponse", () => {
    expect(conseilDuFil(conversation("dm-hugo", { contexte: mesure() }), { maintenant })).toMatchObject({ roleId: "hugo", jetons: 64_000, raison: "lourde", cacheExpire: false });
    expect(conseilDuFil(conversation("dm-hugo", { contexte: mesure({ echanges: 49_999 }) }), { maintenant })).toBeNull();
    expect(conseilDuFil(conversation("dm-hugo", { contexte: mesure() }), { maintenant, occupe: true })).toBeNull();
    expect(conseilDuFil(conversation("dm-hugo", { contexte: null }), { maintenant })).toBeNull();
    expect(conseilDuFil(conversation("dm-hugo", { contexte: "pas du json" }), { maintenant })).toBeNull();
  });

  test("reprise après une heure : un fil neuf là où il y en a, rien dans une conversation d'équipe", () => {
    const tard = Date.parse("2026-11-04T13:30:00.000Z");
    const pause = mesure({ echanges: 35_000 });
    expect(conseilDuFil(conversation("dm-hugo", { contexte: pause }), { maintenant: tard })).toMatchObject({ raison: "pause", filPossible: true });
    expect(conseilDuFil(conversation("c1", { contexte: pause }), { maintenant: tard })).toBeNull();
  });

  test("« Plus tard » masque jusqu'à 20 000 jetons de plus, sur ce téléphone ou depuis le bureau", () => {
    const c = conversation("dm-hugo", { contexte: mesure() });
    expect(conseilDuFil(c, { maintenant, masque: 84_000 })).toBeNull();
    expect(conseilDuFil(conversation("dm-hugo", { contexte: mesure({ masqueJusqua: 84_000 }) }), { maintenant })).toBeNull();
    expect(conseilDuFil(conversation("dm-hugo", { contexte: mesure({ jetons: 90_000 }) }), { maintenant, masque: 84_000 })).not.toBeNull();
  });

  test("la demande de résumé se reconnaît, un mot qui commence pareil non", () => {
    expect(estDemandeResume("/compact")).toBe(true);
    expect(estDemandeResume("/compact Garde les décisions")).toBe(true);
    expect(estDemandeResume("/compacter")).toBe(false);
  });
});

describe("En faire un fil (E2-41)", () => {
  const actifs = ["hugo", "iris", "principal"];
  test("l'auteur d'abord ; dans un fil, son agent ; dans une équipe, le choix des agents actifs", () => {
    expect(agentsPourFil({ auteurId: "iris", conversation: conversation("c1"), actifs })).toEqual(["iris"]);
    expect(agentsPourFil({ auteurId: null, conversation: conversation("dm-hugo"), actifs })).toEqual(["hugo"]);
    expect(agentsPourFil({ auteurId: null, conversation: conversation("c1", { roleIds: ["hugo", "iris", "ancien"] }), actifs })).toEqual(["hugo", "iris"]);
    expect(agentsPourFil({ auteurId: "ancien", conversation: conversation("c1"), actifs })).toEqual([]);
  });
});

describe("Fil (T-02)", () => {
  test("actions d'une réponse : copier et écouter sur le téléphone, le reste par la file ; rien sans texte ni en cours", () => {
    const actions = actionsReponse({ texte: "Voilà", enCours: false, parle: false });
    expect(actions.map((a) => [a.id, a.voie])).toEqual([
      ["repondre", "brouillon"],
      ["citer", "brouillon"],
      ["fil", "brouillon"],
      ["copier", "telephone"],
      ["ecouter", "telephone"],
      ["reessayer", "file"],
      ["brancher", "file"],
    ]);
    expect(actionsReponse({ texte: "Voilà", enCours: false, parle: true }).find((a) => a.id === "ecouter")?.libelle).toBe("Arrêter la lecture");
    expect(actionsReponse({ texte: "  ", enCours: false, parle: false })).toEqual([]);
    /* Une réponse inachevée : ni réessai ni branche, la lecture et la copie restent. */
    expect(actionsReponse({ texte: "Voilà", enCours: true, parle: false }).map((a) => a.id)).toEqual(["copier", "ecouter"]);
    /* Ton propre message : rien à réessayer, rien à quoi « répondre ». */
    expect(actionsReponse({ texte: "Voilà", enCours: false, parle: false, agent: false }).map((a) => a.id)).toEqual(["citer", "fil", "copier", "ecouter"]);
  });

  test("mentions : par prénom, rôle ou id, agents actifs seulement ; la mention en cours de frappe", () => {
    expect(mentionDans("Peux-tu @Hugo regarder ?", cartes)).toBe("hugo");
    expect(mentionDans("@design une maquette", cartes)).toBe("iris");
    expect(mentionDans("@Ancien tu es là ?", cartes)).toBeNull();
    expect(mentionDans("pas de mention", cartes)).toBeNull();
    expect(mentionEnCours("Salut @hu", 9)).toEqual({ debut: 6, requete: "hu" });
    expect(mentionEnCours("mail@exemple", 12)).toBeNull();
  });

  test("fils : un id au format du bureau ; le parent d'une copie d'avant se retrouve", () => {
    expect(nouvelIdFil()).toMatch(/^klyra-fil-[0-9a-f]{8}$/);
    expect(parentDe(conversation("klyra-fil-0000000a", { roleIds: ["hugo"] }))).toBe("dm-hugo");
    expect(parentDe(conversation("dm-hugo"))).toBeNull();
  });
});
