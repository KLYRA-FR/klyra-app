"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { MAX_FICHIERS, Pieces } from "@/components/chat/Composer";
import { PromptBox } from "@/components/chat/PromptBox";
import { Icon, type IconName } from "@/components/icons/Icon";
import { RoleAvatar } from "@/components/roles/RoleAvatar";
import { Bouton } from "@/components/ui/Bouton";
import { MaJournee } from "./MaJournee";
import { NommerAssistant } from "./NommerAssistant";
import { Stickers } from "./Stickers";
import { PuceSelect, type PuceOption } from "@/components/ui/PuceSelect";
import { useAgents } from "@/lib/agents";
import { getBridge } from "@/lib/bridge";
import { evenementsEquipeEntre } from "@/lib/agenda-equipe";
import { aujourdhui } from "@/lib/dates";
import { DEBUT_DEMANDE_AGENT } from "@/lib/decrire-a-assistant";
import { deuxiemeBloc, premierBloc } from "@/lib/mouvement";
import { findMention } from "@/lib/mentions";
import { idDirect, useProjects, useRole, useRoles, useWorkspace } from "@/lib/workspace";
import type { RoleId } from "@/types/domain";

const AUTO = "auto";

/** L'assistant seul : de quoi commencer. Chacune remplit le composeur, sans rien envoyer. */
const SUGGESTIONS_ASSISTANT: { libelle: string; texte: string; icone: IconName }[] = [
  { libelle: "Aide-moi à organiser ma semaine", texte: "Aide-moi à organiser ma semaine", icone: "calendar-01" },
  { libelle: "Résume ce document", texte: "Résume ce document", icone: "file-01" },
  { libelle: "Crée-moi un agent pour…", texte: DEBUT_DEMANDE_AGENT, icone: "users-profiles-plus" },
];

/** La seconde moitié du bonjour : un mot pour se lancer. */
const ENCOURAGEMENTS = [
  "une chose à la fois, et tout avance.",
  "on commence par la plus simple ?",
  "chaque rappel coché compte.",
  "belle journée pour avancer.",
  "l’équipe est là si tu as besoin.",
  "un petit pas maintenant, un grand soulagement ce soir.",
  "on s’y met ensemble ?",
];

/** Ce qui attend aujourd'hui, en une phrase : les rappels et les rendez-vous. */
function useResumeDuJour(): string {
  const { state } = useWorkspace();
  const cle = aujourdhui();
  const rappels = state.taches.filter((t) => !t.faite && t.date !== null && t.date <= cle).length;
  const demain = new Date();
  demain.setHours(24, 0, 0, 0);
  const rdv = [...state.evenements, ...evenementsEquipeEntre(new Date(), demain)].filter((e) => e.date === cle).length;
  if (!rappels && !rdv) return "Rien d’imposé aujourd’hui : la journée est à toi.";
  const morceaux = [
    rappels && `${rappels} rappel${rappels > 1 ? "s" : ""}`,
    rdv && `${rdv} rendez-vous`,
  ].filter(Boolean);
  return `Au programme : ${morceaux.join(" et ")}. Tu vas y arriver.`;
}

