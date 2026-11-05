import { describe, expect, it } from "vitest";
import type { MajEquipe, Message, MessagePart } from "@/types/domain";
import { getField, parseAgentFile } from "./agent-file";
import { ficheAgent } from "./atelier-agent";
import {
  appelEquipe,
  appliquerMajEquipe,
  EQUIPE_VIDE,
  equipeEnCours,
  jetonsEquipe,
  lireMajEquipe,
  manquesEquipe,
  MAX_MEMBRES,
  membresGardes,
  membresNouveaux,
  plierEquipes,
  refusEquipe,
  retourEquipe,
  suivreEquipe,
} from "./atelier-equipe";

const message = (id: string, parts: MessagePart[]): Message => ({
  id,
  chatId: "dm-principal",
  author: { kind: "role", roleId: "principal" },
  createdAt: "2026-11-05T21:00:00.000Z",
  parts,
});
const appel = (etapeId: string, maj: MajEquipe, extra: Partial<Extract<MessagePart, { type: "atelier-equipe" }>> = {}): MessagePart => ({
  type: "atelier-equipe",
  etapeId,
  maj,
  ...extra,
});

const MAJ_STUDIO: MajEquipe = {
  nom: "Studio contenu",
  but: "Sortir la newsletter et les posts de la semaine sans y passer le week-end.",
  membres: [
    { nom: "Nina", role: "Rédaction", mission: "Écrit la newsletter et les posts à partir des notes de la semaine.", livrables: ["La newsletter en Markdown"] },
    { id: "leo", nom: "Léo", role: "Visuels" },
  ],
};
const EQUIPE = [
  { id: "principal", noms: ["Lou", "Assistant"] },
  { id: "hugo", noms: ["Hugo", "Dev"] },
];

describe("lire un appel de l'atelier d'équipe", () => {
  it("garde les membres lus comme dans l'atelier d'un agent, sans ce qui n'a pas sa place dans une équipe", () => {
    const maj = lireMajEquipe({
      nom: "  Studio  ",
      membres: [{ nom: " Nina ", livrables: "Une newsletter", epreuve: { normal: "a", floue: "b", horsMetier: "c" }, consignes: "# tout" }, { role: "sans nom ni id" }, 3],
    });
    expect(maj).toEqual({ nom: "Studio", membres: [{ nom: "Nina", livrables: ["Une newsletter"] }] });
  });

  it("existants et exemples : nettoyés ; rien d'utile : null", () => {
    expect(lireMajEquipe({ existants: [{ id: "Hugo", raison: "Garde le code." }, { id: "x" }], exemples: [{ demande: "Un post", membre: "nina" }, { demande: "" }] })).toEqual({
      existants: [{ id: "hugo", raison: "Garde le code." }],
      exemples: [{ demande: "Un post", membre: "nina" }],
    });
    expect(lireMajEquipe({})).toBeNull();
    expect(lireMajEquipe({ membres: [] })).toBeNull();
  });
});

