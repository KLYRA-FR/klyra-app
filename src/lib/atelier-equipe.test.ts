import { describe, expect, it } from "vitest";
import type { MajEquipe, Message, MessagePart } from "@/types/domain";
import { getField, parseAgentFile } from "./agent-file";
import { ficheAgent } from "./atelier-agent";
import {
  agentDuMembre,
  appelEquipe,
  appliquerChoix,
  A_CONFIER,
  ELLE,
  etapeEquipe,
  fusionnerChoix,
  membreNe,
  pretAValider,
  texteGroupesValides,
  texteTachesValidees,
  appliquerMajEquipe,
  EQUIPE_VIDE,
  equipeAffichee,
  equipeEnCours,
  jetonsEquipe,
  lireMajEquipe,
  manquesEquipe,
  MAX_MEMBRES,
  membresGardes,
  membresNouveaux,
  membresTouches,
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

  it("l'atelier plein écran montre le dernier appel de la série courante, et les membres qu'il a touchés", () => {
    const messages = [
      message("m1", [appel("e1", MAJ_STUDIO)]),
      message("m2", [{ type: "text", text: "Je précise Léo." }, appel("e2", { membres: [{ id: "leo", mission: "Prépare les visuels de la semaine." }, { nom: "Inès", role: "Organisation" }] })]),
    ];
    const affichee = equipeAffichee(messages)!;
    expect(affichee).toMatchObject({ messageId: "m2", etapeId: "e2" });
    expect(affichee.etat.apres.membres.map((m) => m.cle)).toEqual(["nina", "leo", "ines"]);
    expect(membresTouches(affichee.etat)).toEqual(["leo", "ines"]);
    // Le premier appel a tout posé : tous ses membres sont touchés.
    expect(membresTouches(plierEquipes(messages).get("e1")!)).toEqual(["nina", "leo"]);
    // Une série remplacée par une autre plus bas : c'est la nouvelle qui s'affiche ; sans appel, rien.
    expect(equipeAffichee([...messages, message("m3", [appel("e3", { nouveau: true, nom: "B" })])])).toMatchObject({ messageId: "m3", etapeId: "e3" });
    expect(equipeAffichee([message("m0", [{ type: "text", text: "Bonjour" }])])).toBeNull();
  });
});

/* ─── Partir de ses tâches ─────────────────────────────────────────── */

const TACHES: MajEquipe = {
  nom: "Mon équipe",
  taches: [
    { texte: "Répondre aux mails des clients" },
    { id: "post", texte: "Écrire le post LinkedIn du lundi" },
    { id: "devis", texte: "Relancer les devis sans réponse", origine: "assistant", pourquoi: "Tu parles de prospects." },
    { id: "envoi", texte: "Envoyer les mails", pourElle: true },
  ],
};
const GROUPES: MajEquipe = {
  groupes: [
    { id: "textes", nom: "Les textes", pourquoi: "Même ton." },
    { id: "prospects", nom: "Prospects" },
  ],
  taches: [
    { id: "repondre-aux-mails-des-clients", groupe: "textes" },
    { id: "post", groupe: "textes" },
    { id: "devis", groupe: "prospects" },
  ],
};
const MEMBRES: MajEquipe = {
  membres: [
    {
      id: "redaction",
      groupe: "textes",
      prenoms: ["Léa", "Romy"],
      role: "Rédaction",
      mission: "Prépare tes textes en brouillons à relire.",
      limites: ["N’envoie jamais un mail lui-même"],
      methode: ["Tutoie, comme toi"],
      proposes: ["Tutoie, comme toi"],
    },
  ],
};

