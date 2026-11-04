"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Icon } from "@/components/icons/Icon";
import { Interrupteur } from "@/components/reglages/ui";
import { Bouton } from "@/components/ui/Bouton";
import { Modale, useConfirmation } from "@/components/ui/Modale";
import { getBridge, type ConnexionCoffre } from "@/lib/bridge";
import { formatListDate } from "@/lib/format";

/**
 * Le coffre du navigateur de KLYRA (electron/navigateur/coffre.ts) : les connexions que la personne
 * range pour remplir une page de connexion d'un clic, ou laisser un agent le faire sans jamais voir
 * le mot de passe. L'écran n'a que le site et l'identifiant ; le mot de passe part au main, chiffré
 * aussitôt par le trousseau du système, et n'en revient jamais.
 */

const pont = () => getBridge()?.navigateur;

const CHAMP =
  "h-8 w-full rounded-xs border border-bordure-champ bg-fond-surface px-2.5 text-ui-s text-texte-principal outline-none placeholder:text-texte-tertiaire focus:border-bordure-forte";

/** Ce site (ou l'un de ses sous-domaines) : les connexions qui valent pour la page ouverte. */
export function pourSite(c: ConnexionCoffre, hote: string): boolean {
  const h = hote.replace(/^www\./, "");
  return h === c.hote || h.endsWith(`.${c.hote}`);
}

