import { agregerUtilisation, sansEnTeteYaml } from "./gestes-agents";
import { describe, expect, test, vi } from "vitest";
import { getField, parseAgentFile } from "@/lib/agent-file";
import type { AgentLocal } from "@/lib/agents";
import { BridgeError } from "@/lib/bridge";
import { ErreurPoste } from "@/lib/poste/types";
import type { Role } from "@/types/domain";
import { gestesAgents, type DepsAgents, type FicheDisque } from "./gestes-agents";

const FICHE = `---
name: dev
displayName: Hugo
description: "Dev — le code. Appelle Hugo dès qu’il faut coder."
model: opus
memory: project
tools: Read, Grep
---

# Hugo — Dev

Je code.

## Comment je travaille

1. Je lis le projet.
`;

function role(id: string, name: string, content: string | null): Role {
  return {
    id,
    name,
    tag: "Dev",
    title: "",
    initial: name[0],
    teinte: "vert",
    description: "",
    whenToCall: "",
    skills: [],
    heading: "",
    pitch: "",
    sections: [],
    model: "opus",
    memory: "project",
    file: content === null ? null : { path: `/Users/corentin/.claude/agents/${id}.md`, content, modifiedAt: 1000 },
  };
}

function poste(options: { contenu?: string; empreinte?: string } = {}) {
  const disque: FicheDisque = {
    name: "dev",
    path: "/Users/corentin/.claude/agents/dev.md",
    content: options.contenu ?? FICHE,
    modifiedAt: 1000,
    empreinte: options.empreinte ?? "e1",
  };
  const local: AgentLocal = {
    role: role("dev", "Hugo", disque.content),
    statut: "actif",
    entree: { actif: true, ajouteLe: 0, origine: { type: "local" }, empreinte: null },
    modifie: false,
    manquantes: [],
  };
  const assistant = role("principal", "Léa", null);
  const agents = {
    roles: [assistant, local.role],
    tous: [local],
    mes: null,
    meta: {},
    canEdit: true,
    dir: "/Users/corentin/.claude/agents",
    save: vi.fn(async () => undefined),
    saveReglage: vi.fn(async () => undefined),
    preferer: vi.fn(async () => undefined),
    changerModele: vi.fn(async () => undefined),
    create: vi.fn(async () => undefined),
    activer: vi.fn(async () => undefined),
    ajouter: vi.fn(async () => undefined),
    nommerAssistant: vi.fn(async () => undefined),
    changerOrigine: vi.fn(async () => undefined),
    installer: vi.fn(async () => "dev"),
    identifiantLibre: (propose: string) => (propose === "dev" ? "dev-2" : propose),
    history: vi.fn(async () => []),
    readVersion: vi.fn(async () => FICHE.replace("Je code.", "Je codais.")),
  } satisfies DepsAgents["agents"];
  const lou = { blocage: async () => null, lancer: vi.fn(), annuler: vi.fn() };
  const deps: DepsAgents = {
    ton: "ton Mac",
    agents,
    fiches: async () => [disque],
    liens: async () => () => ({ type: "aucun" }),
    bibliotheque: { etat: "pret", moiId: "m1", lire: async () => null, publier: async () => "d1", mettreAJour: async () => 2, retirer: async () => undefined },
    modeles: [],
    arreter: vi.fn(),
    enCours: () => false,
    routinesDe: async () => 0,
    chiffres: () => ({ agents: 1, chats: 0, chatsAujourdhui: 0, projetsActifs: 0, projets: 0, tachesEnCours: 0, tachesFaites: 0 }),
    lou,
  };
  return { deps, agents, disque, lou, gestes: gestesAgents(deps) };
}

const edition = { id: "dev", empreinte: "e1", description: "Dev — le code et les tests.", corps: "# Hugo — Dev\n\nJe code et je teste.", modele: "sonnet", memoire: "project", tag: "Dev", teinte: "vert" };

async function refus(promesse: Promise<unknown>): Promise<ErreurPoste> {
  const erreur = await promesse.then(
    () => null,
    (e: unknown) => e,
  );
  expect(erreur).toBeInstanceOf(ErreurPoste);
  return erreur as ErreurPoste;
}

