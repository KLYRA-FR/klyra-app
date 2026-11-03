"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import Link from "next/link";
import { EmptyState } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { FileTree } from "@/components/project/FileTree";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { Onglets, type Onglet } from "@/components/ui/Onglets";
import { useArbreProjet } from "@/lib/arbre-projet";
import { cn } from "@/lib/cn";
import { useModifiedFiles } from "@/lib/workspace";
import type { Chat, Project } from "@/types/domain";
import { versUrl } from "@/components/ui/Lien";
import { getBridge } from "@/lib/bridge";
import { ouvrirFichier } from "@/components/project/Visionneuse";
import { BarreAdresse, noterAdresse } from "./BarreAdresse";
import { Publier } from "./Publier";

type PreviewTab = "apercu" | "code" | "fichiers" | "taches";
type Device = "desktop" | "mobile";

const TABS: Onglet<PreviewTab>[] = [
  { id: "apercu", label: "Aperçu", icone: <Icon name="globe-01" size={16} /> },
  { id: "code", label: "Modifié", icone: <Icon name="code-01" size={16} /> },
  { id: "fichiers", label: "Fichiers", icone: <Icon name="file-code" size={16} /> },
  { id: "taches", label: "Tâches", icone: <Icon name="list" size={16} /> },
];

const LARGEUR_DEFAUT = 480;
const LARGEUR_MIN = 320;
/** La conversation garde au moins cette largeur. */
const CONVERSATION_MIN = 424;
const CLE = "klyra-apercu-largeur";

/** Largeur du panneau, gardée d'une session à l'autre (préférence de cet écran). */
function useLargeur() {
  const [largeur, setLargeur] = useState(() => {
    try {
      const v = Number(localStorage.getItem(CLE));
      return v >= LARGEUR_MIN ? v : LARGEUR_DEFAUT;
    } catch {
      return LARGEUR_DEFAUT;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(CLE, String(largeur));
    } catch {
      /* stockage indisponible */
    }
  }, [largeur]);
  return [largeur, setLargeur] as const;
}


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

interface PreviewPanelProps {
  project: Project | undefined;
  chat: Chat;
  /** « Modifié par Hugo · 09:52 ». */
  modifiedLabel: string | null;
  /** Un lien local cliqué dans la conversation : l'aperçu l'ouvre. */
  adresseDemandee?: { url: string; n: number } | null;
}

