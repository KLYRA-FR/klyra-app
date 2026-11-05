// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { FichierLu, NiveauDossier } from "./dossiers";

/* Les écrans T-10 à T-13 rendus en texte, avec un compte, un poste et des lectures simulés. */
const simule = vi.hoisted(() => ({
  requetes: {} as Record<string, unknown>,
  lecture: { etat: "attente", lent: false } as Record<string, unknown>,
  ouvert: true,
  params: new URLSearchParams(),
  lieu: null as string | null,
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => simule.requetes[getFunctionName(ref)],
  useMutation: () => vi.fn(),
  useConvex: () => ({}),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => simule.params,
  usePathname: () => "/projet",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/poste/client", () => ({
  useLecturePoste: () => ({ ...simule.lecture, relancer: () => undefined }),
  useGestePoste: () => ({ faire: vi.fn(), occupe: false }),
}));
vi.mock("@/components/telephone/poste", () => {
  const poste = () => ({ cle: "poste-essai", systeme: "mac", nom: "MacBook", ouvert: simule.ouvert, dernierSignal: 0 });
  return {
    usePostes: () => ({ postes: [poste()], principal: poste(), ouvert: simule.ouvert, charge: false }),
    useSupport: () => "ton Mac",
  };
});

vi.mock("@/lib/lieux", async (importer) => ({
  ...(await importer<typeof import("@/lib/lieux")>()),
  useLieuActif: () => simule.lieu,
}));

const { ProjetsTelephone, ProjetTelephone } = await import("@/components/telephone/EcransProjets");
const { DossierTelephone } = await import("@/components/telephone/DossierTelephone");
const { VisionneuseTelephone } = await import("@/components/telephone/VisionneuseTelephone");
const { PageModifierProjet } = await import("@/components/telephone/ModifierProjetTelephone");

const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

beforeEach(() => {
  simule.lieu = null;
  simule.ouvert = true;
  simule.params = new URLSearchParams();
  simule.lecture = { etat: "attente", lent: false };
  simule.requetes = {
    "conversationsCompte:projets": [
      { origine: "site", nom: "Site", accroche: "Refonte du site", statut: "en-revue", epingle: false, misAJour: null },
      { origine: "digital-os", nom: "DIGITAL-OS", accroche: "", statut: "en-cours", epingle: true, misAJour: null },
    ],
    "conversationsCompte:liste": [
      { origine: "c1", titre: "Hero", projetId: "site", roleIds: ["dev"], misAJour: "2026-11-01", epingleLe: null, extrait: "Fait." },
      { origine: "c2", titre: "Offres", projetId: "site", roleIds: ["principal"], misAJour: "2026-11-02", epingleLe: null, extrait: "" },
      { origine: "c3", titre: "Ailleurs", projetId: null, roleIds: [], misAJour: "2026-11-02", epingleLe: null, extrait: "" },
    ],
  };
});

