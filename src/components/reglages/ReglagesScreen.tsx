"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { cn } from "@/lib/cn";
import { avecCommande, estMac } from "@/lib/raccourcis";
import { AutresIa } from "./AutresIa";
import { chercher, estSection, SECTIONS, type IdSection, type Resultat } from "./catalogue";
import { Agents } from "./sections/Agents";
import { Claude } from "./sections/Claude";
import { ComputerUse } from "./sections/ComputerUse";
import { Equipe } from "./sections/Equipe";
import { General } from "./sections/General";
import { MisesAJour } from "./sections/MisesAJour";
import { Notifications } from "./sections/Notifications";
import { Profil } from "./sections/Profil";
import { Voix } from "./sections/Voix";
import { ancreReglage } from "./ui";

/** La dernière section ouverte : les Réglages y reviennent. */
const CLE_SECTION = "klyra:reglages:section";

const CONTENU: Record<IdSection, () => ReactNode> = {
  general: () => <General />,
  profil: () => <Profil />,
  equipe: () => <Equipe />,
  claude: () => <Claude />,
  agents: () => <Agents />,
  "autres-ia": () => (
    <div id={ancreReglage("autres-ia")} className="klyra-reglage scroll-mt-6 rounded-lg">
      <AutresIa />
    </div>
  ),
  notifications: () => <Notifications />,
  voix: () => <Voix />,
  "computer-use": () => <ComputerUse />,
  "mises-a-jour": () => <MisesAJour />,
};

function sectionMemorisee(): IdSection {
  try {
    const s = localStorage.getItem(CLE_SECTION);
    return estSection(s) ? s : "general";
  } catch {
    return "general";
  }
}

/** Mène au réglage cherché : il défile à l'écran, s'éclaire un instant et prend le focus. */
function allerAuReglage(id: string) {
  const el = document.getElementById(ancreReglage(id));
  if (!el) return;
  el.scrollIntoView({ block: "start", behavior: "smooth" });
  el.removeAttribute("data-eclaire");
  void el.offsetWidth; // relance l'animation si on y revient
  el.setAttribute("data-eclaire", "");
  window.setTimeout(() => el.removeAttribute("data-eclaire"), 1800);
  const controle = el.querySelector<HTMLElement>('button:not([disabled]), input:not([disabled]), [href], [role="switch"]');
  controle?.focus({ preventScroll: true });
}

