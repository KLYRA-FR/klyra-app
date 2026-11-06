"use client";

import { useRef, useState } from "react";
import { AGENT_PASTELS } from "@/data/agent-palettes";
import { fondCarte } from "@/components/team/AgentVisuel";
import { teinteNouvelAgent, useAgents } from "@/lib/agents";
import { annoncer } from "@/lib/annonces";
import { ficheAgent } from "@/lib/atelier-agent";
import { bilanEquipe, fusionnerChoix, identifiantsLibres, membresVus, type ChoixEquipe, type EtatEquipe, type MembreVu } from "@/lib/atelier-equipe";
import { eclatDePoints, envoler } from "@/lib/naissance-agent";
import { jouer } from "@/lib/sons/sons";
import { useWorkspace } from "@/lib/workspace";
import type { Role, RoleTeinte } from "@/types/domain";

/** Un membre tel que la carte le montre, avec son agent s'il est né. */
export type Membre = MembreVu & { agent: Role | null };

export type Creation = { type: "repos" } | { type: "creation"; faits: number; total: number } | { type: "erreur"; message: string };

/** Comment l'écran nomme un membre : son prénom, sinon « Sans prénom ». */
export const nomAffiche = (x: Pick<MembreVu, "nom">) => x.nom || "Sans prénom";

/**
 * La carte d'équipe affichée et ce que la personne y fait, le même dans le fil et dans l'atelier en
 * grand : ses choix sont notés sur l'appel affiché (`marquerEquipe`), la création écrit chaque fiche
 * gardée l'une après l'autre.
 */
export function useEquipe(etat: EtatEquipe, messageId: string, etapeId: string) {
  const { roles, create, identifiantLibre } = useAgents();
  const { marquerEquipe } = useWorkspace();
  const liste: Membre[] = membresVus(etat, roles, teinteNouvelAgent).map((x) => ({ ...x, agent: x.idCree ? (roles.find((r) => r.id === x.idCree) ?? null) : null }));
  const [creation, setCreation] = useState<Creation>({ type: "repos" });
  /** La face de chaque carte, pour l'éclat et l'envol à la naissance. */
  const faces = useRef(new Map<string, HTMLDivElement>());

  const bilan = bilanEquipe(etat, liste);
  const aCreer = bilan.aCreer as Membre[];
  const nes = bilan.nes as Membre[];
  const remplacee = bilan.remplacee && creation.type === "repos";
  const modifiable = !remplacee && !bilan.nee && !etat.provisoire && creation.type === "repos";

  const choisir = (c: ChoixEquipe) => marquerEquipe(messageId, etapeId, (p) => ({ choix: fusionnerChoix(p.choix, c) }));
  const teindre = (cle: string, t: RoleTeinte) => marquerEquipe(messageId, etapeId, (p) => ({ teintes: { ...(p.teintes ?? {}), [cle]: t } }));
  const ecarter = (cle: string, oui: boolean) =>
    marquerEquipe(messageId, etapeId, (p) => ({ ecartes: oui ? [...new Set([...(p.ecartes ?? etat.ecartes), cle])] : (p.ecartes ?? etat.ecartes).filter((c) => c !== cle) }));

  const creer = async () => {
    if (!modifiable || bilan.manques.length || !aCreer.length) return;
    const total = aCreer.length;
    setCreation({ type: "creation", faits: 0, total });
    // Un identifiant libre sur le poste pour chacun, et distinct de ceux que cette équipe prend.
    const ids = identifiantsLibres(aCreer.map((x) => x.m.cle), identifiantLibre);
    const nouveauxNes: { cle: string; id: string; teinte: RoleTeinte }[] = [];
    try {
      for (const [i, x] of aCreer.entries()) {
        const id = ids[i];
        await create(id, ficheAgent(x.fiche, id), { tag: x.fiche.role, teinte: x.teinte });
        // Noté à chaque naissance : une erreur plus loin garde ceux qui sont déjà là.
        marquerEquipe(messageId, etapeId, (p) => ({ crees: { ...(p.crees ?? {}), [x.m.cle]: id }, teintes: { ...(p.teintes ?? {}), [x.m.cle]: x.teinte } }));
        nouveauxNes.push({ cle: x.m.cle, id, teinte: x.teinte });
        jouer("atelier-etoile");
        setCreation({ type: "creation", faits: nouveauxNes.length, total });
      }
      setCreation({ type: "repos" });
      jouer("agent-ne");
      annoncer(`Équipe créée : ${aCreer.map(nomAffiche).join(", ")}. Ils rejoignent ton équipe.`);
      /* Un éclat sous chaque carte, puis chacun s'envole à sa place dans la barre, l'un après l'autre. */
      await Promise.all(
        nouveauxNes.map(async (n, i) => {
          await new Promise((r) => setTimeout(r, i * 160));
          const face = faces.current.get(n.cle);
          if (!face) return;
          const p = AGENT_PASTELS[n.teinte];
          eclatDePoints(face, ["#003fe4", "#3365e9", "#99b2f4", "#ccd9fa", p.accent, p.haut]);
          await new Promise((r) => setTimeout(r, 700));
          if (faces.current.get(n.cle)) await envoler(face, n.id, fondCarte(n.teinte));
        }),
      );
    } catch (e) {
      setCreation({ type: "erreur", message: e instanceof Error ? e.message : String(e) });
    }
  };

  return { liste, bilan, aCreer, nes, remplacee, modifiable, creation, creer, choisir, teindre, ecarter, faces };
}

export type Equipe = ReturnType<typeof useEquipe>;
