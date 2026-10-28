"use client";

import { useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";

const CLE = "klyra-apercu-historique";
const HISTORIQUE_MAX = 60;
const SUGGESTIONS_MAX = 8;

const sansProtocole = (url: string) => url.trim().replace(/^https?:\/\//, "");

function lireHistorique(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(CLE) ?? "[]") as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

/** Garde une adresse visitée dans l'aperçu (préférence de cet écran), la plus récente en tête. */
export function noterAdresse(url: string) {
  const adresse = sansProtocole(url);
  if (!adresse) return;
  try {
    const liste = [adresse, ...lireHistorique().filter((u) => u !== adresse)].slice(0, HISTORIQUE_MAX);
    localStorage.setItem(CLE, JSON.stringify(liste));
  } catch {
    /* stockage indisponible */
  }
}

/** Les pages du site du projet (routes Next), lues dans son dossier. */
function usePages(dossier: string | null): string[] {
  const [pages, setPages] = useState<{ dossier: string; liste: string[] } | null>(null);
  useEffect(() => {
    const lire = getBridge()?.projets.pages;
    if (!dossier || !lire) return;
    let actif = true;
    void lire(dossier).then((r) => actif && r.ok && setPages({ dossier, liste: r.data }));
    return () => {
      actif = false;
    };
  }, [dossier]);
  return pages && pages.dossier === dossier ? pages.liste : [];
}

interface Suggestion {
  url: string;
  source: "historique" | "page";
}

interface BarreAdresseProps {
  valeur: string;
  onChange: (valeur: string) => void;
  /** On ouvre une adresse : tapée, ou choisie dans les suggestions. */
  onOuvrir: (adresse: string) => void;
  /** Le dossier du projet, pour proposer les pages du site. */
  dossier: string | null;
  /** L'adresse affichée dans l'aperçu : son hôte sert aux pages du site. */
  chargee: string;
}

/**
 * Barre d'adresse de l'aperçu, avec des suggestions comme celle d'un navigateur :
 * les adresses déjà visitées et les pages du site du projet, filtrées au fil de la saisie.
 */
export function BarreAdresse({ valeur, onChange, onOuvrir, dossier, chargee }: BarreAdresseProps) {
  const id = useId();
  const pages = usePages(dossier);
  const [ouvert, setOuvert] = useState(false);
  const [actif, setActif] = useState(-1);
  const [historique, setHistorique] = useState<string[]>([]);

  const saisie = sansProtocole(valeur).toLowerCase();
  const hote = sansProtocole(valeur || chargee).split("/")[0];
  const vues = new Set<string>();
  const suggestions: Suggestion[] = [
    ...historique.map((url): Suggestion => ({ url, source: "historique" })),
    ...(hote ? pages.map((p): Suggestion => ({ url: `${hote}${p}`, source: "page" })) : []),
  ]
    .filter((s) => {
      const url = s.url.toLowerCase();
      if (vues.has(url) || url === saisie || !url.includes(saisie)) return false;
      vues.add(url);
      return true;
    })
    // Ce qui commence par la saisie d'abord, puis l'historique avant les pages.
    .sort((a, b) => Number(b.url.toLowerCase().startsWith(saisie)) - Number(a.url.toLowerCase().startsWith(saisie)))
    .slice(0, SUGGESTIONS_MAX);
  const visible = ouvert && suggestions.length > 0;

  const ouvrir = (adresse: string) => {
    setOuvert(false);
    setActif(-1);
    onChange(adresse);
    onOuvrir(adresse);
  };

  const clavier = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setOuvert(false);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!visible) return setOuvert(true);
      const pas = e.key === "ArrowDown" ? 1 : -1;
      const n = suggestions.length;
      setActif((i) => (i < 0 ? (pas > 0 ? 0 : n - 1) : (i + pas + n) % n));
      return;
    }
    if ((e.key === "Enter" || (e.key === "Tab" && actif >= 0)) && visible && suggestions[actif]) {
      e.preventDefault();
      ouvrir(suggestions[actif].url);
    }
  };

  return (
    <div className="relative min-w-0 flex-1">
      <Input
        size="sm"
        role="combobox"
        aria-label="Adresse de l’aperçu"
        aria-expanded={visible}
        aria-controls={`${id}-suggestions`}
        aria-autocomplete="list"
        aria-activedescendant={visible && actif >= 0 ? `${id}-${actif}` : undefined}
        placeholder="localhost:3000"
        value={valeur}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => {
          onChange(e.target.value);
          setActif(-1);
          setOuvert(true);
        }}
        onFocus={(e) => {
          setHistorique(lireHistorique());
          setOuvert(true);
          e.currentTarget.select();
        }}
        onBlur={() => setOuvert(false)}
        onKeyDown={clavier}
        className="klyra-mono rounded-sm border-bordure-champ text-ui-2xs text-texte-secondaire"
      />
      {visible && (
        <ul
          id={`${id}-suggestions`}
          role="listbox"
          aria-label="Suggestions d’adresses"
          className="absolute top-full right-0 left-0 z-30 m-0 mt-1 flex max-h-72 list-none flex-col overflow-y-auto rounded-md border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-md"
        >
          {suggestions.map((s, i) => {
            const [h, ...reste] = s.url.split("/");
            return (
              <li
                key={s.url}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === actif}
                // Avant le blur du champ, sinon la liste se ferme sous le clic.
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => ouvrir(s.url)}
                onPointerEnter={() => setActif(i)}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-ui-2xs",
                  i === actif ? "bg-fond-survol" : "bg-transparent",
                )}
              >
                <Icon
                  name={s.source === "historique" ? "clock-backward" : "globe-01"}
                  size={14}
                  className="shrink-0 text-icone-secondaire"
                />
                <span className="klyra-mono min-w-0 flex-1 truncate">
                  <span className="text-texte-tertiaire">{h}</span>
                  <span className="text-texte-principal">/{reste.join("/")}</span>
                </span>
                {s.source === "historique" && <span className="shrink-0 text-texte-tertiaire">Historique</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