describe("T-10 et T-11", () => {
  test("E6-01 : groupes Épinglés puis Projets, statut, chats ; Nouveau projet reste sur l'ordinateur", () => {
    const html = renderToStaticMarkup(<ProjetsTelephone />);
    const lu = texte(html);
    expect(lu).toContain("2 projets sur ton Mac");
    expect(lu.indexOf("Épinglés 1")).toBeLessThan(lu.indexOf("DIGITAL-OS"));
    expect(lu.indexOf("DIGITAL-OS")).toBeLessThan(lu.indexOf("Projets 1"));
    expect(lu).toContain("Site En revue Refonte du site 2 chats");
    expect(lu).toContain("DIGITAL-OS En cours Aucun chat");
    expect(lu).toContain("Actions pour Site");
    expect(lu).toContain("Nouveau projet Sur ton Mac Le dossier d’un projet se choisit sur l’ordinateur.");
    expect(html).toContain('href="/projet?id=site"');
  });

  test("E6-01 : la date de modification vient de la carte ; absente, rien n'est inventé", () => {
    const lu = new Date();
    lu.setHours(13, 8, 0, 0);
    simule.requetes["conversationsCompte:projets"] = [{ origine: "site", nom: "Site", accroche: "", statut: "livre", epingle: false, misAJour: lu.toISOString() }];
    expect(texte(renderToStaticMarkup(<ProjetsTelephone />))).toContain("2 chats · modifié à 13:08");
  });

  test("E6-01 : conversations pas encore lues, pas de faux zéro", () => {
    delete simule.requetes["conversationsCompte:liste"];
    const lu = texte(renderToStaticMarkup(<ProjetsTelephone />));
    expect(lu).toContain("Site En revue Refonte du site");
    expect(lu).not.toContain("Aucun chat");
  });

  test("E6-04 : le compte est lu et vide : où en créer un, sans bouton", () => {
    simule.requetes["conversationsCompte:projets"] = [];
    const html = renderToStaticMarkup(<ProjetsTelephone />);
    expect(texte(html)).toContain("Aucun projet pour l’instant Un projet se crée sur ton Mac : dans KLYRA, Projets › Nouveau projet, choisis son dossier.");
    expect(html).not.toContain("Nouveau projet Sur ton Mac");
  });

  test("E6-03 : compte pas encore lu : ni « aucun projet », ni demande à l'ordinateur", () => {
    delete simule.requetes["conversationsCompte:projets"];
    const lu = texte(renderToStaticMarkup(<ProjetsTelephone />));
    expect(lu).not.toContain("Aucun projet");
    expect(lu).not.toContain("Demande à");
  });

  test("E6-07 : aucun chat, l'entrée reste et l'état explique, sans second bouton", () => {
    simule.params = new URLSearchParams("id=digital-os");
    const html = renderToStaticMarkup(<ProjetTelephone />);
    expect(texte(html)).toContain("Chats 0");
    expect(texte(html)).toContain("Aucun chat dans ce projet Un chat ouvert ici donne à l’agent le dossier du projet.");
    expect(html.match(/nouveau=digital-os/g)).toHaveLength(1);
  });

  test("onglet Chats : les chats du projet et « Nouveau chat dans {nom}… »", () => {
    simule.params = new URLSearchParams("id=site");
    const html = renderToStaticMarkup(<ProjetTelephone />);
    const lu = texte(html);
    expect(lu).toContain("Chats 2 Fichiers Projet");
    expect(lu).toContain("Chats du projet 2");
    expect(lu.indexOf("Offres")).toBeLessThan(lu.indexOf("Hero"));
    expect(lu).not.toContain("Ailleurs");
    expect(lu).toContain("Nouveau chat dans Site…");
    /* C-5 : le fil prend l'id du projet dans `nouveau`. */
    expect(html).toContain('href="/chat?nouveau=site"');
  });

  test("onglet Fichiers, poste fermé : P-6", () => {
    simule.params = new URLSearchParams("id=site&onglet=fichiers");
    simule.ouvert = false;
    simule.lecture = { etat: "ferme", gardee: null };
    const lu = texte(renderToStaticMarkup(<ProjetTelephone />));
    expect(lu).toContain("Ton Mac est fermé Les fichiers de ce projet sont sur ton Mac. Ils s’affichent ici quand KLYRA y est ouverte.");
    /* E6-18 : les chats du projet restent à côté : pas de carte « Écrire à un agent » de plus. */
    expect(lu).not.toContain("Tu peux quand même écrire à un agent");
  });

  test("onglet Fichiers, aucun ordinateur relié : P-13, jamais « fermé » (C-1a)", () => {
    simule.params = new URLSearchParams("id=site&onglet=fichiers");
    simule.lecture = { etat: "aucun" };
    const lu = texte(renderToStaticMarkup(<ProjetTelephone />));
    expect(lu).toContain("Aucun ordinateur relié Les fichiers de ce projet sont sur ton ordinateur. Relie-le une fois à ton compte :");
    expect(lu).toContain("Va dans Réglages › Équipe.");
    expect(lu).not.toContain("est fermé");
  });

  test("onglet Fichiers, ordinateur fermé avec une vue gardée : la liste en lecture seule, datée (S-20)", () => {
    simule.params = new URLSearchParams("id=site&onglet=fichiers");
    simule.ouvert = false;
    const lu = new Date();
    lu.setHours(18, 42, 0, 0);
    simule.lecture = {
      etat: "ferme",
      gardee: { lu: lu.getTime(), data: { total: 1, elements: [{ nom: "devis.md", chemin: "devis.md", type: "fichier", modifie: false, contientModifies: false }] } },
    };
    const html = renderToStaticMarkup(<ProjetTelephone />);
    expect(texte(html)).toContain("Vue à 18:42 · ton Mac est fermé");
    expect(texte(html)).toContain("devis.md");
    expect(texte(html)).toContain("Les fichiers déjà ouverts sur ce téléphone restent lisibles. Relire : possible quand ton Mac est ouvert.");
    expect(texte(html)).not.toContain("Ton Mac est fermé Les fichiers");
  });
});

