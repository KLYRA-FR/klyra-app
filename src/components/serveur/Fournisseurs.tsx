"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Claude } from "@/components/reglages/sections/Claude";
import { ancreReglage, Erreur, Groupe, Ligne, Pastille, Valeur } from "@/components/reglages/ui";
import { Bouton, BoutonIcone } from "@/components/ui/Bouton";
import { CHAMP } from "@/components/ui/Champ";
import { LogoFournisseur } from "@/components/ui/LogoFournisseur";
import { useAgents } from "@/lib/agents";
import { getBridge, type AutreIa, type ProgressionMoteur } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { nomAbonnement } from "@/lib/compte-claude";
import { fournisseur, FOURNISSEURS, PAR_DEFAUT } from "@/lib/fournisseurs";
import { actualiserMoteurs, pret, useMoteurs, type EtatMoteur } from "@/lib/moteurs";
import { FormulaireIa, useAutresIa, type TestIa } from "./AutresIa";
import { cheminServeur } from "./catalogue";

/* ─── Versions publiées ────────────────────────────────────────── */

/** Les dernières versions publiées, lues une fois par lancement de l'app (npm). */
let versions: Record<string, string | null> = {};

function useVersionsDisponibles(ids: string[]): Record<string, string | null> {
  const [lues, setLues] = useState(versions);
  const cle = ids.join(",");
  useEffect(() => {
    const bridge = getBridge()?.moteurs;
    const manquent = cle.split(",").filter((id) => id && !(id in versions));
    if (!bridge || !manquent.length) return;
    void Promise.all(
      manquent.map(async (id) => {
        const r = await bridge.versionDisponible(id);
        versions = { ...versions, [id]: r.ok ? r.data : null };
      }),
    ).then(() => setLues(versions));
  }, [cle]);
  return lues;
}

/** Une version plus récente que celle installée est publiée. */
function aJour(installee: string | null | undefined, publiee: string | null | undefined): boolean {
  if (!installee || !publiee) return true;
  const a = installee.split(".").map(Number);
  const b = publiee.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  return true;
}

/* ─── Petits morceaux ──────────────────────────────────────────── */

/** Le logo du fournisseur (même que dans le choix rapide de la conversation). `initiale` : une IA sans logo. */
export function Marque({ id, taille = 32, initiale }: { id: string; taille?: number; initiale?: string }) {
  return <LogoFournisseur id={id} initiale={initiale ?? fournisseur(id).initiale} taille={taille} />;
}

/** Ce que dit la ligne d'un fournisseur sous son nom. */
function sousTitre(m: EtatMoteur | undefined): string {
  if (!m?.moteur.chemin) return "Non installé";
  const compte = m.compte;
  if (!compte?.connecte) return "Non connecté";
  if (compte.email) return compte.email;
  if (compte.methode === "cle-api") return "Clé API";
  if (compte.methode === "config") return "Réglé dans la configuration de Codex";
  if (compte.methode === "jeton") return "Jeton longue durée";
  return "Connecté";
}

function etatDe(m: EtatMoteur | undefined): { texte: string; ton: "ok" | "attente" | "neutre" } {
  if (!m?.moteur.chemin) return { texte: "Non installé", ton: "neutre" };
  return m.compte?.connecte ? { texte: "Connecté", ton: "ok" } : { texte: "Non connecté", ton: "attente" };
}

/** Les agents qui travaillent par défaut avec ce fournisseur. */
function useAgentsDe(id: string): string[] {
  const { roles } = useAgents();
  return roles.filter((r) => (r.fournisseur || PAR_DEFAUT) === id).map((r) => r.name);
}

const listeNoms = (noms: string[]) => (noms.length <= 1 ? (noms[0] ?? "") : `${noms.slice(0, -1).join(", ")} et ${noms.at(-1)}`);

/* ─── La liste ─────────────────────────────────────────────────── */