/** Accueil de l'IA : on écrit à l'assistant (ou à un agent), ou on part d'une suggestion. */
export function HomeScreen() {
  const router = useRouter();
  const { state, moi, startChat, sendMessage } = useWorkspace();
  const roles = useRoles();
  const assistant = useRole("principal");
  const { assistantANommer, status } = useAgents();
  /* L'assistant seul, sans autre agent : il ne répartit rien, il répond. */
  const seul = roles.length <= 1;
  const projects = useProjects();
  const promptRef = useRef<HTMLTextAreaElement>(null);

  /* Le nom vient d'être choisi (premier lancement) : l'Accueil revient, prêt à écrire à l'assistant. */
  const nommage = useRef(false);
  useEffect(() => {
    if (assistantANommer) nommage.current = true;
    else if (nommage.current) {
      nommage.current = false;
      promptRef.current?.focus();
    }
  }, [assistantANommer]);

  const [text, setText] = useState("");
  /* Une suggestion remplit le composeur, à la suite de ce qui est déjà écrit, curseur à la fin : on relit et on envoie. */
  const preRemplir = (debut: string) => {
    const avant = text.trimEnd();
    const suite = avant ? `${avant}\n${debut}` : debut;
    setText(suite);
    requestAnimationFrame(() => {
      const el = promptRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(suite.length, suite.length);
    });
  };
  /* Fichiers joints avec le trombone (app de bureau). */
  const [fichiers, setFichiers] = useState<string[]>([]);
  const joindre = async () => {
    const bridge = getBridge();
    if (!bridge) return;
    const r = await bridge.fichiers.choisir();
    if (r.ok) setFichiers((f) => [...new Set([...f, ...r.data])].slice(0, MAX_FICHIERS));
  };
  // Sans projet : la demande part en conversation directe (à l'assistant, ou à l'agent choisi).
  const [projectId, setProjectId] = useState("");
  // « Écrire à Hugo » depuis l'équipe arrive ici avec ?a=dev.
  const preselected = useSearchParams().get("a");
  const [to, setTo] = useState<RoleId | typeof AUTO>(
    roles.find((r) => r.id === preselected && r.id !== "principal")?.id ?? AUTO,
  );

  const submit = () => {
    const recipient = to === AUTO ? findMention(text, roles) : to;
    const message = text.trim() || (fichiers.length > 1 ? "Regarde ces fichiers." : "Regarde ce fichier.");
    if (!projectId) {
      const chatId = idDirect(recipient ?? "principal");
      sendMessage(chatId, message, null, fichiers);
      router.push(`/chat?id=${chatId}`);
      return;
    }
    const chatId = startChat(projectId, message, recipient, fichiers);
    router.push(`/chat?id=${chatId}`);
  };

  const recipientOptions: PuceOption<RoleId | typeof AUTO>[] = [
    {
      value: AUTO,
      label: seul ? assistant.name : `${assistant.name} · il répartit`,
      icone: <RoleAvatar roleId="principal" size="xs" />,
    },
    ...roles
      .filter((r) => r.id !== "principal")
      .map((r) => ({ value: r.id, label: `${r.name} · ${r.tag}`, icone: <RoleAvatar roleId={r.id} size="xs" /> })),
  ];

  const maintenant = new Date();
  const heure = maintenant.getHours();
  const salut = heure >= 18 ? "Bonsoir" : heure < 5 ? "Bonne nuit" : "Bonjour";
  /* Une phrase par jour, la même toute la journée. */
  const jourDeLAnnee = Math.floor((maintenant.getTime() - new Date(maintenant.getFullYear(), 0, 0).getTime()) / 86_400_000);
  const encouragement = ENCOURAGEMENTS[jourDeLAnnee % ENCOURAGEMENTS.length];
  const resume = useResumeDuJour();

  const date = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" }).format(new Date());

  /* Nouveau profil : d'abord le nom de l'assistant, à la place de l'Accueil. */
  if (assistantANommer) return <NommerAssistant />;

  return (
    <div className="flex h-full flex-col">
      <div className="@container min-h-0 flex-1 overflow-y-auto">
        {/* Le bonjour en haut, la journée juste en dessous. */}
        <div className="mx-auto flex w-full max-w-[960px] flex-col gap-4 px-5 pt-6 pb-4">
          {/* 1. Le bonjour, centré, entre les stickers de l’équipe à décoller. */}
          <section ref={premierBloc} aria-label="Bonjour" className="relative flex min-h-[220px] items-center justify-center">
            <header className="relative flex max-w-[52%] flex-col items-center gap-3 text-center">
              <span className="text-ui-s font-medium text-texte-tertiaire first-letter:uppercase">{date}</span>
              {/* Titre KLYRA : une partie en semi-gras, l'autre en regular, même couleur. */}
              <h1 className="m-0 text-h2 leading-[0.95] tracking-[-0.05em] text-balance text-texte-principal">
                <span className="font-semibold">
                  {salut} {moi.name},
                </span>{" "}
                <span className="font-normal">{encouragement}</span>
              </h1>
              <p className="m-0 text-ui text-texte-secondaire">{resume}</p>
            </header>
            <Stickers utilisateur={state.currentUser.id} />
          </section>

          {/* 2. La journée d'un coup d'œil : le planning et les rappels d'aujourd'hui. */}
          <section ref={deuxiemeBloc} aria-label="Ta journée" className="rounded-3xl border border-bordure-subtile bg-fond-page p-3">
            <MaJournee />
          </section>
        </div>
      </div>
      {/* La zone pour écrire, fixe en bas comme dans une conversation ; le reste défile au-dessus. */}
      <div className="shrink-0 px-5 pt-3 pb-4">
        {/* La même largeur que les blocs au-dessus. */}
        <div className="mx-auto w-full max-w-[960px]">
          {seul && status !== "chargement" && (
            <ul aria-label="Suggestions" className="m-0 mb-2.5 flex list-none flex-wrap gap-2 p-0">
              {SUGGESTIONS_ASSISTANT.map((s) => (
                <li key={s.libelle}>
                  <Bouton
                    variant="blanc"
                    taille="compact"
                    iconeGauche={<Icon name={s.icone} size={16} className="text-icone-secondaire" />}
                    onClick={() => preRemplir(s.texte)}
                  >
                    {s.libelle}
                  </Bouton>
                </li>
              ))}
            </ul>
          )}
          <PromptBox
            ref={promptRef}
            taille="grand"
            value={text}
            onChange={setText}
            onSubmit={submit}
            onJoindre={() => void joindre()}
            aDesPieces={fichiers.length > 0}
            pieces={<Pieces fichiers={fichiers} onRetirer={(c) => setFichiers((f) => f.filter((x) => x !== c))} />}
            placeholder={
              to === AUTO
                ? seul
                  ? `Écris à ${assistant.name}…`
                  : `Décris ce que tu veux faire : ${assistant.name} répartit le travail…`
                : `Écris à ${roles.find((r) => r.id === to)?.name ?? "l’agent"}…`
            }
            puces={
              <>
                <PuceSelect
                  libelle="Projet"
                  icone={<Icon name="folder" size={16} />}
                  options={[
                    { value: "", label: "Sans projet" },
                    ...projects.map((p) => ({ value: p.id, label: p.name })),
                  ]}
                  value={projectId}
                  onChange={setProjectId}
                />
                <PuceSelect
                  libelle="Écrire à qui ?"
                  icone={<RoleAvatar roleId={to === AUTO ? "principal" : to} size="xs" />}
                  options={recipientOptions}
                  value={to}
                  onChange={setTo}
                />
              </>
            }
          />
        </div>
      </div>
    </div>
  );
}
