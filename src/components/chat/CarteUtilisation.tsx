"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { getBridge, type FenetreUtilisation, type Utilisation } from "@/lib/bridge";
import { COULEUR_CLAUDE } from "@/data/marques";
import { cn } from "@/lib/cn";
import { useLieuActif } from "@/lib/lieux";
import { pret, useMoteurs, type EtatMoteur } from "@/lib/moteurs";

/**
 * Utilisation de l'abonnement d'un fournisseur (Claude, ChatGPT, Grok), en anneaux concentriques : dehors
 * la semaine, dedans la session de 5 h ; Grok, un seul anneau, les crédits du mois. L'arc montre ce qui
 * reste. Le détail s'ouvre au survol, un clic met à jour. Dans le rail, un bouton par fournisseur connecté
 * du serveur affiché (`UtilisationRail`).
 */

/** Les fournisseurs dont on sait lire les limites d'abonnement, par moteur (cf. electron/utilisation.ts). */
const FOURNISSEURS = {
  claude: { nom: "Claude", programme: "Claude Code", fond: COULEUR_CLAUDE, logo: "/brand/claude-logo-blanc.svg" },
  codex: { nom: "ChatGPT", programme: "Codex", fond: "#FFFFFF", logo: "/brand/openai-logo-noir.svg" },
  grok: { nom: "Grok", programme: "Grok Build", fond: "#FFFFFF", logo: "/logos/ia/grok.svg" },
} as const;
type IdFournisseur = keyof typeof FOURNISSEURS;

/** Relire les limites d'un VPS, de Codex ou de Grok ne consomme rien : au plus une fois par minute, au survol. */
const RELECTURE_MS = 60_000;

/**
 * La dernière utilisation connue d'un moteur, sur ce PC (`lieu` null, mise à jour à chaque réponse
 * d'un agent) ou sur un VPS (relue au survol). `actualiser` la redemande : pour Claude Code sur ce PC,
 * une toute petite requête qui compte un peu, donc seulement au clic.
 */
