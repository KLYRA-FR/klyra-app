"use client";

import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { usePriseEnMain } from "@/lib/prise-en-main";
import { useLieuActif } from "@/lib/lieux";
import { CLE_VISITE, ETAPES_VISITE, lireProgressionVisite, type ProgressionVisite } from "@/lib/visite-guidee";

const Contexte = createContext<{ ouvrir: () => void; reprendre: boolean } | null>(null);
export const useVisiteGuidee = () => useContext(Contexte);
type Rectangle = { left: number; top: number; width: number; height: number };

export function VisiteGuideeProvider({ children }: { children: ReactNode }) {
  const { etat, test } = usePriseEnMain();
  const lieu = useLieuActif();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const adresse = pathname + (params.size ? `?${params.toString()}` : "");
  const origine = useRef(adresse);
  const declencheur = useRef<HTMLElement | null>(null);
  const [progression, setProgression] = useState<ProgressionVisite | null>(() => {
    try { return lireProgressionVisite(localStorage.getItem(CLE_VISITE)); } catch { return null; }
  });
  const [ouverte, setOuverte] = useState(false);
  const [stockageIndisponible, setStockageIndisponible] = useState(false);
  const invitation = !progression && etat?.etape === "termine" && !!etat.conversation && !lieu && !test;
  const etape = progression?.etape ?? 0;
  const [cheminCible, requeteCible] = ETAPES_VISITE[etape].href.split("?");
  // Certaines pages ajoutent leur sélection à l’URL (ex. l’agent des routines).
  const prete = pathname === cheminCible && [...new URLSearchParams(requeteCible)].every(([cle, valeur]) => params.get(cle) === valeur);
  useEffect(() => {
    if (!ouverte || prete) return;
    // Une page quittée peut encore normaliser son URL (routines, réglages).
    // La visite garde la destination demandée malgré cette navigation tardive.
    const timer = setTimeout(() => router.replace(ETAPES_VISITE[etape].href, { scroll: false }), 100);
    return () => clearTimeout(timer);
  }, [ouverte, prete, etape, adresse, router]);
  const enregistrer = useCallback((statut: ProgressionVisite["statut"], index: number) => {
    const suite: ProgressionVisite = { version: 1, statut, etape: index };
    setProgression(suite);
    try { localStorage.setItem(CLE_VISITE, JSON.stringify(suite)); }
    catch { setStockageIndisponible(true); }
  }, []);

  const ouvrir = () => {
    origine.current = adresse;
    declencheur.current = document.getElementById("revoir-visite-guidee") ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    const index = progression?.statut === "pause" ? progression.etape : 0;
    enregistrer("en-cours", index);
    setOuverte(true);
    router.replace(ETAPES_VISITE[index].href, { scroll: false });
  };
  const fermer = (fin = false) => {
    enregistrer(ouverte ? (fin ? "terminee" : "pause") : "passee", etape);
    setOuverte(false);
    if (ouverte) router.replace(origine.current, { scroll: false });
  };
  // Après la navigation de retour, rendre le focus au bouton d’aide remonté.
  useEffect(() => {
    if (ouverte || invitation || adresse !== origine.current || !declencheur.current) return;
    const timer = setTimeout(() => {
      const cible = declencheur.current;
      (cible?.isConnected ? cible : document.getElementById("revoir-visite-guidee"))?.focus();
      declencheur.current = null;
    }, 100);
    return () => clearTimeout(timer);
  }, [ouverte, invitation, adresse]);

  return <Contexte.Provider value={{ ouvrir, reprendre: progression?.statut === "pause" }}>
    {children}
    {(ouverte || invitation) && <Guide
      invitation={!ouverte}
      index={etape}
      prete={prete}
      stockageIndisponible={stockageIndisponible}
      commencer={ouvrir}
      fermer={fermer}
      aller={(index) => { enregistrer("en-cours", index); router.replace(ETAPES_VISITE[index].href, { scroll: false }); }}
    />}
  </Contexte.Provider>;
}

