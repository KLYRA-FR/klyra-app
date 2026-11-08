"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Icon } from "@/components/icons/Icon";
import { AgentRond } from "@/components/roles/AgentRond";
import { BoutonIcone } from "@/components/ui/Bouton";
import { PuceSelect, type PuceOption } from "@/components/ui/PuceSelect";
import { getBridge } from "@/lib/bridge";
import { garderBrouillon, lireBrouillons, prendreDemandeEcriture, surBrouillon } from "@/lib/brouillons";
import { cn } from "@/lib/cn";
import { estCaptureCollee } from "@/lib/collage";
import { estImage, nomFichier } from "@/lib/fichiers";
import { useCompteClaude } from "@/lib/compte-claude";
import { moteurDe, PAR_DEFAUT } from "@/lib/fournisseurs";
import { findMention } from "@/lib/mentions";
import { surRepondre } from "@/lib/repondre";
import { commandeEnCours, skillsDemandables, skillsProposees, type SkillProposee } from "@/lib/skills";
import { useFile, useRole, useRoles, useTravail, useWorkspace } from "@/lib/workspace";
import type { Chat, Citation, Project, Role, RoleId } from "@/types/domain";
import { PucesImages, VignettePiece } from "./ImageJointe";
import { PastilleExtension } from "./PastilleExtension";
import { PromptBox } from "./PromptBox";
import { nomChoixDepot, PuceDepot, useOuvrirChoixDepot } from "./PuceDepot";
import { contexteDe, useCompetencesAgent } from "./reglages-agent/donnees";
import { useAjoutFichiers } from "./useAjoutFichiers";
import { useSuggestion } from "./useSuggestion";