describe("T-12", () => {
  const niveau: NiveauDossier = {
    total: 1203,
    elements: [
      { nom: "CL-0001-ACCLARO", chemin: "30_CLIENTS/CL-0001-ACCLARO", type: "dossier", modifie: false, contientModifies: false },
      { nom: "CL-0002-AIR-CLOUD", chemin: "30_CLIENTS/CL-0002-AIR-CLOUD", type: "dossier", modifie: false, contientModifies: true },
      { nom: "index.csv", chemin: "30_CLIENTS/index.csv", type: "fichier", modifie: true, contientModifies: false },
    ],
  };

  test("le chemin en haut, les marques lues, la coupure dite", () => {
    simule.lecture = { etat: "ok", data: niveau };
    const html = renderToStaticMarkup(<DossierTelephone projetId="digital-os" nomProjet="DIGITAL-OS" chemin="30_CLIENTS" />);
    expect(html).toContain('href="/projet?id=digital-os&amp;onglet=fichiers"');
    expect(html).toMatch(/aria-current="page"[^>]*>30_CLIENTS</);
    expect(html).toContain('href="/projet?id=digital-os&amp;dossier=30_CLIENTS%2FCL-0002-AIR-CLOUD"');
    expect(html).toContain('href="/projet?id=digital-os&amp;fichier=30_CLIENTS%2Findex.csv"');
    /* Les marques sont écrites, plus de points de couleur à deviner. */
    expect(texte(html)).toContain("CL-0002-AIR-CLOUD Contient des fichiers modifiés");
    expect(texte(html)).toContain("index.csv Modifié par un agent");
    expect(texte(html)).toContain("Liste coupée : 1 200 autres éléments non affichés. Ouvre le dossier sur ton Mac pour tout voir.");
  });

  test("dossier vide, sans réponse, dossier disparu", () => {
    simule.lecture = { etat: "ok", data: { total: 0, elements: [] } };
    expect(texte(renderToStaticMarkup(<DossierTelephone projetId="p" nomProjet="P" chemin="a" />))).toContain("Dossier vide Ce que tes agents y écriront s’affichera ici.");
    simule.lecture = { etat: "delai" };
    expect(texte(renderToStaticMarkup(<DossierTelephone projetId="p" nomProjet="P" chemin="a" />))).toContain(
      "Ton Mac ne répond pas KLYRA y est ouverte, mais la réponse n’est pas venue. L’ordinateur est peut-être en veille. Réessayer",
    );
    simule.lecture = { etat: "erreur", code: "introuvable", message: "Ce dossier n’existe plus sur ton Mac." };
    expect(texte(renderToStaticMarkup(<DossierTelephone projetId="p" nomProjet="P" chemin="a" />))).toContain("Ce dossier n’existe plus sur ton Mac Il a pu être renommé ou déplacé depuis ta dernière visite. Revenir au projet");
  });
});