describe("l'équipe part de ses tâches", () => {
  it("trois temps : ses tâches, les groupes, puis un agent par groupe", () => {
    const t = appliquerMajEquipe(EQUIPE_VIDE, TACHES);
    expect(etapeEquipe(t)).toBe("taches");
    expect(t.taches.map((x) => x.id)).toEqual(["repondre-aux-mails-des-clients", "post", "devis", "envoi"]);
    expect(t.taches.find((x) => x.id === "devis")).toMatchObject({ origine: "assistant", pourquoi: "Tu parles de prospects.", gardee: false });
    expect(t.taches.find((x) => x.id === "envoi")).toMatchObject({ pourElle: true, groupe: "" });
    const g = appliquerMajEquipe(t, GROUPES);
    expect(etapeEquipe(g)).toBe("groupes");
    // Un appel qui range une tâche ne perd ni son texte ni son origine.
    expect(g.taches.find((x) => x.id === "devis")).toMatchObject({ texte: "Relancer les devis sans réponse", origine: "assistant", groupe: "prospects" });
    const e = appliquerMajEquipe(g, MEMBRES);
    expect(etapeEquipe(e)).toBe("equipe");
    expect(e.membres[0]).toMatchObject({ cle: "redaction", groupe: "textes", prenoms: ["Léa", "Romy"], proposes: ["Tutoie, comme toi"] });
    // Un groupe retiré : ses tâches ne sont plus rangées.
    expect(appliquerMajEquipe(g, { groupes: [{ id: "prospects", retirer: true }] }).taches.find((x) => x.id === "devis")?.groupe).toBe("");
  });

  it("la fiche : sans prénom imposé, sans les lignes proposées qu'elle n'a pas gardées, ses tâches pour « quand l'appeler »", () => {
    const e = [TACHES, GROUPES, MEMBRES].reduce(appliquerMajEquipe, EQUIPE_VIDE);
    const m = e.membres[0];
    expect(m.agent.nom).toBe("");
    const agent = agentDuMembre(e, m);
    expect(agent.methode).toEqual([]);
    expect(agent.limites).toEqual(["N’envoie jamais un mail lui-même"]);
    expect(agent.declencheurs).toEqual(["Répondre aux mails des clients", "Écrire le post LinkedIn du lundi"]);
    expect(manquesEquipe(e, e.membres)).toEqual(["un prénom à l’agent « Rédaction »"]);
    // Elle choisit son prénom et garde la ligne proposée : elles entrent dans la fiche.
    const choisi = appliquerChoix(e, { prenoms: { redaction: " Léa " }, lignes: { redaction: { "Tutoie, comme toi": true } } });
    expect(choisi.membres[0].agent.nom).toBe("Léa");
    expect(choisi.membres[0].proposes).toEqual([]);
    expect(agentDuMembre(choisi, choisi.membres[0]).methode).toEqual(["Tutoie, comme toi"]);
    expect(ficheAgent(agentDuMembre(choisi, choisi.membres[0]), "redaction")).toContain("Tutoie, comme toi");
    // Retirée : elle disparaît de la carte.
    const retiree = appliquerChoix(e, { lignes: { redaction: { "Tutoie, comme toi": false } } });
    expect(retiree.membres[0].agent.methode).toEqual([]);
  });

  it("ses choix : une proposition gardée ou retirée, une tâche déplacée ou gardée pour elle", () => {
    const g = [TACHES, GROUPES].reduce(appliquerMajEquipe, EQUIPE_VIDE);
    expect(pretAValider(g, "groupes")).toMatch(/propositions/);
    const garde = appliquerChoix(g, { taches: { devis: true }, places: { post: ELLE } });
    expect(garde.taches.find((t) => t.id === "devis")?.gardee).toBe(true);
    expect(garde.taches.find((t) => t.id === "post")).toMatchObject({ pourElle: true, groupe: "" });
    expect(pretAValider(garde, "groupes")).toBeNull();
    expect(appliquerChoix(appliquerChoix(g, { places: { post: ELLE } }), { places: { post: A_CONFIER } }).taches.find((t) => t.id === "post")?.pourElle).toBe(false);
    expect(appliquerChoix(g, { taches: { devis: false } }).taches.map((t) => t.id)).not.toContain("devis");
    // Un groupe inconnu ne déplace rien.
    expect(appliquerChoix(g, { places: { post: "inconnu" } }).taches.find((t) => t.id === "post")?.groupe).toBe("textes");
    expect(fusionnerChoix({ taches: { devis: true }, lignes: { a: { x: true } } }, { places: { post: ELLE }, lignes: { a: { y: false } } })).toEqual({
      taches: { devis: true },
      places: { post: ELLE },
      prenoms: {},
      lignes: { a: { x: true, y: false } },
    });
  });

  it("ce qu'elle valide part en message lisible ; une étape attend ses réponses", () => {
    const t = appliquerChoix(appliquerMajEquipe(EQUIPE_VIDE, TACHES), { taches: { devis: false } });
    expect(texteTachesValidees(t)).toBe("Mes tâches sont prêtes :\n- Répondre aux mails des clients\n- Écrire le post LinkedIn du lundi\n\nJe garde pour moi :\n- Envoyer les mails");
    expect(pretAValider(appliquerMajEquipe(EQUIPE_VIDE, TACHES), "taches")).toMatch(/propositions/);
    const g = appliquerChoix([TACHES, GROUPES].reduce(appliquerMajEquipe, EQUIPE_VIDE), { taches: { devis: true } });
    expect(texteGroupesValides(g)).toBe(
      "Mes groupes sont prêts, un agent par groupe :\n- Les textes : Répondre aux mails des clients ; Écrire le post LinkedIn du lundi\n- Prospects : Relancer les devis sans réponse\n\nJe garde pour moi : Envoyer les mails",
    );
    expect(pretAValider(appliquerMajEquipe(g, { taches: [{ texte: "Une nouvelle tâche" }] }), "groupes")).toMatch(/Range chaque tâche/);
  });

  it("l'outil guide chaque temps et refuse un groupe inconnu", () => {
    expect(retourEquipe(appliquerMajEquipe(EQUIPE_VIDE, TACHES))).toMatch(/devis « Relancer les devis sans réponse » \(ta proposition, en attente de sa réponse\).*Attends qu’elle valide ses tâches/);
    const g = [TACHES, GROUPES].reduce(appliquerMajEquipe, EQUIPE_VIDE);
    expect(retourEquipe(g)).toMatch(/Attends qu’elle valide les groupes/);
    const e = appliquerMajEquipe(g, MEMBRES);
    expect(retourEquipe(e)).toMatch(/sans prénom \(redaction, groupe textes, Rédaction\).*Groupes sans agent : prospects.*suggère-en dans prenoms/);
    expect(appelEquipe({ taches: [{ id: "x", texte: "X", groupe: "nulle-part" }] }, g, EQUIPE)).toMatchObject({ erreur: true });
    expect(appelEquipe({ membres: [{ id: "y", groupe: "nulle-part" }] }, g, EQUIPE).texte).toMatch(/n’existe pas/);
  });

  it("un membre sans prénom né sur le PC se reconnaît à son identifiant", () => {
    const e = [TACHES, GROUPES, MEMBRES].reduce(appliquerMajEquipe, EQUIPE_VIDE);
    expect(membreNe(e.membres[0], [{ id: "redaction", noms: ["Léa"] }])).toBe(true);
    expect(membreNe(e.membres[0], EQUIPE)).toBe(false);
  });

  it("le fil plié applique ses choix après l'appel, et l'appel suivant passe par-dessus", () => {
    const messages = [
      message("m1", [appel("e1", TACHES, { choix: { taches: { devis: false } } })]),
      message("m2", [appel("e2", { taches: [{ id: "devis", texte: "Relancer les devis", origine: "assistant" }] })]),
    ];
    const etats = plierEquipes(messages);
    expect(etats.get("e1")!.apres.taches.map((t) => t.id)).not.toContain("devis");
    expect(etats.get("e2")!.apres.taches.find((t) => t.id === "devis")?.texte).toBe("Relancer les devis");
  });
});