/** Les pièces jointes avant l'envoi : une vignette par image, une carte par autre fichier, avec la croix pour l'enlever. */
export function Pieces({ fichiers, onRetirer }: { fichiers: string[]; onRetirer: (chemin: string) => void }) {
  if (!fichiers.length) return null;
  return (
    <div className="flex flex-wrap gap-2">
      {fichiers.map((chemin) => {
        const nom = nomFichier(chemin);
        const croix = (
          <button
            type="button"
            onClick={() => onRetirer(chemin)}
            aria-label={`Retirer ${nom}`}
            className="klyra-surface-sombre absolute -top-1.5 -right-1.5 flex size-5 cursor-pointer items-center justify-center rounded-full border-2 border-fond-surface p-0 text-texte-inverse opacity-0 transition-opacity duration-[120ms] group-hover/piece:opacity-100 focus-visible:opacity-100"
          >
            <Icon name="x-01" size={10} />
          </button>
        );
        const carte = (
          <div
            key={chemin}
            title={estCaptureCollee(chemin) ? `${nom} · capture collée` : chemin}
            className="group/piece relative flex h-[52px] w-[220px] items-center gap-2.5 rounded-md border border-bordure-subtile bg-fond-surface py-2 pr-3 pl-2"
          >
            <PastilleExtension chemin={chemin} />
            <span className="min-w-0 truncate text-ui-xs font-medium text-texte-principal">{nom}</span>
            {croix}
          </div>
        );
        return estImage(chemin) ? <VignettePiece key={chemin} chemin={chemin} croix={croix} repli={carte} /> : carte;
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

/** La liste des compétences qui sort du haut du composeur quand le message commence par « / ». */
function ListeSkills({ skills, actif, onChoisir }: { skills: SkillProposee[]; actif: number; onChoisir: (skill: SkillProposee) => void }) {
  return (
    <div
      role="listbox"
      aria-label="Compétences"
      className="absolute right-0 bottom-full left-0 mb-2 max-h-[264px] overflow-y-auto rounded-lg border border-bordure-subtile bg-fond-surface p-1 shadow-ombre-flottante"
    >
      {skills.map((skill, i) => (
        <button
          key={skill.nom}
          type="button"
          role="option"
          aria-selected={i === actif}
          // mousedown : le champ garde le focus.
          onMouseDown={(e) => {
            e.preventDefault();
            onChoisir(skill);
          }}
          className={cn(
            "flex min-h-9 w-full cursor-pointer items-center gap-2.5 rounded-sm border-0 px-2 py-1.5 text-left",
            i === actif ? "bg-fond-survol" : "bg-transparent hover:bg-fond-survol",
          )}
        >
          <Icon name="layers-01" size={16} className="shrink-0 text-icone-accent" />
          <span className="shrink-0 text-ui-s font-medium text-texte-principal">/{skill.nom}</span>
          {skill.description && <span className="min-w-0 truncate text-ui-xs text-texte-tertiaire">{skill.description}</span>}
        </button>
      ))}
    </div>
  );
}

/** Le résumé de la conversation, proposé avec les compétences : une commande que l'app connaît. */
const COMPACTER: SkillProposee = { nom: "compact", description: "Résume la conversation pour alléger les prochains appels" };

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

/** Au-dessus du champ : le message d'agent auquel on répond, à retirer d'un clic. */
function BandeauReponse({ citation, onRetirer }: { citation: Citation; onRetirer: () => void }) {
  const role = useRole(citation.roleId);
  return (
    <div className="mb-1.5 flex items-start gap-2 rounded-lg border border-bordure-subtile bg-fond-surface-grise py-2 pr-1.5 pl-3">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="text-ui-2xs font-medium text-texte-tertiaire">Réponse à {role.name}</span>
        <span className="line-clamp-2 text-ui-xs leading-[1.45] text-texte-secondaire">{citation.extrait}</span>
      </div>
      <BoutonIcone variant="discret" taille="mini" icone={<Icon name="x-01" size={14} />} libelle="Ne plus répondre à ce message" onClick={onRetirer} />
    </div>
  );
}

/** Composeur sous le fil d'un chat. */
export function Composer({ chat, project }: { chat: Chat; project: Project | undefined }) {
  const roles = useRoles();
  const { sendMessage, arreter, startChat, state: etatEspace } = useWorkspace();
  const router = useRouter();
  const travail = useTravail(chat.id);
  // `?brouillon=…` : on arrive avec un message déjà prêt (ex. « Modifier avec un agent » depuis un artefact).
  const brouillon = useSearchParams().get("brouillon");
  const [text, setText] = useState(() => brouillon ?? lireBrouillons()[chat.id]?.text ?? "");
  const [to, setTo] = useState<RoleId | typeof AUTO>(AUTO);
  const [curseur, setCurseur] = useState(0);
  const [actif, setActif] = useState(0);
  const [fermee, setFermee] = useState(false);
  const champ = useRef<HTMLTextAreaElement>(null);
  const direct = chat.kind === "direct";
  /* Une conversation de projet a son agent, comme le chat d'un agent : pas de destinataire à choisir, @ pour en appeler un autre. */
  const projetConv = chat.kind === "equipe" && !!project;
  const agent = useRole(chat.roleIds[0] ?? "principal");
  /* Le chat d'un agent : la puce « Dépôt » ouvre, à l'envoi, une conversation de cet agent dans le projet choisi. */
  const avecDepot = direct && !chat.fil;
  const [depotChoisi, setDepotChoisi] = useState("");
  const [ouverture, setOuverture] = useState<string | null>(null);
  const ouvrirChoixDepot = useOuvrirChoixDepot();
  /* Quitter la conversation pendant le clone : la nouvelle conversation n'est pas ouverte dans son dos. */
  const monte = useRef(true);
  useEffect(() => {
    monte.current = true;
    return () => {
      monte.current = false;
    };
  }, []);
  const nomDepotChoisi = depotChoisi ? nomChoixDepot(depotChoisi, etatEspace.projects) : null;
  const assistant = useRole("principal");
  /* L'assistant seul, sans autre agent : il ne répartit rien, il répond. */
  const seul = roles.length <= 1;
  const bridge = getBridge();
  const { compte } = useCompteClaude();
  const deconnecte = !!compte && (!compte.installe || !compte.connecte);
  const [fichiers, setFichiers] = useState<string[]>(() => lireBrouillons()[chat.id]?.fichiers ?? []);
  /* Ce qui est écrit reste à cette conversation, même quand on passe à un autre onglet. */
  useEffect(() => {
    garderBrouillon(chat.id, { text, fichiers });
  }, [chat.id, text, fichiers]);

  /* Un début de message ajouté d'ailleurs (« Le décrire à Sam ») : focus, curseur à la fin, rien d'envoyé. */
  useEffect(() => {
    const placer = () =>
      requestAnimationFrame(() => {
        const el = champ.current;
        if (!el) return;
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      });
    if (prendreDemandeEcriture(chat.id)) placer();
    return surBrouillon(chat.id, (suite) => {
      prendreDemandeEcriture(chat.id);
      setText(suite);
      setCurseur(suite.length);
      placer();
    });
  }, [chat.id]);
  /* « Répondre » sous une réponse d'agent : le message auquel on répond, au-dessus du champ. */
  const [citation, setCitation] = useState<Citation | null>(null);
  useEffect(
    () =>
      surRepondre(chat.id, (c) => {
        setCitation(c);
        requestAnimationFrame(() => champ.current?.focus());
      }),
    [chat.id],
  );
  const [depot, setDepot] = useState(false);
  const [alerte, setAlerte] = useState<string | null>(null);
  const zone = useRef<HTMLDivElement>(null);

  const { ajouter, coller } = useAjoutFichiers(fichiers, setFichiers, setAlerte);
  /* La réponse suggérée en fin de réponse d'agent (texte fantôme, Tab l'insère). Pas avec des pièces jointes. */
  const suggestion = useSuggestion(chat.id, text);

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
      ajouter([...(e.dataTransfer?.files ?? [])].map((f) => bridge.fichiers.cheminDe(f)));
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
  }, [bridge, ajouter]);

  const joindre = async () => {
    if (!bridge) {
      setAlerte("Joindre des fichiers marche dans l’app de bureau.");
      return;
    }
    const r = await bridge.fichiers.choisir();
    if (r.ok) ajouter(r.data);
  };

  /* Compétences : « / » en tête du message, avec Claude comme avec ChatGPT (l'app donne à Codex les skills de
     Claude). Celles du poste et du projet et celles que sa fiche précharge, sauf celles que Réglages › Agents lui coupe.
     Le résumé de la conversation est une commande de Claude Code seulement. */
  const competences = useCompetencesAgent(agent.id, contexteDe(chat, project, agent.id));
  const avecClaude = moteurDe(chat) === PAR_DEFAUT;
  const commande = fermee ? null : commandeEnCours(text, curseur);
  const skillsAProposer = useMemo(() => {
    if (commande === null) return [];
    const dispo = competences.etat === "pret" ? skillsDemandables(competences.valeur) : [];
    return skillsProposees([...dispo.map((s) => ({ nom: s.nom, description: s.description })), ...(avecClaude ? [COMPACTER] : [])], commande);
  }, [commande, competences, avecClaude]);

  const choisirSkill = (skill: SkillProposee) => {
    const insere = `/${skill.nom} `;
    const suite = text.slice(curseur).replace(/^\S*/, "").replace(/^\s+/, "");
    setText(insere + suite);
    setCurseur(insere.length);
    requestAnimationFrame(() => champ.current?.setSelectionRange(insere.length, insere.length));
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
    if (skillsAProposer.length) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const pas = event.key === "ArrowDown" ? 1 : -1;
        setActif((a) => (a + pas + skillsAProposer.length) % skillsAProposer.length);
        return true;
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault();
        choisirSkill(skillsAProposer[Math.min(actif, skillsAProposer.length - 1)]);
        return true;
      }
      if (event.key === "Escape") {
        setFermee(true);
        return true;
      }
      return false;
    }
    if (!proposes.length) {
      // Échap retire la réponse en cours, sans toucher au texte.
      if (event.key === "Escape" && citation) {
        setCitation(null);
        return true;
      }
      return false;
    }
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
    if (ouverture) return;
    const recipient = direct ? null : to === AUTO ? findMention(text, roles) : to;
    const texte = text.trim() || (fichiers.length > 1 ? "Regarde ces fichiers." : "Regarde ce fichier.");
    if (avecDepot && depotChoisi) {
      /* Un dépôt choisi : une nouvelle conversation de cet agent dans le projet (le dépôt cloné d'abord s'il le faut). */
      const pieces = fichiers;
      setAlerte(null);
      setOuverture(nomDepotChoisi ?? "le dépôt");
      void ouvrirChoixDepot(depotChoisi, chat.lieu ?? null).then((r) => {
        if (!monte.current) return;
        setOuverture(null);
        if (!r.ok) return setAlerte(r.message);
        const id = startChat(r.projet.id, texte, agent.id, pieces);
        setCitation(null);
        setText("");
        setCurseur(0);
        setFichiers([]);
        setDepotChoisi("");
        router.push(`/chat?id=${encodeURIComponent(id)}`);
      });
      return;
    }
    sendMessage(chat.id, texte, recipient, fichiers, citation ?? undefined);
    setCitation(null);
    setText("");
    setCurseur(0);
    setFichiers([]);
    setAlerte(null);
  };

  /* Sans choix, le message va à l'agent de la conversation (le premier de `roleIds`, l'assistant d'ordinaire). */
  const recipientOptions: PuceOption<RoleId | typeof AUTO>[] = [
    { value: AUTO, label: agent.name, icone: <AgentRond roleId={agent.id} taille={20} /> },
    ...roles
      .filter((r) => r.id !== agent.id)
      .map((r) => ({ value: r.id, label: `${r.name} · ${r.tag}`, icone: <AgentRond roleId={r.id} taille={20} /> })),
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
        {skillsAProposer.length > 0 && <ListeSkills skills={skillsAProposer} actif={Math.min(actif, skillsAProposer.length - 1)} onChoisir={choisirSkill} />}
        {!skillsAProposer.length && proposes.length > 0 && <ListeMentions roles={proposes} actif={Math.min(actif, proposes.length - 1)} onChoisir={choisir} />}
        {citation && <BandeauReponse citation={citation} onRetirer={() => setCitation(null)} />}
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
          onColler={coller}
          aDesPieces={fichiers.length > 0}
          suggestion={suggestion.suggestion && !fichiers.length && !citation ? { texte: suggestion.suggestion, prendre: suggestion.prendre, ignorer: suggestion.ignorer } : null}
          pieces={<Pieces fichiers={fichiers} onRetirer={(c) => setFichiers((f) => f.filter((x) => x !== c))} />}
          apresTexte={fichiers.some(estImage) && <PucesImages fichiers={fichiers} />}
          placeholder={
            direct
              ? nomDepotChoisi
                ? `Nouvelle conversation avec ${agent.name} dans ${nomDepotChoisi}…`
                : `Écris à ${agent.name}…`
              : projetConv
                ? seul
                  ? `Écris à ${agent.name}…`
                  : `Écris à ${agent.name}, ou @mentionne un agent…`
                : seul
                  ? `Écris à ${assistant.name}…`
                  : "Écris à l’équipe, ou @mentionne un agent…"
          }
          puces={
            avecDepot ? (
              <PuceDepot lieu={chat.lieu ?? null} valeur={depotChoisi} onChange={setDepotChoisi} disabled={!!ouverture} />
            ) : direct || projetConv ? undefined : (
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
      {ouverture && (
        <p role="status" className="mt-2 mb-0 px-1 text-ui-2xs font-medium text-texte-secondaire">
          Ouverture de {ouverture}…
        </p>
      )}
      {deconnecte && (
        <p role="alert" className="mt-2 mb-0 flex flex-wrap items-center gap-x-2 px-1 text-ui-2xs font-medium text-texte-erreur">
          {compte?.installe ? "Claude n’est pas connecté : les agents ne pourront pas répondre." : "Claude Code est introuvable sur ce poste."}
          <Link href="/reglages" className="text-texte-principal underline underline-offset-2">
            Ouvrir les réglages
          </Link>
        </p>
      )}
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
            : `${seul ? `${assistant.name} te répond` : `Sans mention, ${assistant.name} répartit le travail`} · Entrée pour envoyer, Maj + Entrée pour aller à la ligne.`}
      </p>
    </div>
  );
}
