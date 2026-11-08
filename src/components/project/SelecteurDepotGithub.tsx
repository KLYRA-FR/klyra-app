"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "klyra-ui";
import { getBridge } from "@/lib/bridge";
import type { DepotGithubProjet, EtatGithubProjet } from "../../../electron/github-types";
import { Champ, CHAMP } from "@/components/ui/Champ";
import { Bouton } from "@/components/ui/Bouton";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";

export function SelecteurDepotGithub({ lieu, depot, branche, onChoix, disabled }: {
  lieu: string | null; depot: string; branche: string;
  onChoix: (depot: string, branche: string) => void; disabled: boolean;
}) {
  const github = getBridge()?.github;
  const [etat, setEtat] = useState<EtatGithubProjet | null>(null);
  const [depots, setDepots] = useState<DepotGithubProjet[]>([]);
  const [branches, setBranches] = useState<string[]>([]);
  const [recherche, setRecherche] = useState("");
  const [chargement, setChargement] = useState(true);
  const [chargeBranches, setChargeBranches] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [relance, setRelance] = useState(0);
  const action = useRef(false);

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
      } catch (e) { if (actif) setErreur(e instanceof Error ? e.message : "GitHub ne répond pas."); }
      finally { if (actif) setChargement(false); }
    })();
    return () => { actif = false; if (timer) clearTimeout(timer); };
  }, [github, lieu, relance]);

  useEffect(() => {
    if (!github || !depot) return;
    let actif = true;
    const debut = setTimeout(() => {
    setBranches([]); setChargeBranches(true);
    void github.branches(lieu, depot).then((r) => {
      if (!actif) return;
      if (r.ok) { setBranches(r.data); if (!r.data.length) setErreur("Ce dépôt est vide : crée d’abord une première branche sur GitHub."); }
      else setErreur(r.message);
    }).catch(() => actif && setErreur("Les branches GitHub ne répondent pas."))
      .finally(() => actif && setChargeBranches(false));
    }, 0);
    return () => { actif = false; clearTimeout(debut); };
  }, [github, lieu, depot]);

  const connexion = async (retirer: boolean) => {
    if (!github || action.current) return;
    action.current = true; setChargement(true); setErreur(null);
    if (retirer) onChoix("", "");
    try {
      const r = await (retirer ? github.deconnecter(lieu) : github.connecter(lieu));
      if (!r.ok) throw new Error(r.message);
      setEtat(r.data); setDepots([]); setRelance((n) => n + 1);
    } catch (e) { setErreur(e instanceof Error ? e.message : "La connexion GitHub n’a pas abouti."); }
    finally { action.current = false; setChargement(false); }
  };

  const trouves = depots.filter((d) => d.nom.toLowerCase().includes(recherche.trim().toLowerCase()));
  return <section aria-label="Choisir un dépôt GitHub" className="flex flex-col gap-4" aria-busy={chargement}>
    <div className="flex flex-wrap items-center gap-3">
      <p className="m-0 flex-1 text-ui-s text-texte-secondaire">{etat?.compte ? `GitHub · ${etat.compte}` : "Connecte GitHub pour retrouver tes dépôts publics et privés."}</p>
      {etat?.compte ? <Bouton variant="blanc" taille="compact" disabled={disabled || chargement} onClick={() => void connexion(true)}>Changer de compte</Bouton>
        : <Bouton variant="blanc" taille="md" disabled={disabled || chargement || etat?.enCours} onClick={() => void connexion(false)}>Connecter GitHub</Bouton>}
      {etat?.compte && <Bouton variant="discret" taille="compact" disabled={disabled || chargement} onClick={() => setRelance((n) => n + 1)}>Actualiser</Bouton>}
    </div>
    {etat?.enCours && <div role="status" className="flex flex-col gap-2 rounded-md bg-fond-surface-grise p-4">
      {etat.connexion ? <>
        <p className="m-0 text-ui-s text-texte-principal">Sur GitHub, saisis ce code et autorise GitHub CLI, utilisé par KLYRA pour accéder à ton code : <strong className="klyra-mono select-all tabular-nums">{etat.connexion.code}</strong></p>
        <Bouton variant="blanc" taille="md" className="self-start" onClick={() => void github?.navigateur()}>Ouvrir GitHub</Bouton>
      </> : <p className="m-0 text-ui-s text-texte-secondaire">Préparation de la connexion GitHub…</p>}
      <Bouton variant="discret" taille="compact" className="self-start" onClick={() => void connexion(true)}>Annuler la connexion</Bouton>
    </div>}
    {chargement && !etat?.enCours && <p role="status" className="m-0 text-ui-s text-texte-secondaire">Chargement des dépôts…</p>}
    {etat?.compte && !etat.enCours && !chargement && <>
      <Champ label="Rechercher un dépôt"><Input size="sm" value={recherche} onChange={(e) => { const valeur = e.target.value; setRecherche(valeur); if (depot && !depot.toLowerCase().includes(valeur.trim().toLowerCase())) onChoix("", ""); }} placeholder="Nom du dépôt ou de l’organisation" className={CHAMP} disabled={disabled} /></Champ>
      <Champ label="Dépôt GitHub" aide="Tes dépôts et ceux des organisations auxquelles ton compte a accès.">
        <ListeDeroulante value={depot} options={trouves.map((d) => ({ value: d.nom, label: `${d.nom}${d.prive ? " · Privé" : ""}${d.archive ? " · Archivé" : ""}${!d.branche ? " · Vide" : ""}`, disabled: !d.branche }))} placeholder="Choisir un dépôt…" disabled={disabled || !trouves.length} onChange={(nom) => { setErreur(null); onChoix(nom, depots.find((d) => d.nom === nom)?.branche ?? ""); }} />
      </Champ>
      {!depots.length && <p role="status" className="m-0 text-ui-s text-texte-secondaire">Aucun dépôt accessible avec ce compte. Vérifie les autorisations GitHub de ton organisation ou change de compte.</p>}
      {!!depots.length && !trouves.length && <p role="status" className="m-0 text-ui-s text-texte-secondaire">Aucun dépôt ne correspond à ta recherche.</p>}
      {depot && <Champ label="Branche"><ListeDeroulante value={branche} options={branches.map((b) => ({ value: b, label: b }))} placeholder={chargeBranches ? "Chargement des branches…" : "Choisir une branche…"} disabled={disabled || chargeBranches || !branches.length} onChange={(b) => onChoix(depot, b)} /></Champ>}
    </>}
    {erreur && <p role="alert" className="m-0 text-ui-s text-texte-erreur">{erreur}</p>}
    <p className="m-0 text-ui-xs text-texte-tertiaire">Le dépôt est cloné {lieu ? "sur ce VPS" : "sur ce PC"}. Le dossier est créé automatiquement ; tes agents y travaillent. Rien n’est envoyé sur GitHub à cette étape.</p>
  </section>;
}