export function useCoffre() {
  const p = pont();
  const [liste, setListe] = useState<ConnexionCoffre[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  useEffect(() => {
    let actif = true;
    void p?.coffre?.().then((r) => {
      if (actif && r.ok) setListe(r.data);
    });
    return () => {
      actif = false;
    };
  }, [p]);
  const appliquer = (r: { ok: true; data: ConnexionCoffre[] } | { ok: false; message: string } | undefined) => {
    if (!r) return false;
    if (!r.ok) {
      setErreur(r.message);
      return false;
    }
    setErreur(null);
    setListe(r.data);
    return true;
  };
  return {
    disponible: !!p?.coffre,
    liste,
    erreur,
    ajouter: async (e: { site: string; identifiant: string; motDePasse: string; agents: boolean }) => appliquer(await p?.ajouterAuCoffre?.(e)),
    retirer: async (id: string) => appliquer(await p?.retirerDuCoffre?.(id)),
    agents: async (id: string, agents: boolean) => appliquer(await p?.agentsCoffre?.(id, agents)),
  };
}

/** Ajouter une connexion : site (déjà rempli dans un onglet), identifiant, mot de passe, et si les agents peuvent s'en servir. */
function FormulaireConnexion({ site: siteDepart, onAjouter }: { site?: string; onAjouter: (e: { site: string; identifiant: string; motDePasse: string; agents: boolean }) => Promise<boolean> }) {
  const [site, setSite] = useState(siteDepart ?? "");
  const [identifiant, setIdentifiant] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [agents, setAgents] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const valider = async (e: FormEvent) => {
    e.preventDefault();
    if (!motDePasse || !site.trim()) return;
    setEnvoi(true);
    const ok = await onAjouter({ site, identifiant, motDePasse, agents });
    setEnvoi(false);
    if (ok) {
      setIdentifiant("");
      setMotDePasse("");
      if (!siteDepart) setSite("");
    }
  };
  return (
    <form onSubmit={valider} className="flex flex-col gap-2 rounded-md border border-bordure-subtile p-3">
      <span className="text-ui-xs font-semibold text-texte-principal">Ajouter une connexion</span>
      {!siteDepart && <input value={site} onChange={(e) => setSite(e.target.value)} placeholder="Site (ex. klyra.fr)" aria-label="Site" className={CHAMP} autoComplete="off" spellCheck={false} />}
      <input value={identifiant} onChange={(e) => setIdentifiant(e.target.value)} placeholder="Identifiant ou e-mail" aria-label="Identifiant" className={CHAMP} autoComplete="off" spellCheck={false} />
      <input
        type="password"
        value={motDePasse}
        onChange={(e) => setMotDePasse(e.target.value)}
        placeholder="Mot de passe"
        aria-label="Mot de passe"
        className={CHAMP}
        autoComplete="new-password"
      />
      <div className="flex items-center justify-between gap-3">
        <span className="text-ui-xs leading-[1.45] text-texte-secondaire">Mes agents peuvent s’en servir (sans voir le mot de passe)</span>
        <Interrupteur libelle="Mes agents peuvent s’en servir" actif={agents} onChange={setAgents} />
      </div>
      <Bouton type="submit" variant="sombre" taille="compact" disabled={envoi || !motDePasse || !site.trim()} className="self-start">
        {envoi ? "Enregistrement…" : "Enregistrer dans le coffre"}
      </Bouton>
    </form>
  );
}

/** La liste des connexions (toutes, ou celles d'un site), avec de quoi remplir la page, permettre aux agents, retirer. */
export function ListeCoffre({ hote, ongletId, onRempli }: { hote?: string; ongletId?: string; onRempli?: () => void }) {
  const coffre = useCoffre();
  const [demander, fenetre] = useConfirmation();
  const [message, setMessage] = useState<string | null>(null);
  if (!coffre.disponible) return <span className="text-ui-xs text-texte-tertiaire">Le coffre est dans l’app de bureau.</span>;
  const liste = (coffre.liste ?? []).filter((c) => !hote || pourSite(c, hote));

  const retirer = async (c: ConnexionCoffre) => {
    const oui = await demander({
      titre: `Retirer la connexion ${c.identifiant || "sans identifiant"} ?`,
      texte: `Le mot de passe de ${c.hote} est effacé du coffre de KLYRA. Le compte sur le site ne change pas.`,
      confirmer: "Retirer",
    });
    if (oui) await coffre.retirer(c.id);
  };
  const remplir = async (c: ConnexionCoffre) => {
    if (!ongletId) return;
    const r = await pont()?.remplir?.(ongletId, c.id);
    setMessage(r?.ok ? r.data : (r?.message ?? null));
    if (r?.ok) onRempli?.();
  };

  return (
    <div className="flex flex-col gap-3">
      {liste.length ? (
        <ul className="m-0 flex list-none flex-col gap-1 p-0">
          {liste.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-sm bg-fond-surface-grise px-3 py-2">
              <Icon name="lock-01" size={14} className="shrink-0 text-icone-secondaire" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate text-ui-s font-medium text-texte-principal">{c.identifiant || "Sans identifiant"}</span>
                <span className="truncate text-ui-2xs text-texte-tertiaire">
                  {c.hote} · {c.utiliseLe ? `utilisée ${formatListDate(new Date(c.utiliseLe).toISOString())}` : "jamais utilisée"}
                </span>
              </span>
              <span className="flex items-center gap-1.5 text-ui-2xs text-texte-secondaire">
                Agents
                <Interrupteur libelle={`Mes agents peuvent utiliser ${c.identifiant || c.hote}`} actif={c.agents} onChange={(v) => void coffre.agents(c.id, v)} />
              </span>
              {ongletId && (
                <Bouton variant="sombre" taille="mini" onClick={() => void remplir(c)}>
                  Remplir
                </Bouton>
              )}
              <Bouton variant="discret" taille="mini" onClick={() => void retirer(c)}>
                Retirer
              </Bouton>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">
          {hote ? `Aucune connexion pour ${hote} dans le coffre.` : "Aucune connexion dans le coffre."}
        </span>
      )}
      {message && <span className="text-ui-xs text-texte-secondaire">{message}</span>}
      <FormulaireConnexion site={hote} onAjouter={coffre.ajouter} />
      {coffre.erreur && <span className="text-ui-xs text-texte-erreur">{coffre.erreur}</span>}
      {fenetre}
    </div>
  );
}

/** « Mots de passe de ce site », depuis la barre d'un onglet. */
export function ModaleCoffre({ hote, ongletId, onFermer }: { hote: string; ongletId: string; onFermer: () => void }) {
  return (
    <Modale
      titre={`Mots de passe de ${hote}`}
      onFermer={onFermer}
      actions={
        <Bouton variant="blanc" taille="md" onClick={onFermer}>
          Fermer
        </Bouton>
      }
    >
      <div className="flex flex-col gap-3">
        <span className="text-ui-xs leading-[1.45] text-texte-tertiaire">
          Rangés dans le coffre de KLYRA, chiffrés par le trousseau de ton ordinateur. « Remplir » complète la page ; un agent autorisé peut le faire sans jamais voir le mot de passe.
        </span>
        <ListeCoffre hote={hote} ongletId={ongletId} onRempli={onFermer} />
      </div>
    </Modale>
  );
}
