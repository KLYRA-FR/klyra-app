"use client";

import { useCallback, useEffect, useState } from "react";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { MenuLignes } from "@/components/team/MenuLignes";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP, Champ } from "@/components/ui/Champ";
import { ListeDeroulante } from "@/components/ui/ListeDeroulante";
import { Modale, useConfirmation } from "@/components/ui/Modale";
import { Erreur, Pastille } from "@/components/reglages/ui";
import { getBridge, type McpDirect, type VueCompteComposio, type VueServiceComposio } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { useComposio, type ComposioApiInterface } from "@/lib/composio";
import { compteComposioActif, nomCompteComposio, statutCompteComposio } from "@/lib/composio-vues";
import { ConnexionComposio } from "./ConnexionComposio";

/** Les apps connues, dans l'ordre de la grille ; l'adresse du serveur reste côté Electron. */
const APPS: { id: string; nom: string; description: string }[] = [
  { id: "github", nom: "GitHub", description: "Dépôts, issues et pull requests." },
  { id: "linear", nom: "Linear", description: "Tickets, projets et cycles." },
  { id: "supabase", nom: "Supabase", description: "Bases, tables et fonctions." },
  { id: "neon", nom: "Neon", description: "Bases Postgres et leurs branches." },
  { id: "stripe", nom: "Stripe", description: "Paiements, clients et abonnements." },
];

/** La Marketplace : Composio d'abord (une connexion, des centaines d'apps), puis les MCP directs. */
export function MarketplaceScreen() {
  return (
    <div className="h-full overflow-y-auto">
      <div className="@container mx-auto flex w-full max-w-[960px] flex-col gap-8 px-5 pt-5 pb-8">
        <header className="flex flex-col gap-1.5">
          <h1 className="m-0 text-h3 leading-[1] tracking-[-0.04em] text-texte-principal">
            <span className="font-semibold">Marketplace</span>
          </h1>
          <p className="m-0 text-ui-s text-texte-secondaire">Les apps que tes agents peuvent utiliser.</p>
        </header>
        <CarteComposio />
        <AppsDirectes />
      </div>
    </div>
  );
}

/* ─── Composio ─────────────────────────────────────────────── */

function CarteComposio() {
  const api = useComposio();
  return <ContenuComposio key={api.scope} api={api} />;
}

