"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RoleAvatar } from "@/components/roles/RoleAvatar";
import { Bouton } from "@/components/ui/Bouton";
import { BoutonPrincipal } from "@/components/ui/BoutonPrincipal";
import { DiffView } from "@/components/ui/DiffView";
import { Markdown } from "@/components/ui/Markdown";
import { useAgents } from "@/lib/agents";
import { BridgeError, getBridge, unwrap } from "@/lib/bridge";
import { consigne, lireProposition } from "@/lib/lou";
import { poste } from "@/lib/plateforme";
import type { Role } from "@/types/domain";
import { Bloc } from "./AgentDetail";

/** L'agent qui écrit les fiches : Lou, prompt engineer (`prompty`). */
const LOU = "prompty";

const IDEES = [
  "Resserre les règles : garde l’essentiel, enlève les répétitions.",
  "Ajoute une règle : il demande toujours une validation avant d’envoyer quoi que ce soit.",
  "Clarifie à quel moment l’appeler, et à quel moment appeler un collègue.",
];

type Etat =
  | { kind: "saisie" }
  | { kind: "travail"; requestId: string }
  | { kind: "proposition"; resume: string; fiche: string; cout?: number; avant: string; modifiedAt: number | null }
  | { kind: "erreur"; message: string };

/**
 * Modifier une fiche avec Lou : on décrit le changement, la vraie Lou (Claude
 * Code en local, sans droit d'écriture) propose la fiche réécrite, on voit
 * l'avant / après, et on applique, ajuste ou abandonne.
 */
