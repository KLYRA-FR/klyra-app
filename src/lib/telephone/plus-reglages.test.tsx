// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, test, vi } from "vitest";

/* Les écrans du lot 8 rendus en texte, avec un compte, un poste et des lectures simulés. */
const simule = vi.hoisted(() => ({
  requetes: {} as Record<string, unknown>,
  lecture: { etat: "attente", lent: false } as Record<string, unknown>,
  postes: undefined as unknown,
  compte: {} as Record<string, unknown>,
  params: new URLSearchParams(),
  carnet: [] as { id: string; adresse: string; nom: string; version: string; etat: string }[],
  lieu: null as string | null,
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => simule.requetes[getFunctionName(ref)],
  useMutation: () => vi.fn(),
  useConvex: () => ({}),
  ConvexReactClient: vi.fn(),
  useConvexAuth: () => ({ isLoading: false, isAuthenticated: true }),
}));
vi.mock("react-dom", async (origine) => ({ ...(await origine<typeof import("react-dom")>()), createPortal: (enfant: ReactNode) => enfant }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
  useSearchParams: () => simule.params,
  usePathname: () => "/reglages",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("next/image", () => ({ default: ({ alt }: { alt: string }) => <span role="img" aria-label={alt} /> }));
vi.mock("@/lib/poste/client", () => ({
  useLecturePoste: () => ({ ...simule.lecture, relancer: () => undefined }),
  useGestePoste: () => ({ faire: vi.fn(), occupe: false }),
  useDemandePoste: () => vi.fn(),
}));
vi.mock("@/components/telephone/poste", () => {
  const liste = () => simule.postes as { ouvert: boolean }[] | undefined;
  return {
    usePostes: () => ({ postes: liste(), principal: liste()?.[0] ?? null, ouvert: liste()?.some((p) => p.ouvert) ?? false, charge: false }),
    useSupport: () => "ton Mac",
    posteRetenu: () => null,
  };
});
vi.mock("@/lib/compte", async (origine) => {
  const vrai = await origine<typeof import("@/lib/compte")>();
  return {
    ...vrai,
    useCompte: () => simule.compte,
    useMonIdentite: () => ({ enregistrer: vi.fn() }),
    useEquipe: (admin: boolean) => ({ membres: simule.requetes["equipe:membres"], invitations: admin ? simule.requetes["equipe:invitations"] : undefined, inviter: vi.fn(), annulerInvitation: vi.fn(), changerRole: vi.fn(), retirer: vi.fn() }),
  };
});
vi.mock("@/lib/lieux", async (origine) => {
  const vrai = await origine<typeof import("@/lib/lieux")>();
  return { ...vrai, useLieuActif: () => simule.lieu, useServeursRelies: () => simule.carnet.filter((s) => s.etat === "joint"), useSondes: () => ({}) };
});
vi.mock("@/lib/reglages", () => ({ useReglages: () => ({ reglages: { sons: { theme: "chaleureux", volume: 0.7 } }, changerSons: vi.fn() }) }));

const MAC = { cle: "poste-essai", systeme: "mac", nom: "Mac de Camille", ouvert: true, dernierSignal: Date.now() - 3600_000 };
const CAMILLE = { _id: "m1", email: "camille.essai@example.test", nom: "Camille Essai", intitule: "Gérante", couleur: "bleu-k1", role: "admin" };
const SAM = { _id: "m2", email: "sam.essai@example.test", nom: "Sam Essai", intitule: "", couleur: "vert", role: "membre" };

const { PlusTelephone } = await import("@/components/telephone/ListesTelephone");
const { ReglagesTelephone } = await import("@/components/telephone/ReglagesTelephone");
const { ServeursTelephone, EcranServeurs } = await import("@/components/telephone/ServeursTelephone");
const { ConnexionTelephone } = await import("@/components/telephone/ConnexionTelephone");
const { FeuilleOrdinateurs, PastillePoste } = await import("@/components/telephone/PastillePoste");

const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const rendre = (section: string) => {
  simule.params = new URLSearchParams(`section=${section}`);
  return renderToStaticMarkup(<ReglagesTelephone />);
};

beforeEach(() => {
  simule.requetes = { "equipe:membres": [CAMILLE, SAM], "equipe:invitations": [] };
  simule.lecture = { etat: "attente", lent: false };
  simule.postes = [MAC];
  simule.compte = { etat: "connecte", moi: CAMILLE, seDeconnecter: vi.fn(), occupe: false, erreur: null, sessionFermee: false, adresseEnAttente: null, prochaineDemande: null, demandeRefusee: false };
  simule.params = new URLSearchParams();
  simule.carnet = [];
  simule.lieu = null;
  vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => undefined, removeItem: () => undefined });
  vi.stubGlobal("window", { addEventListener: () => undefined, removeEventListener: () => undefined, location: { search: "" }, dispatchEvent: () => true });
});

