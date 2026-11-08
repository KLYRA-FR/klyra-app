"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { EmptyState } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { versUrl } from "@/components/ui/Lien";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import type { Project } from "@/types/domain";
import { BarreAdresse, noterAdresse } from "./BarreAdresse";
import { Regle } from "./Regle";

type Device = "desktop" | "mobile";

/** Un onglet de l'aperçu : sa page, comme un onglet de navigateur. */
interface OngletApercu {
  id: string;
  /** Ce qu'affiche la barre d'adresse (on peut y taper sans charger). */
  adresse: string;
  /** La page chargée dans son iframe. */
  chargee: string;
  recharge: number;
}

const nouvelOnglet = (url: string): OngletApercu => ({ id: crypto.randomUUID(), adresse: url, chargee: url, recharge: 0 });

/** « localhost:3002/offre » : le titre court d'un onglet. */
const titreOnglet = (url: string) => url.replace(/^https?:\/\//, "").replace(/\/$/, "") || "Nouvel onglet";

/**
 * L'aperçu du site d'un projet : ses onglets, la barre d'adresse, ordinateur ou téléphone, la page dans son cadre.
 * Gardé monté quand on passe à un autre onglet du panneau : ses pages ne se rechargent pas.
 * Sert au panneau d'une conversation de projet (`PanneauLateral`) et à l'aperçu des autres conversations d'équipe.
 */
export function ApercuSite({
  project,
  modifiedLabel,
  adresseDemandee,
  visible = true,
}: {
  project: Project | undefined;
  /** « Modifié par Hugo · 09:52 ». */
  modifiedLabel: string | null;
  /** Un lien local cliqué dans la conversation, ou annoncé par un agent : l'aperçu l'ouvre. */
  adresseDemandee?: { url: string; n: number } | null;
  /** Caché derrière un autre onglet : la mesure de la page s'arrête. */
  visible?: boolean;
}) {
  const [device, setDevice] = useState<Device>("desktop");
  const [onglets, setOnglets] = useState<OngletApercu[]>(() => [nouvelOnglet(project?.previewUrl ?? "")]);
  const [actifId, setActifId] = useState(() => onglets[0].id);
  const actif = onglets.find((o) => o.id === actifId) ?? onglets[0];
  const { adresse, chargee } = actif;
  /** Change l'onglet affiché (celui qu'on voit est celui qu'on manipule). */
  const majActif = (maj: (o: OngletApercu) => Partial<OngletApercu>) =>
    setOnglets((liste) => liste.map((o) => (o.id === actifId ? { ...o, ...maj(o) } : o)));
  const setAdresse = (valeur: string) => majActif(() => ({ adresse: valeur }));
  const recharger = () => majActif((o) => ({ recharge: o.recharge + 1 }));
  /* Largeur réelle de la page affichée (celle de l'iframe), pour la règle du responsive. */
  const cadre = useRef<HTMLDivElement>(null);
  const [largeurPage, setLargeurPage] = useState(0);
  const cadreVisible = visible && !!chargee;
  useEffect(() => {
    const el = cadre.current;
    if (!el) return;
    const mesurer = () => setLargeurPage(Math.round(el.clientWidth));
    mesurer();
    const obs = new ResizeObserver(mesurer);
    obs.observe(el);
    return () => obs.disconnect();
  }, [cadreVisible, device]);

  /* Lien demandé : on l'affiche (rendu suivant, sans effet). */
  const [derniereDemande, setDerniereDemande] = useState(0);
  if (adresseDemandee && adresseDemandee.n !== derniereDemande) {
    setDerniereDemande(adresseDemandee.n);
    const adresseLue = adresseDemandee.url.replace(/^http:\/\//, "");
    majActif(() => ({ adresse: adresseLue, chargee: adresseLue }));
    noterAdresse(adresseLue);
  }
  /* On navigue dans l'aperçu : la barre de l'onglet affiché montre sa page (sauf pendant qu'on y tape). */
  useEffect(() => {
    return getBridge()?.apercu?.onAdresse((url) => {
      noterAdresse(url);
      if (document.activeElement?.getAttribute("aria-label") === "Adresse de l’aperçu") return;
      const lue = url.replace(/^http:\/\//, "");
      setOnglets((liste) => liste.map((o) => (o.id === actifId ? { ...o, adresse: lue } : o)));
    });
  }, [actifId]);
  const ouvrirAdresse = (url: string) => {
    majActif((o) => ({ chargee: url.trim(), recharge: o.recharge + 1 }));
    noterAdresse(url);
  };
  const ajouterOnglet = () => {
    const onglet = nouvelOnglet(project?.previewUrl ?? "");
    setOnglets((liste) => [...liste, onglet]);
    setActifId(onglet.id);
  };
  const fermerOnglet = (id: string) => {
    if (onglets.length < 2) return;
    const rang = onglets.findIndex((o) => o.id === id);
    const reste = onglets.filter((o) => o.id !== id);
    setOnglets(reste);
    if (id === actifId) setActifId(reste[Math.min(rang, reste.length - 1)].id);
  };

  return (
    <div data-apercu-site className={cn("min-h-0 flex-1 flex-col", visible ? "flex" : "hidden")}>
      <div role="tablist" aria-label="Onglets de l’aperçu" className="flex items-center gap-1 overflow-x-auto px-4 pt-3 pb-2 [scrollbar-width:none]">
        {onglets.map((o) => {
          const estActif = o.id === actif.id;
          const titre = titreOnglet(o.chargee);
          return (
            <div
              key={o.id}
              className={cn(
                "group/onglet flex h-7 max-w-[180px] min-w-0 shrink-0 items-center gap-1 rounded-sm pr-1 pl-2 text-ui-xs font-medium transition-colors duration-[120ms]",
                estActif ? "bg-fond-surface-grise text-texte-principal" : "text-texte-secondaire hover:bg-fond-survol",
                onglets.length < 2 && "pr-2",
              )}
            >
              <button
                type="button"
                role="tab"
                aria-selected={estActif}
                title={titre}
                onClick={() => setActifId(o.id)}
                onAuxClick={(e) => e.button === 1 && fermerOnglet(o.id)}
                className="min-w-0 flex-1 cursor-pointer truncate border-0 bg-transparent p-0 text-left text-inherit"
              >
                {titre}
              </button>
              {onglets.length > 1 && (
                <button
                  type="button"
                  onClick={() => fermerOnglet(o.id)}
                  aria-label={`Fermer l’onglet ${titre}`}
                  data-son="fermer"
                  className={cn(
                    "flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-2xs border-0 bg-transparent p-0 text-icone-secondaire hover:bg-fond-survol hover:text-texte-principal",
                    !estActif && "invisible group-hover/onglet:visible",
                  )}
                >
                  <Icon name="x-01" size={12} />
                </button>
              )}
            </div>
          );
        })}
        <BoutonIcone taille="mini" icone={<Icon name="plus-01" size={16} />} libelle="Nouvel onglet" onClick={ajouterOnglet} className="shrink-0 text-icone-secondaire" />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          ouvrirAdresse(adresse);
        }}
        className="flex items-center gap-1.5 px-4 pb-3"
      >
        <BoutonIcone
          taille="compact"
          icone={<Icon name="refresh-01" size={16} />}
          libelle="Recharger l’aperçu"
          onClick={recharger}
          className="text-icone-secondaire hover:text-icone-defaut"
        />
        <BarreAdresse valeur={adresse} onChange={setAdresse} onOuvrir={ouvrirAdresse} dossier={project?.folder ?? null} chargee={chargee} />
        {chargee && (
          <a
            href={versUrl(adresse.trim() || chargee)}
            target="_blank"
            rel="noreferrer"
            aria-label="Ouvrir dans le navigateur"
            title="Ouvrir dans le navigateur"
            className="flex size-8 items-center justify-center rounded-xs text-icone-secondaire hover:bg-fond-survol hover:text-icone-defaut"
          >
            <Icon name="link-external" size={16} />
          </a>
        )}
        <BoutonIcone
          taille="compact"
          actif={device === "desktop"}
          icone={<Icon name="computer" size={16} />}
          libelle="Aperçu ordinateur"
          aria-pressed={device === "desktop"}
          onClick={() => setDevice("desktop")}
        />
        <BoutonIcone
          taille="compact"
          actif={device === "mobile"}
          icone={<Icon name="iphone-02" size={16} />}
          libelle="Aperçu téléphone"
          aria-pressed={device === "mobile"}
          onClick={() => setDevice("mobile")}
        />
      </form>
      <div className="flex min-h-0 flex-1 flex-col items-center gap-2 px-4 pb-4">
        {chargee ? (
          <>
            <div
              ref={cadre}
              className={cn(
                "flex h-full flex-col overflow-hidden border border-bordure-subtile bg-fond-surface shadow-ombre-ambiante",
                device === "mobile" ? "w-[390px] max-w-full rounded-3xl" : "w-full rounded-md",
              )}
            >
              <Regle largeur={largeurPage} />
              {/* Chaque onglet garde sa page chargée : on cache les autres, on ne les recharge pas. */}
              {onglets
                .filter((o) => o.chargee)
                .map((o) => (
                  <iframe
                    key={`${o.id}-${o.chargee}-${o.recharge}`}
                    src={versUrl(o.chargee)}
                    title={`Aperçu de ${project?.name ?? "projet"} : ${titreOnglet(o.chargee)}`}
                    hidden={o.id !== actif.id}
                    className="min-h-0 w-full flex-1 border-0"
                  />
                ))}
            </div>
            <p className="m-0 text-center text-ui-2xs text-texte-tertiaire">
              {modifiedLabel ? `${modifiedLabel} · ` : ""}Rien ne s’affiche ? Lance le serveur de dev du projet.
            </p>
          </>
        ) : (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
            <EmptyState title="Pas d’adresse d’aperçu" description="Tape l’adresse du serveur de dev au-dessus (par exemple localhost:3002), ou garde-la dans le projet." />
            {project && (
              <Link href={`/projets?modifier=${project.id}`} className="text-ui-s text-texte-principal underline underline-offset-2">
                Modifier le projet
              </Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
