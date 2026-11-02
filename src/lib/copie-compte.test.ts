import { describe, expect, test } from "vitest";
import {
  activiteDe,
  changements,
  cheminPartage,
  conversationCompte,
  lireActivite,
  lireParties,
  messageCompte,
  partiesReduites,
  sansCheminNiSecret,
} from "./copie-compte";
import type { Chat, Message, Project } from "@/types/domain";

const DOSSIER = "/Users/corentin/Projets/klyra-fr";

const message = (parts: Message["parts"], extra: Partial<Message> = {}): Message => ({
  id: "m1",
  chatId: "dm-hugo",
  author: { kind: "role", roleId: "hugo" },
  createdAt: "2026-11-01T10:00:00.000Z",
  parts,
  ...extra,
});

const chat = (extra: Partial<Chat> = {}): Chat => ({
  id: "dm-hugo",
  kind: "direct",
  projectId: null,
  title: "Hugo",
  roleIds: ["hugo"],
  updatedAt: "2026-11-01T10:00:00.000Z",
  sessions: { hugo: "session-secrete" },
  luJusqua: null,
  ...extra,
});

describe("copie des conversations", () => {
  test("ni chemin absolu, ni session : les fichiers joints gardent leur seul nom", () => {
    const m = message([
      { type: "text", text: "Bonjour" },
      { type: "fichiers", chemins: ["/home/secret/cle.env"] },
      { type: "etapes", etapes: [{ id: "e", outil: "Read", libelle: "Lit /home/secret/notes.md", statut: "fait", parent: null, chemin: "/home/secret/notes.md" }] },
    ]);
    const copie = messageCompte(m);
    expect(copie.texte).toBe("Bonjour");
    expect(copie.parties).not.toContain("/home/secret");
    expect(copie.parties).not.toContain("session-secrete");
    expect(JSON.parse(partiesReduites(m.parts))).toEqual([
      { type: "text", text: "Bonjour" },
      { type: "fichiers", fichiers: [{ nom: "cle.env", chemin: null }] },
      { type: "etapes", n: 1, modifies: 0, erreurs: 0, enCours: null, fichiers: [{ nom: "notes.md", chemin: null, source: "lu" }] },
    ]);
  });

  test("un chemin du projet devient relatif ; ailleurs chez soi, ~ ; ailleurs encore, son seul nom", () => {
    expect(cheminPartage(`${DOSSIER}/src/app/page.tsx`, DOSSIER)).toBe("src/app/page.tsx");
    expect(cheminPartage("/Users/corentin/Documents/devis.pdf", DOSSIER)).toBe("~/Documents/devis.pdf");
    expect(cheminPartage("C:\\Users\\corentin\\Bureau\\a.txt", null)).toBe("~/Bureau/a.txt");
    expect(cheminPartage("/etc/hosts", DOSSIER)).toBe("…/hosts");
    expect(sansCheminNiSecret(`J'ai modifié ${DOSSIER}/src/app.tsx et /Users/corentin/.zshrc.`, DOSSIER)).toBe("J'ai modifié src/app.tsx et ~/.zshrc.");
    /* Les adresses web restent telles quelles. */
    expect(sansCheminNiSecret("Voir https://klyra.fr/Users/test/page", DOSSIER)).toBe("Voir https://klyra.fr/Users/test/page");
  });

  test("les clés et mots de passe sont masqués", () => {
    const texte = "Clé sk-ant-api03-abcdefghijklmnopqrstuvwxyz et ghp_abcdefghijklmnopqrstuvwxyz0123 puis password=SuperSecret123";
    const propre = sansCheminNiSecret(texte);
    expect(propre).not.toContain("abcdefghijklmnop");
    expect(propre).not.toContain("SuperSecret123");
    expect(propre).toContain("password=•••");
  });

  test("les parties gardent la forme du bureau : étapes repliées, accord, passation, proposition, actions", () => {
    const parties = lireParties(
      partiesReduites(
        [
          {
            type: "etapes",
            etapes: [
              { id: "1", outil: "Read", libelle: "Lit README.md", statut: "fait", parent: null, chemin: `${DOSSIER}/README.md` },
              { id: "2", outil: "Edit", libelle: "Modifie src/a.tsx", statut: "fait", parent: null, chemin: `${DOSSIER}/src/a.tsx` },
              { id: "3", outil: "Write", libelle: "Crée src/b.tsx", statut: "erreur", parent: null, chemin: `${DOSSIER}/src/b.tsx` },
              { id: "4", outil: "Bash", libelle: "Lance pnpm build", statut: "en-cours", parent: null },
              { id: "5", outil: "Read", libelle: "Lit c.md", statut: "fait", parent: "p1", chemin: `${DOSSIER}/c.md` },
            ],
          },
          { type: "autorisation", id: "a1", outil: "Bash", libelle: `Lance rm ${DOSSIER}/build`, detail: `rm -rf ${DOSSIER}/build`, description: "", statut: "attente" },
          { type: "passation", etapeId: "p1", roleId: "iris", consigne: "Concevoir la hero", statut: "en-cours" },
          { type: "proposition-agent", etapeId: "x", proposition: { id: "lea", nom: "Léa", role: "Juriste", description: "Relit les contrats", consignes: "très long" } },
          { type: "actions", actions: [{ id: "a", label: "Valider", primary: true }] },
        ],
        DOSSIER,
      ),
    );
    expect(parties[0]).toEqual({
      type: "etapes",
      n: 4,
      modifies: 2,
      erreurs: 1,
      enCours: "Lance pnpm build",
      fichiers: [
        { nom: "README.md", chemin: "README.md", source: "lu" },
        { nom: "a.tsx", chemin: "src/a.tsx", source: "modifie" },
        { nom: "c.md", chemin: "c.md", source: "lu" },
      ],
    });
    expect(parties[1]).toMatchObject({ type: "autorisation", libelle: "Lance rm build", detail: "rm -rf build", statut: "attente" });
    expect(parties[2]).toEqual({ type: "passation", roleId: "iris", statut: "en-cours", consigne: "Concevoir la hero", etapes: 1 });
    expect(parties[3]).toEqual({ type: "proposition-agent", etapeId: "x", nom: "Léa", role: "Juriste", description: "Relit les contrats" });
    expect(parties[4]).toEqual({ type: "actions", actions: [{ label: "Valider", primary: true }] });
  });

  test("trop long : sans les listes de fichiers, puis le texte seul", () => {
    const etapes = Array.from({ length: 60 }, (_, i) => ({ id: `${i}`, outil: "Read", libelle: "Lit", statut: "fait" as const, parent: null, chemin: `${DOSSIER}/${"x".repeat(150)}${i}.md` }));
    const long = lireParties(partiesReduites([{ type: "text", text: "a".repeat(7000) }, { type: "etapes", etapes }], DOSSIER));
    expect(long[1]).toMatchObject({ type: "etapes", n: 60 });
    expect((long[1] as { fichiers?: unknown }).fichiers).toBeUndefined();
    expect(lireParties("pas du json")).toEqual([]);
  });
});

