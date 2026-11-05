// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { GRAPHE_VIDE } from "@/types/workflows";
import type { Routine, RoutineRun } from "@/types/routines";
import type { ListeArtefacts } from "./gestes-artefacts";
import type { RoutinesLues } from "./routines-telephone";
import type { WorkflowLu } from "./workflow-etapes";

/* Les écrans du lot 7 rendus en texte, avec un poste et des lectures simulés : ce qu'ils ne doivent jamais dire. */
const simule = vi.hoisted(() => ({
  lecture: { etat: "attente", lent: false } as Record<string, unknown>,
  ouvert: true,
  horsLigne: false,
  params: new URLSearchParams(),
  equipe: { etat: "pret", artefacts: [], message: null, reessayer: () => undefined } as Record<string, unknown>,
  pages: [] as unknown[] | undefined,
  lieu: null as string | null,
}));

vi.mock("convex/react", () => ({ useQuery: () => undefined, useMutation: () => vi.fn(), useConvex: () => ({}) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => simule.params,
  usePathname: () => "/routines",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/poste/client", () => ({
  useLecturePoste: () => ({ ...simule.lecture, relancer: () => undefined }),
  useGestePoste: () => ({ faire: vi.fn(), occupe: false }),
}));
vi.mock("@/lib/telephone/lecture-suivie", () => ({
  useLectureSuivie: () => ({ ...simule.lecture, relancer: () => undefined, relecture: false }),
  messageGeste: () => "",
}));
vi.mock("@/components/telephone/poste", () => {
  const poste = () => ({ cle: "poste-essai", systeme: "mac", nom: "MacBook", ouvert: simule.ouvert, dernierSignal: 0 });
  return {
    usePostes: () => ({ postes: [poste()], principal: poste(), ouvert: simule.ouvert, horsLigne: simule.horsLigne, charge: false }),
    useSupport: () => "ton Mac",
  };
});
vi.mock("@/components/telephone/push", () => ({ usePushTelephone: () => ({ etat: { etat: "indisponible" }, occupe: false, attendreOuverture: vi.fn() }) }));
vi.mock("@/lib/lieux", async (original) => ({ ...(await original<typeof import("@/lib/lieux")>()), useServeursRelies: () => [], useLieuActif: () => simule.lieu }));
vi.mock("@/lib/compte", () => ({ useCompte: () => ({ etat: "connecte", moi: { _id: "moi", email: "camille.essai@example.test" } }), messageErreur: () => "", codeErreur: () => null }));
vi.mock("@/lib/bibliotheque", () => ({ useAbonnement: () => ({ valeur: simule.pages === undefined ? undefined : { documents: simule.pages }, erreur: null }) }));
vi.mock("@/lib/artefacts-equipe", () => ({
  ArtefactsEquipeProvider: ({ children }: { children: ReactNode }) => children,
  useArtefactsEquipe: () => simule.equipe,
}));

const { AgentsRoutinesTelephone, RoutinesAgentTelephone } = await import("@/components/telephone/RoutinesTelephone");
const { WorkflowTelephone } = await import("@/components/telephone/WorkflowsTelephone");
const { ArtefactsTelephone } = await import("@/components/telephone/ArtefactsTelephone");

const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

const routine = (patch: Partial<Routine> = {}): Routine => ({
  id: "r1",
  agentId: "dev",
  name: "Relance des devis",
  instruction: "Relis les devis.",
  schedule: { kind: "daily", time: "09:00" },
  timezone: "UTC",
  active: true,
  nextRunAt: "2030-01-02T09:00:00Z",
  missedPolicy: "skip",
  projectId: null,
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-01T00:00:00Z",
  ...patch,
});
const run = (patch: Partial<RoutineRun>): RoutineRun => ({
  id: "x1",
  routineId: "r1",
  agentId: "dev",
  kind: "manual",
  scheduledFor: "2026-11-05T09:00:00Z",
  routineName: "Relance des devis",
  instruction: "Relis les devis.",
  projectId: null,
  status: "running",
  error: null,
  dispatchedAt: "2026-11-05T09:00:00Z",
  delivery: null,
  result: null,
  createdAt: "2026-11-05T09:00:00Z",
  startedAt: "2026-11-05T09:00:00Z",
  finishedAt: null,
  updatedAt: "2026-11-05T09:00:00Z",
  ...patch,
});
const lues = (patch: Partial<RoutinesLues> = {}): RoutinesLues => ({
  actif: true,
  erreur: null,
  agents: [{ id: "dev", name: "Léon", tag: "Dev", title: "Développeur", teinte: "jaune", actif: true, connu: true } as RoutinesLues["agents"][number]],
  routines: [routine()],
  enCours: [],
  fuseau: "UTC",
  lieu: null,
  serveurs: [],
  projets: [],
  ...patch,
});

