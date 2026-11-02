import { describe, expect, test } from "vitest";
import type { Chat, Fil, Message } from "@/types/domain";
import {
  apresReponse,
  auDebut,
  avecEtapes,
  colonneTicket,
  ERREUR_ARRET,
  ferme,
  FILTRES_PAR_DEFAUT,
  ligneTicket,
  lireEcheance,
  lireEtatOutil,
  lirePriorite,
  peutFermer,
  peutMettreAJour,
  poserEtape,
  rouvert,
  tableauTickets,
  trierTickets,
} from "./tickets";

const fil = (patch: Partial<Fil> = {}): Fil => ({ roleId: "dev", statut: "ouvert", creeLe: "2026-11-02T09:00:00.000Z", lancePar: null, ...patch });

const chat = (id: string, patch: Partial<Fil> = {}, autre: Partial<Chat> = {}): Chat & { fil: Fil } => ({
  id,
  kind: "direct",
  projectId: null,
  title: `Fil ${id}`,
  roleIds: ["dev"],
  updatedAt: "2026-11-02T09:00:00.000Z",
  sessions: {},
  luJusqua: null,
  ...autre,
  fil: fil(patch),
});

const message = (chatId: string, auteur: "user" | "role", statut?: Message["statut"]): Message => ({
  id: `${chatId}-${auteur}-${statut ?? "sans"}`,
  chatId,
  author: auteur === "user" ? { kind: "user" } : { kind: "role", roleId: "dev" },
  createdAt: "2026-11-02T09:01:00.000Z",
  parts: [{ type: "text", text: "…" }],
  ...(statut ? { statut } : {}),
});

describe("colonne d'un fil", () => {
  test("chaque combinaison d'étape, de travail et de statut", () => {
    expect(colonneTicket(fil(), false)).toBe("a-faire");
    for (const etape of ["a-faire", "en-cours", "bloque", "a-valider"] as const) {
      expect(colonneTicket(fil({ etape }), false)).toBe(etape);
      // Une réponse tourne : en cours, quelle que soit l'étape enregistrée.
      expect(colonneTicket(fil({ etape }), true)).toBe("en-cours");
      expect(colonneTicket(fil({ etape, statut: "archive" }), true)).toBe("termine");
      expect(colonneTicket(fil({ etape, statut: "archive", supprime: true }), false)).toBeNull();
    }
  });
});

describe("règles de passage", () => {
  test("1. une réponse commence : en cours, la raison s'efface", () => {
    expect(auDebut(fil({ etape: "bloque", raison: "attend l'accès", etapePosee: true }))).toMatchObject({ etape: "en-cours", raison: null, etapePosee: false });
  });

  test("2. une réponse finit : à valider, sauf étape posée exprès pendant la réponse", () => {
    expect(apresReponse(auDebut(fil({ etape: "a-faire" })), { ok: true })).toMatchObject({ etape: "a-valider", raison: null });
    const pose = poserEtape(auDebut(fil()), "bloque", "  attend   l'accès Figma ");
    expect(pose).toMatchObject({ etape: "bloque", raison: "attend l'accès Figma", etapePosee: true });
    expect(apresReponse(pose, { ok: true })).toMatchObject({ etape: "bloque", raison: "attend l'accès Figma" });
    // Posée « en cours » (l'agent attend une tâche de fond) : elle reste, même relue au démarrage.
    const enCours = apresReponse(poserEtape(auDebut(fil()), "en-cours"), { ok: true });
    expect(enCours.etape).toBe("en-cours");
    expect(avecEtapes([chat("a", enCours)], [])[0]!.fil!.etape).toBe("en-cours");
  });

  test("3. une réponse finit en erreur : bloqué, avec l'erreur", () => {
    expect(apresReponse(auDebut(fil()), { ok: false, erreur: "Quota dépassé" })).toMatchObject({ etape: "bloque", raison: "Erreur : Quota dépassé" });
    expect(apresReponse(auDebut(fil()), { ok: false })).toMatchObject({ raison: "Erreur : inconnue" });
    expect(apresReponse(auDebut(fil()), { ok: false, erreur: "x".repeat(500) }).raison!.length).toBe(200);
    // L'erreur l'emporte sur une étape posée.
    expect(apresReponse(poserEtape(fil(), "a-valider"), { ok: false, erreur: "panne" }).etape).toBe("bloque");
  });

  test("4. arrêtée : bloqué, « Arrêté »", () => {
    expect(apresReponse(auDebut(fil()), { ok: false, erreur: ERREUR_ARRET })).toMatchObject({ etape: "bloque", raison: "Arrêté" });
  });

  test("5. fermé, il ne bouge plus ; rouvert, il reprend à valider ou à faire", () => {
    const ferme = fil({ statut: "archive", etape: "a-valider" });
    expect(auDebut(ferme)).toBe(ferme);
    // Fermer un fil qui travaille l'arrête : la fin « Arrêté » ne doit pas le marquer bloqué.
    expect(apresReponse(ferme, { ok: false, erreur: ERREUR_ARRET })).toBe(ferme);
    expect(rouvert(fil({ statut: "archive", supprime: true, etape: "bloque", raison: "x" }), true)).toMatchObject({
      statut: "ouvert",
      supprime: false,
      etape: "a-valider",
      raison: null,
    });
    expect(rouvert(fil({ statut: "archive" }), false).etape).toBe("a-faire");
  });

  test("6. fils d'avant les tickets : étape donnée au chargement", () => {
    const chats = [chat("vide"), chat("repondu"), chat("en-route"), chat("ferme", { statut: "archive" }), chat("deja", { etape: "bloque", raison: "r" })];
    const messages = [message("vide", "user"), message("repondu", "user"), message("repondu", "role", "fait"), message("en-route", "role", "en-cours")];
    const suite = avecEtapes(chats, messages);
    expect(suite.map((c) => c.fil?.etape)).toEqual(["a-faire", "a-valider", "a-faire", undefined, "bloque"]);
    // Rien à changer : le même tableau, pas de réécriture.
    expect(avecEtapes(suite, messages)).toBe(suite);
    const pasUnFil = { ...chat("x"), fil: undefined };
    expect(avecEtapes([pasUnFil], [])[0]).toBe(pasUnFil);
  });

  test("une réponse interrompue par la fermeture de l'app : bloqué, sauf sur un VPS", () => {
    const [pc, vps] = avecEtapes([chat("pc", { etape: "en-cours" }), chat("vps", { etape: "en-cours" }, { lieu: "https://vps.example" })], []);
    expect(pc!.fil).toMatchObject({ etape: "bloque", raison: "Réponse interrompue : l’app s’est fermée" });
    expect(vps!.fil!.etape).toBe("en-cours");
  });
});