describe("Plus (E8-01, E8-04, E8-06)", () => {
  test("la carte de l'ordinateur en tête, ses destinations, Marketplace « Sur ton Mac »", () => {
    const lu = texte(renderToStaticMarkup(<PlusTelephone />));
    expect(lu).toContain("Ton Mac");
    expect(lu).toContain("KLYRA est ouverte sur ton Mac.");
    expect(lu).toContain("Les routines et les workflows de tes agents");
    expect(lu).toContain("Réglages et serveurs");
    expect(lu).toMatch(/Marketplace Sur ton Mac/);
    expect(lu).toContain("Tickets");
    expect(lu).not.toContain("Serveur affiché");
  });

  test("aucun poste : les étapes de liaison, jamais « fermé » ; les lignes restent", () => {
    simule.postes = [];
    const lu = texte(renderToStaticMarkup(<PlusTelephone />));
    expect(lu).toContain("Aucun ordinateur relié");
    expect(lu).toContain("Connecte-toi avec camille.essai@example.test.");
    expect(lu).not.toMatch(/fermé/i);
    expect(lu).toContain("Automatisations");
  });

  test("première lecture : un squelette, pas de faux état", () => {
    simule.postes = undefined;
    const html = renderToStaticMarkup(<PlusTelephone />);
    expect(html).toContain('aria-busy="true"');
    expect(texte(html)).not.toMatch(/Ouvert|Fermé|Aucun ordinateur/);
    expect(texte(html)).toContain("Automatisations");
  });
});

const STUDIO = { id: "https://vps.invalid", adresse: "https://vps.invalid", nom: "Studio-VPS", version: "1", etat: "joint" };
const CONVERSATIONS = (lieu: string | null, n = 1) =>
  Array.from({ length: n }, (_, i) => ({ origine: `${lieu ?? "pc"}-${i}`, titre: "Essai", projetId: null, misAJour: "2026-11-05", epingleLe: null, extrait: "", extraitLe: null, nonLus: 0, taches: "[]", roleIds: ["dev"], kind: "direct", lieu, parent: null, archiveLe: null, activite: "accord", modele: null }));

describe("feuille Ordinateurs (E8-07, E8-11, E8-12)", () => {
  const feuille = () => {
    vi.stubGlobal("document", { body: {}, activeElement: null });
    const html = renderToStaticMarkup(<FeuilleOrdinateurs onFermer={() => undefined} />);
    vi.unstubAllGlobals();
    return html;
  };

  test("sans serveur relié : pas de choix à faire", () => {
    const html = feuille();
    expect(texte(html)).not.toContain("Serveur affiché");
    expect(html).not.toContain('role="radio"');
    expect(texte(html)).toContain("Ce téléphone ne réveille pas un ordinateur à distance.");
  });

  test("un serveur relié : choix unique entre l'ordinateur et lui, coche sur l'espace affiché, jamais d'adresse", () => {
    simule.carnet = [STUDIO];
    const html = feuille();
    const lu = texte(html);
    expect(lu).toContain("Serveur affiché");
    expect(lu).toContain("Ton Mac");
    expect(lu).toContain("Studio-VPS");
    expect(lu).toContain("Ton planning et tes réglages ne changent pas.");
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>.*?Ton Mac/);
    expect(lu).not.toContain("vps.invalid");
  });

  test("le serveur affiché, ordinateur fermé : ce qui passe encore par lui est dit, « Me prévenir » reste dessous", () => {
    simule.carnet = [STUDIO];
    simule.lieu = STUDIO.adresse;
    simule.postes = [{ ...MAC, ouvert: false }];
    const lu = texte(feuille());
    expect(lu).toContain("Fermé : ses conversations se lisent");
    expect(lu).toContain("Ses fichiers et la liste de ses routines se lisent par ton Mac");
    expect(lu).toContain("Tes messages partiront à son ouverture.");
  });
});

