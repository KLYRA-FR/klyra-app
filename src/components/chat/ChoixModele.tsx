"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { LogoFournisseur } from "@/components/ui/LogoFournisseur";
import { ContenuChoixModele } from "./ContenuChoixModele";
import { cheminServeur } from "@/components/serveur/catalogue";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { fournisseur, moteurDe, nomEffort, PAR_DEFAUT } from "@/lib/fournisseurs";
import { placeMenuFlottant, type PlaceMenu } from "@/lib/menu-flottant";
import { useMoteurs, type EtatMoteur } from "@/lib/moteurs";
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

/** Les modèles d'un fournisseur : les alias de Claude Code, ou ceux que le moteur annonce (Codex) sur cette machine. */
export function useModelesDe(moteur: string, lieu: string | null = null): Choix[] {
  const { moteurs } = useMoteurs(lieu);
  return modelesDe(moteur, moteurs);
}

export function modelesDe(moteur: string, moteurs: EtatMoteur[] | null): Choix[] {
  if (moteur === PAR_DEFAUT) {
    return MODELES.map((m) => ({ id: m.id, nom: m.nom, efforts: m.id === "haiku" ? [] : EFFORTS.map((e) => e.id), effortParDefaut: m.id === "haiku" ? null : "high", parDefaut: m.id === "opus" }));
  }
  return moteurs?.find((m) => m.moteur.id === moteur)?.modeles ?? [];
}

/** Le moteur, le modèle et l'effort qui serviront vraiment : ceux de la conversation, sinon ceux de la fiche (ou du moteur). */
export function useModeleEffectif(chat: Chat) {
  const role = useRole(chat.roleIds[0] ?? "principal");
  const moteur = moteurDe(chat);
  const modeles = useModelesDe(moteur, chat.lieu ?? null);
  if (moteur === PAR_DEFAUT) {
    const modeleFiche = MODELES.find((m) => role.model && role.model.includes(m.id))?.id ?? "opus";
    return { moteur, modele: chat.modele ?? modeleFiche, effort: chat.effort ?? "high", modeleFiche };
  }
  const parDefaut = modeles.find((m) => m.parDefaut) ?? modeles[0];
  const modele = chat.modele ?? parDefaut?.id ?? null;
  const effort = chat.effort ?? modeles.find((m) => m.id === modele)?.effortParDefaut ?? null;
  return { moteur, modele, effort, modeleFiche: parDefaut?.id ?? null };
}

/** Le logo du fournisseur, dans le bouton et la colonne du choix. */
function Pastille({ id, taille = "sm" }: { id: string; taille?: "sm" | "md" }) {
  return <LogoFournisseur id={id} initiale={fournisseur(id).initiale} taille={taille === "sm" ? 16 : 32} />;
}

/**
 * Choix du fournisseur, du modèle et de l'effort pour une conversation, dans l'en-tête (ou en champ
 * dans le panneau latéral), comme le choix rapide d'OpenBot : à gauche les fournisseurs installés sur
 * la machine de la conversation (ce poste ou son VPS), à droite leurs modèles. Changer de fournisseur ne change que cette conversation.
 * Bloqué pendant que l'agent travaille.
 */