describe("gestes « agents » : la fiche n'est jamais écrasée", () => {
  test("une fiche changée sur l'ordinateur depuis sa lecture est refusée (empreinte)", async () => {
    const { agents, gestes } = poste({ empreinte: "e2" });
    const e = await refus(gestes["agents.enregistrer"](edition));
    expect(e.code).toBe("conflit");
    expect(e.message).toBe("La fiche a changé sur ton Mac depuis son ouverture");
    expect(agents.save).not.toHaveBeenCalled();
  });

  test("le refus du pont (fichier changé entre la relecture et l'écriture) devient le même conflit", async () => {
    const { agents, gestes } = poste();
    agents.save.mockRejectedValueOnce(new BridgeError("conflit", "La fiche a changé sur le disque."));
    const e = await refus(gestes["agents.enregistrer"](edition));
    expect(e.code).toBe("conflit");
    expect(e.message).toBe("La fiche a changé sur ton Mac depuis son ouverture");
  });

  test("une écriture passe la date de la version lue au pont, et ne touche que les champs de l'éditeur", async () => {
    const { agents, gestes } = poste();
    await expect(gestes["agents.enregistrer"](edition)).resolves.toEqual({ ok: true });
    expect(agents.save).toHaveBeenCalledTimes(1);
    const [id, contenu, reglage, modifiedAt] = agents.save.mock.calls[0] as unknown as [string, string, unknown, number];
    expect([id, modifiedAt, reglage]).toEqual(["dev", 1000, { tag: "Dev", teinte: "vert" }]);
    const { frontmatter, body } = parseAgentFile(contenu);
    expect(getField(frontmatter, "name")).toBe("dev");
    expect(getField(frontmatter, "tools")).toBe("Read, Grep");
    expect(getField(frontmatter, "model")).toBe("sonnet");
    expect(getField(frontmatter, "description")).toBe("Dev — le code et les tests.");
    expect(body).toContain("Je code et je teste.");
  });

  test("le téléphone ne choisit ni un modèle inconnu, ni l'assistant, ni un identifiant douteux", async () => {
    const { agents, gestes } = poste();
    expect((await refus(gestes["agents.enregistrer"]({ ...edition, modele: "gpt-5" }))).code).toBe("arguments");
    expect((await refus(gestes["agents.enregistrer"]({ ...edition, id: "principal" }))).code).toBe("arguments");
    expect((await refus(gestes["agents.enregistrer"]({ ...edition, id: "../dev" }))).code).toBe("arguments");
    expect((await refus(gestes["agents.fiche"]({ id: "../../etc/passwd" }))).code).toBe("arguments");
    expect(agents.save).not.toHaveBeenCalled();
  });

  test("restaurer une version : même refus si la fiche a changé", async () => {
    const { agents, gestes } = poste({ empreinte: "e2" });
    expect((await refus(gestes["agents.restaurer"]({ id: "dev", versionId: "1730000000000", empreinte: "e1" }))).code).toBe("conflit");
    expect(agents.save).not.toHaveBeenCalled();
    expect((await refus(gestes["agents.version"]({ id: "dev", versionId: "../../secret" }))).code).toBe("arguments");
  });

  test("la proposition de Lou ne s'applique pas sur une fiche changée pendant qu'elle travaillait", async () => {
    const { agents, gestes, disque, lou } = poste();
    lou.lancer.mockResolvedValue({ ok: true, text: `<resume>Ajoute les tests.</resume><fiche>${FICHE.replace("Je code.", "Je code et je teste.")}</fiche>` });
    const { tache } = (await gestes["agents.lou"]({ id: "dev", demande: "Ajoute les tests." })) as { tache: string };
    await vi.waitFor(async () => expect(((await gestes["agents.louEtat"]({ tache })) as { etat: string }).etat).toBe("proposition"));
    disque.empreinte = "e2";
    const e = await refus(gestes["agents.louAppliquer"]({ tache }));
    expect(e.code).toBe("conflit");
    expect(agents.save).not.toHaveBeenCalled();
    disque.empreinte = "e1";
    await expect(gestes["agents.louAppliquer"]({ tache })).resolves.toEqual({ ok: true });
    expect(agents.save).toHaveBeenCalledTimes(1);
  });

  test("Lou qui change l'identifiant de l'agent : la proposition est écartée", async () => {
    const { gestes, lou } = poste();
    lou.lancer.mockResolvedValue({ ok: true, text: `<fiche>${FICHE.replace("name: dev", "name: autre")}</fiche>` });
    const { tache } = (await gestes["agents.lou"]({ id: "dev", demande: "Renomme-le." })) as { tache: string };
    await vi.waitFor(async () => expect(((await gestes["agents.louEtat"]({ tache })) as { etat: string }).etat).toBe("erreur"));
  });

  test("comparer au modèle KLYRA : refusé sur une fiche changée, et seulement pour un modèle", async () => {
    const { gestes } = poste({ empreinte: "e2" });
    expect((await refus(gestes["agents.majModele"]({ id: "dev", action: "remplacer", empreinte: "e1" }))).code).toBe("conflit");
    const autre = poste();
    expect((await refus(autre.gestes["agents.majModele"]({ id: "dev", action: "remplacer", empreinte: "e1" }))).code).toBe("arguments");
  });
});