describe("droits des agents", () => {
  const deCorentin = fil({ roleId: "dev", lancePar: null });
  const deHugo = fil({ roleId: "designer", lancePar: { roleId: "dev", chatId: "dm-dev" } });

  test("mettre à jour : l'agent du fil ou celui qui l'a lancé", () => {
    expect(peutMettreAJour(deCorentin, "dev")).toBe(true);
    expect(peutMettreAJour(deCorentin, "designer")).toBe(false);
    expect(peutMettreAJour(deHugo, "designer")).toBe(true);
    expect(peutMettreAJour(deHugo, "dev")).toBe(true);
    expect(peutMettreAJour(deHugo, "growth")).toBe(false);
  });

  test("fermer : seulement celui qui l'a lancé ; un fil de la personne, c'est elle qui le valide", () => {
    expect(peutFermer(deCorentin, "dev")).toBe(false);
    expect(peutFermer(deHugo, "dev")).toBe(true);
    expect(peutFermer(deHugo, "designer")).toBe(false);
  });
});

describe("arguments des outils", () => {
  test("état", () => {
    expect(lireEtatOutil("bloque")).toBe("bloque");
    expect(lireEtatOutil("Bloqué")).toBe("bloque");
    expect(lireEtatOutil("à valider")).toBe("a-valider");
    expect(lireEtatOutil("en_cours")).toBe("en-cours");
    expect(() => lireEtatOutil("termine")).toThrow(/fermer_fil/);
    expect(() => lireEtatOutil("a-faire")).toThrow();
  });

  test("priorité et échéance", () => {
    expect(lirePriorite(undefined)).toBeUndefined();
    expect(lirePriorite(2)).toBe(2);
    expect(lirePriorite("3")).toBe(3);
    expect(() => lirePriorite(4)).toThrow();
    expect(() => lirePriorite(1.5)).toThrow();
    expect(lireEcheance("")).toBeUndefined();
    expect(lireEcheance("2026-11-05")).toBe("2026-11-05");
    expect(() => lireEcheance("2026-02-30")).toThrow();
    expect(() => lireEcheance("05/11/2026")).toThrow();
  });
});

