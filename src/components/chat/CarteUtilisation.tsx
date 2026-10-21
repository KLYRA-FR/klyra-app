"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { getBridge, type FenetreUtilisation, type Utilisation } from "@/lib/bridge";
import { cn } from "@/lib/cn";

/**
 * Utilisation de l'abonnement Claude, en anneaux concentriques : dehors la
 * semaine, dedans la session de 5 h. L'arc montre ce qui reste. Le détail
 * s'ouvre au survol, un clic met à jour.
 */

/** La dernière utilisation connue, mise à jour à chaque réponse d'un agent. */
function useUtilisation() {
  const bridge = getBridge();
  const [utilisation, setUtilisation] = useState<Utilisation | null>(null);
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    if (!bridge) return;
    void bridge.claude.utilisation().then((r) => r.ok && setUtilisation(r.data));
    return bridge.claude.onUtilisation(setUtilisation);
  }, [bridge]);

  const actualiser = async () => {
    if (!bridge || enCours) return;
    setEnCours(true);
    const r = await bridge.claude.actualiserUtilisation();
    if (r.ok && r.data) setUtilisation(r.data);
    setEnCours(false);
  };

  return { disponible: !!bridge, utilisation, enCours, actualiser };
}

/** Part restante, de 0 à 100. */
const reste = (f: FenetreUtilisation) => Math.max(0, Math.min(100, Math.round((1 - f.utilise) * 100)));

/** « 1 h 12 », « 5 j 2 h » : le temps avant la remise à zéro. */
function avantRemise(ms: number | null, maintenant: number): string | null {
  if (!ms) return null;
  const min = Math.max(0, Math.round((ms - maintenant) / 60_000));
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} h ${String(min % 60).padStart(2, "0")}`;
  return `${Math.floor(h / 24)} j ${h % 24} h`;
}

/** Les deux anneaux. `sombre` : posés sur le rail noir. */
function Anneaux({ utilisation, sombre, taille = 34 }: { utilisation: Utilisation | null; sombre: boolean; taille?: number }) {
  const anneaux = [
    { f: utilisation?.semaine ?? null, r: 15.875 },
    { f: utilisation?.session ?? null, r: 11.375 },
  ];
  return (
    <svg viewBox="0 0 34 34" width={taille} height={taille} aria-hidden="true" className="-rotate-90">
      {anneaux.map(({ f, r }) => {
        const pourcent = f ? reste(f) : 0;
        const bas = f !== null && pourcent < 30;
        return (
          <g key={r}>
            <circle
              cx="17"
              cy="17"
              r={r}
              fill="none"
              strokeWidth="2.25"
              className={sombre ? "stroke-white/15" : "stroke-fond-surface-grise"}
            />
            {f && (
              <circle
                cx="17"
                cy="17"
                r={r}
                fill="none"
                strokeWidth="2.25"
                strokeLinecap="round"
                pathLength={100}
                strokeDasharray={`${Math.max(pourcent, 1)} 100`}
                className={cn(
                  "transition-[stroke-dasharray] duration-[700ms] ease-sortie",
                  bas ? (sombre ? "stroke-bordure-erreur" : "stroke-texte-erreur") : sombre ? "stroke-white" : "stroke-bleu-k1-500",
                )}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

/** Le détail au survol : une ligne par fenêtre, barre, part restante, temps avant la remise à zéro. */
function Detail({ utilisation, disponible, enCours }: { utilisation: Utilisation | null; disponible: boolean; enCours: boolean }) {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setMaintenant(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const ligne = (libelle: string, f: FenetreUtilisation | null) => {
    if (!f) return null;
    const p = reste(f);
    return (
      <div key={libelle} className="grid grid-cols-[64px_minmax(0,1fr)_36px_56px] items-center gap-2">
        <span className="text-ui-xs text-texte-secondaire">{libelle}</span>
        <span className="h-1 overflow-hidden rounded-pill bg-fond-surface-grise">
          <span className={cn("block h-full rounded-pill", p < 30 ? "bg-texte-erreur" : "bg-bleu-k1-500")} style={{ width: `${p}%` }} />
        </span>
        <span className="klyra-mono text-right text-ui-xs font-medium text-texte-principal">{p} %</span>
        <span
          className="klyra-mono text-right text-ui-3xs text-texte-tertiaire"
          title={f.reinitialiseA ? `Repart à zéro le ${new Date(f.reinitialiseA).toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" })}` : undefined}
        >
          {avantRemise(f.reinitialiseA, maintenant)}
        </span>
      </div>
    );
  };

  return (
    <div className="flex w-[300px] flex-col gap-3 rounded-lg border border-bordure-subtile bg-fond-surface p-3 shadow-ombre-flottante">
      <div className="flex items-baseline justify-between">
        <span className="text-ui-s font-semibold text-texte-principal">Utilisation de Claude</span>
        <span className="text-ui-3xs text-texte-tertiaire">restant</span>
      </div>
      {!disponible ? (
        <p className="m-0 text-ui-xs text-texte-tertiaire">Visible dans l’app de bureau.</p>
      ) : !utilisation ? (
        <p className="m-0 text-ui-xs leading-[1.45] text-texte-tertiaire">
          {enCours ? "Lecture…" : "Elle s’affiche à la première réponse d’un agent. Clic pour la lire maintenant."}
        </p>
      ) : (
        <>
          {utilisation.statut === "rejected" && (
            <p role="alert" className="m-0 text-ui-xs font-medium text-texte-erreur">
              Limite atteinte : les agents reprennent à la remise à zéro.
            </p>
          )}
          {ligne("5 heures", utilisation.session)}
          {ligne("Semaine", utilisation.semaine)}
          <span className="text-ui-3xs text-texte-tertiaire">{enCours ? "Mise à jour…" : "Clic pour mettre à jour"}</span>
        </>
      )}
    </div>
  );
}

