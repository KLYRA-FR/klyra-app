"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Input } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Claude } from "@/components/reglages/sections/Claude";
import { Erreur, Groupe, Ligne, Pastille, Valeur } from "@/components/reglages/ui";
import { Bouton } from "@/components/ui/Bouton";
import { CHAMP } from "@/components/ui/Champ";
import { useAgents } from "@/lib/agents";
import { getBridge, type ProgressionMoteur } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { nomAbonnement } from "@/lib/compte-claude";
import { fournisseur, FOURNISSEURS, PAR_DEFAUT } from "@/lib/fournisseurs";
import { actualiserMoteurs, pret, useMoteurs, type EtatMoteur } from "@/lib/moteurs";
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

/** Le carré du fournisseur (même que dans le choix rapide de la conversation). */
export function Marque({ id, taille = 32 }: { id: string; taille?: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ width: taille, height: taille }}
      className={cn(
        "flex shrink-0 items-center justify-center rounded-sm text-ui-s font-semibold text-texte-inverse",
        id === PAR_DEFAUT ? "bg-bleu-k1-500" : "bg-fond-inverse-fort",
      )}
    >
      {fournisseur(id).initiale}
    </span>
  );
}

/** Ce que dit la ligne d'un fournisseur sous son nom. */
function sousTitre(m: EtatMoteur | undefined): string {
  if (!m?.moteur.chemin) return "Non installé";
  const compte = m.compte;
  if (!compte?.connecte) return "Non connecté";
  if (compte.email) return compte.email;
  if (compte.methode === "cle-api") return "Clé API";
  if (compte.methode === "config") return "Réglé dans la configuration de Codex";
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

function Liste({ ouvrir }: { ouvrir: (id: string) => void }) {
  const { moteurs } = useMoteurs();
  const [recherche, setRecherche] = useState("");
  const publiees = useVersionsDisponibles((moteurs ?? []).filter((m) => m.moteur.chemin).map((m) => m.moteur.id));
  const etat = (id: string) => moteurs?.find((m) => m.moteur.id === id);
  const visibles = FOURNISSEURS.filter((f) => f.nom.toLowerCase().includes(recherche.trim().toLowerCase()) || f.moteur.toLowerCase().includes(recherche.trim().toLowerCase()));
  const connectes = visibles.filter((f) => { const m = etat(f.id); return m && pret(m); });
  const autres = visibles.filter((f) => !connectes.includes(f));

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
      {connectes.length > 0 && (
        <Groupe titre="Connectés">
          {connectes.map((f) => (
            <Ligne1 key={f.id} id={f.id} m={etat(f.id)} publiee={publiees[f.id]} onClick={() => ouvrir(f.id)} />
          ))}
        </Groupe>
      )}
      {autres.length > 0 && (
        <Groupe titre="Autres fournisseurs" description="Installés ou connectés depuis leur page.">
          {autres.map((f) => (
            <Ligne1 key={f.id} id={f.id} m={etat(f.id)} publiee={publiees[f.id]} onClick={() => ouvrir(f.id)} />
          ))}
        </Groupe>
      )}
      {!visibles.length && <p className="m-0 text-ui-s text-texte-tertiaire">Aucun fournisseur ne correspond à « {recherche} ».</p>}
    </div>
  );
}

/* ─── Une action longue (connexion, installation) ──────────────── */

type Action = { nom: string; progression: ProgressionMoteur | null } | null;

function texteProgression(p: ProgressionMoteur | null): string {
  if (!p) return "En cours…";
  if (p.etape === "telechargement") return `Téléchargement ${Math.round(p.recu / 1e6)}${p.total ? ` / ${Math.round(p.total / 1e6)}` : ""} Mo…`;
  if (p.etape === "verification") return "Vérification de l’empreinte…";
  if (p.etape === "installation") return "Installation…";
  return "Mise à jour…";
}

function useAction(id: string) {
  const [action, setAction] = useState<Action>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    const bridge = getBridge()?.moteurs;
    if (!action || !bridge) return;
    return bridge.onProgression((qui, p) => qui === id && setAction((a) => (a ? { ...a, progression: p } : a)));
  }, [action, id]);
  const lancer = useCallback(async (nom: string, faire: () => Promise<{ ok: true } | { ok: false; message: string }>) => {
    setErreur(null);
    setAction({ nom, progression: null });
    const r = await faire();
    await actualiserMoteurs();
    setAction(null);
    if (!r.ok) setErreur(r.message);
  }, []);
  return { action, erreur, lancer };
}

/* ─── La page d'un fournisseur ─────────────────────────────────── */

