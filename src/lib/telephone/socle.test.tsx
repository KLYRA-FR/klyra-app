// @vitest-environment node
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

/* Les pièces du socle du téléphone (lot 1) rendues en texte, avec un poste simulé. */
vi.mock("convex/react", () => ({ useQuery: () => undefined, useMutation: () => vi.fn(), useConvex: () => ({}) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }), useSearchParams: () => new URLSearchParams(), usePathname: () => "/projets" }));
vi.mock("next/link", () => ({
  default: ({ href, children, className }: { href: string; children: ReactNode; className?: string }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/telephone/poste", () => {
  const poste = { cle: "poste-essai", systeme: "mac", nom: "Mac de Camille", ouvert: true, dernierSignal: 0 };
  return { usePostes: () => ({ postes: [poste], principal: poste, ouvert: true, charge: false }), useSupport: () => "ton Mac" };
});

const { PageOnglet, EnteteTelephone } = await import("@/components/telephone/EnteteTelephone");
const { LigneListe, GroupeListe, SectionListe, Etiquette, TuileIcone } = await import("@/components/telephone/Liste");
const { EtatEcran, PasDeReponse, ErreurPoste } = await import("@/components/telephone/etats");
const { CaseRonde, CocheChoix, Puce } = await import("@/components/telephone/Controles");

const texte = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

describe("barre du haut et grand titre (§ 2.2, 2.4)", () => {
  test("page d'onglet : la pastille à gauche, le grand titre en h1, le titre court caché tant que la page n'a pas défilé", () => {
    const html = renderToStaticMarkup(
      <PageOnglet titre="Projets" sous="3 projets sur ton Mac">
        <p>contenu</p>
      </PageOnglet>,
    );
    expect(html).toContain('aria-label="KLYRA est ouverte sur ton Mac. État des ordinateurs."');
    expect(html).toMatch(/<h1[^>]*>Projets<\/h1>/);
    expect(html).toContain('aria-hidden="true" class="klyra-entete-titre');
    expect(html).not.toContain("data-defilee");
    expect(texte(html)).toContain("3 projets sur ton Mac");
  });

  test("page poussée : « Retour », le titre à gauche, pas de pastille (D-3)", () => {
    const html = renderToStaticMarkup(<EnteteTelephone titre="Menuiserie Arlod" parent="/projets" />);
    expect(html).toContain('aria-label="Retour"');
    expect(html).toMatch(/<h1[^>]*>Menuiserie Arlod<\/h1>/);
    expect(html).not.toContain("État des ordinateurs");
  });
});

describe("listes (§ 3.2, D-7)", () => {
  test("un élément qui a sa page : pas de ⋯ visible, un bouton pour les lecteurs d'écran ; l'étiquette porte un nom lisible", () => {
    const html = renderToStaticMarkup(
      <SectionListe titre="Projets" compte={1}>
        <GroupeListe>
          <LigneListe href="/projet?id=arlod" debut={<TuileIcone icone="folder" />} retrait="tuile" nom="Menuiserie Arlod" etiquette={<Etiquette>Épinglé</Etiquette>} ligne2="Portail client" fin="chevron" onMenu={() => undefined} />
        </GroupeListe>
      </SectionListe>,
    );
    expect(texte(html)).toContain("Projets 1");
    expect(html).toContain('href="/projet?id=arlod"');
    expect(html).toContain('class="sr-only" aria-haspopup="dialog">Actions pour Menuiserie Arlod</button>');
    expect(html).not.toContain('aria-label="Actions pour Menuiserie Arlod"');
  });

  test("un élément sans page garde son ⋯ ; une ligne inactive dit pourquoi", () => {
    const html = renderToStaticMarkup(
      <GroupeListe>
        <LigneListe nom="devis.csv" onMenu={() => undefined} menuVisible />
        <LigneListe nom="Lancer" inactive raison="Possible quand ton Mac est ouvert" />
      </GroupeListe>,
    );
    expect(html).toContain('aria-label="Actions pour devis.csv"');
    expect(texte(html)).toContain("Lancer Possible quand ton Mac est ouvert");
    expect(html).toMatch(/<button type="button" disabled=""/);
  });
});

describe("états (§ 5.2)", () => {
  test("encadré ou plein, une action au plus ; l'erreur est une alerte", () => {
    const vide = renderToStaticMarkup(<EtatEcran forme="encadre" icone="folder" titre="Aucun chat dans ce projet" texte="Écris à un agent pour commencer." />);
    expect(vide).toContain('role="status"');
    expect(vide).toContain("border-dashed");
    expect(renderToStaticMarkup(<PasDeReponse relancer={() => undefined} />)).toContain('role="alert"');
    expect(texte(renderToStaticMarkup(<ErreurPoste message="" relancer={() => undefined} />))).toContain("Ton Mac n’a pas pu le faire : erreur inattendue. Réessayer");
  });
});

describe("contrôles (§ 6.3)", () => {
  test("une seule puce, la coche du choix, la case ronde", () => {
    expect(renderToStaticMarkup(<Puce choisie>Tous</Puce>)).toContain('aria-pressed="true"');
    expect(renderToStaticMarkup(<CocheChoix choisi />)).toContain("text-icone-accent");
    expect(renderToStaticMarkup(<CaseRonde faite={false} />)).toContain("rounded-full border-[1.5px] border-texte-tertiaire");
  });
});
