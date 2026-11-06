"use client";

import { useLieuActif } from "@/lib/lieux";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Image from "next/image";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { MenuLignes } from "@/components/team/MenuLignes";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { Modale, useConfirmation } from "@/components/ui/Modale";
import { ancreReglage, Erreur, Pastille } from "@/components/reglages/ui";
import { getBridge, type EtatConnect, type McpDirect, type VueCompteComposio, type VueServiceComposio } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { useComposio, type ComposioApiInterface } from "@/lib/composio";
import { compteComposioActif, nomCompteComposio, statutCompteComposio } from "@/lib/composio-vues";
import { ConnexionComposio } from "./ConnexionComposio";

/** Les apps connues, dans l'ordre de la grille ; l'adresse du serveur reste côté Electron. */
/** Les apps en direct. `composio` : l'app passe par Composio (son serveur MCP n'ouvre pas l'inscription OAuth) ; les autres s'autorisent dans le navigateur. */
const APPS: { id: string; nom: string; description: string; via?: "composio" }[] = [
  { id: "github", nom: "GitHub", description: "Dépôts, issues et pull requests.", via: "composio" },
  { id: "linear", nom: "Linear", description: "Tickets, projets et cycles." },
  { id: "supabase", nom: "Supabase", description: "Bases, tables et fonctions." },
  { id: "neon", nom: "Neon", description: "Bases Postgres et leurs branches." },
  { id: "stripe", nom: "Stripe", description: "Paiements, clients et abonnements." },
];

/** Les apps à brancher : Composio d'abord (une connexion, des centaines d'apps), puis les MCP directs. Section des Réglages. */
export function Marketplace() {
  const connect = useComposioConnect();
  return (
    <>
      <div id={ancreReglage("composio")} className="scroll-mt-6">
        <CarteComposio connect={connect} />
      </div>
      <div id={ancreReglage("apps-directes")} className="scroll-mt-6">
        <AppsDirectes composio={connect} />
      </div>
    </>
  );
}

/** La Marketplace en page seule (ancienne adresse) ; le menu mène aux Réglages. */
export function MarketplaceScreen() {
  const lieu = useLieuActif();
  const connect = useComposioConnect();
  return (
    <div className="h-full overflow-y-auto">
      <div className="@container mx-auto flex w-full max-w-[960px] flex-col gap-8 px-5 pt-5 pb-8">
        <header className="flex flex-col gap-1.5">
          <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
            <span className="font-semibold">Marketplace</span>
          </h1>
          <p className="m-0 text-ui-s text-texte-secondaire">Les apps que tes agents peuvent utiliser.</p>
        </header>
        {lieu && (
          <p role="note" className="m-0 rounded-md bg-fond-surface-grise px-3 py-2 text-ui-s text-texte-secondaire">
            Composio a ici le compte de ce serveur. Les apps directes et le mode développeur restent ceux de cet ordinateur : les agents de ce serveur ne s’en servent pas.
          </p>
        )}
        <CarteComposio connect={connect} />
        <AppsDirectes composio={connect} />
      </div>
    </div>
  );
}

/* ─── Composio ─────────────────────────────────────────────── */