describe("T-13", () => {
  const lu = (contenu: FichierLu["contenu"], surPoste = true) => ({ etat: "ok", data: { contenu, surPoste } satisfies FichierLu });

  test("Markdown : Aperçu / Source, dossier, taille et lignes sous le titre, titres aux tailles du téléphone", () => {
    simule.lecture = lu({ type: "texte", texte: "# Tableau de bord\n\nVoir [la règle](FILING-RULES.md).", taille: 21_500 });
    const html = renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="DIGITAL-OS" chemin="00_CONTROL/DASHBOARD.md" ancre={null} retour={[]} />);
    const lu2 = texte(html);
    expect(lu2).toContain("00_CONTROL · 21 Ko · 3 lignes");
    expect(lu2).toContain("Aperçu");
    expect(lu2).toContain("Source");
    expect(html).toContain("Tableau de bord</h1>");
    expect(html).toContain("[&amp;_article_h1]:text-h4");
    expect(html).toContain('data-lien="fichier"');
  });

  test("source : lignes coupées par défaut, numéros à part", () => {
    simule.lecture = lu({ type: "texte", texte: "const a = 1;\nexport default a;", taille: 30 });
    const html = renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="D" chemin="src/a.ts" ancre={null} retour={[]} />);
    expect(html).toContain('data-ligne="2"');
    expect(html).toContain("whitespace-pre-wrap");
    expect(texte(html)).not.toContain("Aperçu");
  });

  test("E6-27 : trop lourd, la phrase du bureau et la limite", () => {
    simule.lecture = lu({ type: "autre", taille: 2_500_000, raison: "Fichier trop lourd pour l’aperçu." });
    const html = texte(renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="D" chemin="devis/export.csv" ancre={null} retour={[]} />));
    expect(html).toContain("Fichier trop lourd pour l’aperçu Au-delà de 1,5 Mo de texte (15 Mo pour une image), il ne passe pas par le téléphone. Ouvrir sur ton Mac");
  });

  test("E6-25 : arrivé par un lien : « Revenir à » et Aperçu / Source", () => {
    simule.lecture = lu({ type: "texte", texte: JSON.stringify({ nom: "x".repeat(220), a: 1 }), taille: 240 });
    const html = texte(renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="D" chemin="maquettes/palette.json" ancre={null} retour={["README.md"]} />));
    expect(html).toContain("Revenir à README.md");
    expect(html).toContain("Aperçu Source");
  });

  test("E6-30 : poste fermé, le fichier gardé se lit, daté ; aucun geste vers l'ordinateur n'est actif", () => {
    simule.ouvert = false;
    const heure = new Date();
    heure.setHours(18, 42, 0, 0);
    simule.lecture = { etat: "ferme", gardee: { lu: heure.getTime(), data: { contenu: { type: "texte", texte: "# Notes", taille: 7 }, surPoste: true } } };
    const html = renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="D" chemin="notes.md" ancre={null} retour={[]} />);
    expect(texte(html)).toContain("Vue à 18:42 · ton Mac est fermé");
    expect(html).toContain("Notes</h1>");
  });

  test("E6-31 : poste fermé sans vue gardée : ce qui manque, sans carte de plus", () => {
    simule.ouvert = false;
    simule.lecture = { etat: "ferme", gardee: null };
    const lu2 = texte(renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="D" chemin="detail.png" ancre={null} retour={[]} />));
    expect(lu2).toContain("Ton Mac est fermé Ce fichier est sur ton Mac. Il s’affiche ici quand KLYRA y est ouverte.");
    expect(lu2).not.toContain("Tu peux quand même écrire");
  });

  test("pas d'aperçu : la phrase du bureau et « Ouvrir sur ton Mac » ; un programme reste sur l'ordinateur", () => {
    simule.lecture = lu({ type: "autre", taille: 2_000_000, raison: "Pas d’aperçu pour ce type de fichier." });
    const pdf = texte(renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="D" chemin="devis.pdf" ancre={null} retour={[]} />));
    expect(pdf).toContain("Pas d’aperçu pour ce type de fichier Un PDF se lit sur l’ordinateur. Ouvrir sur ton Mac");
    const programme = texte(renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="D" chemin="outil.command" ancre={null} retour={[]} />));
    expect(programme).toContain("Ce type de fichier ne s’ouvre que devant l’ordinateur.");
  });

  test("poste fermé : P-6 ; demande en cours : P-9", () => {
    simule.ouvert = false;
    simule.lecture = { etat: "ferme" };
    expect(texte(renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="D" chemin="a.md" ancre={null} retour={[]} />))).toContain("Ton Mac est fermé");
    simule.ouvert = true;
    simule.lecture = { etat: "attente", lent: true };
    expect(texte(renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="D" chemin="a.md" ancre={null} retour={[]} />))).toContain("Demande à ton Mac…");
  });
});