describe("compléter la carte", () => {
  const studio = appliquerMajEquipe(EQUIPE_VIDE, MAJ_STUDIO);

  it("chaque membre reçoit une clé stable, tirée de son id ou de son prénom", () => {
    expect(studio.membres.map((m) => m.cle)).toEqual(["nina", "leo"]);
    expect(studio.membres[0].agent.id).toBe("nina");
  });

  it("un membre donné complète le sien (par id ou par prénom), les autres restent", () => {
    const suite = appliquerMajEquipe(studio, { membres: [{ nom: "nina", limites: ["Publier : jamais sans ton accord."] }, { id: "leo", mission: "Fait les visuels.", id2: 1 } as never] });
    expect(suite.membres).toHaveLength(2);
    expect(suite.membres[0].agent.mission).toContain("newsletter");
    expect(suite.membres[0].agent.limites).toEqual(["Publier : jamais sans ton accord."]);
    expect(suite.membres[1].agent.mission).toBe("Fait les visuels.");
  });

  it("un id différent ne renomme pas un membre retrouvé par son prénom ; retirer l'enlève ; nouveau repart de zéro", () => {
    const renomme = appliquerMajEquipe(studio, { membres: [{ nom: "Nina", role: "Plume" }] });
    expect(renomme.membres[0]).toMatchObject({ cle: "nina", agent: { id: "nina", role: "Plume" } });
    expect(appliquerMajEquipe(studio, { membres: [{ id: "leo", retirer: true }] }).membres.map((m) => m.cle)).toEqual(["nina"]);
    expect(appliquerMajEquipe(studio, { nouveau: true, nom: "Autre" })).toEqual({ ...EQUIPE_VIDE, nom: "Autre" });
  });

  it("le responsable d'un exemple donné par son prénom devient sa clé", () => {
    const b = appliquerMajEquipe(studio, { exemples: [{ demande: "La newsletter de mai", membre: "Nina" }, { demande: "Le site", membre: "hugo" }] });
    expect(b.exemples.map((e) => e.membre)).toEqual(["nina", "hugo"]);
  });

  it("la fiche d'un membre s'écrit comme celle de l'atelier d'un agent", () => {
    const fiche = parseAgentFile(ficheAgent(studio.membres[0].agent, "nina"));
    expect(getField(fiche.frontmatter, "displayName")).toBe("Nina");
    expect(fiche.body).toContain("## Ce que je livre");
    expect(jetonsEquipe(studio)).toBeGreaterThan(0);
  });

  it("ce qui manque pour naître, avec les membres choisis", () => {
    expect(manquesEquipe(studio, [])).toEqual(["au moins un agent gardé"]);
    expect(manquesEquipe(EQUIPE_VIDE, [])).toEqual(["au moins un agent"]);
    expect(manquesEquipe(studio, studio.membres)).toEqual(["sa mission à Léo"]);
    expect(manquesEquipe(studio, studio.membres.slice(0, 1))).toEqual([]);
  });
});

describe("refuser un appel", () => {
  const refus = (maj: MajEquipe, avant = EQUIPE_VIDE) => refusEquipe(maj, avant, appliquerMajEquipe(avant, maj), EQUIPE);

  it("un nouveau membre déjà dans Mes agents va dans existants", () => {
    expect(refus({ membres: [{ id: "hugo", nom: "Hugo" }] })).toMatch(/existants/);
    expect(refus({ membres: [{ id: "dev-2", nom: "Hugo" }] })).toMatch(/déjà un agent qui s’appelle Hugo/);
  });

  it("un membre déjà sur la carte reste accepté s'il a été créé entre-temps par sa propre carte", () => {
    const avant = appliquerMajEquipe(EQUIPE_VIDE, { membres: [{ id: "hugo-2", nom: "Max" }] });
    expect(refusEquipe({ membres: [{ id: "hugo-2", mission: "x" }] }, avant, appliquerMajEquipe(avant, { membres: [{ id: "hugo-2", mission: "x" }] }), [...EQUIPE, { id: "hugo-2", noms: ["Max"] }])).toBeNull();
  });

  it("deux prénoms identiques, trop de membres, un existant ou un responsable inconnus", () => {
    expect(refus({ membres: [{ id: "a", nom: "Zoé" }, { id: "b", nom: "zoe" }] })).toMatch(/Deux agents/);
    expect(refus({ membres: Array.from({ length: MAX_MEMBRES + 1 }, (_, i) => ({ id: `m${i}`, nom: `M${i}` })) })).toMatch(/au plus/);
    expect(refus({ existants: [{ id: "iris", raison: "x" }] })).toMatch(/iris/);
    expect(refus({ membres: [{ nom: "Nina" }], exemples: [{ demande: "x", membre: "personne" }] })).toMatch(/personne/);
    expect(refus({ membres: [{ nom: "Nina" }], existants: [{ id: "hugo", raison: "Le code." }], exemples: [{ demande: "x", membre: "nina" }, { demande: "y", membre: "hugo" }, { demande: "z", membre: "principal" }] })).toBeNull();
  });
});

