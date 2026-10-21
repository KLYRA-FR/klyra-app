"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { PuceSelect, type PuceOption } from "@/components/ui/PuceSelect";
import { getBridge } from "@/lib/bridge";
import { cn } from "@/lib/cn";
import { findMention } from "@/lib/mentions";
import { useFile, useRole, useRoles, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat, Project, Role, RoleId } from "@/types/domain";
import { PastilleExtension } from "./PastilleExtension";
import { PromptBox } from "./PromptBox";

/** Pas plus de 10 fichiers par message. */
const MAX_FICHIERS = 10;

/** Les pièces jointes avant l'envoi : une carte par fichier, avec la croix pour l'enlever. */
function Pieces({ fichiers, onRetirer }: { fichiers: string[]; onRetirer: (chemin: string) => void }) {
  if (!fichiers.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {fichiers.map((chemin) => {
        const nom = chemin.split("/").pop() ?? chemin;
        return (
          <div
            key={chemin}
            title={chemin}
            className="group/piece relative flex h-[52px] w-[220px] items-center gap-2.5 rounded-md border border-bordure-subtile bg-fond-surface py-2 pr-3 pl-2"
          >
            <PastilleExtension chemin={chemin} />
            <span className="min-w-0 truncate text-ui-xs font-medium text-texte-principal">{nom}</span>
            <button
              type="button"
              onClick={() => onRetirer(chemin)}
              aria-label={`Retirer ${nom}`}
              className="klyra-surface-sombre absolute -top-1.5 -right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full border-2 border-fond-surface p-0 text-texte-inverse opacity-0 transition-opacity duration-[120ms] group-hover/piece:opacity-100 focus-visible:opacity-100"
            >
              <Icon name="x-01" size={10} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

const AUTO = "auto";

const normaliser = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

/** La mention en cours de frappe juste avant le curseur : « @hu » → « hu ». */
function mentionEnCours(texte: string, curseur: number): { debut: number; requete: string } | null {
  const m = texte.slice(0, curseur).match(/(^|\s)@([\p{L}-]*)$/u);
  if (!m) return null;
  return { debut: curseur - m[2].length - 1, requete: m[2] };
}

/** La liste des agents qui sort du haut du composeur quand on tape « @ ». */
function ListeMentions({
  roles,
  actif,
  onChoisir,
}: {
  roles: Role[];
  actif: number;
  onChoisir: (role: Role) => void;
}) {
  return (
    <div
      role="listbox"
      aria-label="Mentionner un agent"
      className="absolute right-0 bottom-full left-0 mb-2 max-h-[232px] overflow-y-auto rounded-lg border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-flottante"
    >
      {roles.map((role, i) => (
        <button
          key={role.id}
          type="button"
          role="option"
          aria-selected={i === actif}
          // mousedown : le champ garde le focus.
          onMouseDown={(e) => {
            e.preventDefault();
            onChoisir(role);
          }}
          className={cn(
            "flex h-9 w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 px-2 text-left",
            i === actif ? "bg-fond-survol" : "bg-transparent hover:bg-fond-survol",
          )}
        >
          <AgentRond roleId={role.id} taille={22} />
          <span className="text-ui-s font-medium text-texte-principal">{role.name}</span>
          <span className="truncate text-ui-xs text-texte-tertiaire">{role.title}</span>
          <span className="ml-auto shrink-0 text-ui-3xs text-texte-tertiaire">{role.tag}</span>
        </button>
      ))}
    </div>
  );
}

/** Les messages qui attendent que l'agent ait fini. */
function FileAttente({ chatId, roleId }: { chatId: string; roleId: RoleId }) {
  const file = useFile(chatId);
  const role = useRole(roleId);
  const { retirerDeLaFile } = useWorkspace();
  if (!file.length) return null;
  return (
    <div className="mb-2 flex flex-col gap-1 rounded-lg border border-bordure-subtile bg-fond-page p-2">
      <p className="m-0 px-1 text-ui-2xs text-texte-tertiaire">
        En attente : {file.length > 1 ? "ils partent" : "il part"} dès que {role.name} a fini.
      </p>
      {file.map((m) => (
        <div key={m.id} className="flex h-8 items-center gap-2 rounded-sm bg-fond-surface px-2.5">
          <Icon name="message-square" size={14} className="shrink-0 text-icone-secondaire" />
          <span className="truncate text-ui-s text-texte-principal">{m.text}</span>
          <button
            type="button"
            onClick={() => retirerDeLaFile(chatId, m.id)}
            className="ml-auto shrink-0 cursor-pointer rounded-2xs border-0 bg-transparent px-1.5 py-0.5 text-ui-xs text-texte-tertiaire hover:text-texte-principal"
          >
            Retirer
          </button>
        </div>
      ))}
    </div>
  );
}

/** Composeur sous le fil d'un chat. */
export function Composer({ chat, project }: { chat: Chat; project: Project | undefined }) {
  const roles = useRoles();
  const { sendMessage, arreter } = useWorkspace();
  const travail = useTravail(chat.id);
  const [text, setText] = useState("");
  const [to, setTo] = useState<RoleId | typeof AUTO>(AUTO);
  const [curseur, setCurseur] = useState(0);
  const [actif, setActif] = useState(0);
  const [fermee, setFermee] = useState(false);
  const champ = useRef<HTMLTextAreaElement>(null);
  const direct = chat.kind === "direct";
  const agent = useRole(chat.roleIds[0] ?? "principal");
  const bridge = getBridge();
  const [fichiers, setFichiers] = useState<string[]>([]);
  const [depot, setDepot] = useState(false);
  const [alerte, setAlerte] = useState<string | null>(null);
  const zone = useRef<HTMLDivElement>(null);

  const ajouter = (chemins: string[]) => {
    const tous = [...new Set([...fichiers, ...chemins.filter(Boolean)])];
    setAlerte(tous.length > MAX_FICHIERS ? `${MAX_FICHIERS} fichiers au plus par message.` : null);
    setFichiers(tous.slice(0, MAX_FICHIERS));
  };
  const ajouterRef = useRef(ajouter);
  useEffect(() => {
    ajouterRef.current = ajouter;
  });

  /* Glisser des fichiers sur toute la conversation (la section qui contient le composeur). */
  useEffect(() => {
    const section = zone.current?.closest("section");
    if (!section || !bridge) return;
    let profondeur = 0;
    const avecFichiers = (e: DragEvent) => !!e.dataTransfer?.types.includes("Files");
    const entrer = (e: DragEvent) => {
      if (!avecFichiers(e)) return;
      profondeur++;
      setDepot(true);
    };
    const sortir = () => {
      profondeur = Math.max(0, profondeur - 1);
      if (!profondeur) setDepot(false);
    };
    const survoler = (e: DragEvent) => {
      if (avecFichiers(e)) e.preventDefault();
    };
    const deposer = (e: DragEvent) => {
      if (!avecFichiers(e)) return;
      e.preventDefault();
      profondeur = 0;
      setDepot(false);
      ajouterRef.current([...(e.dataTransfer?.files ?? [])].map((f) => bridge.fichiers.cheminDe(f)));
    };
    section.addEventListener("dragenter", entrer);
    section.addEventListener("dragleave", sortir);
    section.addEventListener("dragover", survoler);
    section.addEventListener("drop", deposer);
    return () => {
      section.removeEventListener("dragenter", entrer);
      section.removeEventListener("dragleave", sortir);
      section.removeEventListener("dragover", survoler);
      section.removeEventListener("drop", deposer);
    };
  }, [bridge]);

  const joindre = async () => {
    if (!bridge) {
      setAlerte("Joindre des fichiers marche dans l’app de bureau.");
      return;
    }
    const r = await bridge.fichiers.choisir();
    if (r.ok) ajouter(r.data);
  };

  /* Mentions : seulement dans une conversation d'équipe. */
  const mention = direct || fermee ? null : mentionEnCours(text, curseur);
  const proposes = useMemo(() => {
    if (!mention) return [];
    const q = normaliser(mention.requete);
    return roles.filter((r) => [r.name, r.tag, r.id].some((n) => normaliser(n).startsWith(q))).slice(0, 7);
  }, [mention, roles]);

  const choisir = (role: Role) => {
    if (!mention) return;
    const avant = text.slice(0, mention.debut);
    const apres = text.slice(curseur);
    const insere = `@${role.name} `;
    setText(avant + insere + apres);
    const position = avant.length + insere.length;
    setCurseur(position);
    requestAnimationFrame(() => champ.current?.setSelectionRange(position, position));
  };

  const onToucheAvant = (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
    if (!proposes.length) return false;
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const pas = event.key === "ArrowDown" ? 1 : -1;
      setActif((a) => (a + pas + proposes.length) % proposes.length);
      return true;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      choisir(proposes[Math.min(actif, proposes.length - 1)]);
      return true;
    }
    if (event.key === "Escape") {
      setFermee(true);
      return true;
    }
    return false;
  };

  const submit = () => {
    const recipient = direct ? null : to === AUTO ? findMention(text, roles) : to;
    const texte = text.trim() || (fichiers.length > 1 ? "Regarde ces fichiers." : "Regarde ce fichier.");
    sendMessage(chat.id, texte, recipient, fichiers);
    setText("");
    setCurseur(0);
    setFichiers([]);
    setAlerte(null);
  };

  const recipientOptions: PuceOption<RoleId | typeof AUTO>[] = [
    { value: AUTO, label: "Principal" },
    ...roles.filter((r) => r.id !== "principal").map((r) => ({ value: r.id, label: `${r.name} · ${r.tag}` })),
  ];

  return (
    <div ref={zone} className="@container mx-auto w-full max-w-[880px] px-5 pt-1 pb-4">
      {/* Fichiers glissés au-dessus de la conversation. */}
      {depot && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-xl border border-dashed border-bleu-k1-500 bg-fond-surface/80 backdrop-blur-[3px]"
        >
          <span className="text-ui font-semibold text-texte-principal">Dépose tes fichiers pour les joindre</span>
        </div>
      )}
      {travail && <FileAttente chatId={chat.id} roleId={travail.roleId} />}
      <div className="relative">
        {proposes.length > 0 && <ListeMentions roles={proposes} actif={Math.min(actif, proposes.length - 1)} onChoisir={choisir} />}
        <PromptBox
          ref={champ}
          value={text}
          onChange={(v) => {
            setText(v);
            setFermee(false);
            setActif(0);
          }}
          onCurseur={setCurseur}
          onSubmit={submit}
          onToucheAvant={onToucheAvant}
          occupe={!!travail}
          onArreter={() => arreter(chat.id)}
          onJoindre={() => void joindre()}
          aDesPieces={fichiers.length > 0}
          pieces={<Pieces fichiers={fichiers} onRetirer={(c) => setFichiers((f) => f.filter((x) => x !== c))} />}
          placeholder={direct ? `Écris à ${agent.name}…` : "Écris à l’équipe, ou @mentionne un agent…"}
          puces={
            direct ? undefined : (
              <>
                <PuceSelect
                  libelle="Destinataire"
                  icone={<Icon name="users-profiles-01" size={16} />}
                  options={recipientOptions}
                  value={to}
                  onChange={setTo}
                />
                {/* Label gris du design system (k-label--gris) : le projet du chat.
                    Masqué quand la colonne est étroite : le panneau du projet le montre déjà. */}
                {project && (
                  <span className="hidden h-8 items-center gap-1.5 rounded-xs bg-fond-surface-grise px-2.5 text-ui-s font-medium text-texte-principal @lg:inline-flex">
                    <Icon name="folder" size={16} className="text-icone-secondaire" />
                    {project.name}
                  </span>
                )}
              </>
            )
          }
        />
      </div>
      {alerte && (
        <p role="alert" className="mt-2 mb-0 px-1 text-ui-2xs font-medium text-texte-erreur">
          {alerte}
        </p>
      )}
      <p className="mt-2 px-1 text-ui-2xs text-texte-tertiaire">
        {travail
          ? "Ton message attendra que l’agent ait fini · le carré l’arrête."
          : direct
            ? `${agent.name} travaille dans son propre dossier · Entrée pour envoyer, Maj + Entrée pour aller à la ligne.`
            : "Sans mention, le Principal répartit le travail · Entrée pour envoyer, Maj + Entrée pour aller à la ligne."}
      </p>
    </div>
  );
}