describe("ce que fait l'agent", () => {
  const travail = { roleId: "hugo", messageId: "m1", debut: Date.parse("2026-11-01T10:00:00.000Z") };

  test("accord, réponse qui s'écrit, collègue, étape, réflexion", () => {
    const accord = activiteDe([message([{ type: "autorisation", id: "a1", outil: "Bash", libelle: "Lance pnpm build", detail: "pnpm build", description: "", statut: "attente" }])], travail, 0);
    expect(accord).toMatchObject({ etat: "accord", roleId: "hugo", messageId: "m1", accord: { id: "a1", libelle: "Lance pnpm build" } });
    expect(activiteDe([message([{ type: "text", text: "Je regarde" }])], travail, 0)?.etat).toBe("ecrit");
    expect(activiteDe([message([{ type: "passation", etapeId: "p", roleId: "iris", consigne: "", statut: "en-cours" }])], travail, 0)?.etat).toBe("collegue");
    expect(activiteDe([message([{ type: "etapes", etapes: [{ id: "1", outil: "Read", libelle: `Lit ${DOSSIER}/a.md`, statut: "en-cours", parent: null }] }])], travail, 0, DOSSIER)).toMatchObject({
      etat: "etape",
      libelle: "Lit a.md",
    });
    expect(activiteDe([message([], { statut: "en-cours" })], travail, 0)?.etat).toBe("reflechit");
  });

  test("« Attend ta réponse » : une réponse non lue qui finit sur une question", () => {
    const question = message([{ type: "text", text: "Je pars sur la version A ?" }], { statut: "fait" });
    expect(activiteDe([question], null, 1)).toMatchObject({ etat: "question", messageId: "m1" });
    expect(activiteDe([question], null, 0)).toBeNull();
    expect(activiteDe([message([{ type: "text", text: "C'est fait." }], { statut: "fait" })], null, 1)).toBeNull();
    expect(lireActivite(JSON.stringify(activiteDe([question], null, 1)))?.etat).toBe("question");
    expect(lireActivite("{")).toBeNull();
  });
});

describe("conversation copiée", () => {
  const projets: Project[] = [
    { id: "p1", name: "klyra.fr", subtitle: "", status: "en-cours", pinned: false, roleIds: [], brief: "", previewUrl: "", folder: DOSSIER, files: [], updatedAt: "" },
  ];

  test("un fil dit son agent parent et son archive ; un fil supprimé ne part pas", () => {
    const fil = chat({ id: "klyra-fil-1a2b3c4d", title: "Maquette", fil: { roleId: "hugo", statut: "archive", creeLe: "" } });
    expect(conversationCompte(fil, [], projets)).toMatchObject({ parent: "dm-hugo", archiveLe: "2026-11-01T10:00:00.000Z", activite: null });
    expect(conversationCompte({ ...fil, fil: { ...fil.fil!, supprime: true } }, [], projets)).toBeNull();
  });

  test("le lieu est l'origine https du VPS (null pour ce PC), le modèle part en court, l'extrait sans chemin", () => {
    const equipe = chat({ id: "c1", kind: "equipe", projectId: "p1", lieu: "https://vps.klyra.fr", modele: "sonnet", effort: "low" });
    const duFil = [message([{ type: "text", text: `Fichier ${DOSSIER}/src/a.tsx prêt` }], { chatId: "c1" })];
    const copie = conversationCompte(equipe, duFil, projets);
    expect(copie).toMatchObject({ lieu: "https://vps.klyra.fr", modele: '{"modele":"sonnet","effort":"low"}', projetNom: "klyra.fr", extrait: "Fichier src/a.tsx prêt" });
    expect(conversationCompte(chat(), [], projets)).toMatchObject({ lieu: null, modele: null });
    expect(JSON.stringify(copie)).not.toContain("session-secrete");
  });
});

describe("copie incrémentale", () => {
  test("seuls les éléments changés repartent", () => {
    const envoyes = new Map<string, string>();
    const premiers = changements([{ origine: "a", v: 1 }, { origine: "b", v: 1 }], (x) => x.origine, envoyes);
    expect(premiers.lot).toHaveLength(2);
    for (const [k, v] of premiers.empreintes) envoyes.set(k, v);
    const ensuite = changements([{ origine: "a", v: 1 }, { origine: "b", v: 2 }], (x) => x.origine, envoyes);
    expect(ensuite.lot).toEqual([{ origine: "b", v: 2 }]);
  });
});
