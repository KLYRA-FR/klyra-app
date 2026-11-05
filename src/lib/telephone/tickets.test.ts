import { describe, expect, test } from "vitest";
import { decisionDemande, notificationDeFin } from "@/lib/tickets-demandes";
import { ticketCompte, conversationCompte, CONTRAT_TICKETS } from "@/lib/copie-compte";
import type { Fil } from "@/types/domain";
import { confieA, demandeEnCours, derniereErreur, disponibilite, extraitBorne, libelleMoment, lireTicket, nombreAValider, tableauTelephone, texteAttente, texteResultat, ticketAttendu, type DemandeLue } from "./tickets";
import type { ConversationLue } from "./chats";

const ticket = (extra: Record<string, unknown> = {}) => JSON.stringify({ version: 1, poste: "p1", statut: "ouvert", etape: "a-faire", raison: null, priorite: 0, echeance: null, projetNom: null, rappel: null, lancePar: null, creeLe: "2026-11-01T10:00:00.000Z", fermeLe: null, aReponse: false, revision: 0, ...extra });
const conversation = (origine: string, extra: Partial<ConversationLue> = {}): ConversationLue =>
  ({ origine, kind: "direct", titre: origine, projetId: null, projetNom: null, roleIds: ["hugo"], misAJour: "2026-11-01T10:00:00.000Z", epingleLe: null, extrait: "", extraitLe: null, nonLus: 0, taches: "[]", lieu: null, parent: "dm-hugo", archiveLe: null, activite: null, modele: null, contexte: null, ticket: null, contratTickets: 1, ticketLu: null, ...extra }) as ConversationLue;
const demande = (extra: Partial<DemandeLue>): DemandeLue => ({ demandeId: "d-00000001", conversationOrigine: "klyra-fil-1", type: "fermer", valeur: "{}", etat: "en-attente", resultat: null, creeLe: 1, finiLe: null, ...extra });
const maintenant = new Date("2026-11-05T10:00:00.000Z");

describe("tableau des tickets", () => {
  test("les étapes et le tri du bureau : priorité, échéance, création ; une conversation sans ticket n'y est pas", () => {
    const { colonnes } = tableauTelephone(
      [
        conversation("dm-hugo"),
        conversation("a", { ticket: ticket({ etape: "a-valider", priorite: 0, creeLe: "2026-11-01T10:00:00.000Z" }) }),
        conversation("b", { ticket: ticket({ etape: "a-valider", priorite: 2, creeLe: "2026-11-02T10:00:00.000Z" }) }),
        conversation("c", { ticket: ticket({ etape: "bloque", raison: "Attend l’accès" }) }),
        conversation("d", { ticket: ticket({ statut: "archive", etape: "a-valider", fermeLe: "2026-11-04T10:00:00.000Z" }) }),
      ],
      { posteOuvert: true, maintenant },
    );
    expect(colonnes["a-valider"].map((l) => l.conversation.origine)).toEqual(["b", "a"]);
    expect(colonnes.bloque[0].ticket.raison).toBe("Attend l’accès");
    expect(colonnes.termine.map((l) => l.conversation.origine)).toEqual(["d"]);
  });

  test("les terminés de plus de 7 jours restent derrière « Tous les fils fermés »", () => {
    const vieux = conversation("v", { ticket: ticket({ statut: "archive", fermeLe: "2026-10-01T10:00:00.000Z" }) });
    expect(tableauTelephone([vieux], { posteOuvert: true, maintenant }).colonnes.termine).toHaveLength(0);
    expect(tableauTelephone([vieux], { posteOuvert: true, maintenant }).termines).toBe(1);
    expect(tableauTelephone([vieux], { posteOuvert: true, maintenant, tousTermines: true }).colonnes.termine).toHaveLength(1);
  });

  test("ordinateur fermé pendant le travail : l'état confirmé reste, jamais un Bloqué inventé (E4-16)", () => {
    const activite = JSON.stringify({ etat: "ecrit", roleId: "hugo", messageId: "m", depuis: "2026-11-05T09:00:00.000Z" });
    const c = conversation("e", { ticket: ticket({ etape: "en-cours" }), activite });
    expect(tableauTelephone([c], { posteOuvert: false, maintenant }).colonnes["en-cours"]).toHaveLength(1);
    expect(tableauTelephone([c], { posteOuvert: false, maintenant }).colonnes.bloque).toHaveLength(0);
    /* À valider confirmé, l'agent reprend : En cours sur un signe frais seulement. */
    const r = conversation("r", { ticket: ticket({ etape: "a-valider" }), activite });
    expect(tableauTelephone([r], { posteOuvert: true, maintenant }).colonnes["en-cours"]).toHaveLength(1);
    expect(tableauTelephone([r], { posteOuvert: false, maintenant }).colonnes["a-valider"]).toHaveLength(1);
  });

  test("un fil d'avant les tickets, sans étape : la reprise du bureau", () => {
    const avecReponse = conversation("x", { ticket: ticket({ etape: null, aReponse: true }) });
    const sansReponse = conversation("y", { ticket: ticket({ etape: null, aReponse: false }) });
    const { colonnes } = tableauTelephone([avecReponse, sansReponse], { posteOuvert: true, maintenant });
    expect(colonnes["a-valider"].map((l) => l.conversation.origine)).toEqual(["x"]);
    expect(colonnes["a-faire"].map((l) => l.conversation.origine)).toEqual(["y"]);
  });
});