/** Une ligne de la barre latérale : une section, ou un résultat de recherche. */
function Entree({
  actif,
  icone,
  children,
  sous,
  onClick,
  onKeyDown,
  courant,
}: {
  actif?: boolean;
  icone: Parameters<typeof Icon>[0]["name"];
  children: ReactNode;
  sous?: string;
  onClick: () => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => void;
  courant?: boolean;
}) {
  return (
    <button
      type="button"
      data-entree-reglages
      aria-current={courant ? "page" : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
      className={cn(
        "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 px-2.5 py-1.5 text-left text-ui-s transition-colors duration-[120ms] ease-sortie",
        actif ? "bg-fond-survol font-semibold text-texte-principal" : "bg-transparent text-texte-secondaire hover:bg-fond-survol hover:text-texte-principal",
      )}
    >
      <Icon name={icone} size={18} className={actif ? "text-icone-defaut" : "text-icone-secondaire"} />
      <span className="flex min-w-0 flex-col">
        <span className="truncate">{children}</span>
        {sous && <span className="truncate text-ui-2xs font-normal text-texte-tertiaire">{sous}</span>}
      </span>
    </button>
  );
}

/**
 * Réglages de l'app : une barre latérale (recherche, puis une entrée par
 * section) et la section ouverte. `/reglages?section=voix` ouvre une section ;
 * sans paramètre, la dernière ouverte. ⌘ , les ouvre de partout, ⌘ F cherche.
 */
export function ReglagesScreen() {
  const router = useRouter();
  const params = useSearchParams();
  const demandee = params.get("section");
  const section: IdSection = estSection(demandee) ? demandee : sectionMemorisee();
  const courante = SECTIONS.find((s) => s.id === section)!;

  const [requete, setRequete] = useState("");
  const resultats = useMemo(() => chercher(requete), [requete]);
  const champ = useRef<HTMLInputElement>(null);
  const nav = useRef<HTMLElement>(null);
  const contenu = useRef<HTMLDivElement>(null);
  /* Le réglage où mener une fois la section affichée. */
  const [cible, setCible] = useState<string | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(CLE_SECTION, section);
    } catch {
      /* pas de stockage : la section n'est pas mémorisée */
    }
  }, [section]);

  useEffect(() => {
    contenu.current?.scrollTo({ top: 0 });
  }, [section]);

  useEffect(() => {
    if (!cible) return;
    /* Une section peut ouvrir ce qui cache le réglage (le formulaire du Profil). */
    window.dispatchEvent(new CustomEvent("klyra:reglage", { detail: cible }));
    const t = window.setTimeout(() => {
      allerAuReglage(cible);
      setCible(null);
    }, 60);
    return () => window.clearTimeout(t);
  }, [cible, section]);

  /* ⌘ F : la recherche des réglages. */
  useEffect(() => {
    const surTouche = (e: globalThis.KeyboardEvent) => {
      if (e.key.toLowerCase() === "f" && avecCommande(e)) {
        e.preventDefault();
        champ.current?.focus();
        champ.current?.select();
      }
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, []);

  const ouvrir = (id: IdSection, reglage: string | null = null) => {
    if (id !== section) router.replace(`/reglages?section=${id}`, { scroll: false });
    setCible(reglage);
  };

  const choisir = (r: Resultat) => {
    ouvrir(r.section.id, r.entree?.id ?? null);
    setRequete("");
  };

  /* ↑ ↓ entre les lignes de la barre (sections ou résultats), Début et Fin ; en haut, retour au champ. */
  const deplacer = (e: KeyboardEvent<HTMLButtonElement>, ouvrirSection?: IdSection[]) => {
    const lignes = Array.from(nav.current?.querySelectorAll<HTMLButtonElement>("[data-entree-reglages]") ?? []);
    const i = lignes.indexOf(e.currentTarget);
    let j = -1;
    if (e.key === "ArrowDown") j = Math.min(lignes.length - 1, i + 1);
    else if (e.key === "ArrowUp") j = i - 1;
    else if (e.key === "Home") j = 0;
    else if (e.key === "End") j = lignes.length - 1;
    else if (e.key === "Escape" && requete) {
      setRequete("");
      champ.current?.focus();
      return;
    } else return;
    e.preventDefault();
    if (j < 0) return champ.current?.focus();
    lignes[j].focus();
    // Dans la liste des sections, la flèche ouvre la section, comme dans les réglages du système.
    if (ouvrirSection?.[j]) ouvrir(ouvrirSection[j]);
  };

  const surToucheChamp = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      nav.current?.querySelector<HTMLButtonElement>("[data-entree-reglages]")?.focus();
    } else if (e.key === "Enter" && resultats[0]) {
      e.preventDefault();
      choisir(resultats[0]);
    } else if (e.key === "Escape" && requete) {
      e.preventDefault();
      e.stopPropagation();
      setRequete("");
    }
  };

  return (
    <div className="flex h-full min-h-0">
      <aside className="flex w-[248px] shrink-0 flex-col gap-3 border-r border-bordure-subtile px-3 pt-5 pb-4">
        <h1 className="m-0 px-2.5 text-ui font-semibold text-texte-principal">Réglages</h1>
        <label className="relative flex items-center">
          <Icon name="search-01" size={16} className="pointer-events-none absolute left-2.5 text-icone-secondaire" />
          <span className="sr-only">Rechercher dans les réglages</span>
          <input
            ref={champ}
            type="search"
            value={requete}
            placeholder="Rechercher dans les réglages…"
            aria-controls="reglages-navigation"
            aria-keyshortcuts={estMac() ? "Meta+F" : "Control+F"}
            onChange={(e) => setRequete(e.target.value)}
            onKeyDown={surToucheChamp}
            className="h-9 w-full rounded-md border border-bordure-champ bg-fond-surface pr-2.5 pl-8 text-ui-s text-texte-principal outline-none transition-colors duration-[120ms] placeholder:text-texte-placeholder hover:border-bordure-champ-survol focus:border-focus [&::-webkit-search-cancel-button]:hidden"
          />
        </label>

        <nav id="reglages-navigation" ref={nav} aria-label={requete ? "Résultats de la recherche" : "Sections des réglages"} className="klyra-defilement-fin -mx-1 flex min-h-0 flex-col gap-0.5 overflow-y-auto px-1">
          {requete ? (
            resultats.length ? (
              resultats.map((r, i) => (
                <Entree
                  key={`${r.section.id}-${r.entree?.id ?? ""}`}
                  /* Le premier résultat : celui qu'Entrée ouvre depuis le champ. */
                  actif={i === 0}
                  icone={r.section.icone}
                  sous={r.entree ? r.section.titre : undefined}
                  onClick={() => choisir(r)}
                  onKeyDown={(e) => deplacer(e)}
                >
                  {r.entree?.titre ?? r.section.titre}
                </Entree>
              ))
            ) : (
              <p role="status" className="m-0 px-2.5 py-2 text-ui-xs text-texte-tertiaire">
                Aucun réglage ne correspond à « {requete} ».
              </p>
            )
          ) : (
            SECTIONS.map((s) => (
              <Entree
                key={s.id}
                icone={s.icone}
                actif={s.id === section}
                courant={s.id === section}
                onClick={() => ouvrir(s.id)}
                onKeyDown={(e) =>
                  deplacer(
                    e,
                    SECTIONS.map((x) => x.id),
                  )
                }
              >
                {s.titre}
              </Entree>
            ))
          )}
        </nav>
      </aside>

      <div ref={contenu} className="min-w-0 flex-1 overflow-y-auto">
        <div key={section} className="klyra-arrivee @container mx-auto flex max-w-[760px] flex-col gap-6 px-8 pt-8 pb-12">
          <header className="flex flex-col gap-1.5">
            <h2 className="m-0 text-h3 leading-[1] font-semibold tracking-[-0.04em] text-texte-principal">{courante.titre}</h2>
            <p className="m-0 text-ui-s text-texte-tertiaire">{courante.description}</p>
          </header>
          {CONTENU[section]()}
        </div>
      </div>
    </div>
  );
}
