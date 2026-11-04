import { describe, expect, it } from "vitest";
import type { MajAtelier, Message, MessagePart } from "@/types/domain";
import { getField, parseAgentFile } from "./agent-file";
import {
  appliquerAjouts,
  appliquerMaj,
  casEpreuve,
  piliersEnAlerte,
  refusAtelier,
  routineProposee,
  SUIVI_VIDE,
  suivreAtelier,
  BROUILLON_VIDE,
  brouillonEnCours,
  corpsFiche,
  descriptionFiche,
  ficheAgent,
  jetonsBrouillon,
  lireChoix,
  lireMajAtelier,
  manques,
  optionsRetenues,
  piliersNouveaux,
  piliersRemplis,
  plierAteliers,
  retourAtelier,
  sansEssaisEnCours,
  texteDuChoix,
} from "./atelier-agent";

const message = (id: string, parts: MessagePart[]): Message => ({
  id,
  chatId: "dm-principal",
  author: { kind: "role", roleId: "principal" },
  createdAt: "2026-11-03T21:00:00.000Z",
  parts,
});
const atelier = (etapeId: string, maj: MajAtelier, extra: { teinte?: "vert"; cree?: string } = {}): MessagePart => ({
  type: "atelier-agent",
  etapeId,
  maj,
  ...extra,
});

const NINA = appliquerMaj(BROUILLON_VIDE, {
  nom: "Nina",
  role: "Commercial",
  mission: "Rédige les propositions commerciales à partir d’un brief client, prêtes à relire.",
  declencheurs: ["Un brief client arrive", "Tu dis « devis »"],
  livrables: ["Une proposition en .docx"],
  limites: ["Envoyer au client : jamais sans ton accord."],
  verification: ["Chaque montant est recompté."],
});

describe("lire un appel de l'atelier", () => {
  it("garde seulement les champs donnés, nettoyés", () => {
    expect(lireMajAtelier({ nom: "  Nina  ", id: "Commercial Été!", declencheurs: ["  Un brief  ", "", 4] })).toEqual({
      nom: "Nina",
      id: "commercial-ete",
      declencheurs: ["Un brief"],
    });
  });

  it("une phrase seule compte comme une liste, au plus 10", () => {
    expect(lireMajAtelier({ limites: "Envoyer : jamais sans accord." })?.limites).toEqual(["Envoyer : jamais sans accord."]);
    expect(lireMajAtelier({ livrables: Array.from({ length: 14 }, (_, i) => `L${i}`) })?.livrables).toHaveLength(10);
  });

  it("rien d'utile : null ; un modèle inconnu est ignoré", () => {
    expect(lireMajAtelier({})).toBeNull();
    expect(lireMajAtelier({ modele: "gpt" })).toBeNull();
    expect(lireMajAtelier({ modele: "sonnet" })).toEqual({ modele: "sonnet" });
  });

  it("une carte neuve", () => {
    expect(lireMajAtelier({ nouveau: true })).toEqual({ nouveau: true });
  });
});