describe("ce que l'écran peut conclure (règle 6)", () => {
  test("un poste ancien n'est pas zéro ticket", () => {
    expect(disponibilite(undefined)).toBe("chargement");
    expect(disponibilite([])).toBe("rien");
    expect(disponibilite([conversation("dm-hugo", { contratTickets: null })])).toBe("ancien");
    expect(disponibilite([conversation("dm-hugo")])).toBe("compatible");
    expect(nombreAValider([conversation("dm-hugo", { contratTickets: null })], true)).toBeNull();
    expect(nombreAValider([conversation("a", { ticket: ticket({ etape: "a-valider" }) })], true)).toBe(1);
  });
  test("une copie illisible n'est pas un ticket", () => {
    expect(lireTicket("pas du json")).toBeNull();
    expect(lireTicket('{"statut":"autre"}')).toBeNull();
  });
});

describe("demande et résultat (règle 2)", () => {
  test("une demande acceptée se dit en attente, jamais faite", () => {
    expect(texteAttente(demande({}), "ton Mac", false)).toBe("Fermeture demandée · attend ton Mac");
    expect(texteResultat(demande({ etat: "en-attente" }), "T")).toBeNull();
    expect(texteResultat(demande({ etat: "traitement" }), "T")).toBeNull();
  });
  test("l'accusé dit le vrai résultat : rappel coché, rappel à cocher, conflit, retrait", () => {
    expect(texteResultat(demande({ etat: "confirmee", resultat: '{"rappel":"coche"}' }), "T")?.texte).toContain("Le rappel d’origine est coché");
    expect(texteResultat(demande({ etat: "confirmee", resultat: '{"rappel":"inaccessible"}' }), "T")).toMatchObject({ erreur: true });
    expect(texteResultat(demande({ etat: "echouee", resultat: '{"code":"conflit"}' }), "T")?.texte).toContain("a changé entre-temps");
    expect(texteResultat(demande({ etat: "echouee", resultat: '{"code":"retrait"}' }), "T")?.texte).toContain("n’est plus sur l’ordinateur");
    expect(texteResultat(demande({ etat: "echouee", resultat: null }), "T")?.texte).not.toMatch(/Error|undefined/);
  });
  test("la demande en cours d'un fil, pas celles des autres ni les finies", () => {
    expect(demandeEnCours([demande({ etat: "confirmee" })], "klyra-fil-1")).toBeNull();
    expect(demandeEnCours([demande({ conversationOrigine: "autre" })], "klyra-fil-1")).toBeNull();
    expect(demandeEnCours([demande({})], "klyra-fil-1")?.type).toBe("fermer");
  });
});