describe("le serveur affiché dans Plus (E8-03, E8-10)", () => {
  test("Plus : la ligne « Serveur affiché » n'existe qu'avec un serveur relié, et nomme le choisi", () => {
    expect(texte(renderToStaticMarkup(<PlusTelephone />))).not.toContain("Serveur affiché");
    simule.carnet = [STUDIO];
    simule.lieu = STUDIO.adresse;
    const lu = texte(renderToStaticMarkup(<PlusTelephone />));
    expect(lu).toContain("Serveur affiché");
    expect(lu).toContain("Les routines de Studio-VPS tournent même ton Mac fermé");
  });

  test("la pastille nomme le serveur, et son nom accessible dit ce qui attend sur l'autre espace", () => {
    simule.carnet = [STUDIO];
    simule.lieu = STUDIO.adresse;
    simule.requetes["conversationsCompte:liste"] = CONVERSATIONS(null);
    const html = renderToStaticMarkup(<PastillePoste />);
    expect(texte(html)).toContain("Studio-VPS");
    expect(html).toContain("Serveur affiché : Studio-VPS.");
    expect(html).toContain("Ordinateurs et serveurs.");
    expect(html).not.toContain("vps.invalid");
  });

  test("sans serveur choisi : la pastille du socle, sans serveur", () => {
    const html = renderToStaticMarkup(<PastillePoste />);
    expect(html).toContain("État des ordinateurs.");
    expect(texte(html)).not.toContain("Studio-VPS");
  });
});

describe("sur un VPS, un geste qui irait à l'ordinateur est inactif", () => {
  const AGENTS = { acces: "projet", assistant: { nom: "Principal", teinte: "bleu-k1" }, agents: [] };
  test("Agents : la raison, et aucune réduction possible d'ici", () => {
    simule.carnet = [STUDIO];
    simule.lieu = STUDIO.adresse;
    simule.lecture = { etat: "ok", data: AGENTS };
    const lu = texte(rendre("agents"));
    expect(lu).toContain("Depuis l’app de bureau, sur ce serveur.");
  });

  test("Computer Use : le contrôle est désactivé, la raison dite", () => {
    simule.carnet = [STUDIO];
    simule.lieu = STUDIO.adresse;
    simule.lecture = { etat: "ok", data: { actif: true, autorisations: null } };
    const html = rendre("computer-use");
    expect(html).toMatch(/role="switch"[^>]*disabled/);
    expect(texte(html)).toContain("Depuis l’app de bureau, sur ce serveur.");
  });

  test("sur l'ordinateur : pas cette raison", () => {
    simule.lecture = { etat: "ok", data: AGENTS };
    expect(texte(rendre("agents"))).not.toContain("Depuis l’app de bureau");
  });
});

describe("la liste des Réglages (E8-15, E8-16)", () => {
  test("trois groupes par source, l'ordinateur nommé par useSupport", () => {
    const lu = texte(renderToStaticMarkup(<ReglagesTelephone />));
    expect(lu).toContain("Ce téléphone et ton compte");
    expect(lu).toContain("Ton Mac");
    expect(lu).toContain("Restent sur ton Mac");
    expect(lu).toContain("Coffre");
  });

  test("aucun poste : un encadré qui dit comment relier ; le compte et le téléphone restent", () => {
    simule.postes = [];
    const lu = texte(renderToStaticMarkup(<ReglagesTelephone />));
    expect(lu).toContain("Aucun ordinateur relié");
    expect(lu).toContain("Profil");
    expect(lu).not.toContain("Computer Use");
  });
});