/** Composio Connect : la connexion par le navigateur, avec le compte Composio de la personne. */
function useComposioConnect() {
  const brut = getBridge()?.composio?.connect;
  /* Le compte Composio du serveur affiché : chacun le sien. */
  const lieu = useLieuActif();
  const [ancien, setAncien] = useState<string | null>(null);
  const vps = lieu && lieu !== ancien ? brut?.vps : undefined;
  const pont = useMemo(() => {
    if (!brut) return undefined;
    if (!vps || !lieu) return brut;
    return {
      etat: () => vps.etat(lieu),
      connecter: () => vps.connecter(lieu),
      annuler: () => vps.annuler(),
      deconnecter: () => vps.deconnecter(lieu),
    };
  }, [brut, vps, lieu]);
  const [etat, setEtat] = useState<EtatConnect | null>(null);
  const [erreur, setErreur] = useState("");
  const relire = useCallback(async () => {
    if (!pont) return;
    const r = await pont.etat();
    if (r.ok) setEtat(r.data);
    else if (r.code === "serveur-ancien" && lieu) setAncien(lieu);
    else setErreur(r.message);
  }, [pont, lieu]);
  useEffect(() => {
    const debut = window.setTimeout(() => void relire(), 0);
    window.addEventListener("focus", relire);
    return () => { window.clearTimeout(debut); window.removeEventListener("focus", relire); };
  }, [relire]);
  const connecter = async () => {
    if (!pont) return;
    setErreur("");
    setEtat((e) => e && { ...e, enCours: true });
    const r = await pont.connecter();
    if (!r.ok) setErreur(r.message);
    await relire();
  };
  return {
    pont, etat, erreur, connecter, relire, surVps: !!vps,
    annuler: async () => { await pont?.annuler(); await relire(); },
    deconnecter: async () => { await pont?.deconnecter(); await relire(); },
  };
}

type EtatComposioConnect = ReturnType<typeof useComposioConnect>;

/** La carte Composio ; `connect` est partagé avec la carte GitHub des apps en direct. */
function CarteComposio({ connect }: { connect: EtatComposioConnect }) {
  const api = useComposio();
  const [demander, confirmation] = useConfirmation();
  const [dev, setDev] = useState(false);
  const etat = connect.etat;
  const deconnecter = async () => {
    if (!(await demander({ titre: "Se déconnecter de Composio ?", texte: "Tes agents n’auront plus accès à tes apps Composio sur cet ordinateur. Les apps restent connectées chez Composio.", confirmer: "Se déconnecter" }))) return;
    await connect.deconnecter();
  };
  return (
    <section aria-labelledby="titre-composio" className="klyra-carte-flottante flex flex-col gap-5 rounded-xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-4">
          <Logo nom="Composio" logo="composio" grand />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="titre-composio" className="m-0 text-ui font-semibold text-texte-principal">Composio</h2>
              <span className="rounded-pill bg-fond-teinte-bleue px-2 py-0.5 text-ui-2xs font-medium text-texte-accent">Recommandé</span>
              {etat?.connecte && <Pastille texte="Connecté" ton="ok" />}
            </div>
            <p className="m-0 text-ui-s text-texte-secondaire">Gmail, Slack, Notion, Google Agenda et des centaines d’autres apps, en une seule connexion.</p>
          </div>
        </div>
        {!connect.pont ? <span className="text-ui-xs text-texte-tertiaire">Dans l’app de bureau.</span> : etat?.enCours ? (
          <div className="flex items-center gap-3">
            <span role="status" className="text-ui-s text-texte-secondaire">Termine dans le navigateur…</span>
            <Bouton onClick={() => void connect.annuler()}>Annuler</Bouton>
          </div>
        ) : etat?.connecte ? (
          <MenuLignes libelle="Options de Composio" declencheur={(d) => <BoutonIcone ref={d.ref} {...d.attributs} libelle="Plus d’options pour Composio" variant="discret" onClick={d.basculer} icone={<Icon name="dot-horizontal" size={16} />} />} lignes={[
            { id: "console", titre: "Ouvrir Composio", icone: "link-external", onChoisir: () => void api.console() },
            { id: "deconnecter", titre: "Se déconnecter…", icone: "trash-01", separee: true, onChoisir: () => void deconnecter() },
          ]} />
        ) : (
          <BoutonPrincipal disabled={!etat} onClick={() => void connect.connecter()}>Se connecter à Composio</BoutonPrincipal>
        )}
      </div>
      {etat?.connecte && <p role="status" className="m-0 text-ui-s text-texte-secondaire">
        Connecté{etat.compte ? <> en tant que <span className="font-medium text-texte-principal">{etat.compte}</span></> : ""}. Tes agents branchent une app la première fois qu’ils en ont besoin : Composio te donne un lien à valider.
      </p>}
      {(connect.erreur || etat?.erreur) && !etat?.enCours && <Erreur>{connect.erreur || etat?.erreur}</Erreur>}
      {!connect.surVps && <details open={dev || !!api.etat?.configure} onToggle={(e) => setDev(e.currentTarget.open)} className="border-t border-bordure-subtile pt-4">
        <summary className="cursor-pointer text-ui-xs text-texte-tertiaire">Mode développeur : clé de projet</summary>
        <div className="mt-4 flex flex-col gap-4">
          <ModeDeveloppeur key={api.scope} api={api} />
        </div>
      </details>}
      {confirmation}
    </section>
  );
}