function Ligne1({ m, id, publiee, onClick }: { m: EtatMoteur | undefined; id: string; publiee: string | null | undefined; onClick: () => void }) {
  const majDispo = !!m?.moteur.chemin && !aJour(m.compte?.version, publiee);
  return (
    <button type="button" onClick={onClick} className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent py-3 text-left hover:opacity-90">
      <Marque id={id} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-ui-s font-medium text-texte-principal">{fournisseur(id).nom}</span>
        <span className="truncate text-ui-xs text-texte-tertiaire">{sousTitre(m)}</span>
      </span>
      {majDispo && <Pastille texte="Mise à jour disponible" ton="attente" />}
      <Icon name="chevron-right" size={16} className="shrink-0 text-icone-secondaire" />
    </button>
  );
}

/** Une IA à consulter, ajoutée avec sa clé : la tester ou la retirer. */
function LigneIa({ ia, test, tester, retirer }: { ia: AutreIa; test: TestIa | undefined; tester: () => void; retirer: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-3 py-3">
      <Marque id={ia.fournisseur} initiale={ia.nom.charAt(0).toUpperCase()} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-ui-s font-medium text-texte-principal">{ia.nom}</span>
        <span className="klyra-mono truncate text-ui-xs text-texte-tertiaire">{ia.modele}</span>
      </span>
      {test?.etat === "ok" && <span className="text-ui-xs text-texte-secondaire">Répond bien</span>}
      {test?.etat === "erreur" && (
        <span role="alert" title={test.message} className="max-w-[240px] truncate text-ui-xs text-texte-erreur">
          {test.message}
        </span>
      )}
      <Pastille texte="À consulter" ton="neutre" />
      <Bouton variant="blanc" taille="compact" disabled={test?.etat === "en-cours"} onClick={tester}>
        {test?.etat === "en-cours" ? "Test…" : "Tester"}
      </Bouton>
      <BoutonIcone taille="compact" icone={<Icon name="trash-01" size={16} />} libelle={`Retirer ${ia.nom}`} onClick={retirer} />
    </div>
  );
}

/** Une IA qu'on peut ajouter avec sa clé API (Gemini, DeepSeek, Grok…). */
function LigneIaProposee({ id, nom, ouverte, onClick }: { id: string; nom: string; ouverte: boolean; onClick: () => void }) {
  const autre = id === "autre";
  return (
    <button type="button" aria-expanded={ouverte} onClick={onClick} className="flex w-full cursor-pointer items-center gap-3 border-0 bg-transparent py-3 text-left hover:opacity-90">
      {autre ? (
        <span aria-hidden="true" className="flex size-8 shrink-0 items-center justify-center rounded-sm bg-fond-surface-grise text-icone-secondaire">
          <Icon name="plus-01" size={16} />
        </span>
      ) : (
        <Marque id={id} initiale={nom.charAt(0).toUpperCase()} />
      )}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-ui-s font-medium text-texte-principal">{autre ? "Autre IA" : nom}</span>
        <span className="truncate text-ui-xs text-texte-tertiaire">{autre ? "Toute API compatible OpenAI, avec sa clé" : "Avec sa clé API"}</span>
      </span>
      <Pastille texte="À consulter" ton="neutre" />
      <Icon name={ouverte ? "chevron-down" : "chevron-right"} size={16} className="shrink-0 text-icone-secondaire" />
    </button>
  );
}

const correspond = (requete: string, ...textes: string[]) => {
  const r = requete.trim().toLowerCase();
  return !r || textes.some((t) => t.toLowerCase().includes(r));
};

/**
 * Tous les fournisseurs du serveur en une liste : ceux qui font travailler les agents (Claude, ChatGPT
 * par Codex) et ceux qu'ils peuvent consulter avec une clé API (Gemini, DeepSeek, Grok…, cf. electron/ia.ts).
 */
