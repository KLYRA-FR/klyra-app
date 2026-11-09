"use client";

import { Input } from "klyra-ui";
import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { RoleAvatar } from "@/components/roles/RoleAvatar";
import { Bouton } from "@/components/ui/Bouton";
import { Modale } from "@/components/ui/Modale";
import { getBridge, type ReconnexionMcp } from "@/lib/bridge";
import { useServeursRelies } from "@/lib/lieux";
import { apparition } from "@/lib/mouvement";
import { poste } from "@/lib/plateforme";
import { depuisLe, libelleEtat, useSanteMcp, verificationsRatees, type DefautMcp } from "@/lib/sante-mcp";
import { useRole } from "@/lib/workspace";

/** Relecture d'une reconnexion en cours : sur ce PC, le navigateur peut la finir tout seul (localhost joignable). */
const SUIVI_MS = 2000;

/**
 * Dans le rail, au-dessus de la pastille de mise à jour : « Connexion » dès qu'un serveur MCP d'un agent est en
 * défaut (ce PC ou un VPS relié), tant qu'il le reste. Un clic, ou la notification, ouvre la fenêtre des connexions.
 */
export function PastilleMcp() {
  const sante = useSanteMcp();
  const [ouverte, setOuverte] = useState(false);

  useEffect(() => getBridge()?.santeMcp?.surOuvrir(() => setOuverte(true)), []);

  const n = sante.defauts.length;
  return (
    <>
      {n > 0 && (
        <button
          ref={apparition}
          type="button"
          onClick={() => setOuverte(true)}
          aria-haspopup="dialog"
          aria-label={n > 1 ? `${n} connexions d’agents à reprendre` : `Une connexion d’agent à reprendre : ${sante.defauts[0].mcp}`}
          title="Connexions des agents à reprendre"
          className="mb-1 flex w-14 cursor-pointer flex-col items-center gap-0.5 rounded-md border border-bordure-erreur bg-fond-surface px-1 pt-2 pb-1.5 text-texte-erreur transition-[background-color,transform] duration-[120ms] ease-sortie hover:bg-fond-survol active:scale-[0.97]"
        >
          <Icon name="lock-01" size={18} />
          <span className="text-ui-3xs leading-[1.15] font-semibold whitespace-nowrap">Connexion</span>
          <span className="klyra-mono text-ui-3xs leading-none">{n}</span>
        </button>
      )}
      {ouverte && <FenetreConnexions sante={sante} onFermer={() => setOuverte(false)} />}
    </>
  );
}

