"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { fournisseur, FOURNISSEURS, moteurDe, nomEffort, PAR_DEFAUT } from "@/lib/fournisseurs";
import { useMoteurs } from "@/lib/moteurs";
import { apparition } from "@/lib/mouvement";
import { useRole, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat } from "@/types/domain";

/** Les modèles Claude, du plus récent au plus léger (alias de Claude Code). */
export const MODELES = [
  { id: "fable", nom: "Claude Fable 5.1" },
  { id: "opus", nom: "Claude Opus 5.5" },
  { id: "sonnet", nom: "Claude Sonnet 5.5" },
  { id: "haiku", nom: "Claude Haiku 5.5" },
] as const;

/** Niveaux d'effort de réflexion. Haiku n'en a qu'un : la ligne est masquée. */
export const EFFORTS = [
  { id: "low", nom: "Bas" },
  { id: "medium", nom: "Moyen" },
  { id: "high", nom: "Élevé" },
  { id: "xhigh", nom: "Très élevé" },
  { id: "max", nom: "Max" },
] as const;

/** Le nom court d'un modèle (« Opus 5.5 »), d'après l'alias ou l'id complet de la fiche. */
export function nomModele(id: string | null | undefined): string {
  if (!id) return "Claude Opus 5.5";
  const m = MODELES.find((x) => x.id === id || id.includes(x.id));
  return m?.nom ?? id;
}

/** Un modèle dans le choix : son nom et les efforts qu'il accepte (aucun : la ligne d'effort est masquée). */
interface Choix {
  id: string;
  nom: string;
  efforts: string[];
  effortParDefaut: string | null;
  parDefaut: boolean;
}

/** Les modèles d'un fournisseur : les alias de Claude Code, ou ceux que le moteur annonce (Codex). */
export function useModelesDe(moteur: string): Choix[] {
  const { moteurs } = useMoteurs();
  if (moteur === PAR_DEFAUT) {
    return MODELES.map((m) => ({ id: m.id, nom: m.nom, efforts: m.id === "haiku" ? [] : EFFORTS.map((e) => e.id), effortParDefaut: m.id === "haiku" ? null : "high", parDefaut: m.id === "opus" }));
  }
  return moteurs?.find((m) => m.moteur.id === moteur)?.modeles ?? [];
}

/** Le moteur, le modèle et l'effort qui serviront vraiment : ceux de la conversation, sinon ceux de la fiche (ou du moteur). */
export function useModeleEffectif(chat: Chat) {
  const role = useRole(chat.roleIds[0] ?? "principal");
  const moteur = moteurDe(chat);
  const modeles = useModelesDe(moteur);
  if (moteur === PAR_DEFAUT) {
    const modeleFiche = MODELES.find((m) => role.model && role.model.includes(m.id))?.id ?? "opus";
    return { moteur, modele: chat.modele ?? modeleFiche, effort: chat.effort ?? "high", modeleFiche };
  }
  const parDefaut = modeles.find((m) => m.parDefaut) ?? modeles[0];
  const modele = chat.modele ?? parDefaut?.id ?? null;
  const effort = chat.effort ?? modeles.find((m) => m.id === modele)?.effortParDefaut ?? null;
  return { moteur, modele, effort, modeleFiche: parDefaut?.id ?? null };
}

/** Le petit carré du fournisseur, dans le bouton et la colonne du choix. */
function Pastille({ id, taille = "sm" }: { id: string; taille?: "sm" | "md" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex shrink-0 items-center justify-center rounded-2xs font-semibold",
        id === PAR_DEFAUT ? "bg-bleu-k1-500 text-texte-inverse" : "bg-fond-inverse-fort text-texte-inverse",
        taille === "sm" ? "size-4 text-ui-3xs" : "size-8 text-ui-s",
      )}
    >
      {fournisseur(id).initiale}
    </span>
  );
}

/**
 * Choix du fournisseur, du modèle et de l'effort pour une conversation, dans l'en-tête (ou en champ
 * dans le panneau latéral), comme le choix rapide d'OpenBot : à gauche les fournisseurs prêts sur
 * ce poste, à droite leurs modèles. Changer de fournisseur ne change que cette conversation.
 * Bloqué pendant que l'agent travaille.
 */