describe("gestes « agents » : Mes agents", () => {
  test("désactiver arrête sa réponse en cours ; l'assistant ne se désactive pas", async () => {
    const { deps, agents, gestes } = poste();
    await gestes["agents.activer"]({ id: "dev", actif: false });
    expect(deps.arreter).toHaveBeenCalledWith("dev");
    expect(agents.activer).toHaveBeenCalledWith("dev", false);
    expect((await refus(gestes["agents.activer"]({ id: "principal", actif: false }))).code).toBe("arguments");
  });

  test("masquer et épingler passent par les préférences du bureau ; l'assistant ne se masque pas", async () => {
    const { agents, gestes } = poste();
    await gestes["agents.preference"]({ id: "dev", masque: true });
    expect(agents.preferer).toHaveBeenCalledWith("dev", { masque: true });
    expect((await refus(gestes["agents.preference"]({ id: "principal", masque: true }))).code).toBe("arguments");
    expect(agents.preferer).toHaveBeenCalledTimes(1);
  });

  test("les souvenirs absents ne deviennent pas une liste vide", async () => {
    const { gestes } = poste();
    expect((await refus(gestes["agents.souvenirs"]({ id: "dev" }))).code).toBe("indisponible");
  });

  test("un souvenir hors de la liste lue est refusé", async () => {
    const { deps, gestes } = poste();
    deps.lectures = {
      souvenirs: async () => ({ coupee: false, souvenirs: [{ ref: "notes.md", titre: "Notes", extrait: "", toujours: true, modifieLe: 1 }] }),
      souvenir: vi.fn(async () => ({ titre: "Notes", contenu: "Texte", modifieLe: 1 })),
      competences: async () => [],
      utilisation: async () => [],
    };
    expect((await refus(gestes["agents.souvenir"]({ id: "dev", ref: "../secret.md" }))).code).toBe("arguments");
    expect((await refus(gestes["agents.souvenir"]({ id: "dev", ref: "autre.md" }))).code).toBe("introuvable");
    await expect(gestes["agents.souvenir"]({ id: "dev", ref: "notes.md" })).resolves.toMatchObject({ titre: "Notes", contenu: "Texte" });
  });

  test("le nom de l'assistant suit les règles du bureau", async () => {
    const { agents, gestes } = poste();
    expect((await refus(gestes["agents.personnaliser"]({ id: "principal", nom: "Hugo", teinte: "rose" }))).code).toBe("invalide");
    await gestes["agents.personnaliser"]({ id: "principal", nom: "Sam", teinte: "rose" });
    expect(agents.nommerAssistant).toHaveBeenCalledWith("Sam", "rose");
  });

  test("créer : un identifiant pris n'écrase rien", async () => {
    const { agents, gestes } = poste();
    const creation = { nom: "Juriste", id: "dev", tag: "Juridique", teinte: "ocre", description: "Juriste.", corps: "# Juriste", modele: "opus", memoire: "project" };
    expect((await refus(gestes["agents.creer"](creation))).message).toContain("« dev » existe déjà sur ton Mac");
    await expect(gestes["agents.creer"]({ ...creation, id: "juriste" })).resolves.toEqual({ id: "juriste" });
    const [, contenu] = agents.create.mock.calls[0] as unknown as [string, string];
    expect(getField(parseAgentFile(contenu).frontmatter, "name")).toBe("juriste");
  });
});

describe("souvenir lu au téléphone", () => {
  test("son en-tête YAML ne s'affiche pas, le reste est gardé", () => {
    expect(sansEnTeteYaml("---\nname: Arrondi\ndescription: x\n---\n\nLigne par **ligne**.\n")).toBe("Ligne par **ligne**.\n");
    expect(sansEnTeteYaml("Sans en-tête\n---\nsuite")).toBe("Sans en-tête\n---\nsuite");
  });
});

describe("journal d'un agent", () => {
  test("agrège par jour et par modèle, sans transformer un coût absent en zéro connu", () => {
    const at = new Date(2026, 10, 5, 12).getTime();
    const u = agregerUtilisation([
      { at, modele: "a", entree: 1, sortie: 2, cacheLu: 3, cacheEcrit: 4, coutUsd: 0.5 },
      { at: at + 1000, modele: "a", entree: 1, sortie: 0, cacheLu: 0, cacheEcrit: 0, coutUsd: null },
      { at, modele: "b", entree: 5, sortie: 0, cacheLu: 0, cacheEcrit: 0, coutUsd: 1 },
    ]);
    expect(u.jours).toHaveLength(2);
    const a = u.jours.find((l) => l.modele === "a")!;
    expect(a.appels).toBe(2);
    expect(a.entree).toBe(2);
    expect(a.coutUsd).toBe(0.5);
    expect(a.appelsSansCout).toBe(1);
  });
});