function useUtilisation(moteur: IdFournisseur, lieu: string | null) {
  const bridge = getBridge()?.moteurs;
  const [utilisation, setUtilisation] = useState<Utilisation | null>(null);
  const [enCours, setEnCours] = useState(false);
  const lueLe = useRef(0);
  /* Relire ne coûte rien, sauf Claude Code sur ce PC (une requête au modèle). */
  const gratuit = moteur !== "claude" || lieu !== null;

  const lire = useCallback(
    async (actualiser: boolean) => {
      if (!bridge?.utilisation) return;
      lueLe.current = Date.now();
      const r = await bridge.utilisation(moteur, lieu, actualiser);
      if (r.ok) setUtilisation(r.data);
    },
    [bridge, moteur, lieu],
  );

  /* Un autre moteur ou un autre serveur est un autre bouton (clé dans UtilisationRail) : rien à remettre à zéro ici. */
  useEffect(() => {
    if (!bridge?.utilisation) return;
    lueLe.current = Date.now();
    void bridge.utilisation(moteur, lieu, gratuit).then((r) => r.ok && setUtilisation(r.data));
    if (lieu !== null || !bridge.onUtilisation) return;
    return bridge.onUtilisation((id, u) => id === moteur && setUtilisation(u));
  }, [bridge, moteur, lieu, gratuit]);

  const actualiser = async () => {
    if (!bridge?.utilisation || enCours) return;
    setEnCours(true);
    await lire(true);
    setEnCours(false);
  };
  /** Au survol : relue si elle est gratuite et date de plus d'une minute. */
  const rafraichir = () => {
    if (gratuit && Date.now() - lueLe.current > RELECTURE_MS) void lire(true);
  };

  return { disponible: !!bridge?.utilisation, utilisation, enCours, actualiser, rafraichir, gratuit };
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

/** Les deux anneaux (Grok : un seul, le mois). `sombre` : posés sur le rail noir. */
function Anneaux({ moteur, utilisation, sombre, taille = 34 }: { moteur: IdFournisseur; utilisation: Utilisation | null; sombre: boolean; taille?: number }) {
  const { fond, logo } = FOURNISSEURS[moteur];
  const anneaux =
    moteur === "grok"
      ? [{ f: utilisation?.mois ?? null, r: 15.875 }]
      : [
          { f: utilisation?.semaine ?? null, r: 15.875 },
          { f: utilisation?.session ?? null, r: 11.375 },
        ];
  return (
    <svg viewBox="0 0 34 34" width={taille} height={taille} aria-hidden="true">
      {/* Les arcs partent de midi : seuls les anneaux tournent, pas le logo au centre. */}
      <g transform="rotate(-90 17 17)">
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
      </g>
      {/* Au centre, le logo du fournisseur sur un rond de sa couleur (Claude : fichier officiel de l'extension Claude Code ; ChatGPT et Grok : public/logos/ia). */}
      <circle cx="17" cy="17" r="8" fill={fond} className={!sombre && moteur !== "claude" ? "stroke-bordure-subtile" : undefined} strokeWidth={0.75} />
      <image href={logo} x="11.5" y="11.5" width="11" height="11" />
    </svg>
  );
}

/** Le détail au survol : une ligne par fenêtre, barre, part restante, temps avant la remise à zéro. */
function Detail({
  moteur,
  utilisation,
  disponible,
  enCours,
  gratuit,
  lieu,
}: {
  moteur: IdFournisseur;
  utilisation: Utilisation | null;
  disponible: boolean;
  enCours: boolean;
  gratuit: boolean;
  lieu: string | null;
}) {
  const { nom, programme } = FOURNISSEURS[moteur];
  /* Claude Code sur un VPS : la dernière reçue d'une session, le clic ne la redemande pas. */
  const relisible = lieu === null || moteur !== "claude";
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
        <span className="text-ui-s font-semibold text-texte-principal">Utilisation de {nom}</span>
        <span className="text-ui-3xs text-texte-tertiaire">restant</span>
      </div>
      {!disponible ? (
        <p className="m-0 text-ui-xs text-texte-tertiaire">Visible dans l’app de bureau.</p>
      ) : !utilisation ? (
        <p className="m-0 text-ui-xs leading-[1.45] text-texte-tertiaire">
          {enCours
            ? "Lecture…"
            : moteur === "codex"
              ? "ChatGPT n’a pas encore donné ses limites (rien à lire avec une clé API). Clic pour réessayer."
              : moteur === "grok"
                ? "Grok n’a pas encore donné ses crédits du mois. Clic pour réessayer."
                : relisible
                ? "Elle s’affiche à la première réponse d’un agent. Clic pour la lire maintenant."
                : "Elle s’affiche à la première réponse d’un agent sur ce serveur."}
        </p>
      ) : !utilisation.session && !utilisation.semaine && !utilisation.mois ? (
        <div className="flex flex-col gap-1.5">
          <p className="m-0 text-ui-xs leading-[1.45] text-texte-tertiaire">
            {enCours ? "Lecture…" : `${programme} n’a pas encore donné le détail des limites.${relisible ? " Clic pour réessayer." : ""}`}
          </p>
          {/* Ce que le fournisseur a répondu (Grok : son erreur, ou les champs de sa réponse sans leurs valeurs). */}
          {utilisation.note && !enCours && <p className="m-0 break-words text-ui-3xs leading-[1.45] text-texte-tertiaire">{utilisation.note}</p>}
        </div>
      ) : (
        <>
          {utilisation.statut === "rejected" && (
            <p role="alert" className="m-0 text-ui-xs font-medium text-texte-erreur">
              {moteur === "grok" ? "Crédits du mois épuisés : les agents reprennent à la remise à zéro." : "Limite atteinte : les agents reprennent à la remise à zéro."}
            </p>
          )}
          {ligne("5 heures", utilisation.session)}
          {ligne("Semaine", utilisation.semaine)}
          {ligne("Mois", utilisation.mois ?? null)}
          <span className="text-ui-3xs text-texte-tertiaire">
            {enCours ? "Mise à jour…" : relisible ? "Clic pour mettre à jour" : gratuit ? "Mise à jour à chaque réponse d’un agent" : null}
          </span>
        </>
      )}
    </div>
  );
}