/** Bouton des anneaux, avec le détail qui s'ouvre au survol (après 250 ms). */
function BoutonAnneaux({
  sombre,
  children,
  className,
  placement,
}: {
  sombre: boolean;
  children?: ReactNode;
  className?: string;
  placement: "droite" | "dessus";
}) {
  const { disponible, utilisation, enCours, actualiser } = useUtilisation();
  const [ouvert, setOuvert] = useState(false);
  const minuteur = useRef<ReturnType<typeof setTimeout>>(undefined);
  const programmer = (valeur: boolean, delai: number) => {
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => setOuvert(valeur), delai);
  };
  useEffect(() => () => clearTimeout(minuteur.current), []);

  const resume = utilisation
    ? [utilisation.session && `5 h : ${reste(utilisation.session)} % restant`, utilisation.semaine && `semaine : ${reste(utilisation.semaine)} %`]
        .filter(Boolean)
        .join(", ")
    : "pas encore lue";

  return (
    <div
      className="relative"
      onMouseEnter={() => programmer(true, 250)}
      onMouseLeave={() => programmer(false, 75)}
      onFocus={() => setOuvert(true)}
      onBlur={() => setOuvert(false)}
    >
      <button
        type="button"
        onClick={() => void actualiser()}
        aria-label={`Utilisation de Claude, ${resume}. Mettre à jour`}
        className={cn(
          "flex cursor-pointer items-center border-0 bg-transparent transition-colors duration-[120ms]",
          sombre ? "hover:bg-white/8" : "hover:bg-fond-survol",
          enCours && "klyra-respire",
          className,
        )}
      >
        <Anneaux utilisation={utilisation} sombre={sombre} />
        {children}
      </button>
      {ouvert && (
        <div
          role="tooltip"
          className={cn(
            "absolute z-50",
            placement === "droite" ? "bottom-0 left-full ml-2" : "bottom-full left-0 mb-2",
          )}
        >
          <Detail utilisation={utilisation} disponible={disponible} enCours={enCours} />
        </div>
      )}
    </div>
  );
}

/** Dans le rail noir : les anneaux seuls. */
export function UtilisationRail() {
  return <BoutonAnneaux sombre placement="droite" className="size-11 justify-center rounded-md p-0" />;
}

/** Dans le menu complet : les anneaux et « Claude », sur une ligne de menu. */
export function CarteUtilisation() {
  return (
    <BoutonAnneaux sombre={false} placement="dessus" className="h-11 w-full gap-3 rounded-sm px-2 text-left">
      <span className="flex min-w-0 flex-col">
        <span className="text-ui font-medium text-texte-secondaire">Utilisation</span>
        <span className="text-ui-3xs text-texte-tertiaire">Claude · semaine et 5 h</span>
      </span>
    </BoutonAnneaux>
  );
}