export function LouPanel({ role }: { role: Role }) {
  const router = useRouter();
  const { roles, save } = useAgents();
  const bridge = getBridge();
  const [demande, setDemande] = useState("");
  const [etat, setEtat] = useState<Etat>({ kind: "saisie" });
  const [claudePath, setClaudePath] = useState<string | null | undefined>(undefined);
  const [application, setApplication] = useState<string | null>(null);
  const enCours = useRef<string | null>(null);

  const louInstallee = roles.some((r) => r.id === LOU && r.file);
  // La fiche telle qu'elle était quand on a demandé à Lou : c'est elle qu'on compare et qu'on remplace.
  const avant = etat.kind === "proposition" ? etat.avant : (role.file?.content ?? "");
  const modifiedAt = etat.kind === "proposition" ? etat.modifiedAt : (role.file?.modifiedAt ?? null);
  // Après une proposition, « Ajuster » repart de la version proposée.
  const base = etat.kind === "proposition" ? etat.fiche : avant;

  useEffect(() => {
    if (!bridge) return;
    void bridge.claude.status().then((r) => setClaudePath(r.ok ? r.data.path : null));
    // Annule la demande en cours si on quitte l'écran.
    return () => {
      if (enCours.current) void bridge.claude.cancel(enCours.current);
    };
  }, [bridge]);

  const demander = async () => {
    if (!bridge || !demande.trim()) return;
    const requestId = crypto.randomUUID();
    enCours.current = requestId;
    setEtat({ kind: "travail", requestId });
    try {
      const resultat = unwrap(await bridge.claude.run(requestId, LOU, consigne(role, base, demande.trim())));
      if (!resultat.ok) throw new Error(resultat.error ?? "Lou n’a pas pu répondre.");
      const { resume, fiche } = lireProposition(resultat.text, role);
      setEtat({ kind: "proposition", resume, fiche, cout: resultat.costUsd, avant, modifiedAt });
      setDemande("");
    } catch (e) {
      setEtat({ kind: "erreur", message: e instanceof Error ? e.message : String(e) });
    } finally {
      enCours.current = null;
    }
  };

  const annuler = () => {
    if (etat.kind === "travail") void bridge?.claude.cancel(etat.requestId);
  };

  const appliquer = async () => {
    if (etat.kind !== "proposition") return;
    setApplication("Application…");
    try {
      await save(role.id, etat.fiche, { tag: role.tag, teinte: role.teinte }, etat.modifiedAt);
      router.push(`/equipe?agent=${role.id}`);
    } catch (e) {
      setApplication(
        e instanceof BridgeError && e.code === "conflit"
          ? "La fiche a changé sur le disque pendant que Lou travaillait. Relance la demande sur la nouvelle version."
          : `L’application a échoué : ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  /* Ce qui empêche de demander à Lou, dit clairement. */
  const blocage = !bridge
    ? `Lou travaille dans l’app de bureau : ouvre KLYRA sur ${poste.ton} pour lui demander une modification.`
    : claudePath === null
      ? "Claude Code est introuvable sur ce poste. Installe-le (extension VS Code, ou « npm install -g @anthropic-ai/claude-code »), puis rouvre cet écran."
      : !louInstallee
        ? "Lou n’est pas dans tes agents. Ajoute-la depuis Équipe › Bibliothèque KLYRA (Modèles KLYRA), puis reviens ici."
        : null;

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex max-w-[960px] flex-col gap-6 px-8 pt-8 pb-12">
        <header className="flex items-center gap-4">
          <RoleAvatar roleId={LOU} size="lg" />
          <div className="flex flex-col gap-1">
            <h1 className="m-0 text-h2 leading-[1] tracking-[-0.05em] text-texte-principal">
              <span className="font-semibold">Modifier {role.name}</span> <span className="font-normal">avec Lou</span>
            </h1>
            <p className="m-0 text-ui text-texte-secondaire">
              Lou est l’agent qui écrit les consignes de l’équipe. Dis-lui en une phrase ce qui doit changer dans la fiche de{" "}
              {role.name} : elle la réécrit, tu compares l’avant et l’après, et rien n’est enregistré sans ton accord.
            </p>
          </div>
        </header>

        {blocage ? (
          <p role="status" className="m-0 rounded-md border border-bordure-subtile bg-fond-page p-4 text-ui text-texte-secondaire">
            {blocage}
          </p>
        ) : (
          <Bloc titre={etat.kind === "proposition" ? "Ajuster la proposition" : "Ce qui doit changer"}>
            <textarea
              value={demande}
              onChange={(e) => setDemande(e.target.value)}
              rows={4}
              disabled={etat.kind === "travail"}
              placeholder={`Ex. « ${role.name} doit aussi s’occuper des tests de bout en bout. »`}
              className="w-full resize-y rounded-md border border-bordure-champ bg-fond-surface px-3 py-2.5 font-[inherit] text-ui leading-[1.5] text-texte-principal outline-none focus:border-focus disabled:opacity-60"
            />
            {etat.kind === "saisie" && (
              <div className="flex flex-wrap gap-1.5">
                {IDEES.map((idee) => (
                  <button
                    key={idee}
                    type="button"
                    onClick={() => setDemande(idee)}
                    className="cursor-pointer rounded-sm border border-bordure-subtile bg-fond-page px-2.5 py-1 text-left text-ui-xs text-texte-secondaire hover:border-bordure-forte hover:text-texte-principal"
                  >
                    {idee}
                  </button>
                ))}
              </div>
            )}
            <div className="flex items-center gap-2">
              {etat.kind === "travail" ? (
                <>
                  <span className="flex-1 text-ui-s text-texte-tertiaire" aria-live="polite">
                    Lou lit la fiche et prépare sa proposition. Ça prend en général une à deux minutes.
                  </span>
                  <Bouton variant="blanc" taille="compact" onClick={annuler}>
                    Annuler
                  </Bouton>
                </>
              ) : (
                <>
                  <span className="flex-1 text-ui-xs text-texte-tertiaire">
                    Lou tourne en local avec ton compte Claude, sans droit d’écriture.
                  </span>
                  <Bouton variant="sombre" taille="compact" disabled={!demande.trim()} onClick={() => void demander()}>
                    {etat.kind === "proposition" ? "Redemander à Lou" : "Demander à Lou"}
                  </Bouton>
                </>
              )}
            </div>
          </Bloc>
        )}

        {etat.kind === "erreur" && (
          <p role="alert" className="m-0 rounded-md border border-bordure-erreur bg-fond-surface p-4 text-ui text-texte-erreur">
            {etat.message}
          </p>
        )}

        {etat.kind === "proposition" && (
          <>
            {etat.resume && (
              <Bloc titre="Ce que Lou a changé">
                <Markdown source={etat.resume} />
              </Bloc>
            )}
            <Bloc titre="Avant / après">
              <DiffView before={etat.avant} after={etat.fiche} />
            </Bloc>
            <div className="flex items-center gap-3">
              <span className="flex-1 text-ui-s text-texte-tertiaire">
                {application ?? "L’ancienne version reste dans l’historique."}
                {etat.cout !== undefined && !application && ` · coût de la demande : ${etat.cout.toFixed(2)} $`}
              </span>
              <Bouton variant="blanc" taille="md" onClick={() => setEtat({ kind: "saisie" })}>
                Abandonner
              </Bouton>
              <BoutonPrincipal onClick={() => void appliquer()}>Appliquer</BoutonPrincipal>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