function ContenuComposio({ api }: { api: ComposioApiInterface }) {
  const { etat, erreur, chargement, action, message, faire } = api;
  const occupe = !!action || chargement;
  const connecte = !!etat?.configure && !etat.erreur;
  const [demander, confirmation] = useConfirmation();
  const [cle, setCle] = useState(false);
  const [ajout, setAjout] = useState(false);

  const importer = async () => {
    if (await faire("importer", (p, c) => p.importer(c), "Composio est connecté. Tu peux supprimer le fichier de la clé.")) setCle(false);
  };
  const remplacer = async () => {
    if (!(await demander({ titre: "Remplacer la clé Composio ?", texte: "Avec la clé d’un autre projet, les apps connectées jusqu’ici ne seront plus accessibles. Les comptes de tes agents sont remis à zéro.", confirmer: "Choisir le fichier…" }))) return;
    await importer();
  };
  const deconnecter = async () => {
    if (!(await demander({ titre: "Se déconnecter de Composio ?", texte: "Tes agents n’auront plus accès aux apps Composio sur cet ordinateur. Les comptes restent chez Composio.", confirmer: "Se déconnecter" }))) return;
    await faire("retirer", (p, c) => p.retirer(c), "Composio est déconnecté de cet ordinateur.");
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
    <section aria-labelledby="titre-composio" className="klyra-carte-flottante flex flex-col gap-5 rounded-xl p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 flex-1 basis-72 items-start gap-4">
          <Logo nom="Composio" grand />
          <div className="flex min-w-0 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="titre-composio" className="m-0 text-ui font-semibold text-texte-principal">Composio</h2>
              <span className="rounded-pill bg-fond-teinte-bleue px-2 py-0.5 text-ui-2xs font-medium text-texte-accent">Recommandé</span>
              {titreEtat}
            </div>
            <p className="m-0 text-ui-s text-texte-secondaire">Gmail, Slack, Notion, Google Agenda et des centaines d’autres apps, en une seule connexion.</p>
          </div>
        </div>
        {!api.bureau ? <span className="text-ui-xs text-texte-tertiaire">Dans l’app de bureau.</span> : connecte ? (
          <div className="flex items-center gap-2">
            <Bouton disabled={occupe || !peutAjouter} onClick={() => setAjout(true)} iconeGauche={<Icon name="plus-01" size={16} />}>Ajouter une app</Bouton>
            <MenuLignes libelle="Options de Composio" declencheur={(d) => <BoutonIcone ref={d.ref} {...d.attributs} libelle="Plus d’options pour Composio" disabled={occupe} variant="discret" onClick={d.basculer} icone={<Icon name="dot-horizontal" size={16} />} />} lignes={[
              { id: "console", titre: "Ouvrir la console Composio", icone: "link-external", onChoisir: () => void api.console() },
              { id: "actualiser", titre: "Actualiser", icone: "refresh-01", onChoisir: () => void api.actualiser() },
              { id: "remplacer", titre: "Remplacer la clé…", icone: "lock-01", onChoisir: () => void remplacer() },
              { id: "deconnecter", titre: "Se déconnecter…", icone: "trash-01", separee: true, onChoisir: () => void deconnecter() },
            ]} />
          </div>
        ) : etat?.configure ? (
          <Bouton disabled={occupe} onClick={() => void api.actualiser()} iconeGauche={<Icon name="refresh-01" size={16} />}>{chargement ? "Actualisation…" : "Réessayer"}</Bouton>
        ) : (
          <BoutonPrincipal disabled={occupe || !etat} onClick={() => setCle(true)}>Se connecter à Composio</BoutonPrincipal>
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
      {message && <p role="status" className="m-0 text-ui-xs text-texte-secondaire">{message}</p>}

      {cle && etat && (
        <Modale titre="Se connecter à Composio" onFermer={() => setCle(false)} className="w-[460px]" actions={<>
          <Bouton onClick={() => setCle(false)}>Annuler</Bouton>
          <BoutonPrincipal data-autofocus disabled={occupe || !etat.coffreDisponible} onClick={() => void importer()}>{action === "importer" ? "Vérification…" : "Importer la clé…"}</BoutonPrincipal>
        </>}>
          <div className="flex flex-col gap-3">
            <p className="m-0">Crée une clé de projet dans la console Composio, enregistre-la dans un fichier, puis importe-le. La clé reste chiffrée sur cet ordinateur.</p>
            <Bouton variant="discret" className="self-start" onClick={() => void api.console()} iconeDroite={<Icon name="link-external" size={16} />}>Ouvrir la console Composio</Bouton>
            {!etat.coffreDisponible && <Erreur>Cet ordinateur n’a pas de coffre sécurisé : la clé ne peut pas être gardée.</Erreur>}
            {api.echec?.nom === "importer" && <Erreur>{api.echec.texte}</Erreur>}
          </div>
        </Modale>
      )}
      {ajout && etat && <ConnexionComposio api={api} onFermer={() => setAjout(false)} onTermine={(service, compte) => {
        setAjout(false);
        // Première connexion de cette app : tes agents l'utilisent tout de suite.
        if (!etat.selections[service.slug]) void choisir(service.slug, compte);
      }} />}
      {confirmation}
    </section>
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
    <div className="flex flex-wrap items-center gap-3 py-3">
      <Logo nom={service.nom} />
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
  const [liens, setLiens] = useState<Record<string, { jeton: string }>>({});
  const relire = useCallback(async () => {
    if (!pont) return;
    const [l, a] = await Promise.all([pont.lister(), pont.apps()]);
    if (l.ok) setListe(l.data);
    if (a.ok) setLiens(a.data);
  }, [pont]);
  useEffect(() => {
    const debut = window.setTimeout(() => void relire(), 0);
    return () => window.clearTimeout(debut);
  }, [relire]);
  return { pont, liste, setListe, liens };
}

function AppsDirectes() {
  const { pont, liste, setListe, liens } = useMcpDirects();
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [demander, confirmation] = useConfirmation();
  const persos = liste.filter((m) => !m.app);

  const retirer = async (m: McpDirect) => {
    if (!pont || !(await demander({ titre: `Retirer ${m.nom} ?`, texte: "Tes agents n’y auront plus accès. Le jeton est effacé de cet ordinateur.", confirmer: "Retirer" }))) return;
    const r = await pont.retirer(m.id);
    if (r.ok) setListe(r.data);
  };

  return (
    <section aria-labelledby="titre-apps" className="flex flex-col gap-3">
      <div className="flex flex-col gap-0.5 px-1">
        <h2 id="titre-apps" className="m-0 text-ui-s font-semibold text-texte-principal">Apps en direct</h2>
        <p className="m-0 text-ui-xs text-texte-tertiaire">Un serveur MCP branché sans Composio, quand un ou deux outils suffisent.</p>
      </div>
      <div className="grid gap-3 @md:grid-cols-2 @3xl:grid-cols-3">
        {APPS.map((a) => {
          const branche = liste.find((m) => m.app === a.id);
          return <CarteApp key={a.id} nom={a.nom} description={a.description} branche={branche} bureau={!!pont} onConnecter={() => setOuvert(a.id)} onRetirer={() => branche && void retirer(branche)} />;
        })}
        {persos.map((m) => <CarteApp key={m.id} nom={m.nom} description={new URL(m.url).host} branche={m} bureau={!!pont} onConnecter={() => {}} onRetirer={() => void retirer(m)} />)}
        <button
          type="button"
          disabled={!pont}
          onClick={() => setOuvert("perso")}
          className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-bordure-defaut bg-transparent p-4 text-ui-s text-texte-secondaire transition-colors duration-[120ms] ease-sortie hover:border-bordure-forte hover:text-texte-principal disabled:cursor-not-allowed disabled:opacity-60"
        >
          <Icon name="plus-01" size={20} />
          Autre serveur MCP
        </button>
      </div>
      {ouvert && pont && <ConnexionMcp app={APPS.find((a) => a.id === ouvert) ?? null} lienJeton={liens[ouvert]?.jeton} onFermer={() => setOuvert(null)} onAjoute={(l) => { setListe(l); setOuvert(null); }} />}
      {confirmation}
    </section>
  );
}

function CarteApp({ nom, description, branche, bureau, onConnecter, onRetirer }: {
  nom: string; description: string; branche?: McpDirect; bureau: boolean; onConnecter: () => void; onRetirer: () => void;
}) {
  return (
    <div className="klyra-carte-flottante flex min-h-[132px] flex-col justify-between gap-3 rounded-lg p-4">
      <div className="flex items-start gap-3">
        <Logo nom={nom} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="truncate text-ui-s font-semibold text-texte-principal">{nom}</span>
          <span className="line-clamp-2 text-ui-xs text-texte-tertiaire">{description}</span>
        </div>
      </div>
      <div className="flex items-center justify-between gap-2">
        {branche ? <>
          <Pastille texte="Connecté" ton="ok" />
          <Bouton variant="discret" taille="mini" onClick={onRetirer}>Retirer…</Bouton>
        </> : <Bouton disabled={!bureau} onClick={onConnecter}>Connecter</Bouton>}
      </div>
    </div>
  );
}

function ConnexionMcp({ app, lienJeton, onFermer, onAjoute }: {
  app: { id: string; nom: string } | null; lienJeton?: string; onFermer: () => void; onAjoute: (liste: McpDirect[]) => void;
}) {
  const pont = getBridge()?.mcp;
  const [nom, setNom] = useState("");
  const [url, setUrl] = useState("");
  const [jeton, setJeton] = useState("");
  const [erreur, setErreur] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const pret = app ? !!jeton.trim() : !!nom.trim() && !!url.trim();

  const valider = async () => {
    if (!pont || !pret) return;
    setEnvoi(true);
    setErreur("");
    const r = await pont.ajouter(app ? { app: app.id, jeton } : { app: null, nom, url, jeton });
    setEnvoi(false);
    if (r.ok) onAjoute(r.data);
    else setErreur(r.message);
  };

  return (
    <Modale titre={app ? `Connecter ${app.nom}` : "Autre serveur MCP"} onFermer={onFermer} className="w-[460px]" actions={<>
      <Bouton onClick={onFermer}>Annuler</Bouton>
      <BoutonPrincipal disabled={!pret || envoi} onClick={() => void valider()}>{envoi ? "Connexion…" : "Connecter"}</BoutonPrincipal>
    </>}>
      <form className="flex flex-col gap-4" onSubmit={(e) => { e.preventDefault(); void valider(); }}>
        {!app && <>
          <Champ label="Nom">
            <Input data-autofocus size="sm" value={nom} onChange={(e) => setNom(e.target.value)} className={CHAMP} />
          </Champ>
          <Champ label="Adresse du serveur" aide="Un serveur MCP distant (HTTP).">
            <Input size="sm" value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://" spellCheck={false} className={CHAMP} />
          </Champ>
        </>}
        <Champ
          label={app ? `Jeton ${app.nom}` : "Jeton (facultatif)"}
          aide={<>Chiffré sur cet ordinateur.{lienJeton && <> <a href={lienJeton} target="_blank" rel="noreferrer" className="text-texte-accent">Créer un jeton</a></>}</>}
        >
          <Input data-autofocus={app ? true : undefined} size="sm" type="password" value={jeton} onChange={(e) => setJeton(e.target.value)} autoComplete="off" spellCheck={false} className={cn(CHAMP, "klyra-mono")} />
        </Champ>
        {erreur && <Erreur>{erreur}</Erreur>}
        <button type="submit" hidden />
      </form>
    </Modale>
  );
}

/** L'initiale de l'app, dans un carré gris (pas de logos de marque dans l'app). */
function Logo({ nom, grand }: { nom: string; grand?: boolean }) {
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center justify-center rounded-md bg-fond-surface-grise font-semibold text-texte-principal", grand ? "size-12 text-ui" : "size-9 text-ui-s")}>
      {nom.charAt(0).toUpperCase()}
    </span>
  );
}
