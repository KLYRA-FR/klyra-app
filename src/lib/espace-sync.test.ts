import { describe, expect, it } from "vitest";
import type { Chat, Message, Project, Rendu } from "@/types/domain";
import { repartirAZero } from "./contexte";
import { changements, elementsDuServeur, fusionner, memoDe, paquets, type ElementEspace, type EtatEspace } from "./espace-sync";

const VPS = "https://vps";
const chat = (id: string, lieu: string | null, updatedAt = "2026-11-05T10:00:00Z"): Chat => ({ id, kind: "direct", projectId: null, title: id, roleIds: ["principal"], updatedAt, sessions: {}, luJusqua: null, ...(lieu ? { lieu } : {}) }) as Chat;
const message = (id: string, chatId: string): Message => ({ id, chatId, author: { kind: "user" }, createdAt: "2026-11-05T10:00:00Z", parts: [] }) as unknown as Message;
const vide = (patch: Partial<EtatEspace> = {}): EtatEspace => ({ chats: [], messages: [], projects: [], workflows: [], executions: [], rendus: [], ...patch });

describe("ce qui appartient à un serveur", () => {
  it("ne prend rien de ce PC ni d'un autre serveur", () => {
    const etat = vide({
      chats: [chat("a", VPS), chat("b", null), chat("c", "https://autre")],
      messages: [message("m1", "a"), message("m2", "b")],
      projects: [{ id: "p", lieu: VPS } as unknown as Project, { id: "q" } as unknown as Project],
      workflows: [{ id: "w", lieu: VPS } as never, { id: "x" } as never],
      executions: [{ id: "e1", workflowId: "w" } as never, { id: "e2", workflowId: "x" } as never],
      rendus: [{ id: "r1", origine: `${VPS}#/a` } as unknown as Rendu, { id: "r2", origine: "/chemin" } as unknown as Rendu],
    });
    const { elements } = elementsDuServeur(etat, VPS);
    expect(elements.map((e) => `${e.type}:${e.id}`).sort()).toEqual(["conversation:a", "execution:e1", "projet:p", "rendu:r1", "workflow:w"]);
    expect((elements.find((e) => e.id === "a")!.valeur as { messages: Message[] }).messages.map((m) => m.id)).toEqual(["m1"]);
  });
});

describe("ce qui part au serveur", () => {
  it("n'envoie que ce qui a changé, et dit ce qui a été retiré", () => {
    const a = vide({ chats: [chat("a", VPS), chat("b", VPS)] });
    const premier = changements(elementsDuServeur(a, VPS).elements, new Map());
    expect(premier.aEcrire.map((e) => e.id)).toEqual(["a", "b"]);
    const memo = premier.suivant;
    expect(changements(elementsDuServeur(a, VPS).elements, memo).aEcrire).toEqual([]);
    const c = vide({ chats: [chat("a", VPS, "2026-11-05T11:00:00Z")] });
    const suite = changements(elementsDuServeur(c, VPS).elements, memo);
    expect(suite.aEcrire.map((e) => e.id)).toEqual(["a"]);
    expect(suite.aRetirer).toEqual([{ type: "conversation", id: "b" }]);
  });

  it("une conversation où un agent écrit part sans sa réponse en cours, et n'envoie rien à chaque mot", () => {
    const enCours = (texte: string) => ({ ...message("r", "a"), statut: "en-cours", parts: [{ type: "text", text: texte }] }) as Message;
    const etat = (texte: string) => vide({ chats: [chat("a", VPS)], messages: [message("u", "a"), enCours(texte)] });
    const travaille = (id: string) => id === "a";
    const { elements } = elementsDuServeur(etat("Bon"), VPS, travaille);
    expect((elements[0].valeur as { messages: Message[] }).messages.map((m) => m.id)).toEqual(["u"]);
    const { aEcrire, suivant } = changements(elements, new Map());
    expect(aEcrire).toHaveLength(1);
    expect(changements(elementsDuServeur(etat("Bonjour"), VPS, travaille).elements, suivant).aEcrire).toEqual([]);
  });

  it("une exécution n'est envoyée que si le serveur ne la connaît pas : c'est lui qui les écrit", () => {
    const etat = (statut: string) => vide({ workflows: [{ id: "w", lieu: VPS } as never], executions: [{ id: "e", workflowId: "w", statut } as never] });
    const { aEcrire, suivant } = changements(elementsDuServeur(etat("en-cours"), VPS).elements, new Map());
    expect(aEcrire.map((e) => e.type).sort()).toEqual(["execution", "workflow"]);
    expect(changements(elementsDuServeur(etat("fait"), VPS).elements, suivant).aEcrire).toEqual([]);
  });

  it("le serveur fait foi sur une exécution qu'il a fait tourner", () => {
    const local = vide({ executions: [{ id: "e", workflowId: "w", statut: "en-cours" } as never] });
    const r = fusionner(local, { revision: 1, elements: [{ type: "execution", id: "e", valeur: { id: "e", workflowId: "w", statut: "fait" } }] }, VPS);
    expect((r.executions[0] as unknown as { statut: string }).statut).toBe("fait");
  });

  it("découpe un gros envoi", () => {
    const e = (id: string, n: number) => ({ type: "projet" as const, id, valeur: "x".repeat(n) });
    expect(paquets([e("a", 60), e("b", 60), e("c", 10)], 100).map((p) => p.map((x) => x.id))).toEqual([["a"], ["b", "c"]]);
  });
});

