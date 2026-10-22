"use client";

import { useEffect, useState } from "react";
import { Textarea } from "klyra-ui";
import { Icon } from "@/components/icons/Icon";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { CHAMP } from "@/components/ui/Champ";
import { getBridge, type EtatGit, type ResultatPublication } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import type { Project } from "@/types/domain";

const STATUTS: Record<string, string> = { M: "Modifié", A: "Ajouté", D: "Supprimé", "?": "Nouveau", R: "Renommé" };

/**
 * Publier un projet : ce qui a changé, le message du commit, puis commit +
 * push de la branche en cours. Sur une branche principale, l'avertissement
 * rappelle que le site peut partir en ligne.
 */
export function Publier({ project, onFermer }: { project: Project; onFermer: () => void }) {
  const bridge = getBridge();
  const [etat, setEtat] = useState<EtatGit | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [envoi, setEnvoi] = useState(false);
  const [resultat, setResultat] = useState<ResultatPublication | null>(null);

  useEffect(() => {
    if (!bridge) return;
    let actif = true;
    void bridge.git.etat(project.folder).then((r) => {
      if (!actif) return;
      if (r.ok) setEtat(r.data);
      else setErreur(r.message);
    });
    return () => {
      actif = false;
    };
  }, [bridge, project.folder]);

  const publier = async () => {
    if (!bridge) return;
    setEnvoi(true);
    const r = await bridge.git.publier(project.folder, message);
    setEnvoi(false);
    if (r.ok) setResultat(r.data);
    else setErreur(r.message);
  };

  const principale = etat?.branche === "main" || etat?.branche === "master";
  const rien = !!etat && etat.fichiers.length === 0 && etat.enAvance === 0;

  return (
    <div className="absolute inset-0 z-30 flex flex-col bg-fond-surface">
      <div className="flex items-center gap-2 border-b border-bordure-subtile px-4 py-3">
        <span className="flex-1 text-ui font-semibold text-texte-principal">Publier {project.name}</span>
        <Bouton variant="discret" taille="compact" onClick={onFermer}>
          Fermer
        </Bouton>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
        {!bridge && <p className="m-0 text-ui-s text-texte-secondaire">Publier marche dans l’app de bureau.</p>}
        {erreur && (
          <p role="alert" className="m-0 text-ui-s text-texte-erreur">
            {erreur}
          </p>
        )}
        {bridge && !etat && !erreur && <p className="m-0 text-ui-s text-texte-tertiaire">Lecture du dépôt…</p>}

        {etat && !etat.depot && (
          <p className="m-0 text-ui-s text-texte-secondaire">Ce dossier n’est pas un dépôt git : il n’y a rien à publier.</p>
        )}

        {resultat ? (
          <div className="flex flex-col gap-3">
            <p className={cn("m-0 text-ui font-semibold", resultat.ok ? "text-texte-principal" : "text-texte-erreur")}>
              {resultat.ok ? `C’est poussé sur ${resultat.branche}${resultat.commit ? ` (${resultat.commit})` : ""}.` : "La publication n’est pas allée au bout."}
            </p>
            {resultat.ok && principale && (
              <p className="m-0 text-ui-s text-texte-secondaire">Sur la branche principale, Vercel met le site en ligne dans quelques minutes.</p>
            )}
            <pre className="klyra-mono m-0 max-h-[240px] overflow-auto rounded-md border border-bordure-subtile bg-fond-page p-3 text-ui-2xs whitespace-pre-wrap text-texte-secondaire">
              {resultat.sortie}
            </pre>
            <Bouton variant="blanc" taille="compact" onClick={onFermer} className="self-start">
              Fermer
            </Bouton>
          </div>
        ) : (
          etat?.depot && (
            <>
              <div className="flex flex-wrap items-center gap-2 text-ui-s">
                <span className="text-texte-secondaire">Branche</span>
                <span className="klyra-mono rounded-2xs bg-fond-surface-grise px-2 py-0.5 text-ui-xs font-medium text-texte-principal">
                  {etat.branche}
                </span>
                {etat.enAvance > 0 && <span className="text-ui-xs text-texte-tertiaire">{etat.enAvance} commit(s) pas encore poussé(s)</span>}
              </div>

              {principale && (
                <p role="alert" className="m-0 rounded-md border border-bordure-erreur bg-fond-surface p-3 text-ui-s text-texte-erreur">
                  Tu es sur la branche principale ({etat.branche}) : pousser ici peut mettre le site en ligne tout de suite.
                </p>
              )}

              {rien ? (
                <p className="m-0 text-ui-s text-texte-secondaire">Rien à publier : tout est déjà poussé.</p>
              ) : (
                <>
                  {etat.fichiers.length > 0 && (
                    <div className="flex flex-col gap-1">
                      <span className="text-ui-xs font-medium text-texte-tertiaire">
                        {etat.fichiers.length} fichier{etat.fichiers.length > 1 ? "s" : ""} changé{etat.fichiers.length > 1 ? "s" : ""}
                      </span>
                      <ul className="m-0 flex max-h-[200px] list-none flex-col overflow-y-auto rounded-md border border-bordure-subtile p-1">
                        {etat.fichiers.map((f) => (
                          <li key={f.chemin} className="flex items-center gap-2 px-2 py-1 text-ui-xs">
                            <span className="w-16 shrink-0 text-texte-tertiaire">{STATUTS[f.statut] ?? f.statut}</span>
                            <span className="klyra-mono truncate text-texte-principal">{f.chemin}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {etat.fichiers.length > 0 && (
                    <label className="flex flex-col gap-2">
                      <span className="text-ui-s font-medium text-texte-principal">Ce qui change</span>
                      <Textarea
                        size="sm"
                        autoGrow
                        value={message}
                        placeholder="feat: nouvelle hero de la home"
                        onChange={(e) => setMessage(e.target.value)}
                        className={cn(CHAMP, "min-h-[64px]")}
                      />
                    </label>
                  )}
                  <div className="flex flex-wrap items-center gap-2">
                    <BoutonPrincipal
                      disabled={envoi || (etat.fichiers.length > 0 && !message.trim())}
                      onClick={() => void publier()}
                    >
                      {envoi ? "Envoi…" : etat.fichiers.length ? "Commit et push" : "Pousser"}
                    </BoutonPrincipal>
                    <span className="flex items-center gap-1 text-ui-2xs text-texte-tertiaire">
                      <Icon name="upload-01" size={14} />
                      vers {etat.distant ? etat.distant.replace(/^https:\/\/github\.com\//, "").replace(/\.git$/, "") : "aucun dépôt distant"}
                    </span>
                  </div>
                </>
              )}
            </>
          )
        )}
      </div>
    </div>
  );
}