function Moteur({ id, m }: { id: string; m: EtatMoteur | undefined }) {
  const bridge = getBridge()?.moteurs;
  const publiees = useVersionsDisponibles(m?.moteur.chemin || m?.moteur.installable ? [id] : []);
  const publiee = publiees[id];
  const { action, erreur, lancer } = useAction(id);
  const installe = !!m?.moteur.chemin;
  const version = m?.compte?.version;
  const nom = m?.moteur.nom ?? fournisseur(id).moteur;
  const description = !installe
    ? `${fournisseur(id).nom} passe par ${nom}. L’app le télécharge depuis sa source officielle (npm), vérifie son empreinte et le range dans ~/.klyra/moteurs.`
    : m?.moteur.gere
      ? "Installé par KLYRA dans ~/.klyra/moteurs : c’est l’app qui le met à jour."
      : "Installé sur ce poste : la mise à jour passe par sa propre commande.";

  return (
    <Groupe titre="Moteur">
      <Ligne id="moteur-version" libelle={installe ? `${nom}${version ? ` ${version}` : ""}` : `${nom} n’est pas installé`} description={description}>
        {installe && publiee && !aJour(version, publiee) && <Pastille texte={`${publiee} disponible`} ton="attente" />}
        {installe && publiee && aJour(version, publiee) && <Valeur>À jour</Valeur>}
        {bridge && !installe && m?.moteur.installable && (
          <Bouton variant="sombre" taille="compact" disabled={!!action} onClick={() => void lancer("installer", () => bridge.installer(id))}>
            {action ? texteProgression(action.progression) : "Installer"}
          </Bouton>
        )}
        {bridge && installe && publiee && !aJour(version, publiee) && (
          <Bouton variant="blanc" taille="compact" disabled={!!action} onClick={() => void lancer("mettre-a-jour", () => bridge.mettreAJour(id))}>
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

function CompteChatGpt({ m }: { m: EtatMoteur | undefined }) {
  const bridge = getBridge()?.moteurs;
  const { action, erreur, lancer } = useAction("codex");
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
              : "La page d’OpenAI s’ouvre dans ton navigateur ; reviens ici une fois connecté."
          }
        >
          {bridge && !compte?.connecte && (
            <Bouton variant="sombre" taille="compact" disabled={!!action} onClick={() => void lancer("connecter", () => bridge.connecter("codex"))}>
              {action?.nom === "connecter" ? "Connexion dans le navigateur…" : "Se connecter"}
            </Bouton>
          )}
          {bridge && compte?.connecte && compte.methode !== "config" && (
            <Bouton variant="blanc" taille="compact" disabled={!!action} onClick={() => void lancer("deconnecter", () => bridge.deconnecter("codex"))}>
              Se déconnecter
            </Bouton>
          )}
        </Ligne>
      </Groupe>

      {!compte?.connecte && (
        <Groupe titre="Clé API" description="Plutôt qu’un abonnement : une clé de platform.openai.com/api-keys. Codex la garde sur ce poste ; elle ne revient jamais à l’interface.">
          <Ligne id="cle-api-chatgpt" libelle="Clé API d’OpenAI" pile>
            <form
              className="flex w-full items-center gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!bridge || !cle.trim()) return;
                void lancer("cle", () => bridge.connecterAvecCle("codex", cle.trim())).then(() => setCle(""));
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

function Detail({ id, retour }: { id: string; retour: () => void }) {
  const { moteurs } = useMoteurs();
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
            {agents.length ? `${agents.length === 1 ? "1 agent l’utilise" : `${agents.length} agents l’utilisent`} : ${listeNoms(agents)}` : "Aucun agent ne l’utilise par défaut. Choisis-le dans une conversation, ou pour un agent dans Agents."}
          </span>
        </div>
      </div>
      {id === PAR_DEFAUT ? <Claude /> : <CompteChatGpt m={m} />}
      <Moteur id={id} m={m} />
    </div>
  );
}

/* ─── La section ───────────────────────────────────────────────── */

/** Sur un VPS : Claude Code seul pour l'instant. */
function SurUnVps() {
  return (
    <Groupe titre="Sur ce serveur" description="Les autres fournisseurs (ChatGPT, et ensuite Grok et OpenCode) arriveront plus tard sur les serveurs distants. Sur Ce PC, ils se règlent dans ses Réglages du serveur.">
      <div className="flex items-center gap-3 py-3">
        <Marque id={PAR_DEFAUT} />
        <span className="flex flex-col">
          <span className="text-ui-s font-medium text-texte-principal">Claude</span>
          <span className="text-ui-xs text-texte-tertiaire">Claude Code, sur ce serveur</span>
        </span>
      </div>
    </Groupe>
  );
}

export function Fournisseurs({ lieu }: { lieu: string | null }): ReactNode {
  const router = useRouter();
  const params = useSearchParams();
  const detail = params.get("fournisseur");
  const serveur = params.get("serveur");
  const connu = useMemo(() => FOURNISSEURS.some((f) => f.id === detail), [detail]);
  if (lieu) return <SurUnVps />;
  const aller = (fournisseurId: string | null) => router.replace(cheminServeur("fournisseurs", { fournisseur: fournisseurId, serveur }), { scroll: false });
  return detail && connu ? <Detail id={detail} retour={() => aller(null)} /> : <Liste ouvrir={(id) => aller(id)} />;
}
