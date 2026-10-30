"use client";

import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { PreferencesSons } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { poste } from "@/lib/plateforme";
import { useReglages } from "@/lib/reglages";
import { apercu, essai, useSilenceSysteme } from "@/lib/sons/sons";
import { THEMES, type ThemeSons } from "@/lib/sons/themes";
import { ApercuSons } from "./ApercuSons";
import { Groupe, Interrupteur, Ligne } from "./ui";

/** Le temps de l'aperçu d'un thème : la carte s'anime pendant qu'il sonne. */
const DUREE_APERCU_MS = 2000;

/** Les cartes des thèmes, en boutons radio : un clic choisit le thème et le fait entendre. */
function ThemesSons({ choisi, onChoisir }: { choisi: ThemeSons | null; onChoisir: (theme: ThemeSons) => void }) {
  const [survol, setSurvol] = useState<ThemeSons | null>(null);
  const [joue, setJoue] = useState<ThemeSons | null>(null);
  const cartes = useRef<(HTMLButtonElement | null)[]>([]);

  useEffect(() => {
    if (!joue) return;
    const minuteur = setTimeout(() => setJoue(null), DUREE_APERCU_MS);
    return () => clearTimeout(minuteur);
  }, [joue]);

  const choisir = (theme: ThemeSons) => {
    onChoisir(theme);
    apercu(theme);
    setJoue(theme);
  };

  /* Flèches : la carte voisine, choisie et entendue (comme un groupe de boutons radio). */
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const pas = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
    if (!pas) return;
    event.preventDefault();
    const i = THEMES.findIndex((t) => t.id === choisi);
    const suivant = (i + pas + THEMES.length) % THEMES.length;
    choisir(THEMES[suivant].id);
    cartes.current[suivant]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Sons des actions"
      onKeyDown={onKeyDown}
      className="grid w-full grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2"
    >
      {THEMES.map((t, i) => {
        const actif = t.id === choisi;
        return (
          <button
            key={t.id}
            ref={(el) => {
              cartes.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={actif}
            tabIndex={actif || (!choisi && i === 0) ? 0 : -1}
            disabled={!choisi}
            onClick={() => choisir(t.id)}
            onPointerEnter={() => setSurvol(t.id)}
            onPointerLeave={() => setSurvol((s) => (s === t.id ? null : s))}
            className={cn(
              "flex cursor-pointer flex-col gap-2 rounded-lg border bg-fond-surface p-1.5 text-left",
              "transition-[border-color,box-shadow,background-color] duration-[160ms] ease-sortie",
              "disabled:cursor-not-allowed disabled:opacity-50",
              actif ? "border-fond-accent shadow-[0_0_0_1px_var(--color-fond-accent)]" : "border-bordure-defaut hover:bg-fond-survol",
            )}
          >
            <ApercuSons theme={t.id} anime={actif || survol === t.id || joue === t.id} />
            <span className="flex flex-col gap-0.5 px-1.5 pb-1">
              <span className="text-ui-s font-semibold text-texte-principal">{t.titre}</span>
              <span className="text-ui-xs leading-[1.35] text-texte-tertiaire">{t.matiere}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** Le volume, de 0 à 100 % : enregistré quand on lâche le curseur, et entendu aussitôt. */
function VolumeSons({ sons, disabled, onChanger }: { sons: PreferencesSons | undefined; disabled: boolean; onChanger: (volume: number) => void }) {
  const [valeur, setValeur] = useState<number | null>(null);
  const affiche = Math.round((valeur ?? sons?.volume ?? 0) * 100);

  const valider = () => {
    if (valeur === null) return;
    onChanger(valeur);
    essai("validation", valeur);
    setValeur(null);
  };

  return (
    <>
      <input
        type="range"
        min={0}
        max={100}
        step={5}
        value={affiche}
        disabled={disabled || !sons}
        aria-label="Volume des sons"
        aria-valuetext={`${affiche} %`}
        onChange={(e) => setValeur(Number(e.target.value) / 100)}
        onPointerUp={valider}
        onKeyUp={valider}
        onBlur={valider}
        className="klyra-curseur w-40"
        style={{ "--valeur": `${affiche}%` } as CSSProperties}
      />
      <span className="klyra-mono w-10 text-right text-ui-xs text-texte-secondaire">{affiche} %</span>
    </>
  );
}

/**
 * Les sons joués par KLYRA (src/lib/sons/), dans Réglages → Notifications :
 * la fin de tâche à part, le thème des sons des actions, le volume.
 */
export function SonsReglages() {
  const { reglages, changerSons } = useReglages();
  const silence = useSilenceSysteme();
  const sons = reglages?.sons;

  return (
    <Groupe titre="Sons" description="De courts sons joués par KLYRA, en plus des notifications du système.">
      <Ligne id="son-fin-tache" libelle="Émettre un son à la fin d’une tâche" description="Un son court quand un agent a fini.">
        <Interrupteur
          libelle="Émettre un son à la fin d’une tâche"
          actif={!!sons?.finDeTache}
          disabled={!sons}
          sansSon
          onChange={(v) => {
            void changerSons({ finDeTache: v });
            if (v) essai("fin-de-tache");
          }}
        />
      </Ligne>
      <Ligne
        id="sons-actions"
        pile
        libelle="Sons des actions"
        description="De courts sons accompagnent l’interface : clics, menus et fenêtres, onglets, envoi d’un message. Clique sur un thème pour l’entendre."
      >
        <ThemesSons choisi={sons?.theme ?? null} onChoisir={(theme) => void changerSons({ theme })} />
      </Ligne>
      <Ligne id="volume-sons" libelle="Volume" description="Le volume des sons de KLYRA, dans la limite de celui du système.">
        <VolumeSons sons={sons} disabled={!!sons && sons.theme === "silence" && !sons.finDeTache} onChanger={(volume) => void changerSons({ volume })} />
      </Ligne>
      {silence.sonsCoupes && (
        <Ligne
          libelle={`Les sons de l’interface sont coupés sur ${poste.ce}`}
          description={`KLYRA se tait donc aussi, sauf les aperçus. Pour les entendre : ${poste.reglagesSons}.`}
        />
      )}
    </Groupe>
  );
}