function Liste({ ouvrir, lieu }: { ouvrir: (id: string) => void; lieu: string | null }) {
  const { moteurs, erreur } = useMoteurs(lieu);
  const ias = useAutresIa(lieu);
  const [recherche, setRecherche] = useState("");
  const [ajout, setAjout] = useState<string | null>(null);
  const publiees = useVersionsDisponibles((moteurs ?? []).filter((m) => m.moteur.chemin).map((m) => m.moteur.id));
  const etat = (id: string) => moteurs?.find((m) => m.moteur.id === id);
  const visibles = FOURNISSEURS.filter((f) => correspond(recherche, f.nom, f.moteur));
  const connectes = visibles.filter((f) => { const m = etat(f.id); return m && pret(m); });
  const autres = visibles.filter((f) => !connectes.includes(f));
  const iasAjoutees = ias.liste.filter((ia) => correspond(recherche, ia.nom, ia.modele, ias.catalogue?.[ia.fournisseur]?.nom ?? ""));
  /* Celles du catalogue pas encore ajoutées ; « Autre » reste toujours proposée, en dernier. */
  const iasProposees = Object.entries(ias.catalogue ?? {})
    .filter(([id, f]) => (id === "autre" || !ias.liste.some((ia) => ia.fournisseur === id)) && correspond(recherche, f.nom, id === "autre" ? "autre compatible openai" : ""))
    .sort(([a], [b]) => Number(a === "autre") - Number(b === "autre"));

  if (erreur) return <Erreur>{erreur}</Erreur>;
  if (!moteurs) return <p className="m-0 text-ui-s text-texte-tertiaire">Lecture des fournisseurs…</p>;
  return (
    <div id="reglage-fournisseurs-liste" className="klyra-reglage flex scroll-mt-6 flex-col gap-6 rounded-lg">
      <label className="relative flex max-w-[280px] items-center self-end">
        <Icon name="search-01" size={16} className="pointer-events-none absolute left-2.5 text-icone-secondaire" />
        <span className="sr-only">Rechercher un fournisseur</span>
        <input
          type="search"
          value={recherche}
          placeholder="Rechercher un fournisseur"
          onChange={(e) => setRecherche(e.target.value)}
          className="h-9 w-full rounded-md border border-bordure-champ bg-fond-surface pr-2.5 pl-8 text-ui-s text-texte-principal outline-none placeholder:text-texte-placeholder focus:border-focus"
        />
      </label>
      {(connectes.length > 0 || iasAjoutees.length > 0) && (
        <Groupe titre="Connectés" description={iasAjoutees.length ? "« À consulter » : tes agents leur demandent un deuxième avis ; elles répondent en texte et ne touchent à aucun fichier." : undefined}>
          {connectes.map((f) => (
            <Ligne1 key={f.id} id={f.id} m={etat(f.id)} publiee={publiees[f.id]} onClick={() => ouvrir(f.id)} />
          ))}
          {iasAjoutees.map((ia) => (
            <LigneIa key={ia.id} ia={ia} test={ias.tests[ia.id]} tester={() => void ias.tester(ia.id)} retirer={() => void ias.retirer(ia.id)} />
          ))}
        </Groupe>
      )}
      {(autres.length > 0 || iasProposees.length > 0) && (
        <Groupe
          titre="Autres fournisseurs"
          description={`Claude et ChatGPT font travailler les agents : ils s’installent et se connectent depuis leur page. Les IA « À consulter » s’ajoutent avec leur clé API, ${lieu ? "gardée sur ce serveur" : "chiffrée dans le trousseau de ce poste"}.`}
        >
          {autres.map((f) => (
            <Ligne1 key={f.id} id={f.id} m={etat(f.id)} publiee={publiees[f.id]} onClick={() => ouvrir(f.id)} />
          ))}
          {ias.catalogue &&
            iasProposees.map(([id, f]) => (
              <div key={id} id={id === "autre" ? ancreReglage("autres-ia") : undefined} className="klyra-reglage flex scroll-mt-6 flex-col">
                <LigneIaProposee id={id} nom={f.nom} ouverte={ajout === id} onClick={() => setAjout((a) => (a === id ? null : id))} />
                {ajout === id && (
                  <div className="pb-4">
                    <FormulaireIa
                      key={id}
                      fournisseurs={ias.catalogue!}
                      initial={id}
                      lieu={lieu}
                      onAjoutee={(l) => {
                        ias.setListe(l);
                        setAjout(null);
                      }}
                      onAnnuler={() => setAjout(null)}
                    />
                  </div>
                )}
              </div>
            ))}
        </Groupe>
      )}
      {!visibles.length && !iasAjoutees.length && !iasProposees.length && <p className="m-0 text-ui-s text-texte-tertiaire">Aucun fournisseur ne correspond à « {recherche} ».</p>}
    </div>
  );
}