/** Bouton des anneaux, avec le détail qui s'ouvre au survol (après 250 ms). */
function BoutonAnneaux({
  moteur,
  lieu,
  sombre,
  children,
  className,
  placement,
}: {
  moteur: IdFournisseur;
  lieu: string | null;
  sombre: boolean;
  children?: ReactNode;
  className?: string;
  placement: "droite" | "dessus";
}) {
  const { disponible, utilisation, enCours, actualiser, rafraichir, gratuit } = useUtilisation(moteur, lieu);
  const { nom } = FOURNISSEURS[moteur];
  const [ouvert, setOuvert] = useState(false);
  const minuteur = useRef<ReturnType<typeof setTimeout>>(undefined);
  const programmer = (valeur: boolean, delai: number) => {
    clearTimeout(minuteur.current);
    minuteur.current = setTimeout(() => setOuvert(valeur), delai);
  };
  useEffect(() => () => clearTimeout(minuteur.current), []);

  const resume = utilisation
    ? [
        utilisation.session && `5 h : ${reste(utilisation.session)} % restant`,
        utilisation.semaine && `semaine : ${reste(utilisation.semaine)} %`,
        utilisation.mois && `mois : ${reste(utilisation.mois)} % des crédits restant`,
      ]
        .filter(Boolean)
        .join(", ")
    : "pas encore lue";

  return (
    <div
      className="relative"
      onMouseEnter={() => {
        programmer(true, 250);
        rafraichir();
      }}
      onMouseLeave={() => programmer(false, 75)}
      onFocus={() => setOuvert(true)}
      onBlur={() => setOuvert(false)}
    >
      <button
        type="button"
        onClick={() => void actualiser()}
        aria-label={`Utilisation de ${nom}, ${resume}. Mettre à jour`}
        className={cn(
          "flex cursor-pointer items-center border-0 bg-transparent transition-colors duration-[120ms]",
          sombre ? "hover:bg-white/8" : "hover:bg-fond-survol",
          enCours && "klyra-respire",
          className,
        )}
      >
        <Anneaux moteur={moteur} utilisation={utilisation} sombre={sombre} />
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
          <Detail moteur={moteur} utilisation={utilisation} disponible={disponible} enCours={enCours} gratuit={gratuit} lieu={lieu} />
        </div>
      )}
    </div>
  );
}

/**
 * Les fournisseurs du serveur affiché dont l'abonnement a des limites à montrer : Claude dès qu'il est
 * prêt, ChatGPT connecté par son compte et Grok par son abonnement (une clé API n'a pas de limites).
 * Tant que rien n'est lu, ou que rien n'est prêt, Claude seul, comme avant.
 */
function fournisseursAffiches(moteurs: EtatMoteur[] | null): IdFournisseur[] {
  const prets = (moteurs ?? []).filter(pret);
  const liste: IdFournisseur[] = [];
  if (prets.some((m) => m.moteur.id === "claude")) liste.push("claude");
  if (prets.some((m) => m.moteur.id === "codex" && m.compte?.methode === "chatgpt")) liste.push("codex");
  if (prets.some((m) => m.moteur.id === "grok" && m.compte?.methode === "grok.com")) liste.push("grok");
  return liste.length ? liste : ["claude"];
}

/** Dans le rail : les anneaux de chaque fournisseur connecté du serveur affiché, le détail au survol. */
export function UtilisationRail() {
  const lieu = useLieuActif();
  const { moteurs } = useMoteurs(lieu);
  return (
    <>
      {fournisseursAffiches(moteurs).map((id) => (
        <BoutonAnneaux key={`${lieu ?? ""}|${id}`} moteur={id} lieu={lieu} sombre placement="droite" className="size-12 justify-center rounded-md p-0" />
      ))}
    </>
  );
}

/** Dans Réglages › Claude : les anneaux de Claude sur ce PC et « Claude », sur une ligne de menu. */
export function CarteUtilisation() {
  return (
    <BoutonAnneaux moteur="claude" lieu={null} sombre={false} placement="dessus" className="h-11 w-full gap-3 rounded-sm px-2 text-left">
      <span className="flex min-w-0 flex-col">
        <span className="text-ui font-medium text-texte-secondaire">Utilisation</span>
        <span className="text-ui-3xs text-texte-tertiaire">Claude · semaine et 5 h</span>
      </span>
    </BoutonAnneaux>
  );
}
