"use client";

import { NotePoste } from "../NotePoste";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { getBridge, type AutorisationsComputerUse, type EtatAutorisation, type EtatPilote } from "@/lib/bridge";
import { useReglages } from "@/lib/reglages";
import { Erreur, Groupe, Interrupteur, Ligne, SeulementBureau, Pastille } from "../ui";

const ETATS: Record<EtatAutorisation, { texte: string; ton: "ok" | "attente" | "neutre" }> = {
  accordee: { texte: "Accordée", ton: "ok" },
  refusee: { texte: "Pas encore accordée", ton: "attente" },
  "a-demander": { texte: "Pas encore demandée", ton: "attente" },
  "sans-objet": { texte: "Rien à autoriser", ton: "neutre" },
  inconnue: { texte: "Inconnue sur ce système", ton: "neutre" },
};

const PILOTE: Record<EtatPilote["statut"], { texte: string; ton: "ok" | "attente" | "neutre" }> = {
  pret: { texte: "Prêt", ton: "ok" },
  autorisations: { texte: "Autorisations à donner", ton: "attente" },
  erreur: { texte: "Ne démarre pas", ton: "attente" },
  absent: { texte: "Absent de cette version", ton: "attente" },
  "non-pris-en-charge": { texte: "Pas sur ce système", ton: "neutre" },
  coupe: { texte: "Coupé", ton: "neutre" },
};

/**
 * Computer Use : l'interrupteur qui autorise les agents à piloter
 * l'ordinateur, l'état du pilote (cua-driver, cf. electron/ordinateur/pilote.ts)
 * et les autorisations que le système doit donner à l'app.
 */
export function ComputerUse() {
  const { reglages, erreur, changerComputerUse, systeme } = useReglages();
  const pont = getBridge()?.reglages;
  const [autorisations, setAutorisations] = useState<AutorisationsComputerUse | null>(null);
  const [erreurOuverture, setErreurOuverture] = useState<string | null>(null);
  const [pilote, setPilote] = useState<EtatPilote | null>(null);
  const [verification, setVerification] = useState(false);

  const lire = useCallback(() => {
    if (!pont) return;
    void pont.autorisationsComputerUse().then((r) => r.ok && setAutorisations(r.data));
    void pont.etatComputerUse?.().then((r) => r.ok && setPilote(r.data));
  }, [pont]);

  /* Le pilote change d'état seul (démarré, arrêté, autorisations accordées) : l'écran suit. */
  useEffect(() => pont?.surEtatComputerUse?.(setPilote), [pont]);
  const actif = !!reglages?.computerUse.actif;

  const verifier = async () => {
    if (!pont?.etatComputerUse) return;
    setVerification(true);
    const r = await pont.etatComputerUse();
    if (r.ok) setPilote(r.data);
    void pont.autorisationsComputerUse().then((a) => a.ok && setAutorisations(a.data));
    setVerification(false);
  };

  /* Relues au retour dans l'app (la personne vient peut-être de les accorder dans le système)
     et quand l'interrupteur change (le pilote démarre ou s'arrête). */
  useEffect(() => {
    lire();
    window.addEventListener("focus", lire);
    return () => window.removeEventListener("focus", lire);
  }, [lire, actif]);

  const ouvrir = async (type: "accessibilite" | "ecran") => {
    if (!pont) return;
    const r = await pont.ouvrirAutorisation(type);
    setErreurOuverture(r.ok ? null : r.message);
  };

  const mac = autorisations?.plateforme === "darwin";

  return (
    <>
      <NotePoste texte={(serveur) => `Computer Use pilote cet ordinateur. Les agents de ${serveur} ne l’utilisent pas : un serveur n’a pas d’écran.`} />
    <>
      <Groupe>
        <Ligne
          id="computer-use-actif"
          libelle="Laisser les agents piloter l’ordinateur"
          description="Les agents voient les fenêtres et agissent dans tes apps (clics, clavier, menus), le plus souvent en arrière-plan, sans prendre ta souris. En accès « Tout », ils agissent sans demander ; sinon, ils lisent l’écran librement et demandent ton accord avant d’agir. Coupé : aucun agent ne touche à ton écran."
        >
          <Interrupteur
            libelle="Laisser les agents piloter l’ordinateur"
            actif={!!reglages?.computerUse.actif}
            disabled={!reglages}
            onChange={(v) => void changerComputerUse(v)}
          />
        </Ligne>
        {erreur && <Erreur>{erreur}</Erreur>}
        {pont?.etatComputerUse && actif && (
          <Ligne
            id="computer-use-pilote"
            libelle="Pilote"
            description={
              pilote?.statut === "pret"
                ? `cua-driver ${pilote.version}. Les agents ont les outils « ordinateur » dès leur prochain message.`
                : pilote?.statut === "autorisations"
                  ? "Accorde les deux autorisations ci-dessous à KLYRA, puis vérifie à nouveau. macOS demande parfois de relancer l’app."
                  : (pilote?.message ?? "Le pilote de Computer Use (cua-driver), fourni avec l’app.")
            }
          >
            {pilote && <Pastille {...PILOTE[pilote.statut]} />}
            <Bouton variant="blanc" taille="compact" disabled={verification} onClick={() => void verifier()}>
              {verification ? "Vérification…" : "Vérifier à nouveau"}
            </Bouton>
          </Ligne>
        )}
      </Groupe>

      <Groupe
        titre="Autorisations du système"
        description={
          !systeme
            ? undefined
            : mac
              ? "macOS doit autoriser KLYRA à piloter les autres apps et à voir l’écran. Accorde-les dans les réglages du système, puis reviens ici."
              : autorisations?.plateforme === "win32"
                ? "Windows ne demande pas d’autorisation pour ça."
                : undefined
        }
      >
        <Ligne id="autorisation-accessibilite" libelle="Accessibilité" description="Pour cliquer et taper au clavier dans les autres apps.">
          {!pont ? (
            <SeulementBureau />
          ) : (
            <>
              {autorisations && <Pastille {...ETATS[autorisations.accessibilite]} />}
              {mac && autorisations?.accessibilite !== "accordee" && (
                <Bouton variant="blanc" taille="compact" iconeDroite={<Icon name="link-external" size={16} />} onClick={() => void ouvrir("accessibilite")}>
                  Ouvrir les réglages
                </Bouton>
              )}
            </>
          )}
        </Ligne>
        <Ligne id="autorisation-ecran" libelle="Enregistrement de l’écran" description="Pour que l’agent voie ce qu’il fait (captures).">
          {!pont ? (
            <SeulementBureau />
          ) : (
            <>
              {autorisations && <Pastille {...ETATS[autorisations.ecran]} />}
              {mac && autorisations?.ecran !== "accordee" && (
                <Bouton variant="blanc" taille="compact" iconeDroite={<Icon name="link-external" size={16} />} onClick={() => void ouvrir("ecran")}>
                  Ouvrir les réglages
                </Bouton>
              )}
            </>
          )}
        </Ligne>
        {erreurOuverture && <Erreur>{erreurOuverture}</Erreur>}
      </Groupe>
    </>
    </>
  );
}
