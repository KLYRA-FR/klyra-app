"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Groupe, Ligne, Valeur } from "@/components/reglages/ui";
import { fournisseur } from "@/lib/fournisseurs";
import { useSondes } from "@/lib/lieux";
import { useMaj } from "@/lib/maj";
import { useMoteurs } from "@/lib/moteurs";
import { libelleServeur, type ServeurConnu } from "@/lib/serveur-vps";

/** Les moteurs de Ce PC et leur version. */
function MoteursDuPoste() {
  const { moteurs } = useMoteurs();
  return (
    <Groupe titre="Moteurs" description="Les programmes qui font travailler les agents sur ce PC. Leurs comptes et leurs mises à jour sont dans Fournisseurs.">
      {!moteurs && <Ligne libelle="Lecture…" />}
      {moteurs?.map((m) => (
        <Ligne key={m.moteur.id} id={m.moteur.id === "claude" ? "serveur-moteurs" : undefined} libelle={`${m.moteur.nom} · ${fournisseur(m.moteur.id).nom}`}>
          <Valeur>{m.moteur.chemin ? (m.compte?.version ?? "Installé") : "Non installé"}</Valeur>
        </Ligne>
      ))}
    </Groupe>
  );
}

/** Général : Ce PC, ou un VPS relié (nom, adresse, version, état). */
export function GeneralServeur({ serveur }: { serveur: ServeurConnu | null }) {
  const { etat } = useMaj();
  const liste = useMemo(() => (serveur ? [serveur] : []), [serveur]);
  const sondes = useSondes(liste);

  if (!serveur) {
    return (
      <>
        <Groupe>
          <Ligne id="serveur-nom" libelle="Ce PC" description="Les agents tournent sur cet ordinateur, tant que l’app est ouverte." />
          <Ligne id="serveur-version" libelle="Version de KLYRA">
            <Valeur>{etat ? `KLYRA ${etat.version}` : "Version de développement"}</Valeur>
          </Ligne>
        </Groupe>
        <MoteursDuPoste />
      </>
    );
  }
  const sonde = sondes[serveur.id];
  return (
    <Groupe>
      <Ligne id="serveur-nom" libelle={serveur.nom} description="Un VPS relié : ses agents tournent même quand ce PC est éteint." />
      <Ligne libelle="Adresse">
        <Valeur mono>{serveur.adresse}</Valeur>
      </Ligne>
      <Ligne id="serveur-version" libelle="Version de KLYRA sur ce serveur">
        <Valeur>{serveur.version || "—"}</Valeur>
      </Ligne>
      <Ligne libelle="État">
        <Valeur>{libelleServeur(serveur.etat, sonde?.sonde, sonde?.agents)}</Valeur>
      </Ligne>
      <Ligne libelle="Tous les serveurs" description="Ajouter, relier ou retirer un serveur.">
        <Link href="/serveurs" className="text-ui-s font-medium text-texte-principal underline underline-offset-2">
          Ouvrir
        </Link>
      </Ligne>
    </Groupe>
  );
}
