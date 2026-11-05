// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { fenetreCreneaux, planningTelephone } from "@/lib/cartes-interactives";
import { messageCompte } from "@/lib/copie-compte";
import type { Evenement, Message, MessagePart } from "@/types/domain";

/* Une carte de créneaux dans le fil du téléphone : croisée avec le calendrier du compte et le planning de l'ordinateur. */
const simule = vi.hoisted(() => ({
  requetes: {} as Record<string, unknown>,
  /** Les arguments reçus par chaque lecture du compte et de l'ordinateur. */
  vus: { compte: [] as unknown[], poste: [] as unknown[] },
  poste: { etat: "attente" } as Record<string, unknown>,
}));

vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0], args: unknown) => {
    const nom = getFunctionName(ref);
    if (nom === "evenements:entre") simule.vus.compte.push(args);
    return args === "skip" ? undefined : simule.requetes[nom];
  },
  useMutation: () => vi.fn(),
  useConvex: () => ({}),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/chat",
}));
vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock("@/lib/poste/client", () => ({
  useLecturePoste: (type: string, args: unknown) => {
    if (type === "planning.lire") simule.vus.poste.push(args);
    return { ...simule.poste, relancer: () => undefined };
  },
  useGestePoste: () => ({ faire: vi.fn(), occupe: false }),
}));
vi.mock("@/components/telephone/poste", () => {
  const poste = () => ({ cle: "poste-essai", systeme: "mac", nom: "MacBook", ouvert: true, dernierSignal: 0 });
  return { usePostes: () => ({ postes: [poste()], principal: poste(), ouvert: true, charge: false }), useSupport: () => "ton Mac" };
});

const { MessagesFil } = await import("@/components/telephone/MessagesFil");

const CRENEAUX = [
  { date: "2026-11-12", heure: "14:00", duree: 60 },
  { date: "2026-11-13", heure: "10:00", duree: 30 },
  { date: "2026-11-13", heure: "16:00", duree: 30 },
];

const ev = (e: Partial<Evenement>): Evenement => ({ id: "e", titre: "Rendez-vous", date: "2026-11-12", debut: null, fin: null, notes: "", projectId: null, notifie: false, ...e }) as Evenement;

function rendre(carte: Extract<MessagePart, { type: "carte" }>["carte"]) {
  const message: Message = { id: "m1", chatId: "dm-principal", author: { kind: "role", roleId: "principal" }, createdAt: "2026-11-05T10:00:00.000Z", statut: "fait", parts: [{ type: "carte", etapeId: "toolu_1", carte }] };
  return renderToStaticMarkup(
    <MessagesFil
      messages={[messageCompte(message)]}
      enFile={[] as never}
      contexte={{ origine: "dm-principal", projetId: null, activite: null, modele: null, reagir: vi.fn(), conversation: undefined, envoyer: vi.fn(), onBandeau: vi.fn() }}
      vide={null}
    />,
  );
}

/** Les créneaux que la carte marque comme pris par un rendez-vous. */
const pris = (html: string) => [...html.matchAll(/aria-label="([^"]*), un rendez-vous à ce moment-là"/g)].map((m) => m[1]);

beforeEach(() => {
  simule.vus = { compte: [], poste: [] };
  simule.poste = { etat: "attente" };
  simule.requetes = {
    "conversationsCompte:agents": [{ origine: "principal", nom: "Léa", teinte: "bleu-k1", roleCourt: "Assistant", actif: true }],
    "evenements:entre": [{ id: "w1", evenementId: "w1", titre: "Point équipe", jour: "2026-11-12", debut: "14:30", fin: "15:00", jourEntier: false }],
  };
});

describe("les créneaux d'une carte, croisés avec le planning, sur le téléphone", () => {
  test("le calendrier du compte, lu sur les jours proposés, même ordinateur fermé", () => {
    simule.poste = { etat: "ferme", gardee: null };
    const html = rendre({ genre: "creneaux", titre: "Le point", intro: "", creneaux: CRENEAUX });
    expect(simule.vus.compte.at(-1)).toEqual(fenetreCreneaux(CRENEAUX));
    expect(pris(html)).toEqual(["jeudi 12 novembre à 14:00, 1 h"]);
    expect(html).toContain("Un rendez-vous de ton planning à ce moment-là.");
  });

  test("et les rendez-vous de l'ordinateur, ouvert ou par sa dernière vue gardée", () => {
    const poste = { evenements: [ev({ id: "d", titre: "Dentiste", date: "2026-11-13", debut: "10:15", fin: "11:00" })], taches: [], categories: [] };
    simule.poste = { etat: "ok", data: poste };
    expect(pris(rendre({ genre: "creneaux", titre: "Le point", intro: "", creneaux: CRENEAUX }))).toEqual(["jeudi 12 novembre à 14:00, 1 h", "vendredi 13 novembre à 10:00, 30 min"]);
    simule.poste = { etat: "ferme", gardee: { lu: 0, data: poste } };
    expect(pris(rendre({ genre: "creneaux", titre: "Le point", intro: "", creneaux: CRENEAUX }))).toHaveLength(2);
  });

  test("une autre carte ne lit ni le compte ni l'ordinateur", () => {
    rendre({ genre: "liste", titre: "Le plan", intro: "", elements: [{ id: "a", texte: "A", coche: true }, { id: "b", texte: "B", coche: true }] });
    expect(simule.vus.compte).toEqual(["skip"]);
    expect(simule.vus.poste).toEqual([null]);
  });
});

describe("le planning à croiser", () => {
  test("une occurrence du compte par jour, journée entière sans heures ; un rendez-vous du compte copié sur l'ordinateur compté une fois", () => {
    const compte = [
      { id: "r-2026-11-12", evenementId: "r", titre: "Hebdo", jour: "2026-11-12", debut: "09:00", fin: "10:00", jourEntier: false },
      { id: "j", titre: "Salon", jour: "2026-11-13", debut: "08:00", fin: null, jourEntier: true },
    ];
    const planning = planningTelephone(compte, [ev({ id: "local", titre: "Hebdo", compteId: "r" }), ev({ id: "seul", titre: "Dentiste" })]);
    expect(planning.map((e) => [e.titre, e.date, e.debut, e.occurrence ?? false])).toEqual([
      ["Hebdo", "2026-11-12", "09:00", true],
      ["Salon", "2026-11-13", null, true],
      ["Dentiste", "2026-11-12", null, false],
    ]);
    expect(planningTelephone(undefined, null)).toEqual([]);
  });

  test("la fenêtre de lecture : du premier jour au lendemain du dernier", () => {
    expect(fenetreCreneaux([{ date: "2026-11-30", heure: "09:00", duree: 60 }, { date: "2026-11-28", heure: "09:00", duree: 60 }])).toMatchObject({ debut: "2026-11-28", fin: "2026-12-01" });
    expect(fenetreCreneaux([])).toBeNull();
  });
});