describe("sections de l'ordinateur", () => {
  test("Claude sans donnée : un état dit, jamais 0 % (E8-31)", () => {
    simule.lecture = { etat: "ok", data: { compte: { installe: true, connecte: true, email: "camille.essai@example.test", abonnement: "max" }, utilisation: null } };
    const lu = texte(rendre("claude"));
    expect(lu).toContain("Connecté");
    expect(lu).toContain("Pas encore d’utilisation lue");
    expect(lu).not.toMatch(/\b0 %/);
    expect(lu).toContain("Organisation Console");
  });

  test("Claude avec données : deux jauges et leur valeur accessible", () => {
    simule.lecture = { etat: "ok", data: { compte: { installe: true, connecte: true, email: null, abonnement: null }, utilisation: { session: { utilise: 0.42, reinitialiseA: null }, semaine: { utilise: 0.18, reinitialiseA: null }, statut: "ok", misAJour: 1 } } };
    const html = rendre("claude");
    expect(html).toContain('aria-valuenow="42"');
    expect(html).toContain('aria-valuenow="18"');
  });

  test("Agents : on ne monte pas d'ici, et le modèle se dit sans identifiant (E8-32)", () => {
    simule.lecture = { etat: "ok", data: { acces: "projet", assistant: { nom: "Principal", teinte: "bleu-k1" }, agents: [{ id: "dev", nom: "Léon", tag: "Dev", teinte: "bleu-k1", modele: "modele-interne-x" }] } };
    const html = rendre("agents");
    const lu = texte(html);
    expect(lu).toContain("Ouvrir tous les accès se décide devant l’ordinateur.");
    expect(lu).toContain("Autre modèle");
    expect(lu).not.toContain("modele-interne-x");
    expect(html).toMatch(/role="radio" aria-checked="true"/);
  });

  test("Agents, ordinateur fermé : la vue gardée en lecture seule, datée (E8-36)", () => {
    simule.postes = [{ ...MAC, ouvert: false }];
    simule.lecture = { etat: "ferme", gardee: { lu: Date.now() - 60_000, data: { acces: "projet", assistant: { nom: "Principal", teinte: "bleu-k1" }, agents: [] } } };
    const html = rendre("agents");
    expect(html).toContain("<fieldset disabled");
    expect(texte(html)).toMatch(/Vue (à|hier à|le)/);
    expect(texte(html)).toContain("Changer : possible quand ton Mac est ouvert.");
  });

  test("Computer Use : rien n'est dit « coupé » tant que l'ordinateur ne l'a pas confirmé (E8-38, E8-40)", () => {
    simule.lecture = { etat: "ok", data: { actif: true, autorisations: null } };
    const allume = rendre("computer-use");
    expect(allume).toMatch(/role="switch" aria-checked="true"/);
    expect(texte(allume)).not.toContain("Coupé");
    simule.lecture = { etat: "ok", data: { actif: false, autorisations: null } };
    const coupe = texte(rendre("computer-use"));
    expect(coupe).toContain("Coupé");
    expect(coupe).toContain("L’allumer");
  });

  test("Aucun ordinateur : l'état `aucun`, pas de valeur inventée", () => {
    simule.postes = [];
    simule.lecture = { etat: "aucun" };
    const lu = texte(rendre("claude"));
    expect(lu).toContain("Aucun ordinateur relié");
    expect(lu).not.toContain("Connecté");
  });

  test("une section qui reste sur l'ordinateur : l'état et une raison par réglage (E8-42)", () => {
    const lu = texte(rendre("voix"));
    expect(lu).toContain("La voix se règle sur ton Mac");
    expect(lu).toContain("Moteur de dictée");
    expect(lu).toContain("Les clés ne quittent pas l’ordinateur.");
  });
});