/** L'ancien branchement par clé de projet (API Composio), pour qui en a déjà une. */
function ModeDeveloppeur({ api }: { api: ComposioApiInterface }) {
  const { etat, erreur, chargement, action, message, faire } = api;
  const occupe = !!action || chargement;
  const connecte = !!etat?.configure && !etat.erreur;
  const [demander, confirmation] = useConfirmation();
  const [cle, setCle] = useState(false);
  const [saisie, setSaisie] = useState("");
  const [ajout, setAjout] = useState(false);
  const [succes, setSucces] = useState("");

  // Le pont répond « faux » si la fenêtre de fichier est fermée sans choix : rien n'est annoncé.
  const connecter = async (importee: boolean | null) => {
    if (!importee) return;
    setCle(false);
    setSaisie("");
    setSucces("La clé de projet est enregistrée.");
  };
  const importer = async () => connecter(await faire("importer", (p, c) => p.importer(c)));
  const valider = async () => {
    if (saisie.trim()) await connecter(await faire("saisir", (p, c) => p.saisir(c, saisie)));
  };
  const remplacer = async () => {
    if (!(await demander({ titre: "Remplacer la clé Composio ?", texte: "Avec la clé d’un autre projet, les apps connectées jusqu’ici ne seront plus accessibles. Les comptes de tes agents sont remis à zéro.", confirmer: "Remplacer" }))) return;
    setSucces("");
    setCle(true);
  };
  const deconnecter = async () => {
    if (!(await demander({ titre: "Retirer la clé de projet ?", texte: "Tes agents n’auront plus accès aux apps de ce projet Composio sur cet ordinateur. Les comptes restent chez Composio.", confirmer: "Retirer" }))) return;
    await faire("retirer", (p, c) => p.retirer(c), "La clé de projet est retirée de cet ordinateur.");
  };
  const choisir = (service: string, compte: VueCompteComposio | null) => faire("selectionner", (p, c) => p.selectionner(c, service, compte?.id ?? null));
  const retirerCompte = async (compte: VueCompteComposio, service: string) => {
    if (!(await demander({ titre: `Déconnecter ${service} ?`, texte: `La connexion ${nomCompteComposio(compte)} est supprimée chez Composio.`, confirmer: "Déconnecter" }))) return;
    await faire(`deconnecter:${compte.id}`, (p, c) => p.deconnecter(c, compte.id), `${service} est déconnecté.`);
  };

  const services = etat && connecte ? [...new Set([...etat.comptes.map((c) => c.service), ...Object.keys(etat.selections)])]
    .map((slug) => etat.services.find((s) => s.slug === slug) ?? { slug, nom: slug, description: "", configurations: [] })
    .sort((a, b) => a.nom.localeCompare(b.nom, "fr")) : [];
  const peutAjouter = !!etat?.services.some((s) => s.configurations.some((c) => c.active));
  const titreEtat = chargement && !etat ? null : connecte ? <Pastille texte="Connecté" ton="ok" /> : etat?.configure && etat.erreur ? <Pastille texte={etat.erreur.code === "reseau" ? "Hors ligne" : "À vérifier"} ton="attente" /> : null;

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-1 basis-60 flex-col gap-0.5">
          <div className="flex flex-wrap items-center gap-2"><span className="text-ui-s font-medium text-texte-principal">Clé de projet</span>{titreEtat}</div>
          <span className="text-ui-xs text-texte-tertiaire">Pour un projet Composio déjà préparé dans sa console.</span>
        </div>
        {!api.bureau ? null : connecte ? (
          <div className="flex items-center gap-2">
            <Bouton disabled={occupe || !peutAjouter} onClick={() => setAjout(true)} iconeGauche={<Icon name="plus-01" size={16} />}>Ajouter une app</Bouton>
            <MenuLignes libelle="Options de la clé de projet" declencheur={(d) => <BoutonIcone ref={d.ref} {...d.attributs} libelle="Plus d’options pour la clé de projet" disabled={occupe} variant="discret" onClick={d.basculer} icone={<Icon name="dot-horizontal" size={16} />} />} lignes={[
              { id: "console", titre: "Ouvrir la console Composio", icone: "link-external", onChoisir: () => void api.console() },
              { id: "actualiser", titre: "Actualiser", icone: "refresh-01", onChoisir: () => void api.actualiser() },
              { id: "remplacer", titre: "Remplacer la clé…", icone: "lock-01", onChoisir: () => void remplacer() },
              { id: "deconnecter", titre: "Retirer la clé…", icone: "trash-01", separee: true, onChoisir: () => void deconnecter() },
            ]} />
          </div>
        ) : etat?.configure ? (
          <Bouton disabled={occupe} onClick={() => void api.actualiser()} iconeGauche={<Icon name="refresh-01" size={16} />}>{chargement ? "Actualisation…" : "Réessayer"}</Bouton>
        ) : (
          <Bouton disabled={occupe || !etat} onClick={() => setCle(true)}>Coller une clé…</Bouton>
        )}
      </div>

      {connecte && (
        <div className="flex flex-col divide-y divide-bordure-subtile border-t border-bordure-subtile">
          {services.map((s) => <ServiceComposio key={s.slug} service={s} api={api} choisir={choisir} retirer={retirerCompte} />)}
          {!services.length && <p className="m-0 pt-4 text-ui-s text-texte-secondaire">{peutAjouter ? "Aucune app connectée pour l’instant." : "Ton projet Composio n’a encore aucune app prête. Ajoute-les dans la console Composio, puis actualise."}</p>}
        </div>
      )}
      {etat?.configure && etat.erreur && <Erreur>{etat.erreur.message}</Erreur>}
      {erreur && !etat?.erreur && <Erreur>{erreur}</Erreur>}
      {(message || succes) && <p role="status" className="m-0 text-ui-xs text-texte-secondaire">{message || succes}</p>}

      {cle && etat && (
        <Modale titre={etat.configure ? "Remplacer la clé de projet" : "Clé de projet Composio"} onFermer={() => { setCle(false); setSaisie(""); }} className="w-[460px]" actions={<>
          <Bouton onClick={() => { setCle(false); setSaisie(""); }}>Annuler</Bouton>
          <BoutonPrincipal disabled={occupe || !etat.coffreDisponible || !saisie.trim()} onClick={() => void valider()}>{action === "saisir" ? "Vérification…" : "Connecter"}</BoutonPrincipal>
        </>}>
          <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void valider(); }}>
            <Champ label="Clé API Composio" aide={<>Dans la console Composio, Settings › API Keys. Chiffrée sur cet ordinateur. <button type="button" onClick={() => void api.console()} className="cursor-pointer border-0 bg-transparent p-0 text-texte-accent">Ouvrir la console</button></>}>
              <Input data-autofocus size="sm" type="password" value={saisie} onChange={(e) => setSaisie(e.target.value)} autoComplete="off" spellCheck={false} placeholder="ak_…" className={cn(CHAMP, "klyra-mono")} />
            </Champ>
            <Bouton variant="discret" className="self-start" disabled={occupe || !etat.coffreDisponible} onClick={() => void importer()}>{action === "importer" ? "Vérification…" : "Ou importer un fichier de clé…"}</Bouton>
            {!etat.coffreDisponible && <Erreur>Cet ordinateur n’a pas de coffre sécurisé : la clé ne peut pas être gardée.</Erreur>}
            {(api.echec?.nom === "saisir" || api.echec?.nom === "importer") && <Erreur>{api.echec.texte}</Erreur>}
            <button type="submit" hidden />
          </form>
        </Modale>
      )}
      {ajout && etat && <ConnexionComposio api={api} onFermer={() => setAjout(false)} onTermine={(service, compte) => {
        setAjout(false);
        // Première connexion de cette app : tes agents l'utilisent tout de suite.
        if (!etat.selections[service.slug]) void choisir(service.slug, compte);
      }} />}
      {confirmation}
    </>
  );
}

