"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { EtatGithubProjet } from "../../../electron/github-types";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { Modale } from "@/components/ui/Modale";
import { getBridge } from "@/lib/bridge";

/**
 * La connexion de KLYRA à GitHub, sur une machine (ce PC ou un VPS) : celle qui donne les dépôts aux projets,
 * à la puce « Dépôt » et à l'onglet Git. Elle n'est ni celle de Composio (les outils des agents, qui ne remet
 * pas d'identifiants à git) ni celle du terminal (écartée exprès) : connecter l'une ne connecte pas l'autre.
 *
 * GitHub donne un code ; la page d'autorisation s'ouvre d'elle-même dans le navigateur de ce PC, une fois par
 * code, et reste à un clic si elle s'est fermée.
 */

/** Les codes dont la page a déjà été ouverte : un écran remonté ne rouvre pas le navigateur. */
const PAGES_OUVERTES = new Set<string>();

/** Le code à saisir sur GitHub et la page qui l'attend. */
export function CodeGithub({ code, onAnnuler }: { code: string | null; onAnnuler: () => void }) {
  const github = getBridge()?.github;
  const [copie, setCopie] = useState(false);

  useEffect(() => {
    if (!code || !github || PAGES_OUVERTES.has(code)) return;
    PAGES_OUVERTES.add(code);
    void github.navigateur();
  }, [code, github]);

  const copier = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopie(true);
    } catch {
      /* Presse-papiers refusé : le code reste sélectionnable. */
    }
  };

  return (
    <div role="status" data-connexion-github className="flex flex-col gap-3 rounded-md bg-fond-surface-grise p-4">
      {code ? (
        <>
          <p className="m-0 text-ui-s text-texte-principal">
            La page GitHub s’est ouverte dans ton navigateur. Saisis-y ce code, puis autorise « GitHub CLI », l’outil officiel de GitHub que KLYRA utilise pour accéder à ton code.
          </p>
          <strong data-code-github className="klyra-mono select-all text-h3 font-semibold tabular-nums tracking-[0.08em] text-texte-principal">
            {code}
          </strong>
          <div className="flex flex-wrap items-center gap-2">
            <Bouton variant="sombre" taille="compact" iconeGauche={<Icon name="copy-left" size={16} />} onClick={() => void copier()}>
              {copie ? "Code copié" : "Copier le code"}
            </Bouton>
            <Bouton variant="blanc" taille="compact" iconeGauche={<Icon name="link-external" size={16} />} onClick={() => void github?.navigateur()}>
              Rouvrir la page GitHub
            </Bouton>
            <Bouton variant="discret" taille="compact" onClick={onAnnuler}>
              Annuler
            </Bouton>
          </div>
          <p className="m-0 text-ui-xs text-texte-tertiaire">La page ne s’est pas ouverte ? Va sur github.com/login/device. Une fois autorisé, KLYRA se met à jour seul.</p>
        </>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <p className="m-0 text-ui-s text-texte-secondaire">GitHub prépare ton code…</p>
          <Bouton variant="discret" taille="compact" onClick={onAnnuler}>
            Annuler
          </Bouton>
        </div>
      )}
    </div>
  );
}

/**
 * L'état de la connexion GitHub d'une machine, relu pendant une autorisation en cours.
 * `connecter` lance l'autorisation, `annuler` la ferme (et retire un compte déjà enregistré : « Changer de compte »).
 */
export function useConnexionGithub(lieu: string | null) {
  const github = getBridge()?.github;
  const [etat, setEtat] = useState<EtatGithubProjet | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [relance, setRelance] = useState(0);

  useEffect(() => {
    if (!github) return;
    let actif = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void github
      .etat(lieu)
      .then((r) => {
        if (!actif) return;
        if (!r.ok) return setErreur(r.message);
        setEtat(r.data);
        setErreur(r.data.erreur);
        if (r.data.enCours) timer = setTimeout(() => actif && setRelance((n) => n + 1), 1500);
      })
      .catch(() => actif && setErreur("GitHub ne répond pas."));
    return () => {
      actif = false;
      if (timer) clearTimeout(timer);
    };
  }, [github, lieu, relance]);

  const lancer = useCallback(
    async (retirer: boolean) => {
      if (!github) return;
      setOccupe(true);
      setErreur(null);
      try {
        const r = await (retirer ? github.deconnecter(lieu) : github.connecter(lieu));
        if (!r.ok) setErreur(r.message);
        else setEtat(r.data);
      } catch {
        setErreur("La connexion GitHub n’a pas abouti.");
      } finally {
        setOccupe(false);
        setRelance((n) => n + 1);
      }
    },
    [github, lieu],
  );

  return {
    disponible: !!github,
    etat,
    erreur,
    occupe,
    connecter: useCallback(() => lancer(false), [lancer]),
    annuler: useCallback(() => lancer(true), [lancer]),
    relire: useCallback(() => setRelance((n) => n + 1), []),
  };
}