describe("ce qui revient du serveur", () => {
  it("le plus récent gagne, et ce qui n'est qu'ici reste pour être envoyé", () => {
    const local = vide({ chats: [chat("vieux", VPS, "2026-11-01T00:00:00Z"), chat("neuf", VPS, "2026-11-05T12:00:00Z"), chat("ici", VPS), chat("pc", null)], messages: [message("mv", "vieux"), message("mn", "neuf"), message("mp", "pc")] });
    const lu = {
      revision: 3,
      elements: [
        { type: "conversation" as const, id: "vieux", valeur: { chat: chat("vieux", VPS, "2026-11-04T00:00:00Z"), messages: [message("sv", "vieux")] } },
        { type: "conversation" as const, id: "neuf", valeur: { chat: chat("neuf", VPS, "2026-11-02T00:00:00Z"), messages: [message("sn", "neuf")] } },
        { type: "conversation" as const, id: "autre-appareil", valeur: { chat: chat("autre-appareil", null), messages: [message("sa", "autre-appareil")] } },
      ],
    };
    const r = fusionner(local, lu, VPS);
    expect(r.chats.map((c) => c.id).sort()).toEqual(["autre-appareil", "ici", "neuf", "pc", "vieux"]);
    expect(r.messages.map((m) => m.id).sort()).toEqual(["mn", "mp", "sa", "sv"]);
    expect(r.chats.find((c) => c.id === "autre-appareil")!.lieu).toBe(VPS);
    expect(r.chats.find((c) => c.id === "pc")!.lieu).toBeUndefined();
  });

  it("un élément retiré sur le serveur part ici aussi, sans toucher à un autre serveur ni à ce qui travaille", () => {
    const local = vide({ chats: [chat("parti", VPS), chat("pc", null), chat("occupe", VPS)], messages: [message("m", "parti")] });
    const r = fusionner(local, { revision: 2, elements: [], supprimes: { conversation: { parti: 1, pc: 1, occupe: 1 } } }, VPS, (id) => id === "occupe");
    expect(r.chats.map((c) => c.id).sort()).toEqual(["occupe", "pc"]);
    expect(r.messages).toEqual([]);
  });

  it("ne remplace pas une conversation où un agent écrit", () => {
    const local = vide({ chats: [chat("a", VPS, "2026-11-01T00:00:00Z")], messages: [message("m", "a")] });
    const r = fusionner(local, { revision: 2, elements: [{ type: "conversation", id: "a", valeur: { chat: chat("a", VPS, "2026-11-05T00:00:00Z"), messages: [] } }] }, VPS, () => true);
    expect(r.messages.map((m) => m.id)).toEqual(["m"]);
  });

  it("ce que rend le serveur sert de point de départ : rien à renvoyer", () => {
    const etat = vide({ chats: [chat("a", VPS)], messages: [message("m", "a")] });
    const { elements } = elementsDuServeur(etat, VPS);
    expect(changements(elements, memoDe(elements)).aEcrire).toEqual([]);
  });
});

/** Deux appareils et un serveur, avec le même enchaînement que useEspaceServeurs : lire, ranger, envoyer. */
function banc(serveurDepart: EtatEspace) {
  const serveur = new Map<string, ElementEspace>(elementsDuServeur(serveurDepart, VPS).elements.map((e) => [`${e.type}/${e.id}`, e]));
  let ecritures = 0;
  const appareil = (depart: EtatEspace) => {
    const a = { etat: depart, memo: undefined as Map<string, string> | undefined };
    const envoyer = () => {
      const { aEcrire, suivant } = changements(elementsDuServeur(a.etat, VPS).elements, a.memo!);
      for (const e of aEcrire) {
        serveur.set(`${e.type}/${e.id}`, e);
        ecritures++;
      }
      a.memo = suivant;
    };
    const lire = () => {
      const elements = [...serveur.values()].map((e) => JSON.parse(JSON.stringify(e)) as ElementEspace);
      a.etat = fusionner(a.etat, { revision: 1, elements }, VPS, () => false, a.memo);
      a.memo = memoDe(elements);
      envoyer();
    };
    return { get etat() { return a.etat; }, changer: (f: (e: EtatEspace) => EtatEspace) => { a.etat = f(a.etat); }, envoyer, lire, oublier: () => { a.memo = undefined; } };
  };
  return { appareil, ecritures: () => ecritures, chatDuServeur: (id: string) => (serveur.get(`conversation/${id}`)!.valeur as { chat: Chat }).chat, messagesDuServeur: (id: string) => (serveur.get(`conversation/${id}`)!.valeur as { messages: Message[] }).messages };
}