describe("E6-08 à E6-12 : la fiche du projet", () => {
  const travail = {
    cle: "0",
    titre: "Arrondi de la TVA",
    statut: "Bloqué",
    ton: "orange",
    agent: "Léon",
    echeance: null,
    derniereNouvelle: null,
    fini: false,
    cout: null,
    alerte: "Sans nouvelles depuis 2 h.",
    filId: "c-tva",
    suivi: [],
  };
  const fiche = {
    brief: "Refaire l’espace client.",
    agents: [{ id: "dev", nom: "Léon", role: "Développeur" }],
    travaux: { etat: "ok", liste: [travail], coupes: 0 },
    surPoste: true,
  };

  beforeEach(() => {
    simule.params = new URLSearchParams("id=site&onglet=projet");
  });

  test("E6-08 : carte du compte, brief, agents, travaux, puis ce qui reste sur l'ordinateur ; aucun identifiant", () => {
    simule.lecture = { etat: "ok", data: fiche };
    const html = renderToStaticMarkup(<ProjetTelephone />);
    const lu = texte(html);
    expect(lu).toContain("En revue Site · Refonte du site");
    expect(lu).toContain("Refaire l’espace client.");
    expect(lu).toContain("Travaux 1");
    expect(lu).toContain("Arrondi de la TVA Bloqué Léon · à surveiller : sans nouvelles depuis 2 h ");
    expect(lu).toContain("Consignes des agents Sur ton Mac");
    expect(lu).not.toContain("c-tva");
    expect(html).toContain('href="/equipe?agent=dev"');
  });

  test("E6-08 : sans brief, on le dit sans en inventer un", () => {
    simule.lecture = { etat: "ok", data: { ...fiche, brief: "" } };
    expect(texte(renderToStaticMarkup(<ProjetTelephone />))).toContain("Aucun brief renseigné");
  });

  test("§ 2 : un journal illisible est une section indisponible, jamais « aucun travail »", () => {
    simule.lecture = { etat: "ok", data: { ...fiche, travaux: { etat: "indisponible", raison: "Le journal des travaux n’a pas pu être lu sur ton Mac." } } };
    const lu = texte(renderToStaticMarkup(<ProjetTelephone />));
    expect(lu).toContain("Le journal des travaux n’a pas pu être lu sur ton Mac.");
    expect(lu).not.toContain("Aucun travail");
    expect(lu).not.toContain("Travaux 0");
  });

  test("un journal vraiment vide le dit, seulement après une lecture réussie", () => {
    simule.lecture = { etat: "ok", data: { ...fiche, travaux: { etat: "ok", liste: [], coupes: 0 } } };
    expect(texte(renderToStaticMarkup(<ProjetTelephone />))).toContain("Aucun travail enregistré");
  });

  test("E6-09 : poste fermé, vue gardée d'abord, compte au-dessus du reste, lecture seule dite", () => {
    simule.ouvert = false;
    const heure = new Date();
    heure.setHours(18, 42, 0, 0);
    simule.lecture = { etat: "ferme", gardee: { lu: heure.getTime(), data: fiche } };
    const lu = texte(renderToStaticMarkup(<ProjetTelephone />));
    expect(lu.indexOf("Vue à 18:42")).toBeLessThan(lu.indexOf("Refaire l’espace client."));
    expect(lu).toContain("Modifier le projet : possible quand ton Mac est ouvert.");
  });

  test("E6-10 : la carte du compte tout de suite, puis « Demande à ton Mac… » pour le reste", () => {
    simule.lecture = { etat: "attente", lent: true };
    const lu = texte(renderToStaticMarkup(<ProjetTelephone />));
    expect(lu).toContain("Site · Refonte du site");
    expect(lu).toContain("Demande à ton Mac…");
    expect(lu).not.toContain("Aucun");
  });

  test("poste fermé sans vue gardée : la carte du compte reste, ni brief ni travaux inventés", () => {
    simule.ouvert = false;
    simule.lecture = { etat: "ferme", gardee: null };
    const lu = texte(renderToStaticMarkup(<ProjetTelephone />));
    expect(lu).toContain("Site · Refonte du site");
    expect(lu).toContain("Ton Mac est fermé");
    expect(lu).not.toContain("Aucun brief");
    expect(lu).not.toContain("Aucun travail");
  });

  test("aucun ordinateur : l'état `aucun`, jamais « fermé »", () => {
    simule.lecture = { etat: "aucun" };
    const lu = texte(renderToStaticMarkup(<ProjetTelephone />));
    expect(lu).toContain("Aucun ordinateur relié");
    expect(lu).not.toContain("est fermé");
  });

  test("un projet retiré du compte le dit, avec un retour", () => {
    simule.params = new URLSearchParams("id=disparu");
    const html = renderToStaticMarkup(<ProjetTelephone />);
    expect(texte(html)).toContain("Ce projet n’est pas dans cet espace");
    expect(html).toContain('aria-label="Retour"');
  });
});

