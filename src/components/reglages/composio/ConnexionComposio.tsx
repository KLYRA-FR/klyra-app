"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { Modale } from "@/components/ui/Modale";
import { cn } from "@/lib/cn";
import type { VueCompteComposio, VueServiceComposio } from "@/lib/bridge";
import type { ComposioApiInterface } from "@/lib/composio";
import { compteComposioActif } from "@/lib/composio-vues";
import { normaliser } from "../catalogue";
import { Erreur } from "../ui";

export function ConnexionComposio({ api, initial, ancien, onFermer, onTermine }: {
  api: ComposioApiInterface; initial?: string; ancien?: VueCompteComposio;
  onFermer: () => void; onTermine: (service: VueServiceComposio, compte: VueCompteComposio) => void;
}) {
  const [requete, setRequete] = useState("");
  const [slug, setSlug] = useState(initial ?? "");
  const [configuration, setConfiguration] = useState("");
  const [attente, setAttente] = useState<{ compteId: string; service: string; expireLe: string | null } | null>(null);
  const catalogue = api.etat?.services ?? [];
  const service = catalogue.find((s) => s.slug === slug);
  const configurations = service?.configurations.filter((c) => c.active) ?? [];
  const authId = configurations.length === 1 ? configurations[0].id : configurations.some((c) => c.id === configuration) ? configuration : "";
  const compte = api.etat?.comptes.find((c) => c.id === attente?.compteId && c.service === attente.service);
  const valide = !!compte && compteComposioActif(compte);
  const occupe = !!api.action || api.chargement;
  const ferme = useRef(false);
  const termine = useRef(false);
  const filtres = catalogue.filter((s) => normaliser(`${s.nom} ${s.slug} ${s.description}`).includes(normaliser(requete)));

  useEffect(() => { ferme.current = false; return () => { ferme.current = true; }; }, []);
  const fermer = () => { ferme.current = true; onFermer(); };

  // Ouvrir le navigateur ne suffit pas : seul ACTIVE relu côté source confirme.
  // La sélection des agents reste un geste distinct, après la connexion.
  useEffect(() => {
    if (!valide || !compte || !service || occupe || termine.current || ferme.current) return;
    termine.current = true;
    onTermine(service, compte);
  }, [valide, compte, service, occupe, onTermine]);

  const choisir = (s: VueServiceComposio) => {
    setSlug(s.slug);
    setConfiguration("");
    requestAnimationFrame(() => document.querySelector<HTMLElement>('[role="dialog"] [role="combobox"], [role="dialog"] [data-continuer-composio]')?.focus());
  };
  const continuer = async () => {
    if (!service || !authId) return;
    const lien = await api.faire("connecter", (p, c) => p.connecter(c, service.slug, authId));
    if (lien && !ferme.current) setAttente(lien);
  };
  const fleches = (e: KeyboardEvent<HTMLButtonElement>) => {
    const lignes = Array.from(e.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="option"]:not([disabled])') ?? []);
    const i = lignes.indexOf(e.currentTarget);
    const j = e.key === "ArrowDown" ? Math.min(lignes.length - 1, i + 1) : e.key === "ArrowUp" ? Math.max(0, i - 1) : e.key === "Home" ? 0 : e.key === "End" ? lignes.length - 1 : -1;
    if (j >= 0) { e.preventDefault(); lignes[j]?.focus(); }
  };
  const echoue = !!compte && ["FAILED", "EXPIRED", "REVOKED", "INACTIVE"].includes(compte.statut);
  const expire = !!attente?.expireLe && Date.parse(attente.expireLe) < (api.etat?.verifieLe ?? 0);
  return <Modale titre={attente ? `Connexion à ${service?.nom ?? slug}` : ancien ? `Reconnecter ${service?.nom ?? slug}` : "Connecter un service"} onFermer={fermer} className="w-[520px] max-h-[calc(100dvh-32px)] overflow-y-auto" actions={<>
    <Bouton onClick={fermer}>{attente ? "Fermer" : "Annuler"}</Bouton>
    {attente ? <BoutonPrincipal disabled={occupe} onClick={() => void api.actualiser()}>{occupe ? "Vérification…" : "Actualiser"}</BoutonPrincipal> : <BoutonPrincipal data-continuer-composio disabled={occupe || !authId} onClick={() => void continuer()}>{api.action === "connecter" ? "Ouverture…" : "Continuer dans le navigateur"}</BoutonPrincipal>}
  </>}>
    <div className="flex flex-col gap-4">
      {attente ? <>
        <p role="status" className="m-0">{valide ? "Connexion confirmée par Composio." : echoue ? "Composio n’a pas confirmé une connexion active." : expire ? "Ce lien de connexion a expiré. Vérifie l’état avant d’en ouvrir un nouveau." : "Termine la connexion dans le navigateur, puis vérifie ici. Tes agents gardent le compte choisi jusqu’à ce que tu le changes."}</p>
        {(echoue || expire) && !valide && <Bouton disabled={occupe} onClick={() => { setAttente(null); termine.current = false; }}>Recommencer la connexion</Bouton>}
        <p className="m-0 text-ui-xs">La connexion pourra apparaître après actualisation, même si tu fermes cette fenêtre. Tu choisiras ensuite le compte de tes agents.</p>
      </> : <>
        {!initial && <>
          <label className="flex flex-col gap-1.5 text-ui-xs">Rechercher un service
            <input data-autofocus aria-controls="catalogue-composio" onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); document.querySelector<HTMLElement>('#catalogue-composio [role="option"]:not([disabled])')?.focus(); } }} type="search" value={requete} onChange={(e) => setRequete(e.target.value)} className="h-9 w-full rounded-md border border-bordure-champ bg-fond-surface px-3 text-ui-s text-texte-principal outline-none focus:border-focus" placeholder="Nom du service…" />
          </label>
          <div id="catalogue-composio" role="listbox" aria-label="Services du projet Composio" className="klyra-defilement-fin max-h-48 overflow-y-auto rounded-md border border-bordure-subtile p-1">
            {filtres.map((s) => <button key={s.slug} type="button" role="option" aria-selected={s.slug === slug} disabled={!s.configurations.some((c) => c.active)} tabIndex={slug === s.slug || (!slug && s === filtres.find((c) => c.configurations.some((a) => a.active))) ? 0 : -1} onKeyDown={fleches} onClick={() => choisir(s)} className={cn("flex w-full flex-col gap-0.5 rounded-sm border-0 p-2 text-left disabled:opacity-50", s.slug === slug ? "bg-fond-survol text-texte-principal" : "bg-transparent hover:bg-fond-survol")}>
              <span className="text-ui-s font-medium">{s.nom}</span><span className="line-clamp-2 text-ui-xs text-texte-secondaire">{s.description || s.slug}{!s.configurations.some((c) => c.active) ? " · Configuration inactive" : ""}</span>
            </button>)}
            {!filtres.length && <p className="m-2 text-ui-xs">Aucun service de ton projet ne correspond.</p>}
          </div>
        </>}
        {service && <>
          {configurations.length > 1 && <ListeDeroulante libelle="Configuration Composio" value={authId} placeholder="Choisir une configuration…" options={configurations.map((c) => ({ value: c.id, label: `${c.nom || c.id} · ${c.methode}` }))} onChange={setConfiguration} />}
          {!configurations.length && <Erreur>Aucune configuration active pour ce service. Prépare-la dans la console Composio, puis actualise.</Erreur>}
          <p className="m-0 text-ui-xs">L’authentification se fait chez Composio et le service choisi. Une connexion n’autorise pas tes agents à envoyer, publier ou supprimer sans ton accord.</p>
          {ancien && <p className="m-0 text-ui-xs">L’ancien compte reste chez Composio. Tes agents gardent le compte choisi jusqu’à ce que tu le changes. Tu pourras déconnecter l’ancien séparément.</p>}
        </>}
      </>}
      {api.erreur && <Erreur>{api.erreur}</Erreur>}
    </div>
  </Modale>;
}