describe("plier les appels", () => {
  it("chaque champ remplace le précédent, nouveau repart de zéro", () => {
    const a = appliquerMaj(NINA, { livrables: ["Un résumé"] });
    expect(a.livrables).toEqual(["Un résumé"]);
    expect(a.nom).toBe("Nina");
    expect(appliquerMaj(NINA, { nouveau: true, nom: "Elio" })).toEqual({ ...BROUILLON_VIDE, nom: "Elio" });
  });

  it("le dernier appel d'une série montre la carte, avec la couleur choisie", () => {
    const etats = plierAteliers([
      message("m1", [atelier("e1", { nom: "Nina" })]),
      message("m2", [{ type: "text", text: "Quand l’appeler ?" }, atelier("e2", { mission: "Rédige.", role: "Commercial" }, { teinte: "vert" })]),
      message("m3", [atelier("e3", { declencheurs: ["Un brief arrive"] })]),
    ]);
    expect(etats.get("e1")?.dernier).toBe(false);
    expect(etats.get("e3")).toMatchObject({ serie: "e1", dernier: true, teinte: "vert", cree: null });
    expect(etats.get("e3")?.apres).toMatchObject({ nom: "Nina", role: "Commercial", declencheurs: ["Un brief arrive"] });
    expect(piliersNouveaux(etats.get("e2")!)).toEqual(["mission"]);
  });

  it("une carte neuve remplace la précédente, jamais créée", () => {
    const etats = plierAteliers([message("m1", [atelier("e1", { nom: "Nina" }), atelier("e2", { nouveau: true, nom: "Elio" })])]);
    expect(etats.get("e1")).toMatchObject({ dernier: true, courante: false, cree: null });
    expect(etats.get("e2")).toMatchObject({ dernier: true, courante: true });
  });

  it("après un agent créé, l'appel suivant ouvre une nouvelle carte", () => {
    const messages = [message("m1", [atelier("e1", { nom: "Nina", role: "Commercial", mission: "Rédige." }, { cree: "nina" })]), message("m2", [atelier("e2", { nom: "Elio" })])];
    const etats = plierAteliers(messages);
    expect(etats.get("e1")).toMatchObject({ dernier: true, cree: "nina" });
    expect(etats.get("e2")).toMatchObject({ serie: "e2", dernier: true, cree: null });
    expect(etats.get("e2")?.apres.role).toBe("");
    expect(brouillonEnCours(messages).nom).toBe("Elio");
    expect(brouillonEnCours(messages.slice(0, 1))).toEqual(BROUILLON_VIDE);
  });
});

describe("l'épreuve en cours, vue du bureau et du téléphone", () => {
  it("les essais qui tournent valent pour toute la série, et ne survivent pas à un redémarrage", () => {
    const messages = [
      message("m1", [{ type: "atelier-agent", etapeId: "e1", maj: { nom: "Zoé" }, essais: ["normal"] }]),
      message("m2", [{ type: "atelier-agent", etapeId: "e2", maj: { role: "Veille" }, essais: ["floue"] }]),
    ];
    const etats = plierAteliers(messages);
    expect(etats.get("e2")?.essais).toEqual(["normal", "floue"]);
    expect(etats.get("e1")?.essais).toEqual(["normal", "floue"]);
    const relu = sansEssaisEnCours(messages[0]);
    expect(JSON.parse(JSON.stringify(relu)).parts[0]).not.toHaveProperty("essais");
    expect(sansEssaisEnCours(messages[0]) === messages[0]).toBe(false);
    const sans = message("m3", [{ type: "text", text: "Bonjour" }]);
    expect(sansEssaisEnCours(sans)).toBe(sans);
  });
});

describe("les piliers", () => {
  it("cinq piliers, d'après les champs", () => {
    expect(piliersRemplis(BROUILLON_VIDE).size).toBe(0);
    expect([...piliersRemplis(NINA)].sort()).toEqual(["declencheurs", "limites", "livrables", "mission", "verification"]);
  });

  it("une fiche écrite d'un bloc : d'après ses sections", () => {
    const b = appliquerMaj(BROUILLON_VIDE, {
      description: "Juriste — relit les contrats.",
      consignes: "# Léa — Juridique\n\n## Quand m’appeler\n\n- Un contrat\n\n## Ce que je ne fais pas\n\n- Signer\n\n## Critères de sortie\n\n- Sources",
    });
    expect([...piliersRemplis(b)].sort()).toEqual(["declencheurs", "limites", "mission", "verification"]);
  });
});