describe("deux appareils sur le même serveur", () => {
  const depart = () => vide({ chats: [{ ...chat("a", VPS), sessions: { principal: "ancienne" } }], messages: [message("m", "a")] });
  const tours = (...appareils: { lire: () => void }[]) => {
    for (let i = 0; i < 3; i++) for (const a of appareils) a.lire();
  };

  it("une remise à zéro arrive sur l'autre appareil et y reste", () => {
    const b = banc(depart());
    const [un, deux] = [b.appareil(depart()), b.appareil(depart())];
    tours(un, deux);
    un.changer((e) => ({ ...e, chats: e.chats.map((c) => repartirAZero(c, "2026-11-05T11:00:00Z")) }));
    un.envoyer();
    tours(deux, un);
    for (const a of [un, deux]) {
      expect(a.etat.chats[0].sessions).toEqual({});
      expect(a.etat.chats[0].departs).toEqual(["2026-11-05T11:00:00Z"]);
    }
    expect(b.chatDuServeur("a").sessions).toEqual({});
  });

  it("elle l'emporte aussi sur un appareil qui vient de s'ouvrir avec son ancienne copie", () => {
    const b = banc(depart());
    const [un, deux] = [b.appareil(depart()), b.appareil(depart())];
    tours(un);
    un.changer((e) => ({ ...e, chats: e.chats.map((c) => repartirAZero(c, "2026-11-05T11:00:00Z")) }));
    un.envoyer();
    tours(deux);
    expect(deux.etat.chats[0].sessions).toEqual({});
  });

  it("à date égale, deux copies différentes ne se réécrivent pas sans fin", () => {
    const b = banc(depart());
    const [un, deux] = [b.appareil(depart()), b.appareil(depart())];
    tours(un, deux);
    un.changer((e) => ({ ...e, chats: e.chats.map((c) => ({ ...c, luJusqua: "2026-11-05T10:30:00Z" })) }));
    un.envoyer();
    deux.lire();
    un.lire();
    const apres = b.ecritures();
    tours(un, deux);
    expect(b.ecritures()).toBe(apres);
    expect(deux.etat.chats[0].luJusqua).toBe("2026-11-05T10:30:00Z");
    expect(un.etat.chats[0].luJusqua).toBe("2026-11-05T10:30:00Z");
  });

  it("une copie changée ici et pas encore envoyée n'est jamais écrasée à date égale", () => {
    const b = banc(depart());
    const [un, deux] = [b.appareil(depart()), b.appareil(depart())];
    tours(un, deux);
    un.changer((e) => ({ ...e, chats: e.chats.map((c) => ({ ...c, title: "Écrit ici" })) }));
    deux.changer((e) => ({ ...e, chats: e.chats.map((c) => ({ ...c, luJusqua: "2026-11-05T10:30:00Z" })) }));
    deux.envoyer();
    un.lire();
    expect(b.chatDuServeur("a").title).toBe("Écrit ici");
    tours(deux, un);
    expect(deux.etat.chats[0].title).toBe("Écrit ici");
    expect(un.etat.chats[0].title).toBe("Écrit ici");
  });

  it("à la réouverture, ce qui n'a pas eu le temps de partir part : rien n'est perdu", () => {
    const b = banc(depart());
    const un = b.appareil(depart());
    tours(un);
    un.changer((e) => ({ ...e, messages: e.messages.map((m) => ({ ...m, statut: "fait" as const })) }));
    un.oublier();
    un.lire();
    expect(un.etat.messages[0].statut).toBe("fait");
    expect(b.messagesDuServeur("a")[0].statut).toBe("fait");
  });

  it("vaut aussi pour un projet ; sur une exécution, le serveur fait foi et l'app n'écrit plus", () => {
    const projet = { id: "p", lieu: VPS, updatedAt: "2026-11-05T10:00:00Z", name: "P" } as unknown as Project;
    const workflow = { id: "w", lieu: VPS, majLe: "2026-11-05T10:00:00Z" } as unknown as EtatEspace["workflows"][number];
    const execution = { id: "x", workflowId: "w", statut: "en-cours" } as unknown as EtatEspace["executions"][number];
    const etat = () => vide({ projects: [projet], workflows: [workflow], executions: [execution] });
    const b = banc(etat());
    const [un, deux] = [b.appareil(etat()), b.appareil(etat())];
    tours(un, deux);
    un.changer((e) => ({ ...e, projects: e.projects.map((p) => ({ ...p, name: "Renommé" })) }));
    un.envoyer();
    deux.changer((e) => ({ ...e, executions: e.executions.map((x) => ({ ...x, statut: "fait" }) as typeof x) }));
    const apres = b.ecritures();
    tours(deux, un);
    expect(deux.etat.projects[0].name).toBe("Renommé");
    expect((deux.etat.executions[0] as unknown as { statut: string }).statut).toBe("en-cours");
    expect(b.ecritures()).toBe(apres);
  });
});