beforeEach(() => {
  simule.lecture = { etat: "attente", lent: false };
  simule.ouvert = true;
  simule.horsLigne = false;
  simule.params = new URLSearchParams();
  simule.equipe = { etat: "pret", artefacts: [], message: null, reessayer: () => undefined };
  simule.pages = [];
  simule.lieu = null;
});

describe("Routines", () => {
  test("le serveur choisi au téléphone : seules ses routines, et ses exécutions", () => {
    simule.lieu = "https://vps.example.test";
    simule.lecture = { etat: "ok", data: lues({ routines: [routine(), routine({ id: "r2", lieu: "https://vps.example.test", name: "Routine du serveur" })], enCours: [run({ status: "running" })] }) };
    const t = texte(renderToStaticMarkup(<RoutinesAgentTelephone agentId="dev" routineId={null} formulaire={false} />));
    expect(t).toContain("Routine du serveur");
    expect(t).not.toContain("Relance des devis");
    const liste = texte(renderToStaticMarkup(<AgentsRoutinesTelephone onglets={null} routineDemandee={null} />));
    expect(liste).not.toContain("En cours");
  });

  test("sur un serveur, un geste qui irait à l'ordinateur reste inactif et dit pourquoi ; la lecture reste", () => {
    simule.lieu = "https://vps.example.test";
    simule.lecture = { etat: "ok", data: lues({ routines: [routine({ lieu: "https://vps.example.test" })], dernieres: { r1: { run: null } } }) };
    const html = renderToStaticMarkup(<RoutinesAgentTelephone agentId="dev" routineId={null} formulaire={false} />);
    expect(texte(html)).toContain("Depuis l’app de bureau, sur ce serveur.");
    expect(texte(html)).toContain("Relance des devis");
    expect(html).toMatch(/<button[^>]*disabled[^>]*>.*?Exécuter/);
    expect(html).toMatch(/<a[^>]*href="\/chat\?id=dm-dev(%40|@)vps\.example\.test"/);
  });

  test("E7-06 : moteur arrêté, l'erreur et Réessayer ; aucune liste vide en dessous", () => {
    simule.lecture = { etat: "ok", data: lues({ actif: false, erreur: null, routines: [] }) };
    const t = texte(renderToStaticMarkup(<AgentsRoutinesTelephone onglets={null} routineDemandee={null} />));
    expect(t).toContain("Les routines sont arrêtées");
    expect(t).toContain("Réessayer");
    expect(t).not.toContain("Mes agents");
  });

  test("E7-01 : En cours et Attend ton accord écrits en direct ; E7-03 : gardée, plus rien d'en cours", () => {
    const enCours = [run({ status: "running" })];
    simule.lecture = { etat: "ok", data: lues({ enCours }) };
    expect(texte(renderToStaticMarkup(<AgentsRoutinesTelephone onglets={null} routineDemandee={null} />))).toContain("En cours");
    simule.ouvert = false;
    simule.lecture = { etat: "ferme", gardee: { data: lues({ enCours }), lu: Date.now() } };
    const t = texte(renderToStaticMarkup(<AgentsRoutinesTelephone onglets={null} routineDemandee={null} />));
    expect(t).toContain("Vue à");
    expect(t).toContain("ton Mac est fermé");
    expect(t).not.toContain("En cours");
    expect(t).toContain("1 routine");
  });

  test("hors ligne, la vue gardée ne dit pas que l'ordinateur est fermé ; sans vue, « Hors ligne »", () => {
    simule.ouvert = false;
    simule.horsLigne = true;
    simule.lecture = { etat: "ferme", gardee: { data: lues(), lu: Date.now() } };
    const garde = texte(renderToStaticMarkup(<AgentsRoutinesTelephone onglets={null} routineDemandee={null} />));
    expect(garde).toContain("ce téléphone est hors ligne");
    expect(garde).not.toContain("est fermé");
    simule.lecture = { etat: "ferme", gardee: null };
    const sans = texte(renderToStaticMarkup(<AgentsRoutinesTelephone onglets={null} routineDemandee={null} />));
    expect(sans).toMatch(/hors ligne/i);
    expect(sans).not.toContain("est fermé");
  });

  test("E7-07 : un lancement dans la file n'est jamais dit terminé ; Exécuter attend, et dit pourquoi", () => {
    simule.lecture = { etat: "ok", data: lues({ enCours: [run({ status: "queued" })], dernieres: { r1: { run: null } } }) };
    const t = texte(renderToStaticMarkup(<RoutinesAgentTelephone agentId="dev" routineId={null} formulaire={false} />));
    expect(t).toContain("En attente");
    expect(t).toContain("Annuler le départ");
    expect(t).toContain("Une exécution attend ou travaille déjà");
    expect(t).not.toMatch(/Terminé|Réussie/);
  });

  test("E7-09 : l'accord se donne dans la conversation", () => {
    simule.lecture = { etat: "ok", data: lues({ enCours: [run({ status: "needs-attention", delivery: { chatId: "c1", messageId: null } })] }) };
    const t = texte(renderToStaticMarkup(<RoutinesAgentTelephone agentId="dev" routineId={null} formulaire={false} />));
    expect(t).toContain("Attend ton accord");
    expect(t).toContain("Répondre dans la conversation");
  });

  test("E7-12 : gardée, les gestes attendent avec leur raison ; un agent inconnu n'affiche jamais son identifiant", () => {
    simule.ouvert = false;
    simule.lecture = { etat: "ferme", gardee: { data: lues(), lu: Date.now() } };
    const html = renderToStaticMarkup(<RoutinesAgentTelephone agentId="dev" routineId={null} formulaire={false} />);
    expect(html).toContain("<fieldset disabled");
    expect(texte(html)).toContain("Exécuter, mettre en pause et modifier : possible quand ton Mac est ouvert.");
    simule.ouvert = true;
    simule.lecture = { etat: "ok", data: lues({ agents: [], routines: [routine({ agentId: "agent-inconnu" })] }) };
    const t = texte(renderToStaticMarkup(<RoutinesAgentTelephone agentId="agent-inconnu" routineId={null} formulaire={false} />));
    expect(t).toContain("Agent indisponible");
    expect(t).not.toContain("agent-inconnu");
  });

  test("E7-10 : aucune routine, trois exemples et Nouvelle routine", () => {
    simule.lecture = { etat: "ok", data: lues({ routines: [] }) };
    const t = texte(renderToStaticMarkup(<RoutinesAgentTelephone agentId="dev" routineId={null} formulaire={false} />));
    for (const exemple of ["Point de la semaine", "Revue des mails", "Contrôle de klyra.fr", "Nouvelle routine"]) expect(t).toContain(exemple);
  });
});

