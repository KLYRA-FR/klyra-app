"use client";

import { useEffect, useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { ouvrirLien } from "@/components/ui/Lien";
import { useConfirmation } from "@/components/ui/Modale";
import { getBridge, unwrap, type EtatMaj } from "@/lib/bridge";
import { Erreur, Groupe, Ligne, SeulementBureau, Valeur } from "../ui";

const DEPOT = "https://github.com/KLYRA-FR/klyra-app-versions/releases";
const quand = new Intl.DateTimeFormat("fr-FR", { weekday: "long", hour: "2-digit", minute: "2-digit" });

function phrase(etat: EtatMaj): string {
  switch (etat.statut) {
    case "dev":
      return "Version de développement : elle ne se met pas à jour toute seule.";
    case "verification":
      return "Recherche et téléchargement en cours…";
    case "prete":
      return `KLYRA ${etat.nouvelle} est téléchargée et vérifiée. Elle s’installera quand tu quitteras l’app.`;
    case "a-jour":
      return `Tu as la dernière version. Vérifié ${quand.format(etat.verifieeLe ?? Date.now())}.`;
    case "erreur":
      return `La dernière recherche a échoué : ${etat.erreur ?? "raison inconnue"}`;
    default:
      return "L’app regarde au démarrage, puis toutes les heures.";
  }
}

export function MisesAJour() {
  const pont = getBridge()?.maj;
  const [etat, setEtat] = useState<EtatMaj | null>(null);
  const [recherche, setRecherche] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [demander, fenetre] = useConfirmation();

  useEffect(() => {
    if (!pont) return;
    const lire = () => void pont.etat().then((r) => r.ok && setEtat(r.data));
    lire();
    // Un téléchargement peut finir pendant qu'on regarde.
    const minuteur = window.setInterval(lire, 5000);
    return () => window.clearInterval(minuteur);
  }, [pont]);

  const rechercher = async () => {
    if (!pont) return;
    setErreur(null);
    setRecherche(true);
    try {
      setEtat(unwrap(await pont.verifier()));
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setRecherche(false);
    }
  };

  const installer = async () => {
    if (!pont || !etat?.nouvelle) return;
    const oui = await demander({
      titre: `Installer KLYRA ${etat.nouvelle} ?`,
      texte: "L’app se ferme, s’installe et se rouvre. Les agents en train de répondre s’arrêtent.",
      confirmer: "Installer et relancer",
    });
    if (!oui) return;
    const r = await pont.installer();
    if (!r.ok) setErreur(r.message);
  };

  return (
    <>
      {fenetre}
      <Groupe>
        <Ligne id="version-installee" libelle="Version installée" description={etat ? phrase(etat) : pont ? "Lecture…" : undefined}>
          <Valeur>{etat ? `KLYRA ${etat.version}` : "Version de développement"}</Valeur>
        </Ligne>
        <Ligne id="rechercher-maj" libelle="Rechercher une mise à jour" description="Sans attendre la vérification de l’heure.">
          {pont ? (
            <Bouton
              variant="blanc"
              taille="compact"
              iconeGauche={<Icon name="refresh-01" size={16} className={recherche ? "animate-spin" : undefined} />}
              disabled={recherche || etat?.statut === "dev" || etat?.statut === "verification"}
              onClick={() => void rechercher()}
            >
              {recherche ? "Recherche…" : "Rechercher maintenant"}
            </Bouton>
          ) : (
            <SeulementBureau />
          )}
        </Ligne>
        <Ligne
          id="installer-maj"
          libelle="Installer et relancer"
          description={etat?.statut === "prete" ? `KLYRA ${etat.nouvelle} attend : installe-la tout de suite.` : "Disponible quand une nouvelle version est prête."}
        >
          {etat?.statut === "prete" ? (
            <BoutonPrincipal onClick={() => void installer()}>Installer et relancer</BoutonPrincipal>
          ) : (
            <Valeur>Rien à installer</Valeur>
          )}
        </Ligne>
        {erreur && <Erreur>{erreur}</Erreur>}
      </Groupe>

      <Groupe>
        <Ligne
          id="depot-versions"
          libelle="Toutes les versions"
          description="Chaque version publiée de l’app, pour Mac et Windows, dans le dépôt KLYRA-FR/klyra-app-versions."
        >
          <Bouton variant="blanc" taille="compact" iconeDroite={<Icon name="link-external" size={16} />} onClick={() => ouvrirLien(etat?.depot ?? DEPOT)}>
            Ouvrir sur GitHub
          </Bouton>
        </Ligne>
      </Groupe>
    </>
  );
}