/**
 * La connexion GitHub dans une fenêtre, d'où qu'on la demande (puce « Dépôt », Marketplace) : elle se lance à
 * l'ouverture, et se ferme d'elle-même une fois le compte enregistré (`onConnecte`).
 */
export function ModaleConnexionGithub({ lieu, onFermer, onConnecte }: { lieu: string | null; onFermer: () => void; onConnecte?: (compte: string) => void }) {
  const c = useConnexionGithub(lieu);
  const lance = useRef(false);
  const fini = useRef(false);
  const { etat, connecter } = c;

  /* Une seule autorisation, lancée dès que l'état est lu, s'il n'y a pas déjà un compte. */
  useEffect(() => {
    if (!etat || lance.current) return;
    lance.current = true;
    if (!etat.compte && !etat.enCours) void connecter();
  }, [etat, connecter]);

  useEffect(() => {
    if (!etat?.compte || etat.enCours || fini.current) return;
    fini.current = true;
    onConnecte?.(etat.compte);
  }, [etat, onConnecte]);

  /* Le compte enregistré est retiré, puis une nouvelle autorisation part. */
  const changer = async () => {
    await c.annuler();
    await connecter();
  };

  /* Fermer pendant l'autorisation l'arrête : un code laissé ouvert ne connecterait rien à l'insu de la personne. */
  const fermer = () => {
    if (etat?.enCours && !etat.compte) void c.annuler();
    onFermer();
  };

  return (
    <Modale titre="Connecter GitHub" onFermer={fermer} className="w-[480px]" actions={<Bouton onClick={fermer}>{etat?.compte ? "Fermer" : "Annuler"}</Bouton>}>
      <div className="flex flex-col gap-3">
        <p className="m-0 text-ui-s text-texte-secondaire">
          KLYRA a sa propre connexion à GitHub, {lieu ? "sur ce serveur" : "sur cet ordinateur"} : elle sert à ouvrir tes dépôts en projets. Composio et le terminal ont la leur, que KLYRA n’utilise pas pour ça.
        </p>
        {etat?.compte && !etat.enCours ? (
          <div className="flex flex-wrap items-center gap-2">
            <p role="status" className="m-0 flex-1 text-ui-s text-texte-principal">
              GitHub est connecté · <span className="font-medium">{etat.compte}</span>
            </p>
            <Bouton variant="discret" taille="compact" disabled={c.occupe} onClick={() => void changer()}>
              Changer de compte
            </Bouton>
          </div>
        ) : etat?.enCours ? (
          <CodeGithub code={etat.connexion?.code ?? null} onAnnuler={() => void c.annuler()} />
        ) : !etat || c.occupe ? (
          <p role="status" className="m-0 text-ui-s text-texte-secondaire">
            Préparation de la connexion…
          </p>
        ) : (
          !c.erreur && (
            <div className="flex flex-wrap items-center gap-2">
              <p className="m-0 flex-1 text-ui-s text-texte-secondaire">GitHub n’est pas connecté.</p>
              <Bouton variant="sombre" taille="compact" onClick={() => void connecter()}>
                Connecter
              </Bouton>
            </div>
          )
        )}
        {c.erreur && (
          <div className="flex flex-wrap items-center gap-2">
            <p role="alert" className="m-0 flex-1 text-ui-s text-texte-erreur">
              {c.erreur}
            </p>
            {!etat?.enCours && (
              <Bouton variant="blanc" taille="compact" disabled={c.occupe} onClick={() => void connecter()}>
                Réessayer
              </Bouton>
            )}
          </div>
        )}
      </div>
    </Modale>
  );
}
