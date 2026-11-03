// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { plierAteliers } from "@/lib/atelier-agent";
import { messageCompte } from "@/lib/copie-compte";
import type { Message, MessagePart } from "@/types/domain";

/* Le fil du téléphone avec l'atelier d'un agent : la copie faite par l'ordinateur, rendue en texte. */
const simule = vi.hoisted(() => ({ requetes: {} as Record<string, unknown>, ouvert: true }));

vi.mock("convex/react", () => ({
  useQuery: (ref: Parameters<typeof getFunctionName>[0]) => simule.requetes[getFunctionName(ref)],
  useMutation: () => vi.fn(),
  useConvex: () => ({}),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => "/chat",
}));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/lib/poste/client", () => ({
  useLecturePoste: () => ({ etat: "attente", lent: false, relancer: () => undefined }),
  useGestePoste: () => ({ faire: vi.fn(), occupe: false }),
}));
vi.mock("@/components/telephone/poste", () => {
  const poste = () => ({ cle: "poste-essai", systeme: "mac", nom: "MacBook", ouvert: simule.ouvert, dernierSignal: 0 });
  return {
    usePostes: () => ({ postes: [poste()], principal: poste(), ouvert: simule.ouvert, charge: false }),
    useSupport: () => "ton Mac",
  };
});

const { MessagesFil } = await import("@/components/telephone/MessagesFil");

const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
const EPREUVE = { normal: "Fais la veille de la semaine.", floue: "Regarde un peu.", horsMetier: "Réserve-moi un train." };

function fil(): Message[] {
  const m = (id: string, parts: MessagePart[], kind: "role" | "user" = "role", minute = 0): Message => ({
    id,
    chatId: "dm-principal",
    author: kind === "role" ? { kind: "role", roleId: "principal" } : { kind: "user" },
    createdAt: `2026-11-03T10:0${minute}:00.000Z`,
    parts,
    statut: kind === "role" ? "fait" : undefined,
  });
  return [
    m("m1", [{ type: "atelier-agent", etapeId: "e1", maj: { nom: "Zoé", role: "Veille", mission: "Surveille les concurrents.", epreuve: EPREUVE } }]),
    m("m2", [{ type: "text", text: "Chaque lundi" }], "user", 1),
    m(
      "m3",
      [
        { type: "text", text: "Ce qu’elle ne fait pas ?" },
        { type: "atelier-agent", etapeId: "e2", maj: { declencheurs: ["Chaque lundi"] } },
        { type: "choix", etapeId: "c1", question: "Ses limites", options: ["Ne publie rien", "Ne paie rien"], multiple: false },
      ],
      "role",
      2,
    ),
  ];
}

/** Ce que l'ordinateur copie dans le compte, tel que le téléphone le lit. */
const copie = (messages: Message[]) => {
  const contexte = { etats: plierAteliers(messages), roles: [], teinteDe: () => "ocre" as const, vps: false };
  return messages.map((m) => messageCompte(m, null, contexte));
};

const rendre = (messages: Message[], enFile: { _id: string; texte: string; pieces: [] }[] = []) =>
  renderToStaticMarkup(
    <MessagesFil
      messages={copie(messages)}
      enFile={enFile as never}
      contexte={{ origine: "dm-principal", projetId: null, activite: null, modele: null, envoyer: vi.fn(), onBandeau: vi.fn() }}
      vide={null}
    />,
  );

beforeEach(() => {
  simule.ouvert = true;
  simule.requetes = { "conversationsCompte:agents": [{ origine: "principal", nom: "Léa", teinte: "bleu-k1", roleCourt: "Assistant", actif: true }] };
});

describe("l'atelier d'un agent sur le téléphone", () => {
  test("le premier appel en une ligne, la carte entière sur le dernier, l'épreuve et « Créer l'agent »", () => {
    const html = rendre(fil());
    const t = texte(html);
    expect(t).toContain("Carte de Zoé : sa mission");
    expect(t).toContain("Atelier · nouvel agent");
    expect(t).toContain("Zoé");
    expect(t).toContain("Surveille les concurrents.");
    expect(t).toContain("Couleur de Zoé");
    expect(t).toContain("L’épreuve");
    expect(t).toContain("« Réserve-moi un train. »");
    expect(t).toContain("Créer l’agent");
    expect(t).toContain("Rien n’est écrit sur ton Mac avant ce geste.");
    expect(html.match(/data-carte-atelier="e2"/g)).toHaveLength(1);
    expect(html).not.toContain('data-carte-atelier="e1"');
    expect(t).not.toContain("Possible quand ton Mac est ouvert");
  });

  test("ordinateur fermé : les gestes désactivés, dit sous le bouton ; répondre reste possible", () => {
    simule.ouvert = false;
    const html = rendre(fil());
    expect(texte(html)).toContain("Possible quand ton Mac est ouvert");
    const bouton = (libelle: string) => html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${libelle}`, "s"))?.[0] ?? "";
    expect(bouton("Créer l’agent")).toContain('disabled=""');
    expect(bouton("Lancer l’épreuve")).toContain('disabled=""');
    expect(html.match(/role="radio"[^>]*disabled=""/g)?.length).toBe(12);
    expect(bouton("Ne publie rien")).not.toContain("disabled");
  });

  test("les réponses toutes prêtes : actives sur la dernière réponse, figées une fois répondues (même en attente de l'ordinateur)", () => {
    expect(rendre(fil())).toMatch(/<button type="button"[^>]*>Ne publie rien<\/button>/);
    const repondu = [...fil(), { id: "m4", chatId: "dm-principal", author: { kind: "user" }, createdAt: "2026-11-03T10:05:00.000Z", parts: [{ type: "text", text: "Ne paie rien" }] } as Message];
    const fige = rendre(repondu);
    expect(fige).toMatch(/<button type="button" aria-pressed="true" disabled=""[^>]*>Ne paie rien<\/button>/);
    expect(fige).toMatch(/<button type="button" aria-pressed="false" disabled=""[^>]*>Ne publie rien<\/button>/);
    expect(rendre(fil(), [{ _id: "f1", texte: "Ne publie rien", pieces: [] }])).toMatch(/aria-pressed="true" disabled=""[^>]*>Ne publie rien/);
  });

  test("l'agent créé : « Dans ton équipe », lui écrire, sa routine à relire", () => {
    const messages = fil();
    const derniere = messages[2].parts[1] as Extract<MessagePart, { type: "atelier-agent" }>;
    derniere.maj = { ...derniere.maj, routine: { nom: "Veille du lundi", consigne: "Fais la veille.", quand: { type: "semaine", heure: "09:00", jour: 1 } } };
    derniere.cree = "zoe";
    const html = rendre(messages);
    const t = texte(html);
    expect(t).toContain("Dans ton équipe");
    expect(html).toContain('href="/chat?id=dm-zoe"');
    expect(t).toContain("Lui confier : Veille du lundi");
    expect(t).not.toContain("Créer l’agent");
  });
});
