"use client";

import { useEffect, useState } from "react";
import type { ActiviteGithub, DiffFichierGit, ResumeTests } from "../../../electron/github-types";
import { Icon, type IconName } from "@/components/icons/Icon";
import { VueModifies } from "@/components/preview/VueModifies";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { DiffView } from "@/components/ui/DiffView";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { nomDepot, resumeDepot } from "@/lib/depot-projet";
import { useEtatDepot } from "@/lib/etat-depot";
import { formatListDate } from "@/lib/format";
import type { Project } from "@/types/domain";
import { ouvrirFichier } from "./Visionneuse";

const STATUTS: Record<string, string> = { M: "Modifié", A: "Ajouté", D: "Supprimé", "?": "Nouveau", R: "Renommé" };

/** « github.com/KLYRA-FR/klyra-app » si le dépôt est sur GitHub, sinon rien (jamais l'adresse brute du distant). */
function urlGithub(project: Project, distant: string | null): string | null {
  const nom = nomDepot(project.depot, distant);
  return /^[\w.-]+\/[\w.-]+$/.test(nom) && (project.depot || /github\.com/i.test(distant ?? "")) ? `https://github.com/${nom}` : null;
}

function Section({ titre, nombre, action, children }: { titre: string; nombre?: number; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={titre} className="flex flex-col gap-1.5">
      <div className="flex h-7 items-center gap-2 px-1">
        <h3 className="m-0 flex-1 text-ui-s font-semibold text-texte-principal">
          {titre}
          {nombre !== undefined && <span className="klyra-mono ml-1.5 text-ui-2xs font-normal text-texte-tertiaire">{nombre}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Un fichier changé, ouvert : avant et après, ligne à ligne. */
function DiffFichier({ project, natif, chemin, ancien }: { project: Project; natif: boolean; chemin: string; ancien?: string }) {
  const bridge = getBridge();
  const [diff, setDiff] = useState<DiffFichierGit | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const possible = natif ? !!bridge?.github?.diff : !!bridge?.git.diff;
  useEffect(() => {
    let actif = true;
    const lire = natif ? bridge?.github?.diff?.(project.lieu ?? null, project.folder, chemin, ancien) : bridge?.git.diff?.(project.folder, chemin, ancien);
    if (!lire) return;
    void lire.then((r) => {
      if (!actif) return;
      if (r.ok) setDiff(r.data);
      else setErreur(r.message);
    });
    return () => {
      actif = false;
    };
  }, [bridge, natif, project.lieu, project.folder, chemin, ancien]);

  if (!possible) return <p className="m-0 px-2 text-ui-xs text-texte-tertiaire">Relance l’app pour voir les différences.</p>;
  if (erreur) return <p className="m-0 px-2 text-ui-xs text-texte-erreur">{erreur}</p>;
  if (!diff) return <p className="m-0 px-2 text-ui-xs text-texte-tertiaire">Lecture…</p>;
  if (diff.binaire) return <p className="m-0 px-2 text-ui-xs text-texte-tertiaire">Fichier binaire : pas de texte à comparer.</p>;
  if (diff.tropGros) return <p className="m-0 px-2 text-ui-xs text-texte-tertiaire">Fichier trop gros pour être montré ici (plus de 512 Ko).</p>;
  return <DiffView before={diff.avant ?? ""} after={diff.apres ?? ""} className="text-ui-2xs" />;
}

const TESTS: Record<ResumeTests["etat"], { icone: IconName; classe: string }> = {
  reussi: { icone: "check-01", classe: "text-icone-accent" },
  echec: { icone: "x-01", classe: "text-texte-erreur" },
  "en-cours": { icone: "loader-01", classe: "text-icone-secondaire" },
  aucun: { icone: "circle", classe: "text-icone-secondaire" },
};

function texteTests(t: ResumeTests): string {
  if (t.etat === "aucun") return "Aucun test sur cette branche.";
  const parties = [t.echecs && `${t.echecs} en échec`, t.enCours && `${t.enCours} en cours`, t.reussis && `${t.reussis} réussi${t.reussis > 1 ? "s" : ""}`].filter(Boolean);
  return parties.join(" · ");
}

/** Ce que GitHub dit du dépôt : tests de la branche, pull requests ouvertes, derniers commits. */
function ActiviteDepot({ project, lecture }: { project: Project; lecture: number }) {
  const github = getBridge()?.github;
  const [activite, setActivite] = useState<ActiviteGithub | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [relance, setRelance] = useState(0);
  /* La lecture demandée et la dernière rendue : entre les deux, GitHub est en train de répondre. */
  const demandee = `${lecture}-${relance}`;
  const [rendue, setRendue] = useState<string | null>(null);
  const chargement = rendue !== demandee;
  useEffect(() => {
    if (!github?.activite) return;
    let actif = true;
    void github.activite(project.lieu ?? null, project.folder).then((r) => {
      if (!actif) return;
      setRendue(demandee);
      if (r.ok) {
        setActivite(r.data);
        setErreur(null);
      } else setErreur(r.message);
    });
    return () => {
      actif = false;
    };
  }, [github, project.lieu, project.folder, demandee]);

  if (!github?.activite) return null;
  const actualiser = (
    <BoutonIcone taille="mini" icone={<Icon name="refresh-01" size={14} />} libelle="Relire GitHub" disabled={chargement} onClick={() => setRelance((n) => n + 1)} className="text-icone-secondaire" />
  );
  if (erreur && !activite) {
    return (
      <Section titre="Sur GitHub" action={actualiser}>
        <p role="alert" className="m-0 px-1 text-ui-xs text-texte-erreur">{erreur}</p>
      </Section>
    );
  }
  if (!activite) return <p className="m-0 px-1 text-ui-xs text-texte-tertiaire">Lecture de GitHub…</p>;
  const tests = activite.tests;
  return (
    <>
      <Section titre={activite.branche ? `Tests de ${activite.branche}` : "Tests"} action={actualiser}>
        {tests ? (
          <div className="flex flex-col gap-1 px-1" data-tests-github={tests.etat}>
            <span className="flex items-center gap-2 text-ui-xs text-texte-principal">
              <Icon name={TESTS[tests.etat].icone} size={14} className={cn("shrink-0", TESTS[tests.etat].classe)} />
              {texteTests(tests)}
            </span>
            {tests.echouees.map((t) => (
              <span key={t.nom} className="flex items-center gap-2 pl-5 text-ui-xs text-texte-secondaire">
                {t.url ? (
                  <a href={t.url} target="_blank" rel="noreferrer" className="truncate text-texte-erreur underline underline-offset-2">
                    {t.nom}
                  </a>
                ) : (
                  <span className="truncate text-texte-erreur">{t.nom}</span>
                )}
              </span>
            ))}
          </div>
        ) : (
          <p className="m-0 px-1 text-ui-xs text-texte-tertiaire">GitHub n’a pas donné l’état des tests.</p>
        )}
      </Section>

      <Section titre="Pull requests ouvertes" nombre={activite.pullRequests?.length}>
        {!activite.pullRequests ? (
          <p className="m-0 px-1 text-ui-xs text-texte-tertiaire">GitHub n’a pas donné les pull requests.</p>
        ) : activite.pullRequests.length ? (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0" data-pull-requests>
            {activite.pullRequests.map((p) => (
              <li key={p.numero}>
                <a
                  href={p.url || `${activite.url}/pull/${p.numero}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex flex-col gap-0.5 rounded-sm px-2 py-1.5 no-underline transition-colors duration-[120ms] hover:bg-fond-survol"
                >
                  <span className="flex items-baseline gap-1.5 text-ui-xs text-texte-principal">
                    <span className="klyra-mono shrink-0 text-texte-tertiaire">#{p.numero}</span>
                    <span className="truncate font-medium">{p.titre}</span>
                  </span>
                  <span className="truncate text-ui-2xs text-texte-tertiaire">
                    {[p.auteur, p.branche, p.brouillon && "brouillon", p.majLe && formatListDate(p.majLe).toLocaleLowerCase("fr")].filter(Boolean).join(" · ")}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 px-1 text-ui-xs text-texte-tertiaire">Aucune pull request ouverte.</p>
        )}
      </Section>

      <Section titre="Derniers commits">
        {activite.commits?.length ? (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0">
            {activite.commits.map((c) => (
              <li key={c.sha}>
                <a href={c.url || `${activite.url}/commit/${c.sha}`} target="_blank" rel="noreferrer" className="flex flex-col gap-0.5 rounded-sm px-2 py-1.5 no-underline transition-colors duration-[120ms] hover:bg-fond-survol">
                  <span className="flex items-baseline gap-1.5 text-ui-xs text-texte-principal">
                    <span className="klyra-mono shrink-0 text-texte-tertiaire">{c.sha}</span>
                    <span className="truncate">{c.message}</span>
                  </span>
                  <span className="truncate text-ui-2xs text-texte-tertiaire">{[c.auteur, c.date && formatListDate(c.date).toLocaleLowerCase("fr")].filter(Boolean).join(" · ")}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="m-0 px-1 text-ui-xs text-texte-tertiaire">{activite.commits ? "Aucun commit." : "GitHub n’a pas donné les commits."}</p>
        )}
      </Section>
    </>
  );
}

/**
 * L'onglet Git d'une conversation de projet : le dépôt et sa branche, récupérer, ce qui a changé (avant / après),
 * publier ; pour un dépôt ouvert depuis GitHub, ses tests, ses pull requests et ses derniers commits.
 * Une autre branche s'ouvre comme un projet à part (Projets) : on ne change jamais la branche d'un clone.
 */
export function VueGit({ project, onPublier }: { project: Project; onPublier: () => void }) {
  const { etat, natif, disponible, recuperer } = useEtatDepot(project);
  const [enCours, setEnCours] = useState(false);
  const [retour, setRetour] = useState<{ ok: boolean; message: string } | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [lecture, setLecture] = useState(0);

  if (!disponible) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <p className="m-0 px-1 text-ui-s text-texte-secondaire">Git se lit pour un dossier de ce PC, ou un dépôt ouvert depuis GitHub (Projets › Nouveau projet).</p>
        <VueModifies project={project} />
      </div>
    );
  }
  if (!etat) return <p className="m-0 p-4 text-ui-s text-texte-tertiaire">Lecture du dépôt…</p>;
  if (!etat.depot) {
    return (
      <div className="flex flex-col gap-3 p-3">
        <p className="m-0 px-1 text-ui-s text-texte-secondaire">Ce dossier n’est pas un dépôt git.</p>
        <VueModifies project={project} />
      </div>
    );
  }

  const url = urlGithub(project, etat.distant);
  const aPublier = etat.fichiers.length > 0 || etat.enAvance > 0 || (!etat.suivie && !!etat.distant);
  const recupererClic = async () => {
    setEnCours(true);
    setRetour(null);
    const r = await recuperer();
    setEnCours(false);
    setRetour(r);
    setLecture((n) => n + 1);
  };

  return (
    <div data-vue-git className="flex flex-col gap-5 p-3">
      <section aria-label="Dépôt" className="flex flex-col gap-2 rounded-md border border-bordure-subtile bg-fond-page p-3">
        <div className="flex items-center gap-2">
          <Icon name="git-branch-01" size={16} className="shrink-0 text-icone-secondaire" />
          <span className="klyra-mono min-w-0 flex-1 truncate text-ui-s text-texte-principal">{nomDepot(project.depot, etat.distant)}</span>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="flex shrink-0 items-center gap-1 text-ui-xs text-texte-secondaire no-underline hover:text-texte-principal">
              GitHub
              <Icon name="link-external" size={12} />
            </a>
          )}
        </div>
        <p className="m-0 text-ui-xs text-texte-secondaire">{resumeDepot(etat)}</p>
        <div className="flex flex-wrap gap-2">
          {etat.suivie && (
            <Bouton variant="blanc" taille="compact" iconeGauche={<Icon name="refresh-01" size={16} />} disabled={enCours} onClick={() => void recupererClic()}>
              {enCours ? "Récupération…" : "Récupérer"}
            </Bouton>
          )}
          {etat.distant && (
            <Bouton variant="sombre" taille="compact" iconeGauche={<Icon name="upload-01" size={16} />} disabled={!aPublier} onClick={onPublier}>
              Publier
            </Bouton>
          )}
        </div>
        {retour && (
          <p role={retour.ok ? "status" : "alert"} className={retour.ok ? "m-0 text-ui-xs text-texte-secondaire" : "m-0 text-ui-xs text-texte-erreur"}>
            {retour.message}
          </p>
        )}
        {natif && <p className="m-0 text-ui-2xs text-texte-tertiaire">Une autre branche s’ouvre comme un projet à part, depuis Projets.</p>}
      </section>

      <Section titre="Changements" nombre={etat.fichiers.length}>
        {etat.fichiers.length ? (
          <ul className="m-0 flex list-none flex-col gap-0.5 p-0" data-changements>
            {etat.fichiers.map((f) => {
              const cle = `${f.statut}:${f.chemin}`;
              const deplie = ouvert === cle;
              return (
                <li key={cle} className="flex flex-col gap-1.5">
                  <div className={cn("group/fichier flex items-center gap-1 rounded-sm pr-1 transition-colors duration-[120ms]", deplie ? "bg-fond-surface-grise" : "hover:bg-fond-survol")}>
                    <button
                      type="button"
                      aria-expanded={deplie}
                      onClick={() => setOuvert(deplie ? null : cle)}
                      title={f.ancien ? `${f.ancien} → ${f.chemin}` : f.chemin}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 border-0 bg-transparent px-2 py-1.5 text-left"
                    >
                      <span className="w-[60px] shrink-0 text-ui-2xs text-texte-tertiaire">{STATUTS[f.statut] ?? f.statut}</span>
                      <span className="klyra-mono min-w-0 flex-1 truncate text-ui-xs text-texte-principal">{f.chemin}</span>
                      <Icon name="chevron-down" size={12} className={cn("shrink-0 text-icone-secondaire transition-transform duration-[120ms]", deplie && "rotate-180")} />
                    </button>
                    {f.statut !== "D" && (
                      <BoutonIcone
                        taille="mini"
                        icone={<Icon name="file-code" size={14} />}
                        libelle={`Voir ${f.chemin}`}
                        onClick={() => ouvrirFichier({ projectId: project.id, chemin: f.chemin })}
                        className="text-icone-secondaire opacity-0 group-hover/fichier:opacity-100 focus-visible:opacity-100"
                      />
                    )}
                  </div>
                  {deplie && <DiffFichier project={project} natif={natif} chemin={f.chemin} ancien={f.ancien} />}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="m-0 px-1 text-ui-xs text-texte-tertiaire">{etat.enAvance > 0 ? "Aucun fichier modifié ; des commits attendent d’être publiés." : "Aucun changement : tout est publié."}</p>
        )}
      </Section>

      {natif && <ActiviteDepot project={project} lecture={lecture} />}
    </div>
  );
}