function ServiceComposio({ service, api, choisir, retirer }: {
  service: VueServiceComposio; api: ComposioApiInterface;
  choisir: (service: string, compte: VueCompteComposio | null) => Promise<unknown>;
  retirer: (compte: VueCompteComposio, service: string) => Promise<void>;
}) {
  const etat = api.etat!;
  const occupe = !!api.action || api.chargement;
  const choix = etat.selections[service.slug];
  const comptes = etat.comptes.filter((c) => c.service === service.slug);
  const choisi = comptes.find((c) => c.id === choix);
  const statut = choisi ? statutCompteComposio(choisi) : { texte: comptes.length ? "Aucun compte choisi" : "Introuvable", ton: "attente" as const };
  return (
    <div data-service-composio={service.slug} className="flex flex-wrap items-center gap-3 py-3">
      <Logo nom={service.nom} src={service.logo ?? undefined} />
      <div className="flex min-w-0 flex-1 basis-40 flex-col">
        <span className="truncate text-ui-s font-medium text-texte-principal">{service.nom}</span>
        {comptes.length <= 1 && choisi && <span className="truncate text-ui-xs text-texte-tertiaire">{nomCompteComposio(choisi)}</span>}
      </div>
      {comptes.length > 1 && <ListeDeroulante libelle={`Compte de tes agents pour ${service.nom}`} variante="puce" disabled={occupe} value={choix ?? ""} options={[
        ...comptes.map((c) => ({ value: c.id, label: nomCompteComposio(c), disabled: !compteComposioActif(c) })),
        { value: "", label: "Aucun" },
      ]} onChange={(id) => void choisir(service.slug, comptes.find((c) => c.id === id) ?? null)} />}
      {!(choisi && compteComposioActif(choisi)) && <Pastille {...statut} />}
      {comptes.length === 1 && !choix && compteComposioActif(comptes[0]) && <Bouton disabled={occupe} onClick={() => void choisir(service.slug, comptes[0])}>Utiliser</Bouton>}
      {comptes.length > 0 && <MenuLignes libelle={`Options de ${service.nom}`} declencheur={(d) => <BoutonIcone ref={d.ref} {...d.attributs} libelle={`Plus d’options pour ${service.nom}`} disabled={occupe} variant="discret" onClick={d.basculer} icone={<Icon name="dot-horizontal" size={16} />} />}
        lignes={comptes.map((c) => ({ id: c.id, titre: comptes.length > 1 ? `Déconnecter ${nomCompteComposio(c)}…` : "Déconnecter…", icone: "trash-01" as const, onChoisir: () => void retirer(c, service.nom) }))} />}
    </div>
  );
}