describe("Équipe (E8-26, E8-27)", () => {
  test("admin : sa ligne sans action, les autres avec ⋯, les invitations et « Aucune invitation en attente »", () => {
    const html = rendre("equipe");
    const lu = texte(html);
    expect(lu).toContain("Tu es admin");
    expect(html).toContain('aria-label="Actions pour Sam Essai"');
    expect(html).not.toContain('aria-label="Actions pour Camille Essai"');
    expect(lu).toContain("Aucune invitation en attente");
    expect(lu).toContain("Inviter quelqu’un");
  });

  test("les couleurs se nomment en mots, jamais par leur token", () => {
    const html = rendre("equipe");
    expect(html).toContain('aria-label="Bleu"');
    expect(html).not.toMatch(/aria-label="bleu-k1"/);
  });

  test("non-admin : lecture seule, ni invitations ni menu", () => {
    simule.compte = { ...simule.compte, moi: { ...SAM } };
    const html = rendre("equipe");
    const lu = texte(html);
    expect(lu).toContain("Seuls les admins gèrent l’équipe");
    expect(lu).not.toContain("Inviter quelqu’un");
    expect(html).not.toContain("Actions pour");
  });
});

describe("Ce téléphone (E8-19 à E8-23)", () => {
  test("le compte, son chemin et une sortie, sans se déconnecter directement", () => {
    simule.requetes["notificationsPush:clePublique"] = null;
    simule.requetes["notificationsPush:monAbonnement"] = null;
    const lu = texte(rendre("mobile"));
    expect(lu).toContain("camille.essai@example.test");
    expect(lu).toContain("Passe par ton compte, puis par ton Mac.");
    expect(lu).toContain("Se déconnecter de ce téléphone");
    expect(lu).toContain("Ordinateurs et serveurs");
    expect(lu).toContain("Volume");
  });
});

describe("Serveurs (E8-44, E8-46)", () => {
  test("sans serveur : le guide, le vrai terminal, « yes » expliqué", () => {
    const lu = texte(renderToStaticMarkup(<ServeursTelephone />));
    expect(lu).toContain("Sur ton Mac, ouvre Terminal");
    expect(lu).toContain("tape « yes » puis Entrée");
    expect(lu).toContain("Lien d’invitation");
  });

  test("le bureau garde son écran (l'adresse et ses gestes directs)", () => {
    const lu = texte(renderToStaticMarkup(<EcranServeurs />));
    expect(lu).toContain("Relie l’app à un serveur KLYRA qui tourne sur ton VPS.");
    expect(lu).toContain("Connecte-toi à ton VPS");
  });
});

describe("Connexion (E8-50, E8-54, E8-55)", () => {
  test("l'adresse, puis le lien à coller, sans donnée de compte", () => {
    simule.compte = { ...simule.compte, etat: "deconnecte", moi: null };
    const html = renderToStaticMarkup(<ConnexionTelephone />);
    expect(html).toContain('aria-label="Adresse e-mail"');
    expect(html).toContain('aria-label="Lien de connexion"');
    expect(texte(html)).toContain("Recevoir un lien");
    expect(texte(html)).toContain("Tu as déjà le lien ?");
  });

  test("compte retiré : ce qu'il faut faire, et un bouton de sortie de taille normale", () => {
    simule.compte = { ...simule.compte, etat: "retire", moi: null };
    const html = renderToStaticMarkup(<ConnexionTelephone />);
    expect(texte(html)).toContain("Demande à un admin de t’inviter de nouveau.");
    expect(html).toContain("h-[46px]");
  });

  test("déconnecté à distance : le bandeau, pas « retiré »", () => {
    simule.compte = { ...simule.compte, etat: "deconnecte", moi: null, sessionFermee: true };
    const lu = texte(renderToStaticMarkup(<ConnexionTelephone />));
    expect(lu).toContain("a été déconnecté depuis");
    expect(lu).not.toContain("ne fait plus partie");
  });
});