describe("la fiche écrite", () => {
  it("composée avec les piliers, sans mémoire", () => {
    const corps = corpsFiche(NINA);
    expect(corps).toMatch(/^# Nina — Commercial\n\nRédige les propositions/);
    expect(corps).toContain("## Quand m’appeler\n\n- Un brief client arrive\n- Tu dis « devis »");
    expect(corps).toContain("## Ce que je ne fais pas\n\n- Envoyer au client : jamais sans ton accord.");
    const fiche = parseAgentFile(ficheAgent(NINA, "commercial"));
    expect(getField(fiche.frontmatter, "name")).toBe("commercial");
    expect(getField(fiche.frontmatter, "displayName")).toBe("Nina");
    expect(getField(fiche.frontmatter, "model")).toBe("opus");
    expect(getField(fiche.frontmatter, "memory")).toBeUndefined();
  });

  it("la description dit quand l'appeler", () => {
    expect(descriptionFiche(NINA)).toBe(
      "Commercial — Rédige les propositions commerciales à partir d’un brief client, prêtes à relire. Appelle Nina : un brief client arrive ; tu dis « devis ».",
    );
    expect(descriptionFiche({ ...NINA, description: "Écrite par l’assistant." })).toBe("Écrite par l’assistant.");
  });

  it("le corps écrit par l'assistant passe tel quel", () => {
    expect(corpsFiche({ ...NINA, consignes: "# Nina\n\nTout." })).toBe("# Nina\n\nTout.");
  });

  it("ce qui manque pour la créer, et le retour à l'assistant", () => {
    expect(manques(BROUILLON_VIDE)).toEqual(["un prénom", "un rôle court", "sa mission"]);
    expect(manques(NINA)).toEqual([]);
    expect(retourAtelier(appliquerMaj(BROUILLON_VIDE, { nom: "Nina" }))).toMatch(/0\/5 piliers.*il manque : un rôle court, sa mission/);
    expect(retourAtelier(NINA)).toMatch(/5\/5 piliers\. Fiche estimée à ~\d+ jetons.*la crée sur la carte/);
    expect(jetonsBrouillon(NINA)).toBeGreaterThan(50);
  });
});

describe("les réponses toutes prêtes", () => {
  it("2 à 6 options distinctes", () => {
    expect(lireChoix({ options: ["Nina", " nina ", "Romy"] })).toEqual({ question: "", options: ["Nina", "Romy"], multiple: false });
    expect(lireChoix({ options: ["Seule"] })).toBeNull();
    expect(lireChoix({ options: ["a", "b", "c", "d", "e", "f", "g"] })).toBeNull();
    expect(lireChoix({ question: "Quand ?", options: ["Lundi", "Mardi"], multiple: true })?.multiple).toBe(true);
  });

  it("la réponse envoyée, et les options qu'elle reprend", () => {
    const options = ["Envoyer au client", "Engager un prix", "Signer"];
    const envoye = texteDuChoix(["Envoyer au client", "Signer"]);
    expect(envoye).toBe("Envoyer au client · Signer");
    expect([...optionsRetenues(options, envoye)]).toEqual(["Envoyer au client", "Signer"]);
    expect(optionsRetenues(options, "Autre chose").size).toBe(0);
  });
});

describe("l'épreuve, les voisins et la routine (V2, V3)", () => {
  it("trois demandes complètes, sinon rien", () => {
    expect(lireMajAtelier({ epreuve: { normal: "Brief A", floue: "Fais un devis", horsMetier: "Corrige le bug" } })?.epreuve).toEqual({
      normal: "Brief A",
      floue: "Fais un devis",
      horsMetier: "Corrige le bug",
    });
    expect(lireMajAtelier({ epreuve: { normal: "Brief A", floue: "" } })).toBeNull();
    const b = appliquerMaj(NINA, { epreuve: { normal: "A", floue: "B", horsMetier: "C" } });
    expect(casEpreuve(b)?.map((c) => c.type)).toEqual(["normal", "floue", "hors-metier"]);
    expect(casEpreuve(NINA)).toBeNull();
  });

  it("les voisins : 3 au plus, avec une raison", () => {
    expect(lireMajAtelier({ voisins: [{ id: "Designer", raison: "Elle fait les maquettes." }, { id: "dev" }] })?.voisins).toEqual([
      { id: "designer", raison: "Elle fait les maquettes." },
    ]);
  });

  it("la routine proposée devient un brouillon d'Automatisations", () => {
    const routine = lireMajAtelier({ routine: { nom: "Relances", consigne: "Liste les propositions sans réponse.", quand: { type: "semaine", jour: 1, heure: "09:00" } } })?.routine;
    expect(routine).toEqual({ nom: "Relances", consigne: "Liste les propositions sans réponse.", quand: { type: "semaine", jour: 1, heure: "09:00" } });
    expect(lireMajAtelier({ routine: { nom: "X", consigne: "Y", quand: { type: "semaine", jour: 9 } } })).toBeNull();
    expect(lireMajAtelier({ routine: { nom: "X", consigne: "Y", quand: { type: "jour", heure: "25:00" } } })?.routine?.quand).toEqual({ type: "jour", heure: "09:00" });
    const b = appliquerMaj(NINA, { routine });
    expect(routineProposee(b, "nina", "Europe/Paris")).toEqual({
      agentId: "nina",
      name: "Relances",
      instruction: "Liste les propositions sans réponse.",
      schedule: { kind: "weekly", weekday: 1, time: "09:00" },
      timezone: "Europe/Paris",
      missedPolicy: "skip",
      active: true,
    });
    expect(routineProposee(NINA, "nina", "Europe/Paris")).toBeNull();
  });

  it("une phrase ajoutée par la personne reste, même si l'assistant réécrit le pilier", () => {
    const ajout = { pilier: "limites" as const, texte: "Le code : je passe la main à Hugo." };
    const etats = plierAteliers([
      message("m1", [{ type: "atelier-agent", etapeId: "e1", maj: { nom: "Nina", limites: ["Envoyer : jamais sans accord."] }, ajouts: [ajout] }]),
      message("m2", [atelier("e2", { limites: ["Signer : jamais."] })]),
    ]);
    expect(etats.get("e1")?.apres.limites).toEqual(["Envoyer : jamais sans accord.", "Le code : je passe la main à Hugo."]);
    expect(etats.get("e2")?.apres.limites).toEqual(["Signer : jamais.", "Le code : je passe la main à Hugo."]);
    expect(etats.get("e2")?.ajouts).toEqual([ajout]);
    expect(appliquerAjouts(appliquerAjouts(NINA, [ajout]), [ajout]).limites.filter((l) => l === ajout.texte)).toHaveLength(1);
    expect(retourAtelier(etats.get("e2")!.apres, [ajout])).toContain("La personne a ajouté à la fiche");
  });

  it("l'épreuve suit la carte, et l'étoile d'une correction pas encore ajoutée clignote", () => {
    const ko = {
      type: "hors-metier" as const,
      demande: "Corrige le bug",
      reponse: "Je corrige.",
      verdict: "ko" as const,
      raison: "Il fait le travail d’un autre.",
      correction: { pilier: "limites" as const, texte: "Le code : je passe la main." },
      jetons: 100,
      empreinte: "x",
    };
    const etats = plierAteliers([
      message("m1", [{ type: "atelier-agent", etapeId: "e1", maj: { nom: "Nina" }, resultats: [ko] }]),
      message("m2", [atelier("e2", { role: "Commercial" })]),
    ]);
    expect(etats.get("e2")?.resultats).toEqual([ko]);
    expect([...piliersEnAlerte([ko], [])]).toEqual(["limites"]);
    expect(piliersEnAlerte([ko], [{ pilier: "limites", texte: "le code : je passe la main." }]).size).toBe(0);
  });

  it("cinq piliers sans épreuve : l'assistant est invité à la proposer", () => {
    expect(retourAtelier(NINA)).toContain("trois demandes pour la mettre à l’épreuve");
    expect(retourAtelier(appliquerMaj(NINA, { epreuve: { normal: "A", floue: "B", horsMetier: "C" } }))).not.toContain("trois demandes");
  });
});

describe("le module commun au PC et au VPS (electron/atelier-agent.ts)", () => {
  it("ses petits outils restent ceux de l'écran", async () => {
    const commun = await import("../../electron/atelier-agent");
    const noms = await import("./noms-agents");
    const poids = await import("./poids-fiche");
    const { serializeAgentFile, setFields } = await import("./agent-file");
    for (const t of ["  Élodie  Moreau ", "Juriste immo", "Ça-va !", ""]) {
      expect(commun.comparable(t)).toBe(noms.comparable(t));
      expect(commun.identifiantDe(t)).toBe(noms.identifiantDe(t));
      expect(commun.nomPropre(t)).toBe(noms.nomPropre(t));
    }
    expect(commun.CARACTERES_PAR_JETON).toBe(poids.CARACTERES_PAR_JETON);
    expect(commun.SEUIL_FICHE_LONGUE).toBe(poids.SEUIL_FICHE_LONGUE);
    for (const b of [NINA, { ...NINA, nom: "Zoé \"la\" \\ grande", modele: "sonnet" as const, description: "Un \"guillemet\" \\ et\nune ligne" }]) {
      const attendu = serializeAgentFile({
        frontmatter: setFields({ entries: [] }, { name: "x", displayName: commun.nomPropre(b.nom) || undefined, description: commun.descriptionFiche(b).replace(/\s*\n\s*/g, " "), model: b.modele || "opus" }),
        body: commun.corpsFiche(b),
      });
      expect(commun.ficheAgent(b, "x")).toBe(attendu);
    }
  });

  it("les refus : identifiant, prénom ou rôle pris, voisin hors de l'équipe", () => {
    const equipe = [{ id: "principal", noms: ["Cicco", "Assistant"] }, { id: "commercial", noms: ["Nina", "Commercial"] }];
    expect(refusAtelier({ nom: "Elio" }, equipe)).toBeNull();
    expect(refusAtelier({ id: "commercial" }, equipe)).toMatch(/déjà dans Mes agents/);
    expect(refusAtelier({ nom: "nina" }, equipe)).toMatch(/s’appelle Nina/);
    expect(refusAtelier({ nom: "Cicco" }, equipe)).toMatch(/s’appelle Cicco/);
    expect(refusAtelier({ voisins: [{ id: "veille", raison: "x" }] }, equipe)).toMatch(/pas un de ses agents actifs/);
    expect(refusAtelier({ voisins: [{ id: "commercial", raison: "x" }] }, equipe)).toBeNull();
  });

  it("le suivi d'un serveur : les appels se plient, une carte créée ou neuve repart de zéro", () => {
    const equipe = [{ id: "principal", noms: ["Cicco"] }];
    let suivi = suivreAtelier(SUIVI_VIDE, { nom: "Nina", role: "Commercial" }, equipe);
    suivi = suivreAtelier(suivi, { mission: "Rédige." }, equipe);
    expect(suivi.brouillon).toMatchObject({ nom: "Nina", role: "Commercial", mission: "Rédige." });
    const ajoute = { ...suivi, ajouts: [{ pilier: "limites" as const, texte: "Le code : non." }] };
    expect(suivreAtelier(ajoute, { mission: "Autre." }, equipe).ajouts).toHaveLength(1);
    // Nina créée sur le PC, sa fiche arrivée sur le serveur : l'appel suivant ouvre une autre carte.
    const apres = suivreAtelier(ajoute, { nom: "Elio" }, [...equipe, { id: "nina", noms: ["Nina"] }]);
    expect(apres).toEqual({ brouillon: { ...BROUILLON_VIDE, nom: "Elio" }, ajouts: [] });
    expect(suivreAtelier(ajoute, { nouveau: true, nom: "Sol" }, equipe).brouillon.role).toBe("");
  });
});