/* ─── MCP directs ──────────────────────────────────────────── */

function useMcpDirects() {
  const pont = getBridge()?.mcp;
  const [liste, setListe] = useState<McpDirect[]>([]);
  const relire = useCallback(async () => {
    if (!pont) return;
    const l = await pont.lister();
    if (l.ok) setListe(l.data);
  }, [pont]);
  useEffect(() => {
    const debut = window.setTimeout(() => void relire(), 0);
    window.addEventListener("focus", relire);
    return () => { window.clearTimeout(debut); window.removeEventListener("focus", relire); };
  }, [relire]);
  return { pont, liste, setListe };
}

type EntreeConnexion = { app?: string; nom?: string; url?: string; remplace?: string };

function AppsDirectes({ composio }: { composio: EtatComposioConnect }) {
  const { pont, liste, setListe } = useMcpDirects();
  const [autre, setAutre] = useState(false);
  /** La carte dont l'autorisation attend le navigateur. */
  const [attente, setAttente] = useState<string | null>(null);
  const [erreurs, setErreurs] = useState<Record<string, string>>({});
  const [demander, confirmation] = useConfirmation();
  const persos = liste.filter((m) => !m.app);

  const autoriser = async (cle: string, entree: EntreeConnexion) => {
    if (!pont || attente) return;
    setAttente(cle);
    setErreurs((e) => ({ ...e, [cle]: "" }));
    const r = await pont.connecter(entree);
    setAttente(null);
    if (r.ok) setListe(r.data.liste);
    else setErreurs((e) => ({ ...e, [cle]: r.message }));
  };

  const retirer = async (m: McpDirect) => {
    if (!pont || !(await demander({ titre: `Retirer ${m.nom} ?`, texte: "Tes agents n’y auront plus accès. Son accès est effacé de cet ordinateur.", confirmer: "Retirer" }))) return;
    const r = await pont.retirer(m.id);
    if (r.ok) setListe(r.data);
  };

  /** Le pied d'une carte : état et gestes, selon la connexion. */
  const pied = (cle: string, branche: McpDirect | undefined, connecter: EntreeConnexion | null): ReactNode => {
    if (attente === cle) return <>
      <span role="status" className="text-ui-xs text-texte-secondaire">Autorise dans le navigateur…</span>
      <Bouton taille="mini" onClick={() => void pont?.annuler()}>Annuler</Bouton>
    </>;
    if (!branche) return <Bouton disabled={!pont || !!attente || !connecter} onClick={() => connecter && void autoriser(cle, connecter)}>Connecter</Bouton>;
    const occupe = !!attente;
    if (branche.aReconnecter) return <>
      <Pastille texte="À reconnecter" ton="attente" />
      <span className="flex gap-1">
        <Bouton taille="mini" disabled={occupe} onClick={() => void autoriser(cle, { remplace: branche.id })}>Reconnecter</Bouton>
        <Bouton variant="discret" taille="mini" disabled={occupe} onClick={() => void retirer(branche)}>Retirer…</Bouton>
      </span>
    </>;
    if (branche.connexion === "jeton" && connecter) return <>
      <Pastille texte="Connecté par jeton" ton="neutre" />
      <MenuLignes libelle={`Options de ${branche.nom}`} declencheur={(d) => <BoutonIcone ref={d.ref} {...d.attributs} libelle={`Plus d’options pour ${branche.nom}`} disabled={occupe} variant="discret" onClick={d.basculer} icone={<Icon name="dot-horizontal" size={16} />} />} lignes={[
        { id: "autoriser", titre: "Passer à l’autorisation", icone: "lock-01", onChoisir: () => void autoriser(cle, { remplace: branche.id }) },
        { id: "retirer", titre: "Retirer…", icone: "trash-01", separee: true, onChoisir: () => void retirer(branche) },
      ]} />
    </>;
    return <>
      <Pastille texte={branche.connexion === "jeton" ? "Connecté par jeton" : "Connecté"} ton={branche.connexion === "jeton" ? "neutre" : "ok"} />
      <Bouton variant="discret" taille="mini" disabled={occupe} onClick={() => void retirer(branche)}>Retirer…</Bouton>
    </>;
  };

  /** GitHub passe par Composio : un ancien jeton reste utilisable jusqu'à ce qu'on le retire. */
  const piedComposio = (branche: McpDirect | undefined): ReactNode => {
    if (branche) return <>
      <Pastille texte="Connecté par jeton" ton="neutre" />
      <Bouton variant="discret" taille="mini" disabled={!!attente} onClick={() => void retirer(branche)}>Retirer…</Bouton>
    </>;
    if (!composio.pont) return <span className="text-ui-xs text-texte-tertiaire">Dans l’app de bureau.</span>;
    if (composio.etat?.connecte) return <Pastille texte="Par Composio" ton="ok" />;
    if (composio.etat?.enCours) return <>
      <span role="status" className="text-ui-xs text-texte-secondaire">Autorise dans le navigateur…</span>
      <Bouton taille="mini" onClick={() => void composio.annuler()}>Annuler</Bouton>
    </>;
    return <Bouton disabled={!composio.etat} onClick={() => void composio.connecter()}>Connecter</Bouton>;
  };

  return (
    <section aria-labelledby="titre-apps" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 id="titre-apps" className="m-0 text-ui-s font-semibold text-texte-principal">Apps en direct</h2>
        <p className="m-0 text-ui-xs text-texte-tertiaire">Un serveur MCP branché sans Composio, quand un ou deux outils suffisent. Tu autorises l’accès dans ton navigateur.</p>
      </div>
      <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-3">
        {APPS.map((a) => {
          const branche = liste.find((m) => m.app === a.id);
          if (a.via === "composio") {
            const note = branche ? `${a.description} Passe maintenant par Composio : retire le jeton pour l’utiliser.` : `${a.description} Par Composio : tes agents te donnent un lien à valider la première fois.`;
            return <CarteApp key={a.id} id={a.id} logo={a.id} nom={a.nom} description={note} erreur={branche ? "" : composio.erreur || (composio.etat?.enCours ? "" : composio.etat?.erreur ?? "")} pied={piedComposio(branche)} />;
          }
          return <CarteApp key={a.id} id={a.id} logo={a.id} nom={a.nom} description={a.description} erreur={erreurs[a.id]} pied={pied(a.id, branche, { app: a.id })} />;
        })}
        {persos.map((m) => <CarteApp key={m.id} nom={m.nom} description={new URL(m.url).host} erreur={erreurs[m.id]} pied={pied(m.id, m, null)} />)}
        <button
          type="button"
          disabled={!pont || !!attente}
          onClick={() => setAutre(true)}
          className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-bordure-defaut bg-transparent p-4 text-ui-s text-texte-secondaire transition-colors duration-[120ms] ease-sortie hover:border-bordure-forte hover:text-texte-principal disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="plus-01" size={20} />
          Autre serveur MCP
        </button>
      </div>
      {autre && pont && <AutreServeurMcp onFermer={() => setAutre(false)} onAjoute={(l) => { setListe(l); setAutre(false); }} />}
      {confirmation}
    </section>
  );
}

