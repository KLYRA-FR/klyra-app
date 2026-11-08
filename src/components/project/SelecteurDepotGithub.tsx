"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "klyra-ui";
import { getBridge } from "@/lib/bridge";
import type { DepotGithubProjet, EtatGithubProjet } from "../../../electron/github-types";
import { Icon } from "@/components/icons/Icon";
import { CHAMP } from "@/components/ui/Champ";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { lieuParDefaut } from "@/lib/lieux";
import { depotsTrouves, detailsDepot, projetDepuisDepot, projetDuDepot } from "@/lib/projet-depuis-depot";
import type { Project } from "@/types/domain";

/**
 * Les dépôts GitHub du compte connecté sur la machine choisie (PC ou VPS), comme dans Claude Desktop :
 * la liste s'affiche, on cherche, un clic sur « Ouvrir » clone la branche par défaut et rend le projet.
 * Rien à remplir : le nom, la description et le site viennent de GitHub (`projetDepuisDepot`).
 * Une autre branche reste possible, par le bouton de branche de la ligne.
 * Sert à l'ajout d'un projet ; prévu aussi pour choisir un dépôt depuis un composeur.
 */
export function SelecteurDepotGithub({
  lieu,
  projets,
  onOuvert,
}: {
  lieu: string | null;
  projets: Project[];
  /** Le dépôt est sur la machine : le projet à ouvrir, à enregistrer s'il n'existait pas. */
  onOuvert: (projet: Project, existant: boolean) => void;
}) {
  const github = getBridge()?.github;
  const [etat, setEtat] = useState<EtatGithubProjet | null>(null);
  const [depots, setDepots] = useState<DepotGithubProjet[]>([]);
  const [recherche, setRecherche] = useState("");
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState<string | null>(null);
  const [relance, setRelance] = useState(0);
  /** Le dépôt en cours d'ouverture (un seul à la fois). */
  const [ouverture, setOuverture] = useState<string | null>(null);
  /** Le dépôt dont on choisit une autre branche, ses branches et celle choisie. */
  const [autreBranche, setAutreBranche] = useState<{ depot: string; branches: string[] | null; choix: string } | null>(null);
  const action = useRef(false);
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);

  useEffect(() => {
    if (!github) return;
    let actif = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void (async () => {
      setChargement(true);
      try {
        const r = await github.etat(lieu);
        if (!actif) return;
        if (!r.ok) throw new Error(r.message);
        setEtat(r.data);
        setErreur(r.data.erreur);
        if (r.data.enCours) timer = setTimeout(() => actif && setRelance((n) => n + 1), 1500);
        if (r.data.compte && !r.data.enCours) {
          const liste = await github.depots(lieu);
          if (!actif) return;
          if (!liste.ok) throw new Error(liste.message);
          setDepots(liste.data);
        } else setDepots([]);
      } catch (e) {
        if (actif) setErreur(e instanceof Error ? e.message : "GitHub ne répond pas.");
      } finally {
        if (actif) setChargement(false);
      }
    })();
    return () => {
      actif = false;
      if (timer) clearTimeout(timer);
    };
  }, [github, lieu, relance]);

  /* Les branches d'un dépôt, lues seulement quand on en demande une autre. */
  const depotBranches = autreBranche?.depot ?? null;
  useEffect(() => {
    if (!github || !depotBranches) return;
    let actif = true;
    void github
      .branches(lieu, depotBranches)
      .then((r) => {
        if (!actif) return;
        if (!r.ok) return setErreur(r.message);
        setAutreBranche((a) => (a?.depot === depotBranches ? { ...a, branches: r.data } : a));
      })
      .catch(() => actif && setErreur("Les branches GitHub ne répondent pas."));
    return () => {
      actif = false;
    };
  }, [github, lieu, depotBranches]);

  const connexion = async (retirer: boolean) => {
    if (!github || action.current) return;
    action.current = true;
    setChargement(true);
    setErreur(null);
    try {
      const r = await (retirer ? github.deconnecter(lieu) : github.connecter(lieu));
      if (!r.ok) throw new Error(r.message);
      setEtat(r.data);
      setDepots([]);
      setAutreBranche(null);
      setRelance((n) => n + 1);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : "La connexion GitHub n’a pas abouti.");
    } finally {
      action.current = false;
      setChargement(false);
    }
  };

  const ouvrir = async (depot: DepotGithubProjet, branche: string) => {
    if (!github || ouverture) return;
    setErreur(null);
    setOuverture(depot.nom);
    const r = await github.ouvrir(lieu, depot.nom, branche);
    // Fenêtre quittée, ou autre serveur choisi pendant le clone : le projet n'est pas créé ici.
    if (!monte.current || lieuParDefaut() !== lieu) return;
    setOuverture(null);
    if (!r.ok) return setErreur(r.message);
    const { projet, existant } = projetDepuisDepot({ depot: { ...depot, nom: r.data.depot }, branche, dossier: r.data.dossier, lieu, projets });
    onOuvert(projet, existant);
  };

  const trouves = depotsTrouves(depots, recherche);
  const occupe = chargement || !!ouverture;
  return (
    <section aria-label="Choisir un dépôt GitHub" data-source-github className="flex flex-col gap-3" aria-busy={occupe}>
      <div className="flex flex-wrap items-center gap-2">
        <p className="m-0 flex-1 text-ui-s text-texte-secondaire">
          {etat?.compte ? (
            <>
              GitHub · <span className="font-medium text-texte-principal">{etat.compte}</span>
            </>
          ) : (
            "Connecte GitHub pour retrouver tes dépôts publics et privés."
          )}
        </p>
        {etat?.compte ? (
          <>
            <BoutonIcone taille="compact" icone={<Icon name="refresh-01" size={16} />} libelle="Actualiser la liste" disabled={occupe} onClick={() => setRelance((n) => n + 1)} />
            <Bouton variant="discret" taille="compact" disabled={occupe} onClick={() => void connexion(true)}>
              Changer de compte
            </Bouton>
          </>
        ) : (
          <Bouton variant="sombre" taille="md" disabled={chargement || etat?.enCours} onClick={() => void connexion(false)}>
            Connecter GitHub
          </Bouton>
        )}
      </div>

      {etat?.enCours && (
        <div role="status" className="flex flex-col gap-2 rounded-md bg-fond-surface-grise p-4">
          {etat.connexion ? (
            <>
              <p className="m-0 text-ui-s text-texte-principal">
                Sur GitHub, saisis ce code et autorise GitHub CLI, utilisé par KLYRA pour accéder à ton code :{" "}
                <strong className="klyra-mono select-all tabular-nums">{etat.connexion.code}</strong>
              </p>
              <Bouton variant="blanc" taille="md" className="self-start" onClick={() => void github?.navigateur()}>
                Ouvrir GitHub
              </Bouton>
            </>
          ) : (
            <p className="m-0 text-ui-s text-texte-secondaire">Préparation de la connexion GitHub…</p>
          )}
          <Bouton variant="discret" taille="compact" className="self-start" onClick={() => void connexion(true)}>
            Annuler la connexion
          </Bouton>
        </div>
      )}

      {chargement && !etat?.enCours && (
        <p role="status" className="m-0 text-ui-s text-texte-secondaire">
          Chargement des dépôts…
        </p>
      )}

      {etat?.compte && !etat.enCours && !chargement && (
        <>
          <Input
            size="sm"
            type="search"
            aria-label="Rechercher un dépôt"
            value={recherche}
            onChange={(e) => setRecherche(e.target.value)}
            placeholder="Rechercher un dépôt"
            className={CHAMP}
            disabled={!!ouverture}
          />
          {!depots.length && (
            <p role="status" className="m-0 text-ui-s text-texte-secondaire">
              Aucun dépôt accessible avec ce compte. Vérifie les autorisations GitHub de ton organisation ou change de compte.
            </p>
          )}
          {!!depots.length && !trouves.length && (
            <p role="status" className="m-0 text-ui-s text-texte-secondaire">
              Aucun dépôt ne correspond à ta recherche.
            </p>
          )}
          {!!trouves.length && (
            <ul aria-label="Dépôts GitHub" className="m-0 flex max-h-[420px] list-none flex-col overflow-y-auto rounded-lg border border-bordure-subtile bg-fond-page p-1">
              {trouves.map((d) => {
                const deja = projetDuDepot(d.nom, lieu, projets);
                const enCours = ouverture === d.nom;
                const choixBranche = autreBranche?.depot === d.nom ? autreBranche : null;
                return (
                  <li key={d.nom} data-depot={d.nom} className="flex flex-col gap-2 rounded-md px-3 py-2.5 transition-colors duration-[120ms] ease-sortie hover:bg-fond-surface">
                    <div className="flex items-center gap-3">
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="truncate text-ui font-medium text-texte-principal">{d.nom}</span>
                          {deja && <span className="shrink-0 rounded-pill bg-fond-surface-grise px-2 py-px text-ui-2xs font-medium text-texte-secondaire">Déjà ouvert</span>}
                        </span>
                        {d.description && <span className="truncate text-ui-s text-texte-secondaire">{d.description}</span>}
                        <span className="truncate text-ui-xs text-texte-tertiaire">{detailsDepot(d)}</span>
                      </span>
                      {!!d.branche && (
                        <BoutonIcone
                          taille="compact"
                          icone={<Icon name="git-branch-01" size={16} />}
                          libelle={`Ouvrir une autre branche de ${d.nom}`}
                          aria-expanded={!!choixBranche}
                          actif={!!choixBranche}
                          disabled={!!ouverture}
                          onClick={() => setAutreBranche(choixBranche ? null : { depot: d.nom, branches: null, choix: d.branche })}
                        />
                      )}
                      {deja ? (
                        <Bouton variant="blanc" taille="compact" disabled={!!ouverture} onClick={() => onOuvert(deja, true)}>
                          Rouvrir
                        </Bouton>
                      ) : (
                        <Bouton variant="blanc" taille="compact" disabled={!d.branche || !!ouverture} onClick={() => void ouvrir(d, d.branche)}>
                          {enCours ? "Ouverture…" : "Ouvrir"}
                        </Bouton>
                      )}
                    </div>
                    {choixBranche && (
                      <div className="flex flex-wrap items-center gap-2">
                        <ListeDeroulante
                          variante="compact"
                          libelle="Branche"
                          icone={<Icon name="git-branch-01" size={14} />}
                          value={choixBranche.choix}
                          options={(choixBranche.branches ?? [choixBranche.choix]).map((b) => ({ value: b, label: b }))}
                          placeholder="Chargement des branches…"
                          disabled={!choixBranche.branches || !!ouverture}
                          onChange={(b) => setAutreBranche({ ...choixBranche, choix: b })}
                        />
                        <Bouton variant="blanc" taille="compact" disabled={!choixBranche.branches || !!ouverture} onClick={() => void ouvrir(d, choixBranche.choix)}>
                          {enCours ? "Ouverture…" : "Ouvrir cette branche"}
                        </Bouton>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}

      {erreur && (
        <p role="alert" className="m-0 text-ui-s text-texte-erreur">
          {erreur}
        </p>
      )}
      <p className="m-0 text-ui-xs text-texte-tertiaire">
        Le dépôt est cloné {lieu ? "sur ce VPS" : "sur ce PC"}, dans un dossier créé automatiquement ; tes agents y travaillent. Rien n’est envoyé sur GitHub.
      </p>
    </section>
  );
}