/** Panneau de droite d'une conversation de projet : le vrai site en aperçu, ses fichiers, et Publier. */
export function PreviewPanel({ project, chat, modifiedLabel, adresseDemandee }: PreviewPanelProps) {
  const [tab, setTab] = useState<PreviewTab>("apercu");
  const [device, setDevice] = useState<Device>("desktop");
  const [largeur, setLargeur] = useLargeur();
  const [onglets, setOnglets] = useState<OngletApercu[]>(() => [nouvelOnglet(project?.previewUrl ?? "")]);
  const [actifId, setActifId] = useState(() => onglets[0].id);
  const actif = onglets.find((o) => o.id === actifId) ?? onglets[0];
  const { adresse, chargee } = actif;
  /** Change l'onglet affiché (celui qu'on voit est celui qu'on manipule). */
  const majActif = (maj: (o: OngletApercu) => Partial<OngletApercu>) =>
    setOnglets((liste) => liste.map((o) => (o.id === actifId ? { ...o, ...maj(o) } : o)));
  const setAdresse = (valeur: string) => majActif(() => ({ adresse: valeur }));
  const recharger = () => majActif((o) => ({ recharge: o.recharge + 1 }));
  const [publier, setPublier] = useState(false);
  const panneau = useRef<HTMLElement>(null);

  /* Lien cliqué dans la conversation : on l'affiche (rendu suivant, sans effet). */
  const [derniereDemande, setDerniereDemande] = useState(0);
  if (adresseDemandee && adresseDemandee.n !== derniereDemande) {
    setDerniereDemande(adresseDemandee.n);
    const adresseLue = adresseDemandee.url.replace(/^http:\/\//, "");
    majActif(() => ({ adresse: adresseLue, chargee: adresseLue }));
    setTab("apercu");
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

  /* Poignée : on tire le bord gauche ; double-clic pour revenir à la largeur de départ. */
  const tirer = (depart: ReactPointerEvent) => {
    const x0 = depart.clientX;
    const l0 = largeur;
    const max = () => (panneau.current?.parentElement?.clientWidth ?? 1200) - CONVERSATION_MIN;
    const bouger = (e: PointerEvent) => setLargeur(Math.max(LARGEUR_MIN, Math.min(max(), l0 + x0 - e.clientX)));
    const lacher = () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      delete document.body.dataset.glisse;
    };
    // Pendant le geste, l'aperçu (iframe) ne doit pas avaler les mouvements de la souris.
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    document.body.dataset.glisse = "1";
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
  };
  const clavierPoignee = (e: ReactKeyboardEvent) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    setLargeur((l) => Math.max(LARGEUR_MIN, l + (e.key === "ArrowLeft" ? 24 : -24)));
  };

  return (
    <aside
      ref={panneau}
      aria-label="Aperçu du projet"
      className="@container relative flex h-full shrink-0 flex-col border-l border-bordure-subtile bg-fond-surface"
      style={{ width: largeur }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Largeur de l’aperçu"
        aria-valuenow={largeur}
        tabIndex={0}
        onPointerDown={tirer}
        onDoubleClick={() => setLargeur(LARGEUR_DEFAUT)}
        onKeyDown={clavierPoignee}
        className="group/poignee absolute top-0 bottom-0 -left-2 z-20 w-4 cursor-col-resize"
      >
        <span className="absolute top-0 bottom-0 left-2 w-px bg-transparent transition-colors duration-[120ms] group-hover/poignee:bg-bleu-k1-500 group-focus-visible/poignee:bg-bleu-k1-500" />
      </div>

      <div className="flex items-center gap-2 px-4 py-3">
        <Onglets libelle="Vues du projet" onglets={TABS} valeur={tab} onChange={setTab} etiquettes="large" />
        <Bouton
          variant="sombre"
          taille="compact"
          iconeGauche={<Icon name="upload-01" size={16} />}
          title="Publier : commit et push sur git"
          className="ml-auto"
          disabled={!project}
          onClick={() => setPublier(true)}
        >
          <span className="sr-only @md:not-sr-only">Publier</span>
        </Bouton>
      </div>

      {tab === "apercu" && (
        <>
          <div role="tablist" aria-label="Onglets de l’aperçu" className="flex items-center gap-1 overflow-x-auto px-4 pb-2 [scrollbar-width:none]">
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
            <BarreAdresse
              valeur={adresse}
              onChange={setAdresse}
              onOuvrir={ouvrirAdresse}
              dossier={project?.folder ?? null}
              chargee={chargee}
            />
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
                  className={cn(
                    "h-full overflow-hidden border border-bordure-subtile bg-fond-surface shadow-ombre-ambiante",
                    device === "mobile" ? "w-[390px] max-w-full rounded-3xl" : "w-full rounded-md",
                  )}
                >
                  {/* Chaque onglet garde sa page chargée : on cache les autres, on ne les recharge pas. */}
                  {onglets
                    .filter((o) => o.chargee)
                    .map((o) => (
                      <iframe
                        key={`${o.id}-${o.chargee}-${o.recharge}`}
                        src={versUrl(o.chargee)}
                        title={`Aperçu de ${project?.name ?? "projet"} : ${titreOnglet(o.chargee)}`}
                        hidden={o.id !== actif.id}
                        className="size-full border-0"
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
        </>
      )}
      {tab !== "apercu" && project && (
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4">
          {tab === "fichiers" && <ArbreProjet project={project} />}
          {tab === "code" && <Modifies project={project} />}
          {tab === "taches" && <TachesChat chat={chat} />}
        </div>
      )}

      {publier && project && <Publier project={project} onFermer={() => setPublier(false)} />}
    </aside>
  );
}

function ArbreProjet({ project }: { project: Project }) {
  const arbre = useArbreProjet(project);
  const modified = useModifiedFiles(project.id);
  if (arbre.erreur) return <p className="m-0 p-3 text-ui-s text-texte-erreur">Dossier illisible : {arbre.erreur}</p>;
  return (
    <FileTree
      key={project.id}
      nodes={arbre.noeuds}
      contenu={arbre.contenu}
      charger={arbre.charger}
      modified={modified}
      onOuvrir={(chemin) => ouvrirFichier({ projectId: project.id, chemin })}
    />
  );
}

function Modifies({ project }: { project: Project }) {
  const modified = [...useModifiedFiles(project.id)].sort();
  if (!modified.length) {
    return <EmptyState title="Rien de modifié" description="Les fichiers que les agents modifient dans ce projet s’affichent ici." />;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-0.5 p-2">
      {modified.map((f) => (
        <li key={f} className="klyra-mono flex items-center gap-2 rounded-sm px-2 py-1.5 text-ui-xs text-texte-principal">
          <Icon name="file-code" size={14} className="shrink-0 text-icone-secondaire" />
          <span className="truncate">{f}</span>
        </li>
      ))}
    </ul>
  );
}

function TachesChat({ chat }: { chat: Chat }) {
  const taches = chat.taches ?? [];
  if (!taches.length) {
    return <EmptyState title="Pas de tâches" description="Quand un agent découpe son travail, sa liste s’affiche ici." />;
  }
  return (
    <ul className="m-0 flex list-none flex-col gap-1 p-3">
      {taches.map((t, i) => (
        <li key={i} className="flex items-start gap-2 text-ui-s">
          <Icon
            name={t.statut === "fait" ? "check-01" : t.statut === "en-cours" ? "loader-01" : "circle"}
            size={16}
            className={cn("mt-0.5 shrink-0", t.statut === "fait" ? "text-icone-accent" : "text-icone-secondaire")}
          />
          <span className={t.statut === "fait" ? "text-texte-tertiaire line-through" : "text-texte-principal"}>{t.texte}</span>
        </li>
      ))}
    </ul>
  );
}