describe("décision de l'ordinateur (règle 4)", () => {
  const fil: Fil = { roleId: "hugo", statut: "ouvert", creeLe: "2026-11-01T10:00:00.000Z", etape: "a-valider", revision: 3 };
  const ctx = { travaille: false, aReponse: true, maintenant };
  test("fermer, rouvrir, remettre à faire, priorité : les fonctions du bureau", () => {
    expect(decisionDemande(fil, { type: "fermer", valeur: {}, revision: 3 }, ctx)).toMatchObject({ fil: { statut: "archive", supprime: false } });
    expect(decisionDemande({ ...fil, statut: "archive" }, { type: "rouvrir", valeur: {}, revision: 3 }, ctx)).toMatchObject({ fil: { statut: "ouvert", etape: "a-valider" } });
    expect(decisionDemande({ ...fil, statut: "archive" }, { type: "rouvrir", valeur: {}, revision: 3 }, { ...ctx, aReponse: false })).toMatchObject({ fil: { etape: "a-faire" } });
    expect(decisionDemande(fil, { type: "etape", valeur: { etape: "a-faire" }, revision: 3 }, ctx)).toMatchObject({ fil: { etape: "a-faire", etapePosee: true } });
    expect(decisionDemande(fil, { type: "priorite", valeur: { priorite: 2 }, revision: 3 }, ctx)).toMatchObject({ fil: { priorite: 2 } });
  });
  test("conflit : autre révision, travail en cours, déjà fermé ; rien n'est appliqué", () => {
    expect(decisionDemande(fil, { type: "fermer", valeur: {}, revision: 2 }, ctx)).toEqual({ conflit: "conflit" });
    expect(decisionDemande(fil, { type: "fermer", valeur: {}, revision: 3 }, { ...ctx, travaille: true })).toEqual({ conflit: "conflit" });
    expect(decisionDemande({ ...fil, statut: "archive" }, { type: "fermer", valeur: {}, revision: 3 }, ctx)).toEqual({ conflit: "conflit" });
    expect(decisionDemande(fil, { type: "priorite", valeur: { priorite: 9 }, revision: 3 }, ctx)).toEqual({ conflit: "demande-invalide" });
  });
});

describe("à qui un rappel est confié", () => {
  const confier = (etat: DemandeLue["etat"]) => demande({ type: "confier", etat, conversationOrigine: "klyra-fil-2", valeur: JSON.stringify({ roleId: "leon", rappel: { source: "compte", id: "r1" } }) });
  test("un fil ouvert d'abord ; `poste` devient `local` au pont", () => {
    const c = conversation("f", { roleIds: ["leon"], ticket: ticket({ rappel: { source: "local", id: "t1" } }) });
    expect(confieA({ source: "poste", id: "t1" }, [c], [])).toEqual({ roleId: "leon", fil: "f", etat: "confie" });
    expect(confieA({ source: "compte", id: "t1" }, [c], [])).toBeNull();
  });
  test("la demande : en attente, puis confiée, ou à réessayer", () => {
    expect(confieA({ source: "compte", id: "r1" }, [], [confier("en-attente")])).toEqual({ roleId: "leon", fil: null, etat: "attente" });
    const fini = { ...confier("confirmee"), finiLe: 1000 };
    expect(confieA({ source: "compte", id: "r1" }, [], [fini], 2000)).toEqual({ roleId: "leon", fil: "klyra-fil-2", etat: "confie" });
    /* Longtemps après, sans copie : le fil a été retiré ; on peut confier à nouveau. */
    expect(confieA({ source: "compte", id: "r1" }, [], [fini], 1000 + 10 * 60 * 1000)).toBeNull();
    expect(confieA({ source: "compte", id: "r1" }, [], [confier("echouee")])).toEqual({ roleId: "leon", fil: null, etat: "a-reessayer" });
  });
  test("un fil fermé : fait, et on peut le dire ; il ne bloque pas une nouvelle demande en attente", () => {
    const c = conversation("klyra-fil-2", { roleIds: ["leon"], ticket: ticket({ statut: "archive", rappel: { source: "compte", id: "r1" } }) });
    expect(confieA({ source: "compte", id: "r1" }, [c], [{ ...confier("confirmee"), finiLe: 1000 }], 2000)).toEqual({ roleId: "leon", fil: "klyra-fil-2", etat: "fait" });
    expect(confieA({ source: "compte", id: "r1" }, [c], [confier("en-attente")], 2000)).toEqual({ roleId: "leon", fil: null, etat: "attente" });
  });
});