/* ─── Une action longue (connexion, installation) ──────────────── */

/** `code` : sur un VPS, le code à saisir sur la page d'OpenAI pendant la connexion. */
type Action = { nom: string; progression: ProgressionMoteur | null; code?: { url: string; code: string } } | null;

function texteProgression(p: ProgressionMoteur | null): string {
  if (!p) return "En cours…";
  if (p.etape === "telechargement") return `Téléchargement ${Math.round(p.recu / 1e6)}${p.total ? ` / ${Math.round(p.total / 1e6)}` : ""} Mo…`;
  if (p.etape === "verification") return "Vérification de l’empreinte…";
  if (p.etape === "installation") return "Installation…";
  return "Mise à jour…";
}

function useAction(id: string, lieu: string | null) {
  const [action, setAction] = useState<Action>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const enCours = !!action;
  useEffect(() => {
    const bridge = getBridge()?.moteurs;
    if (!enCours || !bridge) return;
    const sansProgression = bridge.onProgression((qui, p, ou) => qui === id && (ou ?? null) === lieu && setAction((a) => (a ? { ...a, progression: p } : a)));
    const sansCode = bridge.onCode?.((qui, ou, code) => qui === id && ou === lieu && setAction((a) => (a ? { ...a, code } : a)));
    return () => {
      sansProgression();
      sansCode?.();
    };
  }, [enCours, id, lieu]);
  const lancer = useCallback(
    async (nom: string, faire: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
      setErreur(null);
      setAction({ nom, progression: null });
      const r = await faire();
      await actualiserMoteurs(lieu);
      setAction(null);
      if (!r.ok) setErreur(r.message);
    },
    [lieu],
  );
  return { action, erreur, lancer };
}

/* ─── La page d'un fournisseur ─────────────────────────────────── */

function Moteur({ id, m, lieu }: { id: string; m: EtatMoteur | undefined; lieu: string | null }) {
  const bridge = getBridge()?.moteurs;
  const publiees = useVersionsDisponibles(m?.moteur.chemin || m?.moteur.installable ? [id] : []);
  const publiee = publiees[id];
  const { action, erreur, lancer } = useAction(id, lieu);
  const installe = !!m?.moteur.chemin;
  const version = m?.compte?.version;
  const nom = m?.moteur.nom ?? fournisseur(id).moteur;
  const ici = lieu ? "ce serveur" : "ce poste";
  const description = !installe
    ? m?.moteur.installable
      ? `${fournisseur(id).nom} passe par ${nom}. ${lieu ? "Le serveur le télécharge" : "L’app le télécharge"} depuis sa source officielle (npm), vérifie son empreinte et le range dans ~/.klyra/moteurs.`
      : `${nom} s’installe sur ${ici} avec la commande d’installation de KLYRA.`
    : m?.moteur.gere
      ? `Installé par KLYRA dans ~/.klyra/moteurs de ${ici} : c’est KLYRA qui le met à jour.`
      : `Installé sur ${ici} : la mise à jour passe par sa propre commande.`;

  return (
    <Groupe titre="Moteur">
      <Ligne id="moteur-version" libelle={installe ? `${nom}${version ? ` ${version}` : ""}` : `${nom} n’est pas installé`} description={description}>
        {installe && publiee && !aJour(version, publiee) && <Pastille texte={`${publiee} disponible`} ton="attente" />}
        {installe && publiee && aJour(version, publiee) && <Valeur>À jour</Valeur>}
        {bridge && !installe && m?.moteur.installable && (
          <Bouton variant="sombre" taille="compact" disabled={!!action} onClick={() => void lancer("installer", () => bridge.installer(id, lieu))}>
            {action ? texteProgression(action.progression) : "Installer"}
          </Bouton>
        )}
        {bridge && installe && publiee && !aJour(version, publiee) && (
          <Bouton variant="blanc" taille="compact" disabled={!!action} onClick={() => void lancer("mettre-a-jour", () => bridge.mettreAJour(id, lieu))}>
            {action ? texteProgression(action.progression) : "Mettre à jour"}
          </Bouton>
        )}
      </Ligne>
      {installe && m?.moteur.chemin && (
        <Ligne libelle="Emplacement">
          <span className="klyra-mono max-w-[340px] truncate text-ui-xs text-texte-secondaire" title={m.moteur.chemin}>
            {m.moteur.chemin}
          </span>
        </Ligne>
      )}
      {erreur && (
        <div className="py-2">
          <Erreur>{erreur}</Erreur>
        </div>
      )}
    </Groupe>
  );
}