describe("Workflows", () => {
  const wf = (patch: Partial<WorkflowLu> = {}): WorkflowLu => ({
    id: "w1",
    titre: "De la maquette à la recette",
    majLe: "",
    noeuds: [
      { id: "d", type: "declencheur", at: { x: 0, y: 100 }, champs: { declencheur: "manuel" } },
      { id: "r", type: "ressource", at: { x: 0, y: 200 }, champs: { chemins: "/maison/camille/secret/devis.csv" } },
      { id: "a", type: "approbation", at: { x: 0, y: 300 }, champs: { question: "Ça te convient ?" } },
      { id: "s", type: "sortie", at: { x: 0, y: 400 }, champs: { cible: "fichier", chemin: "/maison/camille/secret/sortie.txt" } },
      { id: "g", type: "agent", at: { x: 0, y: 500 }, champs: { agent: "agent-parti", tache: "Code" } },
    ],
    liens: [
      { id: "1", de: "d", vers: "r" },
      { id: "2", de: "r", vers: "a" },
      { id: "3", de: "a", vers: "s" },
      { id: "4", de: "s", vers: "g" },
    ],
    prochaines: {},
    version: null,
    executions: [],
    plus: 0,
    vue: null,
    enCours: null,
    agents: [],
    ...patch,
  });

  test("E7-29 : les étapes se lisent ; ni chemin ni identifiant d'agent ; le dessin reste sur l'ordinateur", () => {
    simule.lecture = { etat: "ok", data: wf() };
    const t = texte(renderToStaticMarkup(<WorkflowTelephone id="w1" versionId={null} />));
    expect(t).toContain("devis.csv");
    expect(t).toContain("sortie.txt");
    expect(t).not.toContain("/maison");
    expect(t).not.toContain("agent-parti");
    expect(t).toContain("Agent indisponible");
    expect(t).toContain("Changer les étapes");
    expect(t).toContain("Lancer le workflow");
  });

  test("sur un serveur : Lancer inactif, avec sa raison", () => {
    simule.lieu = "https://vps.example.test";
    simule.lecture = { etat: "ok", data: wf() };
    const html = renderToStaticMarkup(<WorkflowTelephone id="w1" versionId={null} />);
    expect(texte(html)).toContain("Depuis l’app de bureau, sur ce serveur.");
  });

  test("E7-38 : une version se lit, ni Restaurer ni Lancer", () => {
    simule.lecture = { etat: "ok", data: wf({ version: { id: "v1", at: "2026-11-03T14:20:00Z", raison: "auto" } }) };
    const t = texte(renderToStaticMarkup(<WorkflowTelephone id="w1" versionId="v1" />));
    expect(t).toContain("Aperçu de la version");
    expect(t).toContain("Restaurer cette version : sur ton ordinateur.");
    expect(t).not.toContain("Rendre actuelle");
    expect(t).not.toContain("Lancer le workflow");
  });

  test("E7-30 : l'approbation attend ; gardée ou hors ligne, Approuver ne part pas et dit pourquoi", () => {
    const etapes = [{ id: "e-a", noeudId: "a", passe: 1, statut: "approbation" as const, sortie: "", branche: null, erreur: null, debut: "2026-11-05T09:00:00Z", fin: null }];
    const execution = { id: "x", numero: 12, source: "manuel" as const, statut: "approbation" as const, erreur: null, debut: "2026-11-05T09:00:00Z", fin: null, seule: false, chatId: null, faits: 3, arret: "Approbation", etapes };
    simule.lecture = { etat: "ok", data: wf({ executions: [execution], enCours: "x", vue: execution }) };
    const t = texte(renderToStaticMarkup(<WorkflowTelephone id="w1" versionId={null} />));
    expect(t).toContain("Attend ton accord");
    expect(t).toContain("exécution 12");
    expect(t).toContain("Approuver");
    expect(t).toContain("En cours…");

    simule.ouvert = false;
    simule.lecture = { etat: "ferme", gardee: { data: wf({ executions: [execution], enCours: "x", vue: execution }), lu: Date.now() } };
    const html = renderToStaticMarkup(<WorkflowTelephone id="w1" versionId={null} />);
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Approuver/);
    expect(texte(html)).toContain("Lancer et approuver : possible quand ton Mac est ouvert.");
  });

  test("sans étape : l'état le dit, Lancer attend ; supprimé ailleurs : retour à la liste", () => {
    simule.lecture = { etat: "ok", data: wf({ noeuds: [], liens: [] }) };
    const html = renderToStaticMarkup(<WorkflowTelephone id="w1" versionId={null} />);
    expect(texte(html)).toContain("Ce workflow n’a pas encore d’étape");
    expect(html).toMatch(/disabled/);
    simule.lecture = { etat: "erreur", code: "introuvable", message: "Ce workflow n’existe plus sur ton Mac." };
    const t = texte(renderToStaticMarkup(<WorkflowTelephone id="w1" versionId={null} />));
    expect(t).toContain("Revenir aux workflows");
    expect(t).not.toContain("Réessayer");
    expect(GRAPHE_VIDE.noeuds).toEqual([]);
  });
});

