"use client";

import { useState } from "react";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { ouvrirLien } from "@/components/ui/Lien";
import { useConfirmation } from "@/components/ui/Modale";
import type { EtatMaj } from "@/lib/bridge";
import { useMaj } from "@/lib/maj";
import { Erreur, Groupe, Ligne, SeulementBureau, Valeur } from "../ui";

const DEPOT = "https://github.com/KLYRA-FR/klyra-app-versions/releases";
const date = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
const mo = (octets: number) => `${(octets / 1024 / 1024).toLocaleString("fr-FR", { maximumFractionDigits: 1 })} Mo`;

function phrase(etat: EtatMaj): string {
  switch (etat.statut) {
    case "dev":
      return "Version de développement : elle ne se met pas à jour toute seule.";
    case "verification":
      return "Recherche en cours…";
    case "telechargement":
      return `Téléchargement de KLYRA ${etat.disponible ?? ""}…`;
    case "prete":
      return `KLYRA ${etat.nouvelle} est téléchargée et vérifiée. Elle s’installera quand tu quitteras l’app, ou tout de suite d’un clic.`;
    case "a-jour":
      return "Tu as la dernière version.";
    case "erreur":
      return "La dernière recherche n’a pas abouti : voir le message ci-dessous.";
    default:
      return "L’app regarde au démarrage, puis toutes les heures.";
  }
}

/** La barre de téléchargement, avec les mégaoctets reçus. */
function Progression({ recus, total }: { recus: number; total: number }) {
  const part = total ? Math.min(1, recus / total) : null;
  return (
    <div className="flex w-full items-center gap-3">
      <span
        role="progressbar"
        aria-label="Téléchargement de la mise à jour"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={part === null ? undefined : Math.round(part * 100)}
        className="relative h-2 min-w-0 flex-1 overflow-hidden rounded-pill bg-fond-surface-grise"
      >
        <span
          className={part === null ? "klyra-respire absolute inset-y-0 left-0 w-1/3 rounded-pill bg-bleu-k1-500" : "absolute inset-y-0 left-0 rounded-pill bg-bleu-k1-500 transition-[width] duration-[220ms] ease-sortie"}
          style={part === null ? undefined : { width: `${part * 100}%` }}
        />
      </span>
      <span className="klyra-mono shrink-0 text-ui-xs text-texte-secondaire">
        {part === null ? mo(recus) : `${Math.round(part * 100)} % · ${mo(recus)} sur ${mo(total)}`}
      </span>
    </div>
  );
}

export function MisesAJour() {
  const { etat, erreur, rechercher, installer, disponible } = useMaj();
  const [recherche, setRecherche] = useState(false);
  const [demander, fenetre] = useConfirmation();
  const occupe = recherche || etat?.statut === "verification" || etat?.statut === "telechargement";

  const lancerRecherche = async () => {
    setRecherche(true);
    await rechercher();
    setRecherche(false);
  };

  const installerApresAccord = async () => {
    if (!etat?.nouvelle) return;
    const oui = await demander({
      titre: `Installer KLYRA ${etat.nouvelle} ?`,
      texte: "L’app se ferme, s’installe et se rouvre. Les agents en train de répondre s’arrêtent.",
      confirmer: "Installer et relancer",
    });
    if (oui) await installer();
  };

  return (
    <>
      {fenetre}
      <Groupe>
        <Ligne id="version-installee" libelle="Version installée" description={etat ? phrase(etat) : disponible ? "Lecture…" : undefined}>
          <Valeur>{etat ? `KLYRA ${etat.version}` : "Version de développement"}</Valeur>
        </Ligne>
        <Ligne id="version-disponible" libelle="Dernière version disponible" description="Publiée dans le dépôt des versions de KLYRA.">
          <Valeur>{etat?.disponible ? `KLYRA ${etat.disponible}` : "—"}</Valeur>
        </Ligne>
        <Ligne id="derniere-verification" libelle="Dernière vérification" description="Au démarrage de l’app, puis toutes les heures.">
          <Valeur>{etat?.verifieeLe ? date.format(etat.verifieeLe) : "Pas encore"}</Valeur>
        </Ligne>
        <Ligne id="rechercher-maj" libelle="Rechercher une mise à jour" description="Sans attendre la vérification de l’heure.">
          {disponible ? (
            <Bouton
              variant="blanc"
              taille="compact"
              iconeGauche={<Icon name="refresh-01" size={16} className={occupe ? "animate-spin" : undefined} />}
              disabled={occupe || etat?.statut === "dev" || etat?.statut === "prete"}
              onClick={() => void lancerRecherche()}
            >
              {occupe ? "Recherche…" : "Rechercher maintenant"}
            </Bouton>
          ) : (
            <SeulementBureau />
          )}
        </Ligne>
        {etat?.statut === "telechargement" && etat.progression && (
          <Ligne id="telechargement-maj" libelle="Téléchargement" description={`KLYRA ${etat.disponible ?? ""} : l’empreinte est vérifiée à la fin, avant toute installation.`} pile>
            <Progression recus={etat.progression.recus} total={etat.progression.total} />
          </Ligne>
        )}
        <Ligne
          id="installer-maj"
          libelle="Installer et relancer"
          description={etat?.statut === "prete" ? `KLYRA ${etat.nouvelle} attend : installe-la tout de suite.` : "Disponible quand une nouvelle version est téléchargée."}
        >
          {etat?.statut === "prete" ? (
            <BoutonPrincipal onClick={() => void installerApresAccord()}>Installer et relancer</BoutonPrincipal>
          ) : (
            <Valeur>Rien à installer</Valeur>
          )}
        </Ligne>
        {etat?.statut === "erreur" && etat.erreur && <Erreur>{etat.erreur}</Erreur>}
        {erreur && <Erreur>{erreur}</Erreur>}
      </Groupe>

      <Groupe>
        <Ligne
          id="depot-versions"
          libelle="Toutes les versions"
          description="Chaque version publiée de l’app, pour les deux systèmes, dans le dépôt KLYRA-FR/klyra-app-versions."
        >
          <Bouton variant="blanc" taille="compact" iconeDroite={<Icon name="link-external" size={16} />} onClick={() => ouvrirLien(etat?.depot ?? DEPOT)}>
            Ouvrir sur GitHub
          </Bouton>
        </Ligne>
      </Groupe>
    </>
  );
}
