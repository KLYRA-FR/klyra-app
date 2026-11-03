import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/icons/Icon";
import { AgentVisuel } from "@/components/team/AgentVisuel";
import type { RoleTeinte } from "@/types/domain";

/**
 * Aperçu de l’app, dessiné avec ses vrais morceaux (icônes, visuels des agents,
 * tokens) : le rail, la liste des agents et une conversation. Décoratif, sans
 * interaction ; le texte qu’il contient est un exemple.
 */

const RAIL: IconName[] = ["accueil-ronds", "message-square", "layers-01", "projets-dossier", "calendar-01", "boutique-01"];

const AGENTS: { id: string; nom: string; role: string; teinte: RoleTeinte; actif?: boolean; travaille?: boolean }[] = [
  { id: "principal", nom: "Principal", role: "Ton assistant", teinte: "bleu-k1", actif: true },
  { id: "designer", nom: "Iris", role: "Design", teinte: "rose", travaille: true },
  { id: "dev", nom: "Hugo", role: "Développement", teinte: "vert-k2", travaille: true },
  { id: "redacteur", nom: "Olivier", role: "Rédaction", teinte: "ocre" },
  { id: "commercial", nom: "Thomas", role: "Ventes", teinte: "orange" },
];

function Avatar({ id, teinte, taille }: { id: string; teinte: RoleTeinte; taille: number }) {
  return (
    <span className="block shrink-0 overflow-hidden" style={{ width: taille, height: taille, borderRadius: Math.round(taille * 0.25) }}>
      <AgentVisuel agentId={id} teinte={teinte} />
    </span>
  );
}

function Bulle({ children }: { children: ReactNode }) {
  return <div className="ml-auto max-w-[78%] rounded-xl rounded-br-xs bg-fond-inverse px-3.5 py-2.5 text-ui-s leading-[1.45] text-texte-inverse">{children}</div>;
}

export function ApercuApp() {
  return (
    <div aria-hidden className="pointer-events-none select-none overflow-hidden rounded-xl border border-bordure-defaut bg-fond-surface text-left shadow-ombre-lg">
      {/* Barre de la fenêtre */}
      <div className="flex h-9 items-center gap-1.5 border-b border-bordure-subtile bg-fond-surface-douce px-3.5">
        <span className="size-2.5 rounded-full bg-gris-k2-500" />
        <span className="size-2.5 rounded-full bg-gris-k2-500" />
        <span className="size-2.5 rounded-full bg-gris-k2-500" />
        <span className="mx-auto text-ui-2xs text-texte-tertiaire">KLYRA</span>
      </div>

      <div className="flex h-[420px] sm:h-[460px]">
        {/* Rail */}
        <div className="hidden w-14 shrink-0 flex-col items-center gap-1.5 border-r border-bordure-subtile bg-fond-page py-3 sm:flex">
          <span className="mb-2 flex size-8 items-center justify-center rounded-sm bg-fond-accent text-ui-2xs font-semibold text-texte-inverse">K</span>
          {RAIL.map((nom, i) => (
            <span
              key={nom}
              className={`flex size-9 items-center justify-center rounded-md-moins ${i === 1 ? "bg-fond-surface-grise text-icone-defaut" : "text-icone-secondaire"}`}
            >
              <Icon name={nom} size={20} />
            </span>
          ))}
        </div>

        {/* Agents */}
        <div className="hidden w-56 shrink-0 flex-col border-r border-bordure-subtile p-3 md:flex">
          <p className="px-2 pb-2 text-ui-xs font-medium text-texte-tertiaire">Mes agents</p>
          {AGENTS.map((agent) => (
            <div key={agent.id} className={`flex items-center gap-2.5 rounded-md-moins px-2 py-1.5 ${agent.actif ? "bg-fond-survol" : ""}`}>
              <Avatar id={agent.id} teinte={agent.teinte} taille={30} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-ui-s font-medium">{agent.nom}</p>
                <p className="truncate text-ui-2xs text-texte-tertiaire">{agent.role}</p>
              </div>
              {agent.travaille && <span className="size-1.5 rounded-full bg-bleu-k1-500" />}
            </div>
          ))}
        </div>

        {/* Conversation */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex h-12 items-center gap-2.5 border-b border-bordure-subtile px-4">
            <Avatar id="principal" teinte="bleu-k1" taille={24} />
            <p className="text-ui font-medium">Principal</p>
            <span className="ml-auto flex items-center gap-1.5 rounded-sm bg-fond-surface-grise px-2 py-1 text-ui-2xs text-texte-secondaire">
              <Icon name="computer" size={14} />
              Ce PC
            </span>
          </div>

          <div className="flex flex-1 flex-col gap-4 overflow-hidden px-4 py-5">
            <Bulle>Prépare la page Tickets pour la démo de demain : la maquette, puis l’intégration.</Bulle>

            <div className="flex gap-2.5">
              <Avatar id="principal" teinte="bleu-k1" taille={24} />
              <div className="min-w-0 flex-1 space-y-2.5">
                <p className="text-ui-s leading-[1.5] text-texte-principal">
                  C’est lancé. Iris dessine l’écran, Hugo l’intègre dès qu’elle a fini. Je te préviens quand c’est à valider.
                </p>
                <div className="space-y-1.5">
                  {[
                    { agent: AGENTS[1], titre: "Maquette de la page Tickets", etape: "En cours" },
                    { agent: AGENTS[2], titre: "Intégrer la page Tickets", etape: "À faire" },
                  ].map(({ agent, titre, etape }) => (
                    <div key={titre} className="flex items-center gap-2.5 rounded-md border border-bordure-defaut bg-fond-surface px-3 py-2 shadow-ombre-xs">
                      <Avatar id={agent.id} teinte={agent.teinte} taille={20} />
                      <p className="min-w-0 flex-1 truncate text-ui-xs font-medium">{titre}</p>
                      <span
                        className={`rounded-sm px-1.5 py-0.5 text-ui-3xs font-medium ${etape === "En cours" ? "bg-fond-teinte-bleue text-texte-accent" : "bg-fond-surface-grise text-texte-secondaire"}`}
                      >
                        {etape}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Composeur */}
          <div className="p-3">
            <div className="flex items-center gap-2 rounded-xl border border-bordure-champ bg-fond-surface px-3 py-2.5 shadow-ombre-xs">
              <span className="text-icone-secondaire">
                <Icon name="paperclip" size={18} />
              </span>
              <span className="flex-1 text-ui-s text-texte-placeholder">Écris à Principal, @ pour un agent…</span>
              <span className="text-icone-secondaire">
                <Icon name="microphone-01" size={18} />
              </span>
              <span className="klyra-surface-sombre flex size-7 items-center justify-center rounded-xs text-texte-inverse">
                <Icon name="arrow-up" size={16} />
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