describe("ce que l'outil répond", () => {
  it("l'état de chaque membre, le poids total, ce qui manque, sans dire l'équipe créée", () => {
    const texte = retourEquipe(appliquerMajEquipe(EQUIPE_VIDE, MAJ_STUDIO));
    expect(texte).toMatch(/Équipe « Studio contenu » à jour : 2 agents/);
    expect(texte).toMatch(/Nina \(nina, Rédaction\) [0-5]\/5/);
    expect(texte).toMatch(/Léo : sa mission/);
    expect(texte).toMatch(/exemples/);
    expect(texte).toMatch(/ne dis pas qu’elle est créée/);
  });

  it("appelEquipe : refus sans changer la carte, sinon la carte suivie", () => {
    const r = appelEquipe(MAJ_STUDIO as Record<string, unknown>, EQUIPE_VIDE, EQUIPE);
    expect(r.erreur).toBe(false);
    expect(r.suivi.membres).toHaveLength(2);
    const refus = appelEquipe({ membres: [{ id: "hugo", nom: "Hugo" }] }, r.suivi, EQUIPE);
    expect(refus.erreur).toBe(true);
    expect(refus.suivi).toBe(r.suivi);
    expect(appelEquipe({}, r.suivi, EQUIPE).erreur).toBe(true);
  });

  it("un serveur repart de zéro quand l'équipe est née sur le PC", () => {
    const suivi = appliquerMajEquipe(EQUIPE_VIDE, MAJ_STUDIO);
    const nee = [...EQUIPE, { id: "nina", noms: ["Nina", "Rédaction"] }];
    expect(suivreEquipe(suivi, { nom: "Suite" }, EQUIPE).membres).toHaveLength(2);
    expect(suivreEquipe(suivi, { nom: "Suite" }, nee)).toEqual({ ...EQUIPE_VIDE, nom: "Suite" });
    // Ses membres déjà créés ne sont plus « nouveaux » à refuser : la carte suivante peut les citer comme existants.
    expect(appelEquipe({ existants: [{ id: "nina", raison: "Écrit." }] }, suivi, nee).erreur).toBe(false);
  });
});

describe("plier les appels du fil", () => {
  it("la série se complète ; le dernier appel montre la carte ; les choix de la personne valent pour toute la série", () => {
    const messages = [
      message("m1", [appel("e1", { nom: "Studio", membres: [{ nom: "Nina" }] }, { teintes: { nina: "vert" } })]),
      message("m2", [appel("e2", { membres: [{ nom: "Léo" }] }, { ecartes: ["leo"] })]),
    ];
    const etats = plierEquipes(messages);
    expect(etats.get("e1")).toMatchObject({ dernier: false, serie: "e1", courante: true });
    const e2 = etats.get("e2")!;
    expect(e2).toMatchObject({ dernier: true, serie: "e1", teintes: { nina: "vert" }, ecartes: ["leo"] });
    expect(e2.apres.membres.map((m) => m.cle)).toEqual(["nina", "leo"]);
    expect(membresNouveaux(e2).map((m) => m.cle)).toEqual(["leo"]);
    expect(membresGardes(e2).map((m) => m.cle)).toEqual(["nina"]);
    expect(equipeEnCours(messages).nom).toBe("Studio");
  });

  it("après une équipe créée, ou avec nouveau, une autre série commence ; l'ancienne jamais créée n'est plus courante", () => {
    const creee = [message("m1", [appel("e1", { membres: [{ nom: "Nina" }] }, { crees: { nina: "nina" } })]), message("m2", [appel("e2", { membres: [{ nom: "Zoé" }] })])];
    const etats = plierEquipes(creee);
    expect(etats.get("e1")).toMatchObject({ dernier: true, courante: false, crees: { nina: "nina" } });
    expect(etats.get("e2")!.apres.membres.map((m) => m.cle)).toEqual(["zoe"]);
    expect(equipeEnCours(creee).membres.map((m) => m.cle)).toEqual(["zoe"]);
    expect(equipeEnCours(creee.slice(0, 1))).toEqual(EQUIPE_VIDE);

    const remplacee = plierEquipes([message("m1", [appel("e1", { nom: "A" })]), message("m2", [appel("e2", { nouveau: true, nom: "B" })])]);
    expect(remplacee.get("e1")).toMatchObject({ dernier: true, courante: false });
    expect(remplacee.get("e2")).toMatchObject({ dernier: true, courante: true, serie: "e2" });
  });
});