describe("textes du ticket", () => {
  test("un moment passé garde son heure", () => {
    const m = new Date(2026, 10, 5, 15, 0);
    expect(libelleMoment(new Date(2026, 10, 5, 13, 8).toISOString(), m)).toBe("13:08");
    expect(libelleMoment(new Date(2026, 10, 4, 18, 42).getTime(), m)).toBe("hier, 18:42");
    expect(libelleMoment(new Date(2026, 10, 2, 9, 5).getTime(), m)).toMatch(/^2 nov\.?, 09:05$/);
  });
  test("un extrait coupé se dit coupé", () => {
    expect(extraitBorne("**Fait.**")).toEqual({ texte: "Fait.", coupe: false });
    const long = extraitBorne("a".repeat(700));
    expect(long.coupe).toBe(true);
    expect(long.texte.endsWith("…")).toBe(true);
  });
  test("seule la dernière demande du fil compte pour l'erreur affichée", () => {
    const echec = demande({ etat: "echouee", resultat: '{"code":"conflit"}' });
    expect(derniereErreur([echec], "klyra-fil-1", "T")).toContain("a changé entre-temps");
    expect(derniereErreur([demande({ etat: "confirmee" }), echec], "klyra-fil-1", "T")).toBeNull();
    expect(derniereErreur([echec], "autre", "T")).toBeNull();
  });
  test("une demande Confier en route : la copie du fil arrive", () => {
    expect(ticketAttendu([demande({ type: "confier", conversationOrigine: "f", etat: "confirmee", finiLe: 1000 })], "f", 2000)).toBe(true);
    expect(ticketAttendu([demande({ type: "confier", conversationOrigine: "f", etat: "confirmee", finiLe: 1000 })], "f", 1000 + 10 * 60 * 1000)).toBe(false);
    expect(ticketAttendu([demande({ type: "confier", conversationOrigine: "f", etat: "en-attente" })], "f", 2000)).toBe(true);
    expect(ticketAttendu([demande({ type: "confier", conversationOrigine: "f", etat: "echouee" })], "f")).toBe(false);
  });
});

describe("notification d'un ticket à valider (E4-19)", () => {
  const fin = { ok: true, titre: "Léon a fini", corps: "Sa réponse t’attend.", lien: "/chat?id=f&message=m" };
  const fil: Fil = { roleId: "dev", statut: "ouvert", creeLe: "2026-11-01T10:00:00.000Z" };
  test("un fil qui passe à valider : son titre, et le toucher ouvre le ticket", () => {
    expect(notificationDeFin({ id: "f", title: "Arrondi", fil }, fin)).toEqual({ evenement: "agentFini", titre: "À valider : Arrondi", corps: "Léon a fini. Sa réponse t’attend.", lien: "/tickets?id=f" });
  });
  test("le reste ne change pas : conversation, erreur, étape posée exprès, fil fermé", () => {
    expect(notificationDeFin({ id: "c", title: "Léon" }, fin).lien).toBe(fin.lien);
    expect(notificationDeFin({ id: "f", title: "Arrondi", fil }, { ...fin, ok: false })).toMatchObject({ evenement: "agentErreur", lien: fin.lien });
    expect(notificationDeFin({ id: "f", title: "Arrondi", fil: { ...fil, etapePosee: true } }, fin).lien).toBe(fin.lien);
    expect(notificationDeFin({ id: "f", title: "Arrondi", fil: { ...fil, statut: "archive" } }, fin).lien).toBe(fin.lien);
  });
});

describe("copie d'un fil dans le compte (règle 1)", () => {
  const chat = { id: "klyra-fil-1", kind: "direct", projectId: null, title: "Arrondi", roleIds: ["dev"], updatedAt: "2026-11-02T10:00:00.000Z", fil: { roleId: "dev", statut: "ouvert", creeLe: "2026-11-01T10:00:00.000Z", etape: "bloque", raison: "Erreur dans /home/camille/projet/a.ts", priorite: 2, projetId: "arlod", rappel: { source: "local", id: "t1" }, revision: 4 } } as never;
  const projets = [{ id: "arlod", name: "Menuiserie Arlod", folder: "/home/camille/projet" }] as never;
  test("les champs du fil, sa révision, son poste et la présence d'une réponse, sans chemin", () => {
    const t = JSON.parse(ticketCompte(chat, [{ author: { kind: "role", roleId: "dev" }, statut: "fait" }] as never, projets, "poste-1")!);
    expect(t).toMatchObject({ version: CONTRAT_TICKETS, poste: "poste-1", statut: "ouvert", etape: "bloque", priorite: 2, projetNom: "Menuiserie Arlod", rappel: { source: "local", id: "t1" }, aReponse: true, revision: 4 });
    expect(t.raison).not.toContain("/home/camille");
  });
  test("une réponse encore en cours n'est pas une réponse ; un fil supprimé quitte la copie", () => {
    expect(JSON.parse(ticketCompte(chat, [{ author: { kind: "role", roleId: "dev" }, statut: "en-cours" }] as never, projets, null)!).aReponse).toBe(false);
    const supprime = { id: "x", fil: { supprime: true } } as never;
    expect(conversationCompte(supprime, [], [], null, null)).toBeNull();
  });
});
