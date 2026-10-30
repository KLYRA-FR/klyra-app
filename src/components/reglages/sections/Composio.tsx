"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { useConfirmation } from "@/components/ui/Modale";
import { MenuLignes } from "@/components/team/MenuLignes";
import type { VueCompteComposio, VueServiceComposio } from "@/lib/bridge";
import { useComposio, type ComposioApiInterface } from "@/lib/composio";
import { compteComposioActif, heureComposio, nomCompteComposio, statutCompteComposio } from "@/lib/composio-vues";
import { Erreur, Groupe, Ligne, Pastille, SeulementBureau, Valeur, ancreReglage } from "../ui";
import { ConnexionComposio } from "../composio/ConnexionComposio";

export function Composio() {
  const api = useComposio();
  return <ContenuComposio key={api.scope} api={api} />;
}

function ContenuComposio({ api }: { api: ComposioApiInterface }) {
  const router = useRouter();
  const { etat, erreur, chargement, action, message, faire } = api;
  const occupe = !!action || chargement;
  const [demander, confirmation] = useConfirmation();
  const [connexion, setConnexion] = useState<{ service?: string; ancien?: VueCompteComposio } | null>(null);
  const [succes, setSucces] = useState("");
  const [nouveaux, setNouveaux] = useState<string[]>([]);
  const [anciens, setAnciens] = useState<string[]>([]);
  const identite = etat?.profil.type === "equipe" ? `Pour ${etat.profil.nom} (compte d’équipe), sur cet ordinateur` : etat ? "Pour le profil de cet ordinateur" : "";
  const titreEtat = chargement ? "Actualisation…" : !etat ? (erreur ? "Accès indisponible" : "Pas configuré") : !etat.coffreDisponible ? "Coffre non sûr" : etat.erreur ? (etat.erreur.code === "reseau" ? "Hors ligne" : etat.erreur.code === "acces" ? "Clé refusée" : "Erreur") : etat.configure ? "Prêt" : "Pas configuré";

  const importer = async () => {
    if (etat?.configure && !(await demander({ titre: "Remplacer la clé du projet ?", texte: "Tu choisis un nouveau fichier de clé. Les comptes restent chez Composio ; les choix des agents sont remis à Aucun. Avec la clé d’un autre projet, les anciens comptes ne seront plus accessibles ici.", confirmer: "Choisir le fichier…" }))) return;
    const importe = await faire("importer", (p, c) => p.importer(c));
    if (importe) setSucces("Clé du projet importée. Tu peux supprimer le fichier privé.");
  };
  const retirer = async () => {
    if (!(await demander({ titre: "Retirer la clé Composio de ce poste ?", texte: "Tes agents n’auront plus accès à Composio pour ce profil. Les choix de compte des agents sont effacés. Les comptes connectés restent chez Composio. Pour retirer une connexion chez Composio, déconnecte-la ici avant de retirer la clé.", confirmer: "Retirer la clé" }))) return;
    await faire("retirer", (p, c) => p.retirer(c), "Clé retirée de ce profil. Les comptes restent chez Composio.");
  };
  const choisir = (service: string, compte: VueCompteComposio | null) => faire("selectionner", (p, c) => p.selectionner(c, service, compte?.id ?? null), compte ? `Tes agents utilisent maintenant ${nomCompteComposio(compte)} pour ${service}.` : `Tes agents n’utilisent plus aucun compte pour ${service}.`);
  const deconnecter = async (compte: VueCompteComposio, service: string) => {
    if (!(await demander({ titre: `Déconnecter ${nomCompteComposio(compte)} de ${service} ?`, texte: `Cette connexion est supprimée chez Composio. Tout outil qui l’utilise perd son accès. Les autorisations chez ${service} peuvent rester en place. ${etat?.selections[compte.service] === compte.id ? "Tes agents n’auront plus de compte choisi pour ce service." : ""}`, confirmer: "Déconnecter" }))) return;
    await faire(`deconnecter:${compte.id}`, (p, c) => p.deconnecter(c, compte.id), "Connexion retirée chez Composio.");
  };

  const services = etat ? [...new Set([...etat.comptes.map((c) => c.service), ...Object.keys(etat.selections), ...etat.enAttente.map((c) => c.service)])]
    .map((slug) => etat.services.find((s) => s.slug === slug) ?? { slug, nom: slug, description: "", configurations: [] })
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr")) : [];

  return <>
    <Groupe titre="Projet Composio">
      <Ligne id="projet-composio" libelle={`Composio · ${titreEtat}`} description={<span role="status">{identite || "Les connexions restent propres à chaque profil sur cet ordinateur."}</span>}>
        {!api.bureau ? <SeulementBureau /> : <div className="flex flex-wrap gap-2">
          {etat?.configure && <Bouton disabled={occupe || !etat.coffreDisponible} onClick={() => void importer()}>Remplacer la clé…</Bouton>}
          <Bouton disabled={occupe} onClick={() => void api.actualiser()} iconeGauche={<Icon name="refresh-01" size={16} />}>{chargement ? "Actualisation…" : "Actualiser"}</Bouton>
        </div>}
      </Ligne>
      {api.bureau && etat && !etat.configure && <Ligne pile libelle="Préparer ton projet" description="La clé et les comptes restent dans ce profil sur cet ordinateur. Rien n’est partagé avec ton équipe.">
        <div className="flex w-full flex-col gap-4">
          <ol className="m-0 list-decimal space-y-1 pl-4 text-ui-xs text-texte-secondaire">
            <li>Dans la console Composio, prépare les services de ton projet.</li>
            <li>Crée une clé de projet et enregistre-la dans un fichier privé sur cet ordinateur.</li>
            <li>Importe ce fichier ici. La clé sera gardée dans le coffre du système ; tu pourras ensuite supprimer le fichier.</li>
          </ol>
          <div className="flex flex-wrap items-center gap-2">
            <BoutonPrincipal disabled={occupe || !etat.coffreDisponible} onClick={() => void importer()}>{action === "importer" ? "Vérification…" : "Importer la clé du projet…"}</BoutonPrincipal>
            <Bouton variant="discret" onClick={() => void api.console()}>Ouvrir la console Composio</Bouton>
          </div>
          {!etat.coffreDisponible && <Erreur>Ce poste n’a pas de coffre sécurisé disponible. Aucune clé ne peut être importée.</Erreur>}
        </div>
      </Ligne>}
      {etat?.configure && <>
        <Ligne libelle="Clé du projet" description="Gardée dans le coffre du système. Elle ne revient jamais vers l’écran."><Bouton variant="discret" disabled={occupe} onClick={() => void retirer()}>Retirer de ce poste…</Bouton></Ligne>
        {etat.verifieLe && <Ligne libelle="Actualisé"><Valeur>à {heureComposio(etat.verifieLe)}</Valeur></Ligne>}
      </>}
      {erreur && <Erreur>{erreur}</Erreur>}
    </Groupe>
    {(message || succes) && <p role="status" className="m-0 text-ui-xs text-texte-secondaire">{message || succes}</p>}
    {etat?.configure && !etat.erreur && <Groupe titre="Services connectés" description="Pour chaque service, tes agents n’utilisent que le compte choisi.">
      <div id={ancreReglage("services-composio")} className="klyra-reglage scroll-mt-6">
        {services.map((service) => <Service key={service.slug} service={service} api={api} anciens={anciens} nouveaux={nouveaux} choisir={choisir} deconnecter={deconnecter} reconnecter={(ancien) => setConnexion({ service: service.slug, ancien })} />)}
        {!services.length && <p className="my-4 text-ui-s text-texte-secondaire">{etat.services.some((s) => s.configurations.some((c) => c.active)) ? "Aucun compte connecté pour ce profil. Connecte un service, puis choisis le compte de tes agents." : "Ton projet Composio n’a encore aucun service prêt. Prépare les services dans la console Composio, puis actualise."}</p>}
      </div>
      <Ligne id="ajouter-service" libelle="Connecter un service">
        <Bouton disabled={occupe || !etat.services.some((s) => s.configurations.some((c) => c.active))} onClick={() => setConnexion({})} iconeGauche={<Icon name="plus-01" size={16} />}>Connecter un service</Bouton>
        <Bouton variant="discret" onClick={() => void api.console()}>Console Composio</Bouton>
      </Ligne>
    </Groupe>}
    <Groupe titre="Ce que tes agents peuvent faire">
      <Ligne id="agents-composio" libelle="Ce qu’ils font" description="Chercher une action, lire son schéma et l’exécuter. Ils ne connectent ni ne déconnectent aucun compte." />
      <Ligne libelle="Quel compte" description="Seulement le compte choisi pour le service. S’il manque, expire ou devient indisponible, l’appel est refusé. Aucun autre compte ne le remplace." />
      <Ligne pile libelle="Avant d’agir" description="Les réglages d’accès restent applicables. L’exécution Composio n’est pas autorisée d’office en mode projet. Avec « Tout accepter », aucune carte ne bloque l’action ; les consignes des agents leur demandent toujours l’accord avant d’envoyer, publier ou supprimer.">
        <Bouton variant="discret" onClick={() => router.push("/reglages?section=agents")}>Accès des agents <Icon name="chevron-right" size={16} /></Bouton>
      </Ligne>
      <Ligne libelle="À qui" description={`${identite || "À ce profil sur cet ordinateur"}. Rien n’est partagé avec l’équipe ou les autres profils.`} />
      <Ligne libelle="Coût" description="Composio est un service externe. Son offre et ses limites se consultent dans la console Composio." />
    </Groupe>
    {confirmation}
    {connexion && etat && <ConnexionComposio api={api} initial={connexion.service} ancien={connexion.ancien} onFermer={() => setConnexion(null)} onTermine={(service, compte) => {
      if (connexion.ancien) setAnciens((a) => [...a, connexion.ancien!.id]);
      setNouveaux((n) => [...n, compte.id]);
      setSucces(`${service.nom} connecté : ${nomCompteComposio(compte)}. Choisis-le pour tes agents si tu veux l’utiliser.`);
      setConnexion(null);
      requestAnimationFrame(() => Array.from(document.querySelectorAll<HTMLElement>("[data-service-composio]")).find((el) => el.dataset.serviceComposio === service.slug)?.querySelector<HTMLElement>('[data-utiliser-composio]')?.focus());
    }} />}
  </>;
}