export function ChoixModele({ chat, variante = "entete" }: { chat: Chat; variante?: "entete" | "champ" }) {
  const { choisirModele, choisirFournisseur } = useWorkspace();
  const travail = useTravail(chat.id);
  const { moteurs, actualiser } = useMoteurs();
  const { moteur, modele, effort, modeleFiche } = useModeleEffectif(chat);
  const [ouvert, setOuvert] = useState(false);
  const [vue, setVue] = useState(moteur);
  const [recherche, setRecherche] = useState("");
  const [connexion, setConnexion] = useState<{ etat: "en-cours" } | { etat: "erreur"; message: string } | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const modelesVue = useModelesDe(vue);
  const modelesActuels = useModelesDe(moteur);

  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => {
      if (!zone.current?.contains(e.target as Node)) setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => e.key === "Escape" && setOuvert(false);
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  const bloque = !!travail;
  // Sur un VPS, les agents travaillent avec Claude Code seul pour l'instant.
  const disponibles = FOURNISSEURS.filter((f) => f.id === PAR_DEFAUT || (!chat.lieu && moteurs?.some((m) => m.moteur.id === f.id && m.moteur.chemin)));
  const etatVue = moteurs?.find((m) => m.moteur.id === vue);
  const actuel = modelesActuels.find((m) => m.id === modele);
  const nomCourt = actuel?.nom.replace(/^Claude /, "") ?? modele ?? fournisseur(moteur).nom;
  const effortsActuels = actuel?.efforts ?? [];
  const libelle = `${nomCourt}${effort && effortsActuels.includes(effort) ? ` · ${nomEffort(effort)}` : ""}`;
  const filtres = modelesVue.filter((m) => m.nom.toLowerCase().includes(recherche.trim().toLowerCase()));
  const connecte = vue === PAR_DEFAUT || !!etatVue?.compte?.connecte;

  const ouvrir = () => {
    setVue(moteur);
    setRecherche("");
    setConnexion(null);
    setOuvert((v) => !v);
  };

  const choisir = (m: Choix) => {
    if (vue === moteur) {
      // Claude : revenir au modèle de la fiche efface le choix, comme avant.
      const garde = vue === PAR_DEFAUT && m.id === modeleFiche && !chat.modele ? null : m.id;
      choisirModele(chat.id, garde, m.efforts.length ? (effort && m.efforts.includes(effort) ? effort : m.effortParDefaut) : null);
    } else {
      const garde = vue === PAR_DEFAUT && m.id === modeleFiche ? null : m.id;
      choisirFournisseur(chat.id, vue, garde, effort && m.efforts.includes(effort) ? effort : null);
    }
    if (!m.efforts.length || vue !== moteur) setOuvert(false);
  };

  const seConnecter = async () => {
    const bridge = getBridge()?.moteurs;
    if (!bridge) return;
    setConnexion({ etat: "en-cours" });
    const r = await bridge.connecter(vue);
    await actualiser();
    setConnexion(r.ok ? null : { etat: "erreur", message: r.message });
  };

  return (
    <div ref={zone} className={cn("relative", variante === "champ" && "w-full")}>
      <button
        type="button"
        onClick={ouvrir}
        disabled={bloque}
        aria-expanded={ouvert}
        aria-haspopup="dialog"
        title={bloque ? "Attends la fin du travail en cours pour changer de modèle." : `${fournisseur(moteur).nom} · ${actuel?.nom ?? nomCourt}${effort ? ` · effort ${nomEffort(effort)}` : ""}`}
        className={cn(
          "flex cursor-pointer items-center gap-1.5 rounded-xs border border-bordure-subtile bg-fond-surface text-texte-principal transition-[border-color,scale] duration-[120ms] ease-sortie hover:border-bordure-forte active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-60",
          variante === "entete" ? "h-8 max-w-[260px] px-2.5 text-ui-s" : "h-11 w-full px-3 text-ui",
        )}
      >
        <Pastille id={moteur} />
        <span className="truncate font-medium">{libelle}</span>
        <Icon
          name="chevron-down"
          size={14}
          className={cn("ml-auto shrink-0 text-icone-secondaire transition-transform duration-[220ms] ease-sortie", ouvert && "rotate-180")}
        />
      </button>

      {ouvert && (
        <div
          ref={apparition}
          role="dialog"
          aria-label="Fournisseur, modèle et effort"
          className={cn(
            "absolute top-full z-50 mt-2 flex w-[400px] max-w-[calc(100vw-32px)] rounded-lg border border-bordure-subtile bg-fond-surface shadow-ombre-flottante",
            variante === "entete" ? "right-0" : "left-0",
          )}
        >
          {/* Les fournisseurs prêts sur ce poste. */}
          <div role="tablist" aria-label="Fournisseurs" aria-orientation="vertical" className="flex w-14 shrink-0 flex-col items-center gap-1.5 border-r border-bordure-subtile p-2">
            {disponibles.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                aria-selected={vue === f.id}
                title={f.nom}
                onClick={() => {
                  setVue(f.id);
                  setRecherche("");
                  setConnexion(null);
                }}
                className={cn(
                  "flex size-10 cursor-pointer items-center justify-center rounded-sm border-0 bg-transparent hover:bg-fond-survol",
                  vue === f.id && "bg-fond-surface-grise",
                )}
              >
                <Pastille id={f.id} taille="md" />
                <span className="sr-only">{f.nom}</span>
              </button>
            ))}
          </div>

          <div className="flex min-w-0 flex-1 flex-col">
            <div className="flex flex-col gap-0.5 px-3 pt-3 pb-2">
              <span className="truncate text-ui-s font-medium text-texte-principal">
                {fournisseur(vue).nom}
                {etatVue?.compte?.email ? ` · ${etatVue.compte.email}` : ""}
              </span>
              <span className="text-ui-xs text-texte-tertiaire">
                {vue === moteur ? "Dans cette conversation" : `Passer cette conversation sur ${fournisseur(vue).nom}`}
              </span>
            </div>

            {connecte ? (
              <>
                {modelesVue.length > 6 && (
                  <div className="px-3 pb-2">
                    <input
                      type="search"
                      value={recherche}
                      onChange={(e) => setRecherche(e.target.value)}
                      placeholder="Rechercher des modèles"
                      aria-label="Rechercher des modèles"
                      className="h-8 w-full rounded-xs border border-bordure-subtile bg-fond-surface-grise px-2.5 text-ui-s text-texte-principal placeholder:text-texte-tertiaire focus:border-bordure-forte focus:outline-none"
                    />
                  </div>
                )}
                <div role="radiogroup" aria-label="Modèle" className="flex max-h-[320px] flex-col gap-0.5 overflow-y-auto px-1.5 pb-1.5">
                  {filtres.map((m) => {
                    const choisi = vue === moteur && m.id === modele;
                    return (
                      <button
                        key={m.id}
                        type="button"
                        role="radio"
                        aria-checked={choisi}
                        onClick={() => choisir(m)}
                        className="flex h-9 shrink-0 cursor-pointer items-center gap-2.5 rounded-sm border-0 bg-transparent px-2 text-left hover:bg-fond-survol"
                      >
                        {/* Rond plein et coche quand c'est le modèle choisi. */}
                        <span
                          aria-hidden="true"
                          className={cn(
                            "flex size-4 shrink-0 items-center justify-center rounded-full border",
                            choisi ? "border-bleu-k1-500 bg-bleu-k1-500 text-texte-inverse" : "border-bordure-forte",
                          )}
                        >
                          {choisi && <Icon name="check-01" size={12} />}
                        </span>
                        <span className="flex-1 truncate text-ui-s text-texte-principal">{m.nom}</span>
                        {(vue === PAR_DEFAUT ? m.id === modeleFiche : m.parDefaut) && (
                          <span className="rounded-2xs bg-fond-surface-grise px-1.5 py-px text-ui-3xs font-medium text-texte-secondaire">
                            {vue === PAR_DEFAUT ? "fiche" : "par défaut"}
                          </span>
                        )}
                      </button>
                    );
                  })}
                  {!filtres.length && <p className="m-0 px-2 py-2 text-ui-xs text-texte-tertiaire">{modelesVue.length ? "Aucun modèle ne correspond." : "Lecture des modèles…"}</p>}
                </div>
              </>
            ) : (
              <div className="flex flex-col items-start gap-2 px-3 pb-3">
                <p className="m-0 text-ui-xs text-texte-secondaire">{fournisseur(vue).nom} n’est pas connecté sur ce poste.</p>
                <button
                  type="button"
                  onClick={() => void seConnecter()}
                  disabled={connexion?.etat === "en-cours"}
                  className="h-8 cursor-pointer rounded-xs border border-bordure-subtile bg-fond-surface px-3 text-ui-s font-medium text-texte-principal hover:border-bordure-forte disabled:cursor-wait disabled:opacity-60"
                >
                  {connexion?.etat === "en-cours" ? "Connexion dans le navigateur…" : "Se connecter"}
                </button>
                {connexion?.etat === "erreur" && (
                  <p role="alert" className="m-0 text-ui-xs text-texte-erreur">
                    {connexion.message}
                  </p>
                )}
              </div>
            )}

            {vue === moteur && effortsActuels.length > 0 && (
              <div className="flex flex-col gap-1.5 border-t border-bordure-subtile p-3">
                <span className="text-ui-xs font-medium text-texte-tertiaire">Effort de réflexion</span>
                <div
                  role="radiogroup"
                  aria-label="Effort"
                  className="grid gap-0.5 rounded-sm bg-fond-surface-grise p-0.5"
                  style={{ gridTemplateColumns: `repeat(${effortsActuels.length}, minmax(0, 1fr))` }}
                >
                  {effortsActuels.map((id) => {
                    const choisi = id === effort;
                    return (
                      <button
                        key={id}
                        type="button"
                        role="radio"
                        aria-checked={choisi}
                        title={nomEffort(id)}
                        onClick={() => choisirModele(chat.id, chat.modele ?? null, id)}
                        className={cn(
                          "h-7 cursor-pointer truncate rounded-2xs border-0 px-1 text-ui-2xs font-medium transition-colors duration-[220ms] ease-sortie",
                          choisi ? "bg-fond-surface text-texte-principal shadow-ombre-xs" : "bg-transparent text-texte-secondaire hover:text-texte-principal",
                        )}
                      >
                        {nomEffort(id)}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
            {chat.lieu && disponibles.length === 1 && moteurs?.some((m) => m.moteur.id !== PAR_DEFAUT && m.moteur.chemin) && (
              <p className="m-0 border-t border-bordure-subtile px-3 py-2 text-ui-xs text-texte-tertiaire">Sur un serveur distant, les agents travaillent avec Claude pour l’instant.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