function FenetreConnexions({ sante, onFermer }: { sante: ReturnType<typeof useSanteMcp>; onFermer: () => void }) {
  const ratees = verificationsRatees(sante.lieux);
  const nomLieu = useNomLieu();
  /* L'heure d'ouverture de la fenêtre : les « depuis » se lisent par rapport à elle. */
  const [maintenant] = useState(() => Date.now());
  /* Les lignes vues depuis l'ouverture : un MCP reconnecté reste affiché (« Reconnecté ») jusqu'à la fermeture. */
  const [lignes, setLignes] = useState<DefautMcp[]>(sante.defauts);
  const cleDe = (d: DefautMcp) => `${d.lieu ?? ""}|${d.agent}|${d.mcp}`;
  const enCours = new Set(sante.defauts.map(cleDe));
  const [vuesAvant, setVuesAvant] = useState(sante.defauts);
  if (vuesAvant !== sante.defauts) {
    setVuesAvant(sante.defauts);
    setLignes((avant) => [...avant.map((l) => sante.defauts.find((d) => cleDe(d) === cleDe(l)) ?? l), ...sante.defauts.filter((d) => !avant.some((l) => cleDe(l) === cleDe(d)))]);
  }
  return (
    <Modale
      titre="Connexions des agents"
      onFermer={onFermer}
      className="w-[min(560px,calc(100vw-48px))]"
      actions={
        <>
          <Bouton variant="blanc" disabled={sante.verification} onClick={() => void sante.verifier()} iconeGauche={<Icon name="refresh-01" size={16} />}>
            {sante.verification ? "Vérification…" : "Vérifier maintenant"}
          </Bouton>
          <Bouton variant="sombre" onClick={onFermer} data-autofocus={sante.defauts.length ? undefined : true}>
            Fermer
          </Bouton>
        </>
      }
    >
      <p className="m-0">
        {lignes.length
          ? "Ces services ne répondent plus à tes agents. Reconnecte-les avant qu’un agent bute dessus : tu n’as qu’à te connecter dans ton navigateur."
          : "Toutes les connexions de tes agents répondent. KLYRA les vérifie au lancement, puis toutes les heures."}
      </p>
      {lignes.length > 0 && (
        <ul className="m-0 mt-4 flex list-none flex-col gap-2 p-0">
          {lignes.map((d) => (
            <LigneDefaut key={cleDe(d)} defaut={d} resolu={!enCours.has(cleDe(d))} lieu={nomLieu(d.lieu)} maintenant={maintenant} />
          ))}
        </ul>
      )}
      {ratees.length > 0 && (
        <div className="mt-4 text-ui-xs text-texte-tertiaire">
          <p className="m-0 font-medium">Pas pu vérifier :</p>
          <ul className="m-0 mt-1 list-disc pl-4">
            {ratees.map((r, i) => (
              <li key={i}>
                {nomLieu(r.lieu)} — {r.message}
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modale>
  );
}

function useNomLieu() {
  const serveurs = useServeursRelies();
  return (lieu: string | null) => (lieu === null ? poste.ce : (serveurs.find((s) => s.adresse === lieu)?.nom ?? new URL(lieu).hostname));
}

function LigneDefaut({ defaut, resolu, lieu, maintenant }: { defaut: DefautMcp; resolu: boolean; lieu: string; maintenant: number }) {
  const role = useRole(defaut.agent);
  const [reco, setReco] = useState<ReconnexionMcp | null>(null);
  const [enCours, setEnCours] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const pont = getBridge()?.santeMcp;
  /* La dernière reconnexion lancée, pour l'abandonner si la fenêtre se ferme en route. */
  const active = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (active.current) void pont?.annuler(defaut.lieu, active.current);
    };
  }, [pont, defaut.lieu]);

  /* Tant qu'on attend : relire, la connexion peut finir sans adresse collée (ce PC). */
  useEffect(() => {
    if (!pont || reco?.etat !== "attente") return;
    const id = reco.id;
    const t = setInterval(() => {
      void pont.suivre(defaut.lieu, id).then((r) => {
        if (r.ok && r.data && r.data.etat !== "attente") {
          active.current = null;
          setReco(r.data);
        }
      });
    }, SUIVI_MS);
    return () => clearInterval(t);
  }, [pont, reco, defaut.lieu]);

  const lancer = async () => {
    if (!pont) return;
    setEnCours(true);
    setErreur(null);
    try {
      const r = await pont.reconnecter(defaut.lieu, defaut.agent, defaut.mcp);
      if (!r.ok) setErreur(r.message);
      else if (r.data) {
        active.current = r.data.etat === "attente" ? r.data.id : null;
        setReco(r.data);
      }
    } finally {
      setEnCours(false);
    }
  };

  return (
    <li className="rounded-lg border border-bordure-subtile bg-fond-surface p-3">
      <div className="flex items-center gap-3">
        <RoleAvatar roleId={defaut.agent} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="m-0 truncate text-ui font-medium text-texte-principal">{defaut.mcp}</p>
          <p className="m-0 truncate text-ui-xs text-texte-secondaire">
            {role.name} · {lieu} ·{" "}
            {resolu ? <span>Répond de nouveau</span> : <><span className="text-texte-erreur">{libelleEtat(defaut.etat)}</span> {depuisLe(defaut.depuis, maintenant)}</>}
          </p>
        </div>
        {resolu ? (
          <Icon name="check-01" size={16} className="text-icone-secondaire" />
        ) : defaut.distant ? (
          <Bouton variant={reco?.etat === "attente" ? "blanc" : "sombre"} disabled={enCours} onClick={() => void lancer()}>
            {enCours ? "Ouverture…" : reco?.etat === "attente" ? "Recommencer" : "Reconnecter"}
          </Bouton>
        ) : (
          <span className="max-w-40 text-right text-ui-2xs text-texte-tertiaire">Tourne sur la machine : à relancer par l’agent</span>
        )}
      </div>
      {erreur && (
        <p role="alert" className="m-0 mt-2 text-ui-xs text-texte-erreur">
          {erreur}
        </p>
      )}
      {reco && <Parcours reco={reco} lieu={defaut.lieu} surFin={(r) => ((active.current = null), setReco(r))} />}
    </li>
  );
}

/** Les deux gestes de la personne : se connecter dans son navigateur, puis coller l'adresse de la page de retour. */
function Parcours({ reco, lieu, surFin }: { reco: ReconnexionMcp; lieu: string | null; surFin: (r: ReconnexionMcp) => void }) {
  const [adresse, setAdresse] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const pont = getBridge()?.santeMcp;

  if (reco.etat === "connecte") {
    return (
      <p role="status" className="m-0 mt-2 flex items-center gap-1.5 text-ui-xs text-texte-secondaire">
        <Icon name="check-01" size={16} /> Reconnecté : {reco.mcp} répond de nouveau.
      </p>
    );
  }
  if (reco.etat === "echec") {
    return (
      <p role="alert" className="m-0 mt-2 text-ui-xs text-texte-erreur">
        {reco.message}
      </p>
    );
  }

  const envoyer = async () => {
    if (!pont || !adresse.trim()) return;
    setEnvoi(true);
    setErreur(null);
    try {
      const r = await pont.retour(lieu, reco.id, adresse.trim());
      // Le champ se vide aussitôt : l'adresse porte un code à usage unique, elle ne reste pas à l'écran.
      setAdresse("");
      if (!r.ok) setErreur(r.message);
      else if (r.data) surFin(r.data);
    } finally {
      setEnvoi(false);
    }
  };

  return (
    <div className="mt-3 flex flex-col gap-3 border-t border-bordure-subtile pt-3 text-ui-s text-texte-principal">
      <div className="flex flex-col gap-1.5">
        <p className="m-0">1. Ouvre la page de connexion et connecte-toi au service.</p>
        {reco.lien ? (
          <a href={reco.lien} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 text-texte-accent">
            Ouvrir la page de connexion <Icon name="link-external" size={16} />
          </a>
        ) : (
          <p className="m-0 text-texte-tertiaire">Le lien arrive…</p>
        )}
      </div>
      <form
        className="flex flex-col gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          void envoyer();
        }}
      >
        <label htmlFor={`retour-${reco.id}`} className="m-0">
          2. À la fin, le navigateur arrive sur une page qui ne s’ouvre pas (son adresse commence par http://localhost). Copie cette adresse et colle-la ici.
        </label>
        <div className="flex gap-2">
          <Input
            id={`retour-${reco.id}`}
            size="sm"
            value={adresse}
            autoComplete="off"
            spellCheck={false}
            placeholder="http://localhost:…/callback?code=…"
            onChange={(e) => setAdresse(e.target.value)}
            className="min-w-0 flex-1"
          />
          <Bouton type="submit" variant="sombre" disabled={envoi || !adresse.trim()}>
            {envoi ? "Connexion…" : "Envoyer"}
          </Bouton>
        </div>
        {lieu === null && <p className="m-0 text-ui-xs text-texte-tertiaire">Sur {poste.ce}, la connexion se termine souvent seule : cette fenêtre le verra.</p>}
        {erreur && (
          <p role="alert" className="m-0 text-ui-xs text-texte-erreur">
            {erreur}
          </p>
        )}
      </form>
    </div>
  );
}