function CompteChatGpt({ m, lieu }: { m: EtatMoteur | undefined; lieu: string | null }) {
  const bridge = getBridge()?.moteurs;
  const { action, erreur, lancer } = useAction("codex", lieu);
  const [cle, setCle] = useState("");
  const compte = m?.compte;
  const installe = !!m?.moteur.chemin;
  if (!installe) return null;

  return (
    <>
      <Groupe titre="Compte" description="Ton abonnement ChatGPT : Codex s’y connecte, comme dans son application.">
        <Ligne
          id="compte-chatgpt"
          libelle={compte?.email ?? (compte?.methode === "config" ? "Réglé dans la configuration de Codex" : compte?.methode === "cle-api" ? "Connecté par clé API" : "Aucun compte connecté")}
          description={
            compte?.connecte
              ? [compte.abonnement && `Abonnement ${nomAbonnement(compte.abonnement)}`, "Les agents réglés sur ChatGPT travaillent avec ce compte."].filter(Boolean).join(" · ")
              : lieu
                ? "La page d’OpenAI s’ouvre dans ton navigateur ; reviens ici une fois connecté. Le compte est relié à ce serveur."
                : "La page d’OpenAI s’ouvre dans ton navigateur ; reviens ici une fois connecté."
          }
        >
          {bridge && !compte?.connecte && (
            <Bouton variant="sombre" taille="compact" disabled={!!action} onClick={() => void lancer("connecter", () => bridge.connecter("codex", lieu))}>
              {action?.nom === "connecter" ? "Connexion dans le navigateur…" : "Se connecter"}
            </Bouton>
          )}
          {bridge && compte?.connecte && compte.methode !== "config" && (
            <Bouton variant="blanc" taille="compact" disabled={!!action} onClick={() => void lancer("deconnecter", () => bridge.deconnecter("codex", lieu))}>
              Se déconnecter
            </Bouton>
          )}
        </Ligne>
        {action?.code && (
          <Ligne id="code-chatgpt" libelle="Code à saisir sur la page d’OpenAI" description={<>L’adresse de retour est déjà prise sur ce poste : la connexion passe par ce code. La page ne s’est pas ouverte ? Va sur {action.code.url}.</>}>
            <span className="klyra-mono rounded-sm bg-fond-surface-grise px-3 py-1.5 text-ui font-semibold tracking-[0.08em] text-texte-principal select-all">{action.code.code}</span>
          </Ligne>
        )}
      </Groupe>

      {!compte?.connecte && (
        <Groupe titre="Clé API" description={`Plutôt qu’un abonnement : une clé de platform.openai.com/api-keys. Codex la garde sur ${lieu ? "ce serveur" : "ce poste"} ; elle ne revient jamais à l’interface.`}>
          <Ligne id="cle-api-chatgpt" libelle="Clé API d’OpenAI" pile>
            <form
              className="flex w-full items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!bridge || !cle.trim()) return;
                void lancer("cle", () => bridge.connecterAvecCle("codex", cle.trim(), lieu)).then(() => setCle(""));
              }}
            >
              <Input size="sm" type="password" value={cle} onChange={(e) => setCle(e.target.value)} autoComplete="off" spellCheck={false} placeholder="sk-…" className={cn(CHAMP, "klyra-mono flex-1")} />
              <Bouton type="submit" variant="blanc" taille="compact" disabled={!!action || !cle.trim()}>
                {action?.nom === "cle" ? "Vérification…" : "Ajouter"}
              </Bouton>
            </form>
          </Ligne>
        </Groupe>
      )}
      {erreur && <Erreur>{erreur}</Erreur>}
    </>
  );
}