export function ChoixModele({ chat, variante = "entete" }: { chat: Chat; variante?: "entete" | "champ" }) {
  const router = useRouter();
  const { choisirModele, choisirFournisseur } = useWorkspace();
  const travail = useTravail(chat.id);
  const lieu = chat.lieu ?? null;
  const { moteurs, actualiser } = useMoteurs(lieu);
  const { moteur, modele, effort, modeleFiche } = useModeleEffectif(chat);
  const [ouvert, setOuvert] = useState(false);
  const [vue, setVue] = useState(moteur);
  const [recherche, setRecherche] = useState("");
  const [connexion, setConnexion] = useState<{ etat: "en-cours" } | { etat: "erreur"; message: string } | null>(null);
  const [place, setPlace] = useState<PlaceMenu | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const bouton = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const modelesVue = useModelesDe(vue, lieu);
  const modelesActuels = useModelesDe(moteur, lieu);
  const dansLeTiroir = variante === "champ";

  const placer = useCallback(() => {
    const b = bouton.current;
    if (!b) return;
    const r = b.getBoundingClientRect();
    setPlace(
      placeMenuFlottant(
        { left: r.left, top: r.top, right: r.right, bottom: r.bottom },
        { width: window.innerWidth, height: window.innerHeight },
        menu.current?.offsetHeight || 320,
      ),
    );
  }, []);

  useLayoutEffect(() => {
    if (ouvert && dansLeTiroir) placer();
  }, [ouvert, dansLeTiroir, placer]);

  useEffect(() => {
    if (!ouvert || !dansLeTiroir) return;
    const defilement = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) placer();
    };
    window.addEventListener("resize", placer);
    window.addEventListener("scroll", defilement, true);
    return () => {
      window.removeEventListener("resize", placer);
      window.removeEventListener("scroll", defilement, true);
    };
  }, [ouvert, dansLeTiroir, placer]);

  const placee = place !== null;
  const versLeHaut = place?.versLeHaut ?? false;
  useLayoutEffect(() => {
    if (!ouvert) return;
    if (!dansLeTiroir || placee) apparition(menu.current);
  }, [ouvert, dansLeTiroir, placee, versLeHaut]);

  useEffect(() => {
    if (!ouvert) return;
    const fermer = (e: MouseEvent) => {
      const cible = e.target as Node;
      if (zone.current?.contains(cible) || menu.current?.contains(cible)) return;
      setPlace(null);
      setOuvert(false);
    };
    const echap = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setPlace(null);
      setOuvert(false);
    };
    document.addEventListener("mousedown", fermer);
    document.addEventListener("keydown", echap);
    return () => {
      document.removeEventListener("mousedown", fermer);
      document.removeEventListener("keydown", echap);
    };
  }, [ouvert]);

  const bloque = !!travail;
  const actuel = modelesActuels.find((m) => m.id === modele);
  const nomCourt = actuel?.nom.replace(/^Claude /, "") ?? modele ?? fournisseur(moteur).nom;
  const effortsActuels = actuel?.efforts ?? [];
  const libelle = `${nomCourt}${effort && effortsActuels.includes(effort) ? ` · ${nomEffort(effort)}` : ""}`;

  const ouvrir = () => {
    setVue(moteur);
    setRecherche("");
    setConnexion(null);
    setPlace(null);
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
    if (!m.efforts.length || vue !== moteur) {
      setPlace(null);
      setOuvert(false);
    }
  };

  const seConnecter = async () => {
    const bridge = getBridge()?.moteurs;
    if (!bridge) return;
    // Sur un VPS, la connexion passe par un code à saisir : la page du fournisseur le montre.
    if (lieu) {
      setPlace(null);
      setOuvert(false);
      router.push(cheminServeur("fournisseurs", { fournisseur: vue, serveur: lieu }));
      return;
    }
    setConnexion({ etat: "en-cours" });
    const r = await bridge.connecter(vue);
    await actualiser();
    setConnexion(r.ok ? null : { etat: "erreur", message: r.message });
  };

  const panneau = ouvert ? (
        <div
          ref={menu}
          role="dialog"
          aria-label="Fournisseur, modèle et effort"
          className={cn(
            "flex w-[400px] max-w-[calc(100vw-32px)] rounded-lg border border-bordure-subtile bg-fond-surface shadow-ombre-flottante",
            dansLeTiroir ? cn("fixed z-[70]", !place && "invisible") : "absolute top-full right-0 z-50 mt-2",
          )}
          style={
            dansLeTiroir && place
              ? { top: place.top, bottom: place.bottom, left: place.left, width: place.largeur }
              : undefined
          }
        >
          <ContenuChoixModele
            vue={vue} moteur={moteur} modele={modele} effort={effort} modeleFiche={modeleFiche} lieu={lieu}
            moteurs={moteurs} modelesVue={modelesVue} modelesActuels={modelesActuels}
            recherche={recherche} connexion={connexion}
            onVue={(id) => { setVue(id); setRecherche(""); setConnexion(null); }}
            onRecherche={setRecherche} onModele={choisir}
            onEffort={(id) => choisirModele(chat.id, chat.modele ?? null, id)}
            onConnecter={() => void seConnecter()}
            onAjouter={() => { setPlace(null); setOuvert(false); router.push(cheminServeur("fournisseurs", { serveur: lieu })); }}
          />
        </div>
  ) : null;

  return (
    <div ref={zone} className={cn("relative", variante === "champ" && "w-full")}>
      <button
        ref={bouton}
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
      {panneau && (dansLeTiroir ? createPortal(panneau, document.body) : panneau)}
    </div>
  );
}