describe("liste des tickets", () => {
  test("tri : bloqués, en cours, à valider, à faire ; puis priorité, échéance, création", () => {
    const fils = [
      chat("faire", { etape: "a-faire" }),
      chat("valider", { etape: "a-valider" }),
      chat("travaille", { etape: "a-valider" }),
      chat("bloque", { etape: "bloque" }),
      chat("valider-haute", { etape: "a-valider", priorite: 3 }),
      chat("valider-tot", { etape: "a-valider", echeance: "2026-11-03" }),
      chat("valider-vieux", { etape: "a-valider", creeLe: "2026-11-01T09:00:00.000Z" }),
    ];
    const ordre = trierTickets(fils, (id) => id === "travaille").map((c) => c.id);
    expect(ordre).toEqual(["bloque", "travaille", "valider-haute", "valider-tot", "valider-vieux", "valider", "faire"]);
  });

  test("ligne d'un ticket", () => {
    const c = chat("klyra-fil-1234abcd", { etape: "bloque", raison: "attend l'accès Figma", priorite: 2, echeance: "2026-11-05" }, { title: "Rapport hebdo" });
    expect(ligneTicket(c, { travaille: false, agent: "Hugo", projet: "Klyra.fr", lancePar: "Iris" })).toBe(
      "Rapport hebdo (klyra-fil-1234abcd) · Hugo · bloqué : attend l'accès Figma · priorité moyenne · échéance 2026-11-05 · projet Klyra.fr · lancé par Iris",
    );
    expect(ligneTicket(c, { travaille: true, agent: "Hugo" })).toBe("Rapport hebdo (klyra-fil-1234abcd) · Hugo · en cours · priorité moyenne · échéance 2026-11-05");
  });
});

describe("tableau", () => {
  const maintenant = new Date("2026-11-10T12:00:00.000Z");
  const fils = [
    chat("faire", { etape: "a-faire" }),
    chat("travaille", { etape: "a-valider" }),
    chat("bloque", { etape: "bloque", roleId: "designer", lancePar: { roleId: "dev", chatId: "dm-dev" } }),
    chat("valider", { etape: "a-valider", projetId: "klyra" }),
    chat("ferme-recent", { statut: "archive", fermeLe: "2026-11-09T08:00:00.000Z" }),
    chat("ferme-hier", { statut: "archive", fermeLe: "2026-11-09T20:00:00.000Z" }),
    chat("ferme-vieux", { statut: "archive", fermeLe: "2026-10-20T08:00:00.000Z" }),
    // Fermé avant les tickets : pas de fermeLe, sa dernière activité fait foi.
    chat("ferme-ancien", { statut: "archive" }, { updatedAt: "2026-11-08T08:00:00.000Z" }),
    chat("supprime", { statut: "archive", supprime: true, fermeLe: "2026-11-09T08:00:00.000Z" }),
  ];
  const travaille = (id: string) => id === "travaille";
  const ids = (t: ReturnType<typeof tableauTickets>) => Object.fromEntries(Object.entries(t.colonnes).map(([k, v]) => [k, v.map((c) => c.id)]));

  test("chaque fil dans sa colonne ; Terminé : les 7 derniers jours, du plus récent au plus ancien", () => {
    const t = tableauTickets([...fils, { ...chat("pas-un-fil"), fil: undefined }], travaille, FILTRES_PAR_DEFAUT, maintenant);
    expect(ids(t)).toEqual({
      "a-faire": ["faire"],
      "en-cours": ["travaille"],
      bloque: ["bloque"],
      "a-valider": ["valider"],
      termine: ["ferme-hier", "ferme-recent", "ferme-ancien"],
    });
    expect(t.termines).toBe(4);
    expect(tableauTickets(fils, travaille, FILTRES_PAR_DEFAUT, maintenant, true).colonnes.termine.map((c) => c.id)).toEqual([
      "ferme-hier",
      "ferme-recent",
      "ferme-ancien",
      "ferme-vieux",
    ]);
  });

  test("filtres : agent, projet, origine", () => {
    expect(ids(tableauTickets(fils, travaille, { ...FILTRES_PAR_DEFAUT, agent: "designer" }, maintenant)).bloque).toEqual(["bloque"]);
    expect(ids(tableauTickets(fils, travaille, { ...FILTRES_PAR_DEFAUT, agent: "designer" }, maintenant))["a-faire"]).toEqual([]);
    expect(ids(tableauTickets(fils, travaille, { ...FILTRES_PAR_DEFAUT, projet: "klyra" }, maintenant))["a-valider"]).toEqual(["valider"]);
    expect(tableauTickets(fils, travaille, { ...FILTRES_PAR_DEFAUT, origine: "agents" }, maintenant).colonnes.bloque.map((c) => c.id)).toEqual(["bloque"]);
    expect(tableauTickets(fils, travaille, { ...FILTRES_PAR_DEFAUT, origine: "moi" }, maintenant).colonnes.bloque).toEqual([]);
  });

  test("fermer date le fil ; rouvrir efface la date", () => {
    const f = ferme(fil({ etape: "a-valider" }), false, maintenant);
    expect(f).toMatchObject({ statut: "archive", supprime: false, fermeLe: "2026-11-10T12:00:00.000Z" });
    expect(rouvert(f, true).fermeLe).toBeNull();
  });
});