/** Claude Code sur un VPS : posé et connecté par la commande d'installation de KLYRA, lancée sur le VPS. */
function CompteClaudeVps({ m }: { m: EtatMoteur | undefined }) {
  const compte = m?.compte;
  if (!m?.moteur.chemin) return null;
  return (
    <Groupe titre="Compte" description="Ton abonnement Claude : les agents de ce serveur travaillent avec lui.">
      <Ligne
        id="compte-claude-vps"
        libelle={compte?.connecte ? (compte.methode === "jeton" ? "Connecté par un jeton longue durée" : "Connecté") : "Claude Code n’est pas connecté sur ce serveur"}
        description={
          compte?.connecte ? (
            "Pour changer de compte, relance « connecter-claude » sur le VPS."
          ) : (
            <>
              Sur le VPS, lance : <span className="klyra-mono select-all">curl -fsSL https://raw.githubusercontent.com/KLYRA-FR/klyra-app/main/serveur/lancer.sh | sudo sh -s -- connecter-claude</span>
            </>
          )
        }
      />
    </Groupe>
  );
}

function Detail({ id, retour, lieu }: { id: string; retour: () => void; lieu: string | null }) {
  const { moteurs } = useMoteurs(lieu);
  const m = moteurs?.find((x) => x.moteur.id === id);
  const agents = useAgentsDe(id);
  const etat = etatDe(m);
  return (
    <div className="flex flex-col gap-6">
      <nav aria-label="Fil d’Ariane" className="flex items-center gap-1.5 text-ui-s">
        <button type="button" onClick={retour} className="cursor-pointer border-0 bg-transparent p-0 text-texte-tertiaire hover:text-texte-principal">
          Fournisseurs
        </button>
        <Icon name="chevron-right" size={14} className="text-icone-secondaire" />
        <span className="font-medium text-texte-principal">{fournisseur(id).nom}</span>
      </nav>
      <div className="flex items-center gap-3">
        <Marque id={id} taille={44} />
        <div className="flex min-w-0 flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-ui font-semibold text-texte-principal">{fournisseur(id).nom}</span>
            <Pastille texte={etat.texte} ton={etat.ton} />
          </div>
          <span className="text-ui-xs text-texte-tertiaire">
            {agents.length ? `${agents.length === 1 ? "1 agent l’utilise" : `${agents.length} agents l’utilisent`} : ${listeNoms(agents)}` : "Aucun agent ne l’utilise par défaut. Choisis-le dans une conversation, ou pour un agent dans Réglages › Agents."}
          </span>
        </div>
      </div>
      {id === PAR_DEFAUT ? lieu ? <CompteClaudeVps m={m} /> : <Claude /> : <CompteChatGpt m={m} lieu={lieu} />}
      <Moteur id={id} m={m} lieu={lieu} />
    </div>
  );
}

/* ─── La section ───────────────────────────────────────────────── */

export function Fournisseurs({ lieu }: { lieu: string | null }): ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const detail = params.get("fournisseur");
  const serveur = params.get("serveur");
  const connu = useMemo(() => FOURNISSEURS.some((f) => f.id === detail), [detail]);
  const aller = (fournisseurId: string | null) => router.replace(cheminServeur("fournisseurs", { fournisseur: fournisseurId, serveur }), { scroll: false });
  return detail && connu ? <Detail id={detail} retour={() => aller(null)} lieu={lieu} /> : <Liste ouvrir={(id) => aller(id)} lieu={lieu} />;
}