describe("Artefacts", () => {
  const liste: ListeArtefacts = {
    claude: true,
    rendusAilleurs: 0,
    projets: [{ id: "p1", nom: "Menuiserie Arlod" }],
    rendus: [{ id: "rd1", titre: "Maquettes de l’espace client", description: "", type: "page", agent: "Maëlle", projetId: "p1", projet: "Menuiserie Arlod", date: "2026-11-03T10:00:00Z", apercu: true }],
    artefacts: [{ id: "a1", titre: "Simulateur de devis", description: "Calcule un devis", url: "https://claude.ai/artifact/simulateur", projetId: "p1", projet: "Menuiserie Arlod", date: "2026-10-28T10:00:00Z" }],
  };

  test("E7-39 : deux sources séparées, un compte pour chacune ; le partage vient du compte", () => {
    simule.lecture = { etat: "ok", data: liste };
    simule.equipe = { ...simule.equipe, artefacts: [{ _id: "e1", url: "https://claude.ai/artifact/simulateur", titre: "Simulateur de devis", description: "", majLe: 1, auteur: { nom: "Sam Essai", couleur: "", actif: true }, deMoi: false }] };
    const t = texte(renderToStaticMarkup(<ArtefactsTelephone />));
    expect(t).toContain("Rendus des agents");
    expect(t).toContain("Artefacts claude.ai");
    expect(t).toContain("Partagé");
    expect(t).toContain("Mes artefacts 2");
    expect(t).toContain("Équipe 1");
  });

  test("le serveur choisi au téléphone : pas de liens claude.ai, ni dans Mes artefacts ni dans Équipe", () => {
    simule.lieu = "https://vps.example.test";
    simule.lecture = { etat: "ok", data: liste };
    simule.equipe = { ...simule.equipe, artefacts: [{ _id: "e1", url: "https://claude.ai/artifact/x", titre: "Lien de Sam", description: "", majLe: 1, auteur: { nom: "Sam Essai", couleur: "", actif: true }, deMoi: false }] };
    const miens = texte(renderToStaticMarkup(<ArtefactsTelephone />));
    expect(miens).toContain("Maquettes de l’espace client");
    expect(miens).not.toContain("Simulateur de devis");
    expect(miens).toContain("Équipe 0");
    simule.params = new URLSearchParams("onglet=equipe");
    expect(texte(renderToStaticMarkup(<ArtefactsTelephone />))).not.toContain("Lien de Sam");
  });

  test("un ordinateur d'avant ce contrat : la mise à jour demandée, pas un faux vide", () => {
    simule.lecture = { etat: "ok", data: { artefacts: [], projets: [] } };
    const t = texte(renderToStaticMarkup(<ArtefactsTelephone />));
    expect(t).toContain("Mets KLYRA à jour");
    expect(t).not.toContain("Rien pour l’instant");
  });

  test("E7-57 : ordinateur fermé sans vue, un seul état, pas de faux vide ni de faux compte ; Équipe reste comptée", () => {
    simule.ouvert = false;
    simule.lecture = { etat: "ferme", gardee: null };
    const t = texte(renderToStaticMarkup(<ArtefactsTelephone />));
    expect(t).toContain("ton Mac est fermé".replace("ton", "Ton"));
    expect(t).toContain("Voir l’onglet Équipe");
    expect(t).not.toContain("Rien pour l’instant");
    expect(t).toMatch(/Mes artefacts Équipe 0/);
  });

  test("E7-56 : gardée, les rendus attendent et les liens restent ; E7-58 : aucun ordinateur, la note de l'équipe", () => {
    simule.ouvert = false;
    simule.lecture = { etat: "ferme", gardee: { data: liste, lu: Date.now() } };
    const html = renderToStaticMarkup(<ArtefactsTelephone />);
    expect(html).toContain("<fieldset disabled");
    expect(texte(html)).toContain("Ouvrir un rendu, modifier, retirer : possible quand ton Mac est ouvert.");
    simule.lecture = { etat: "aucun" };
    const t = texte(renderToStaticMarkup(<ArtefactsTelephone />));
    expect(t).toContain("Aucun ordinateur relié");
    expect(t).toContain("même sans ordinateur");
    expect(t).not.toContain("est fermé");
  });

  test("Équipe : hors ligne n'est pas un vide ; vide seulement quand liens et pages sont lus ; une page partagée compte", () => {
    simule.params = new URLSearchParams("onglet=equipe");
    simule.lecture = { etat: "ok", data: liste };
    simule.equipe = { ...simule.equipe, etat: "hors-ligne" };
    const horsLigne = texte(renderToStaticMarkup(<ArtefactsTelephone />));
    expect(horsLigne).toContain("reviendront avec le réseau");
    expect(horsLigne).not.toContain("Rien de partagé");

    simule.equipe = { ...simule.equipe, etat: "pret", artefacts: [] };
    expect(texte(renderToStaticMarkup(<ArtefactsTelephone />))).toContain("Rien de partagé pour l’instant");

    simule.pages = undefined;
    expect(texte(renderToStaticMarkup(<ArtefactsTelephone />))).not.toContain("Rien de partagé");

    simule.pages = [{ _id: "d1", titre: "Page d’offres", description: "", majLe: 1, auteur: { nom: "Sam Essai" }, deMoi: false }];
    const avecPage = texte(renderToStaticMarkup(<ArtefactsTelephone />));
    expect(avecPage).toContain("Page d’offres");
    expect(avecPage).toContain("Partagé par Sam Essai");
    expect(avecPage).not.toContain("Rien de partagé");
  });

  test("E7-44 : l'aperçu est une image, jamais une page ; son absence se dit", () => {
    simule.params = new URLSearchParams("rendu=rd1");
    simule.lecture = { etat: "ok", data: { ...liste, image: null } };
    const t = texte(renderToStaticMarkup(<ArtefactsTelephone />));
    expect(t).toContain("Pas d’aperçu");
    simule.lecture = { etat: "ok", data: { ...liste, image: "http://localhost:3000/" } };
    const html = renderToStaticMarkup(<ArtefactsTelephone />);
    expect(html).not.toContain("localhost");
    expect(html).not.toContain("<iframe");
  });
});