function CarteApp({ id, logo, nom, description, erreur, pied }: {
  id?: string; logo?: string; nom: string; description: string; erreur?: string; pied: ReactNode;
}) {
  return (
    <div data-app-mcp={id} className="klyra-carte-flottante flex min-h-[132px] flex-col justify-between gap-3 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <Logo nom={nom} logo={logo} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-ui-s font-semibold text-texte-principal">{nom}</span>
          <span className="line-clamp-3 text-ui-xs text-texte-tertiaire">{description}</span>
        </div>
      </div>
      {erreur && <Erreur>{erreur}</Erreur>}
      <div className="flex items-center justify-between gap-2">{pied}</div>
    </div>
  );
}

/**
 * Un serveur MCP saisi à la main : l'autorisation dans le navigateur d'abord.
 * Seulement si le serveur n'a pas d'OAuth, un jeton collé en dernier recours.
 */
function AutreServeurMcp({ onFermer, onAjoute }: { onFermer: () => void; onAjoute: (liste: McpDirect[]) => void }) {
  const pont = getBridge()?.mcp;
  const [nom, setNom] = useState("");
  const [url, setUrl] = useState("");
  const [sansOAuth, setSansOAuth] = useState(false);
  const [jeton, setJeton] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const pret = !!nom.trim() && !!url.trim();

  const fermer = () => {
    if (envoi) void pont?.annuler();
    onFermer();
  };

  const valider = async () => {
    if (!pont || !pret || envoi) return;
    setEnvoi(true);
    setErreur("");
    if (sansOAuth) {
      const r = await pont.ajouter({ app: null, nom, url, jeton });
      setEnvoi(false);
      if (r.ok) onAjoute(r.data);
      else setErreur(r.message);
      return;
    }
    const r = await pont.connecter({ nom, url });
    setEnvoi(false);
    if (!r.ok) setErreur(r.message);
    else if (r.data.statut === "connecte") onAjoute(r.data.liste);
    else if (r.data.statut === "sans-oauth") setSansOAuth(true);
  };

  return (
    <Modale titre="Autre serveur MCP" onFermer={fermer} className="w-[460px]" actions={<>
      <Bouton onClick={fermer}>Annuler</Bouton>
      <BoutonPrincipal disabled={!pret || envoi} onClick={() => void valider()}>{envoi ? (sansOAuth ? "Connexion…" : "Autorise dans le navigateur…") : sansOAuth ? "Ajouter" : "Connecter"}</BoutonPrincipal>
    </>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void valider(); }}>
        <Champ label="Nom">
          <Input data-autofocus size="sm" value={nom} disabled={envoi} onChange={(e) => setNom(e.target.value)} className={CHAMP} />
        </Champ>
        <Champ label="Adresse du serveur" aide="Un serveur MCP distant (HTTP). Ton navigateur s’ouvre pour autoriser l’accès.">
          <Input size="sm" value={url} disabled={envoi} onChange={(e) => { setUrl(e.target.value); setSansOAuth(false); setJeton(""); }} placeholder="https://" spellCheck={false} className={CHAMP} />
        </Champ>
        {sansOAuth && <>
          <p role="note" className="m-0 rounded-md bg-fond-surface-grise px-3 py-2 text-ui-s text-texte-secondaire">
            Ce serveur ne propose pas d’autorisation par le navigateur. S’il demande un jeton, colle celui que son éditeur t’a donné ; sinon, laisse vide.
          </p>
          <Champ label="Jeton (facultatif)" aide="Chiffré sur cet ordinateur.">
            <Input data-autofocus size="sm" type="password" value={jeton} onChange={(e) => setJeton(e.target.value)} autoComplete="off" spellCheck={false} className={cn(CHAMP, "klyra-mono")} />
          </Champ>
        </>}
        {erreur && <Erreur>{erreur}</Erreur>}
        <button type="submit" hidden />
      </form>
    </Modale>
  );
}

/** Le logo officiel de l'app (public/logos : Composio, et simple-icons en CC0 ; ou celui que donne Composio), sinon son initiale. */
function Logo({ nom, logo, src, grand }: { nom: string; logo?: string; src?: string; grand?: boolean }) {
  const image = src ?? (logo ? `/logos/${logo}.svg` : null);
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-md font-semibold text-texte-principal", image ? "border border-bordure-subtile bg-fond-surface" : "bg-fond-surface-grise", grand ? "size-12 text-ui" : "size-9 text-ui-s")}>
      {image ? <Image src={image} alt="" width={grand ? 28 : 20} height={grand ? 28 : 20} /> : nom.charAt(0).toUpperCase()}
    </span>
  );
}