function Service({ service, api, anciens, nouveaux, choisir, deconnecter, reconnecter }: {
  service: VueServiceComposio; api: ComposioApiInterface; anciens: string[]; nouveaux: string[];
  choisir: (service: string, compte: VueCompteComposio | null) => Promise<unknown>;
  deconnecter: (compte: VueCompteComposio, service: string) => Promise<void>;
  reconnecter: (compte: VueCompteComposio) => void;
}) {
  const etat = api.etat!;
  const choix = etat.selections[service.slug];
  const comptes = etat.comptes.filter((c) => c.service === service.slug).sort((a, b) => Number(b.id === choix) - Number(a.id === choix) || nomCompteComposio(a).localeCompare(nomCompteComposio(b)));
  const choisi = comptes.find((c) => c.id === choix);
  const occupe = !!api.action || api.chargement;
  const peutReconnecter = service.configurations.some((c) => c.active);
  const attentesAbsentes = etat.enAttente.filter((a) => a.service === service.slug && !comptes.some((c) => c.id === a.compteId));
  return <section data-service-composio={service.slug} className="border-b border-bordure-subtile py-3.5 last:border-b-0">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h4 className="m-0 text-ui-s font-semibold text-texte-principal">{service.nom}</h4>
      <div className="flex min-w-0 flex-wrap items-center gap-2 text-ui-xs text-texte-secondaire">
        Compte de tes agents
        <ListeDeroulante libelle={`Compte de tes agents pour ${service.nom}`} variante="puce" disabled={occupe} value={choix ?? ""} options={[
          ...(choix && !choisi ? [{ value: choix, label: `Compte …${choix.slice(-4)} · introuvable`, disabled: true }] : []),
          ...comptes.map((c) => ({ value: c.id, label: `${nomCompteComposio(c)}${compteComposioActif(c) ? "" : ` · ${statutCompteComposio(c).texte.toLowerCase()}`}`, disabled: !compteComposioActif(c) })),
          { value: "", label: "Aucun" },
        ]} onChange={(id) => void choisir(service.slug, comptes.find((c) => c.id === id) ?? null)} className="max-w-full" />
      </div>
    </div>
    {comptes.map((compte) => <div key={compte.id} data-compte-composio={compte.id} className="flex flex-col gap-1 py-2.5">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className="flex size-8 shrink-0 items-center justify-center rounded-full bg-fond-surface-grise text-ui-s font-semibold text-texte-secondaire">{service.nom[0]}</span>
        <div className="min-w-0 flex-1 basis-36"><div title={nomCompteComposio(compte)} className="truncate text-ui-s font-medium text-texte-principal">{nomCompteComposio(compte)}</div>{compte.alias && compte.alias !== compte.nom && <div className="truncate text-ui-xs text-texte-secondaire">{compte.alias}</div>}</div>
        <div className="flex flex-wrap items-center gap-2">
          <Pastille {...statutCompteComposio(compte)} />
          {nouveaux.includes(compte.id) && compteComposioActif(compte) && choix !== compte.id && <Bouton data-utiliser-composio disabled={occupe} onClick={() => void choisir(service.slug, compte)}>Utiliser pour tes agents</Bouton>}
          {!compteComposioActif(compte) && !["INITIATED", "INITIALIZING"].includes(compte.statut) && <Bouton disabled={occupe || !peutReconnecter} onClick={() => reconnecter(compte)}>Reconnecter</Bouton>}
          <MenuLignes libelle={`Options de ${nomCompteComposio(compte)}`} declencheur={(d) => <BoutonIcone ref={d.ref} {...d.attributs} libelle={`Plus d’options pour ${nomCompteComposio(compte)} (${service.nom})`} disabled={occupe} variant="discret" onClick={d.basculer} icone={<Icon name="dot-horizontal" size={16} />} />} lignes={[
            ...(compteComposioActif(compte) && choix !== compte.id ? [{ id: "choisir", titre: "Utiliser pour tes agents", icone: "check-01" as const, onChoisir: () => void choisir(service.slug, compte) }] : []),
            { id: "reconnecter", titre: "Reconnecter", icone: "refresh-01", desactivee: !peutReconnecter, onChoisir: () => reconnecter(compte) },
            { id: "deconnecter", titre: "Déconnecter…", icone: "trash-01", separee: true, detail: "Supprime la connexion chez Composio", onChoisir: () => void deconnecter(compte, service.nom) },
          ]} />
        </div>
      </div>
      {api.action === `deconnecter:${compte.id}` && <span role="status" className="text-ui-xs text-texte-secondaire">Déconnexion…</span>}
      {anciens.includes(compte.id) && <div className="flex flex-wrap items-center gap-2 text-ui-xs text-texte-secondaire">L’ancien compte reste chez Composio.<Bouton variant="discret" disabled={occupe} onClick={() => void deconnecter(compte, service.nom)}>Déconnecter l’ancien compte…</Bouton></div>}
    </div>)}
    {attentesAbsentes.map((a) => <p key={a.compteId} role="status" className="text-ui-xs text-texte-secondaire">Connexion en attente de confirmation par Composio. Actualise après la validation dans le navigateur.</p>)}
    {!choix && nouveaux.some((id) => comptes.some((c) => c.id === id)) && <p role="status" className="text-ui-xs text-texte-secondaire">Choisis le compte de tes agents pour qu’ils puissent utiliser {service.nom}.</p>}
    {choix && (!choisi || !compteComposioActif(choisi)) && <p role="status" className="m-0 mt-2 text-ui-xs text-texte-secondaire">Tes agents ne peuvent pas utiliser {service.nom} : {choisi ? `le compte choisi est ${statutCompteComposio(choisi).texte.toLowerCase()}` : "le compte choisi n’est plus présent chez Composio"}. Choisis un compte actif ou Aucun.</p>}
  </section>;
}