function Guide({ invitation, index, prete, stockageIndisponible, commencer, fermer, aller }: {
  invitation: boolean; index: number; prete: boolean; stockageIndisponible: boolean;
  commencer: () => void; fermer: (fin?: boolean) => void; aller: (index: number) => void;
}) {
  const dialogue = useRef<HTMLDialogElement>(null);
  const carte = useRef<HTMLElement>(null);
  const [zone, setZone] = useState<Rectangle | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const etape = ETAPES_VISITE[index];
  useEffect(() => {
    const el = dialogue.current;
    el?.showModal();
    return () => el?.close();
  }, []);
  useEffect(() => { carte.current?.focus({ preventScroll: true }); }, [index, invitation]);

  useLayoutEffect(() => {
    if (invitation) return;
    let frame = 0;
    let cible: HTMLElement | null = null;
    const mesurer = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const suivante = prete ? document.querySelector<HTMLElement>(etape.cible) : null;
        if (suivante !== cible) {
          if (cible) resize.unobserve(cible);
          cible = suivante;
          if (cible) {
            cible.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
            resize.observe(cible);
          }
        }
        const rect = cible?.getBoundingClientRect();
        const marge = 8;
        const z = rect && rect.width > 0 && rect.height > 0 && rect.left < innerWidth && rect.top < innerHeight && rect.right > 0 && rect.bottom > 0 ? {
          left: Math.max(marge, rect.left - marge), top: Math.max(marge, rect.top - marge),
          width: Math.min(innerWidth - marge, rect.right + marge) - Math.max(marge, rect.left - marge),
          height: Math.min(innerHeight - marge, rect.bottom + marge) - Math.max(marge, rect.top - marge),
        } : null;
        setZone((avant) => JSON.stringify(avant) === JSON.stringify(z) ? avant : z);
        const largeur = carte.current?.offsetWidth ?? 400;
        const hauteur = carte.current?.offsetHeight ?? 320;
        const aDroite = z && z.left + z.width + 24 + largeur <= innerWidth - 16;
        const aGauche = z && z.left - 24 - largeur >= 16;
        const dessous = z && z.top + z.height + 24 + hauteur <= innerHeight - 16;
        const dessus = z && z.top - 24 - hauteur >= 16;
        const p = {
          left: innerWidth < 640 ? 16 : aDroite ? z.left + z.width + 24 : aGauche ? z.left - largeur - 24 : Math.max(16, innerWidth - largeur - 24),
          top: innerWidth < 640 ? Math.max(16, innerHeight - hauteur - 16) : !aDroite && !aGauche && dessous ? z.top + z.height + 24 : !aDroite && !aGauche && dessus ? z.top - hauteur - 24 : Math.max(16, Math.min(z?.top ?? 96, innerHeight - hauteur - 16)),
        };
        setPosition((avant) => avant?.left === p.left && avant.top === p.top ? avant : p);
      });
    };
    const resize = new ResizeObserver(mesurer);
    if (carte.current) resize.observe(carte.current);
    const mutations = new MutationObserver(mesurer);
    // Observer les pages et leur navigation, sans observer le dialogue lui-même.
    document.querySelectorAll('main, nav[aria-label="Navigation principale"]').forEach((el) => mutations.observe(el, { childList: true, subtree: true }));
    window.addEventListener("resize", mesurer);
    window.addEventListener("scroll", mesurer, true);
    mesurer();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutations.disconnect(); window.removeEventListener("resize", mesurer); window.removeEventListener("scroll", mesurer, true); };
  }, [etape, invitation, prete]);

  return <dialog ref={dialogue} className="visite-dialogue" aria-modal="true" aria-labelledby="visite-titre" aria-describedby="visite-texte" data-visite-etape={invitation ? "invitation" : etape.id}
    onCancel={(e) => { e.preventDefault(); fermer(); }}
    onKeyDown={(e) => {
      // Les raccourcis de l’app restent inactifs pendant la visite.
      e.stopPropagation();
      if (!invitation && prete && e.key === "ArrowRight" && index < ETAPES_VISITE.length - 1) { e.preventDefault(); aller(index + 1); }
      if (!invitation && prete && e.key === "ArrowLeft" && index > 0) { e.preventDefault(); aller(index - 1); }
    }}>
    <div className="visite-voile" data-sans-cible={invitation || !zone || !prete} aria-hidden="true" />
    {!invitation && prete && zone && <div className="visite-halo" style={zone} aria-hidden="true" />}
    <section ref={carte} tabIndex={-1} className="visite-carte" data-invitation={invitation} style={!invitation && position ? position : undefined}>
      <div className="visite-entete"><span>{invitation ? "Découvrir KLYRA" : `Visite guidée · ${index + 1} / ${ETAPES_VISITE.length}`}</span>
        <button className="visite-fermer" type="button" aria-label={invitation ? "Passer la visite" : "Quitter la visite"} onClick={() => fermer()}>×</button>
      </div>
      <div aria-live="polite" aria-atomic="true">
        <h2 id="visite-titre">{invitation ? "On fait le tour ?" : etape.titre}</h2>
        <p id="visite-texte">{invitation ? "Découvre chaque espace de KLYRA, à quoi il sert et où retrouver ton travail. Tu peux quitter la visite et la reprendre dans les réglages." : etape.texte}</p>
        {!invitation && <p className="visite-repere">{etape.repere}</p>}
      </div>
      {!invitation && <progress aria-label="Progression de la visite" value={index + 1} max={ETAPES_VISITE.length} />}
      {stockageIndisponible && <p role="status">La progression sera conservée uniquement pendant cette session.</p>}
      {!invitation && !prete && <p role="status">Ouverture de la page…</p>}
      <div className="visite-actions">
        <button type="button" className="visite-secondaire" onClick={() => fermer()}>{invitation ? "Plus tard" : "Passer la visite"}</button>
        {!invitation && <button type="button" className="visite-secondaire" disabled={index === 0 || !prete} onClick={() => aller(index - 1)}>Précédent</button>}
        <button type="button" className="visite-principal" disabled={!invitation && !prete} onClick={() => invitation ? commencer() : index === ETAPES_VISITE.length - 1 ? fermer(true) : aller(index + 1)}>{invitation ? "Commencer la visite" : index === ETAPES_VISITE.length - 1 ? "Terminer" : "Suivant"}</button>
      </div>
    </section>
  </dialog>;
}
