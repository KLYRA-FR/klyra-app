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

const { ProjetsTelephone, ProjetTelephone } = await import("@/components/telephone/EcransProjets");
const { DossierTelephone } = await import("@/components/telephone/DossierTelephone");
const { VisionneuseTelephone } = await import("@/components/telephone/VisionneuseTelephone");

const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

beforeEach(() => {
  simule.ouvert = true;
  simule.params = new URLSearchParams();
  simule.lecture = { etat: "attente", lent: false };
  simule.requetes = {
    "conversationsCompte:projets": [
      { origine: "site", nom: "Site", accroche: "Refonte du site", statut: "en-revue", epingle: false },
      { origine: "digital-os", nom: "DIGITAL-OS", accroche: "", statut: "en-cours", epingle: true },
    ],
    "conversationsCompte:liste": [
      { origine: "c1", titre: "Hero", projetId: "site", misAJour: "2026-11-01", epingleLe: null, extrait: "Fait." },
      { origine: "c2", titre: "Offres", projetId: "site", misAJour: "2026-11-02", epingleLe: null, extrait: "" },
      { origine: "c3", titre: "Ailleurs", projetId: null, misAJour: "2026-11-02", epingleLe: null, extrait: "" },
    ],
  };
});

describe("T-10 et T-11", () => {
  test("une colonne : épinglé d'abord, statut et chats ; les gestes du dossier restent sur l'ordinateur", () => {
    const html = renderToStaticMarkup(<ProjetsTelephone />);
    const lu = texte(html);
    expect(lu.indexOf("DIGITAL-OS")).toBeLessThan(lu.indexOf("Site"));
    expect(lu).toContain("En revue · 2 chats");
    expect(lu).toContain("En cours · 0 chat");
    expect(lu).toContain("Nouveau projet Sur ton Mac : le dossier d’un projet se choisit sur l’ordinateur.");
    expect(html).toContain('href="/projet?id=site"');
  });

  test("aucun projet : « Ajoute un projet sur ton Mac »", () => {
    simule.requetes["conversationsCompte:projets"] = [];
    expect(texte(renderToStaticMarkup(<ProjetsTelephone />))).toContain("Ajoute un projet sur ton Mac");
  });

  test("onglet Chats : les chats du projet et « Nouveau chat dans {nom}… »", () => {
    simule.params = new URLSearchParams("id=site");
    const html = renderToStaticMarkup(<ProjetTelephone />);
    const lu = texte(html);
    expect(lu).toContain("Chats du projet");
    expect(lu.indexOf("Offres")).toBeLessThan(lu.indexOf("Hero"));
    expect(lu).not.toContain("Ailleurs");
    expect(lu).toContain("Nouveau chat dans Site…");
    expect(html).toContain('href="/chat?nouveau=1&amp;projet=site"');
  });

  test("onglet Fichiers, poste fermé : P-6", () => {
    simule.params = new URLSearchParams("id=site&onglet=fichiers");
    simule.ouvert = false;
    simule.lecture = { etat: "ferme" };
    expect(texte(renderToStaticMarkup(<ProjetTelephone />))).toContain("Ton Mac est fermé Les fichiers de ce projet sont sur ton Mac. Ils s’affichent quand KLYRA y est ouverte.");
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
    expect(html).toContain('aria-label="Contient des fichiers modifiés"');
    expect(html).toContain('aria-label="Modifié par un agent"');
    expect(texte(html)).toContain("Liste coupée : 1 200 autres éléments non affichés. Ouvre le dossier sur l’ordinateur pour tout voir.");
  });

  test("dossier vide, sans réponse, dossier disparu", () => {
    simule.lecture = { etat: "ok", data: { total: 0, elements: [] } };
    expect(texte(renderToStaticMarkup(<DossierTelephone projetId="p" nomProjet="P" chemin="a" />))).toContain("Dossier vide");
    simule.lecture = { etat: "delai" };
    expect(texte(renderToStaticMarkup(<DossierTelephone projetId="p" nomProjet="P" chemin="a" />))).toContain("Ton Mac ne répond pas. Réessayer");
    simule.lecture = { etat: "erreur", code: "introuvable", message: "Ce dossier n’existe plus sur ton Mac." };
    expect(texte(renderToStaticMarkup(<DossierTelephone projetId="p" nomProjet="P" chemin="a" />))).toContain("Ce dossier n’existe plus sur ton Mac.");
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

  test("pas d'aperçu : la phrase du bureau et « Ouvrir sur ton Mac » ; un programme reste sur l'ordinateur", () => {
    simule.lecture = lu({ type: "autre", taille: 2_000_000, raison: "Pas d’aperçu pour ce type de fichier." });
    const pdf = texte(renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="D" chemin="devis.pdf" ancre={null} retour={[]} />));
    expect(pdf).toContain("Pas d’aperçu pour ce type de fichier. Ouvrir sur ton Mac");
    const programme = texte(renderToStaticMarkup(<VisionneuseTelephone projetId="d" nomProjet="D" chemin="outil.command" ancre={null} retour={[]} />));
    expect(programme).toContain("Sur ton Mac : ce type de fichier ne s’ouvre que devant l’ordinateur.");
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