describe("sur un serveur (Plus › Serveurs)", () => {
  const SERVEUR = "https://vps.exemple.test";
  beforeEach(() => {
    simule.lieu = SERVEUR;
    simule.requetes["conversationsCompte:projets"] = [
      { origine: "ici", nom: "Du PC", accroche: "", statut: "en-cours", epingle: false, misAJour: null, lieu: null },
      { origine: "la", nom: "Du serveur", accroche: "", statut: "en-cours", epingle: false, misAJour: null, lieu: SERVEUR },
    ];
    simule.requetes["conversationsCompte:liste"] = [
      { origine: "c1", titre: "Du PC", projetId: "la", roleIds: ["dev"], misAJour: "2026-11-01", epingleLe: null, extrait: "", lieu: null },
      { origine: "c2", titre: "Sur le serveur", projetId: "la", roleIds: ["dev"], misAJour: "2026-11-02", epingleLe: null, extrait: "", lieu: SERVEUR },
    ];
  });

  test("la liste ne montre que l'espace choisi, et ne dit pas « sur ton Mac »", () => {
    const lu = texte(renderToStaticMarkup(<ProjetsTelephone />));
    expect(lu).toContain("1 projet sur ce serveur");
    expect(lu).toContain("Du serveur");
    expect(lu).toContain("1 chat");
    expect(lu).not.toContain("Du PC");
    expect(lu).not.toContain("Sur ton Mac");
    expect(lu).toContain("Nouveau projet App de bureau");
  });

  test("un projet d'un autre espace ne s'ouvre pas ici", () => {
    simule.params = new URLSearchParams("id=ici");
    expect(texte(renderToStaticMarkup(<ProjetTelephone />))).toContain("Ce projet n’est pas dans cet espace");
  });

  test("Modifier : le geste irait à l'ordinateur : inactif, et il dit pourquoi", () => {
    simule.lecture = { etat: "ok", data: { nom: "Du serveur", accroche: "", brief: "", statut: "en-cours", epingle: false } };
    const html = renderToStaticMarkup(<PageModifierProjet projetId="la" onFermer={() => undefined} onEnregistre={() => undefined} />);
    expect(texte(html)).toContain("Depuis l’app de bureau, sur ce serveur.");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled/);
  });

  test("poste fermé : les fichiers d'un serveur ne sont pas dits « sur ton Mac »", () => {
    simule.params = new URLSearchParams("id=la&onglet=fichiers");
    simule.ouvert = false;
    simule.lecture = { etat: "ferme", gardee: null };
    const lu = texte(renderToStaticMarkup(<ProjetTelephone />));
    expect(lu).toContain("Les fichiers de ce projet se lisent par KLYRA sur ton Mac.");
    expect(lu).not.toContain("sont sur ton Mac");
  });

  test("un PDF d'un serveur ne propose pas de l'ouvrir sur l'ordinateur", () => {
    simule.lecture = { etat: "ok", data: { contenu: { type: "autre", taille: 20, raison: "Pas d’aperçu pour ce type de fichier." }, surPoste: false } };
    const lu = texte(renderToStaticMarkup(<VisionneuseTelephone projetId="la" nomProjet="Du serveur" chemin="a.pdf" ancre={null} retour={[]} />));
    expect(lu).toContain("Pas d’aperçu pour ce type de fichier");
    expect(lu).not.toContain("Ouvrir sur");
  });
});
