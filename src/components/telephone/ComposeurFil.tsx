"use client";

import { useEffect, useImperativeHandle, useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent, type Ref } from "react";
import { EFFORTS, MODELES, nomModele } from "@/components/chat/ChoixModele";
import { getField, parseAgentFile } from "@/lib/agent-file";
import { Icon } from "@/components/icons/Icon";
import { BoutonIcone } from "@/components/ui/Bouton";
import { garderBrouillon, lireBrouillons, surBrouillon } from "@/lib/brouillons";
import { cn } from "@/lib/cn";
import { messageErreur } from "@/lib/compte";
import { COMMANDE_COMPACTER, formaterJetons, MARGE_PLUS_TARD } from "@/lib/contexte";
import type { Activite } from "@/lib/copie-compte";
import { useGestePoste, useLecturePoste } from "@/lib/poste/client";
import { bandeauComposeur, majuscule, support } from "@/lib/poste-texte";
import { lieuDeHote, lireIdDirect, nomLieu, useServeursRelies } from "@/lib/lieux";
import { surRepondre } from "@/lib/repondre";
import { jetonAppareil, lireEquipeServeur } from "@/lib/serveur-vps";
import { commandeEnCours, skillsProposees, type SkillProposee } from "@/lib/skills";
import { ASSISTANT, conseilDuFil, mentionDans, mentionEnCours, type ConversationLue } from "@/lib/telephone/chats";
import { garderCitation, lireCitation, type CitationBrouillon } from "@/lib/telephone/citation";
import { useEnvoyerMessage } from "@/lib/telephone/envoi";
import { envoiSimple, voieEnvoi } from "@/lib/telephone/vps-direct";
import { lireModele, type OptionsMessage } from "@/lib/telephone/options";
import { agentPourLibelle } from "@/lib/telephone/libelles-fil";
import type { FicheLue } from "@/lib/telephone/gestes-agents";
import { ajouterPieces, MAX_PIECES, nomCapture, taillePiece, texteParDefaut } from "@/lib/telephone/pieces";
import { useAnnonce } from "./Annonce";
import { useHorsLigne } from "./BandeauReseau";
import { CocheChoix } from "./Controles";
import { Feuille, MenuFeuille } from "./Feuille";
import { GroupeListe, LigneListe } from "./Liste";
import { usePostes, useSupport } from "./poste";
import { RondAgent, useCartes } from "./AgentsChat";

/* Une puce : 36 px à voir, 44 px à toucher. */
const PUCE =
  "relative flex h-9 shrink-0 items-center gap-1 rounded-xs border border-bordure-subtile bg-fond-surface px-2.5 text-ui text-texte-principal after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']";

type Choix = { modele: string | null; effort: string | null };

const COMPACTER: SkillProposee = { nom: "compact", description: "Résume la conversation pour alléger les prochains appels" };

function libelleModele(choix: Choix | null): string {
  if (!choix?.modele) return "Modèle de la fiche indisponible";
  const nom = nomModele(choix.modele);
  const effort = choix.modele !== "haiku" ? EFFORTS.find((e) => e.id === choix.effort)?.nom : undefined;
  return effort ? `${nom} · ${effort}` : nom;
}

/** Lecture d’affichage : même fiche que l’écran Agent, ou équipe du VPS du fil ; aucun choix d’envoi. */
function useModeleFiche(agent: string, lieu: string | null, actif: boolean): string | null {
  const lecture = useLecturePoste<FicheLue>("agents.fiche", actif && !lieu ? { id: agent } : null);
  const [vps, setVps] = useState<{ cle: string; modele: string } | null>(null);
  const cle = `${lieu}|${agent}`;
  useEffect(() => {
    if (!actif || !lieu) return;
    const controle = new AbortController();
    void lireEquipeServeur(lieu, controle.signal).then((equipe) => {
      if (!equipe || controle.signal.aborted) return;
      const fiche = equipe.fiches.find((f) => f.name === agent);
      if (agent !== ASSISTANT && !fiche) return;
      setVps({ cle, modele: fiche ? (getField(parseAgentFile(fiche.content).frontmatter, "model") || "inherit") : "inherit" });
    }).catch(() => undefined);
    return () => controle.abort();
  }, [actif, lieu, agent, cle]);
  const fiche = lecture.etat === "ok" ? lecture.data : lecture.etat === "ferme" ? lecture.gardee?.data : null;
  const modele = lieu ? (vps?.cle === cle ? vps.modele : null) : fiche ? (fiche.type === "agent" ? (getField(parseAgentFile(fiche.contenu).frontmatter, "model") || "inherit") : "inherit") : null;
  /* Comme le choix effectif du bureau : une fiche sans modèle hérite d’Opus. */
  return modele === "inherit" ? "opus" : (MODELES.find((m) => modele?.includes(m.id))?.id ?? modele);
}

/** « Modèle et effort » en feuille (E2-34) : ils partent avec le prochain message ; fermer annule le choix provisoire. */
function FeuilleModele({ actuel, onChoisir, onFermer }: { actuel: Choix | null; onChoisir: (choix: Choix) => void; onFermer: () => void }) {
  const [choix, setChoix] = useState<Choix>(actuel ?? { modele: null, effort: null });
  const radio = "flex min-h-12 w-full items-center gap-3 border-b border-bordure-subtile text-left text-body-s text-texte-principal last:border-b-0";
  return (
    <Feuille
      titre="Modèle et effort"
      sousTitre="Pour cette conversation"
      onFermer={onFermer}
      pied={
        <button
          type="button"
          className="klyra-surface-sombre h-11 w-full rounded-xs text-body-s text-texte-inverse"
          onClick={() => {
            onFermer();
            onChoisir(choix);
          }}
        >
          Choisir
        </button>
      }
    >
      <div role="radiogroup" aria-label="Modèle">
        <button type="button" role="radio" aria-checked={!choix.modele} className={radio} onClick={() => setChoix({ modele: null, effort: null })}>
          <span className="min-w-0 flex-1 py-1.5">
            Celui de sa fiche
            <span className="block text-ui-xs text-texte-secondaire">Le modèle choisi dans sa fiche</span>
          </span>
          <CocheChoix choisi={!choix.modele} />
        </button>
        {MODELES.map((m) => (
          <button
            key={m.id}
            type="button"
            role="radio"
            aria-checked={choix.modele === m.id}
            className={radio}
            onClick={() => setChoix((c) => ({ modele: m.id, effort: m.id === "haiku" ? null : (c.effort ?? "high") }))}
          >
            <span className="min-w-0 flex-1 py-1.5">
              {m.nom}
              {m.id === "haiku" ? <span className="block text-ui-xs text-texte-secondaire">Sans réglage d’effort</span> : null}
            </span>
            <CocheChoix choisi={choix.modele === m.id} />
          </button>
        ))}
      </div>
      {choix.modele && choix.modele !== "haiku" ? (
        <>
          <p className="mt-4 text-ui font-medium text-texte-secondaire">Effort de réflexion</p>
          <div role="radiogroup" aria-label="Effort" className="mt-2 grid grid-cols-3 gap-2">
            {EFFORTS.map((e) => (
              <button
                key={e.id}
                type="button"
                role="radio"
                aria-checked={choix.effort === e.id}
                onClick={() => setChoix((c) => ({ ...c, effort: e.id }))}
                className={cn("h-11 rounded-xs text-ui font-medium", choix.effort === e.id ? "klyra-surface-sombre text-texte-inverse" : "bg-fond-surface-grise text-texte-secondaire")}
              >
                {e.nom}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <p className="mt-4 text-ui-xs text-texte-secondaire">Le choix part avec ton prochain message.</p>
    </Feuille>
  );
}

interface Suggestion {
  cle: string;
  nom: string;
  detail: string;
  visuel?: React.ReactNode;
}

/** La liste au-dessus du champ (E2-31, E2-32) : au doigt ou au clavier, sans jamais envoyer ; le clavier du téléphone reste ouvert. */
function ListeSuggestion({ libelle, suggestions, actif, aide, onChoisir }: { libelle: string; suggestions: Suggestion[]; actif: number; aide?: string | null; onChoisir: (s: Suggestion) => void }) {
  return (
    <div className="absolute inset-x-0 bottom-full z-10 mb-2 max-h-[40vh] overflow-y-auto rounded-xl border border-bordure-subtile bg-fond-surface py-1 shadow-ombre-levee">
      {aide ? <p className="px-3.5 py-2.5 text-ui text-texte-secondaire">{aide}</p> : null}
      {suggestions.length ? (
        <ul role="listbox" aria-label={libelle} id="composeur-suggestions">
          {suggestions.map((s, i) => (
            <li key={s.cle} role="option" aria-selected={i === actif} id={`composeur-suggestion-${i}`}>
              <button
                type="button"
                /* Le champ garde le focus : le clavier ne se ferme pas au toucher. */
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onChoisir(s)}
                className={cn("flex min-h-12 w-full items-center gap-2.5 px-3.5 py-1.5 text-left", i === actif && "bg-fond-survol")}
              >
                {s.visuel}
                <span className="truncate text-body-s text-texte-principal">{s.nom}</span>
                <span className="min-w-0 truncate text-ui-xs text-texte-secondaire">{s.detail}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Le conseil de contexte au-dessus du composeur (E2-42) : la mesure copiée, jamais pendant une réponse, « Plus tard » retenu ici. */
const cleMasque = (origine: string) => `klyra-telephone-contexte-${origine}`;

function ConseilFil({ conversation, origine, occupe, onResumer, onNouveauFil }: { conversation: ConversationLue | undefined; origine: string; occupe: boolean; onResumer: () => void; onNouveauFil: () => void }) {
  const { nom } = useCartes();
  const [masque, setMasque] = useState(() => {
    if (typeof window === "undefined") return 0;
    return Number(localStorage.getItem(cleMasque(origine))) || 0;
  });
  const [maintenant] = useState(() => Date.now());
  const conseil = conseilDuFil(conversation, { maintenant, masque, occupe });
  if (!conseil) return null;
  const qui = nom(conseil.roleId);
  const taille = formaterJetons(conseil.jetons);
  const constat = conseil.cacheExpire
    ? `Pause de plus d’une heure : ton prochain message ici fera relire ${taille} jetons à ${qui}, au prix fort.`
    : `${qui} relit ${taille} jetons à chaque étape de cette conversation.`;
  return (
    <div role="status" className="mb-2 rounded-xl bg-fond-surface-grise px-3 py-2.5">
      <p className="text-ui text-texte-principal">
        {constat} <span className="text-texte-secondaire">{conseil.raison === "lourde" ? "Pour continuer ici, un résumé allège la suite." : conseil.filPossible ? "Pour un nouveau sujet, un fil neuf repart léger." : ""}</span>
      </p>
      <div className="mt-1 flex flex-wrap justify-end gap-1">
        <button
          type="button"
          className="flex h-11 items-center rounded-xs px-3 text-ui font-medium text-texte-principal"
          onClick={() => {
            const suite = conseil.jetons + MARGE_PLUS_TARD;
            setMasque(suite);
            try {
              localStorage.setItem(cleMasque(origine), String(suite));
            } catch {
              /* stockage indisponible : le conseil reviendra à la prochaine ouverture */
            }
          }}
        >
          Plus tard
        </button>
        {conseil.filPossible && conseil.raison === "pause" ? (
          <button type="button" className="flex h-11 items-center rounded-xs bg-fond-surface px-3 text-ui font-medium text-texte-principal" onClick={onNouveauFil}>
            Nouveau fil
          </button>
        ) : null}
        {conseil.raison === "lourde" ? (
          <button type="button" className="flex h-11 items-center rounded-xs bg-fond-surface px-3 text-ui font-medium text-texte-principal" onClick={onResumer}>
            Résumer la conversation
          </button>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Le composeur du fil (§ 2, E2-29 à E2-35), au bas de la zone visible : une carte comme au bureau, le
 * champ (16 px, jusqu'à 40 % de la hauteur visible), puis joindre, destinataire, @, modèle, Arrêter et
 * Envoyer. L'envoi passe par `useEnvoyerMessage` (File). Le brouillon et sa citation restent sur ce téléphone,
 * par conversation ; un envoi refusé garde tout. Choisir une suggestion ou une option n'envoie jamais rien.
 */
export function ComposeurFil({
  origine,
  conversation,
  equipe,
  nouveauProjet,
  agentId,
  activite,
  resumeAttendu = false,
  onNouveauFil,
  poignee,
}: {
  /** Un `/compact` attend sa réponse : le conseil se tait, un second appui le renverrait (§ 8). */
  resumeAttendu?: boolean;
  /** Pour ouvrir « Modèle et effort » depuis les Détails (E2-45). */
  poignee?: Ref<{ ouvrirModele: () => void }>;
  origine: string;
  conversation: ConversationLue | undefined;
  equipe: boolean;
  nouveauProjet: string | null;
  agentId: string | null;
  activite: Activite | null;
  onNouveauFil?: () => void;
}) {
  const envoyer = useEnvoyerMessage();
  const annoncer = useAnnonce();
  const horsLigne = useHorsLigne();
  const { postes, principal, ouvert } = usePostes();
  const sur = useSupport();
  const { cartes, nom } = useCartes();
  const arret = useGestePoste();
  const [texte, setTexte] = useState(() => (typeof window === "undefined" ? "" : (lireBrouillons()[origine]?.text ?? "")));
  const [citation, setCitation] = useState<CitationBrouillon | null>(() => (typeof window === "undefined" ? null : lireCitation(origine)));
  const [pieces, setPieces] = useState<File[]>([]);
  const [alerte, setAlerte] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [deposees, setDeposees] = useState(0);
  /* L'arrêt demandé ne vaut que tant que l'agent travaille : dès que l'état reçu change, il ne s'affiche plus. */
  const [arretDemande, setArretDemande] = useState(false);
  /* « Résumer » touché : une seule fois, le temps que la demande apparaisse dans la file du compte. */
  const [resumeLance, setResumeLance] = useState(false);
  const [destinataire, setDestinataire] = useState<string | null>(null);
  const [choix, setChoix] = useState<Choix | null>(null);
  const [posteChoisi, setPosteChoisi] = useState<string | null>(null);
  const [feuille, setFeuille] = useState<"joindre" | "destinataire" | "modele" | "poste" | null>(null);
  const [curseur, setCurseur] = useState(0);
  const [actif, setActif] = useState(0);
  const [listeFermee, setListeFermee] = useState(false);
  useImperativeHandle(poignee, () => ({ ouvrirModele: () => setFeuille("modele") }), []);
  /* La réponse arrivée, le conseil peut revenir s'il reste justifié. */
  const [attenduAvant, setAttenduAvant] = useState(resumeAttendu);
  if (attenduAvant !== resumeAttendu) {
    setAttenduAvant(resumeAttendu);
    if (!resumeAttendu && resumeLance) setResumeLance(false);
  }
  const champ = useRef<HTMLTextAreaElement>(null);
  const photo = useRef<HTMLInputElement>(null);
  const camera = useRef<HTMLInputElement>(null);
  const fichier = useRef<HTMLInputElement>(null);

  /* Le brouillon, gardé par conversation sur ce téléphone (pas partagé entre appareils). */
  useEffect(() => {
    garderBrouillon(origine, { text: texte, fichiers: [] });
  }, [origine, texte]);
  useEffect(() => {
    garderCitation(origine, citation);
  }, [origine, citation]);

  const poserFocus = (position?: number) =>
    requestAnimationFrame(() => {
      const el = champ.current;
      el?.focus();
      if (position !== undefined) {
        el?.setSelectionRange(position, position);
        setCurseur(position);
      }
    });

  /* Une suggestion de l'accueil, un passage cité, un envoi annulé s'ajoutent au brouillon : focus, curseur à la fin, rien n'est envoyé. */
  useEffect(
    () =>
      surBrouillon(origine, (suite) => {
        setTexte(suite);
        poserFocus(suite.length);
      }),
    [origine],
  );
  /* « Répondre » : la citation au-dessus du champ, retirable, sans toucher au texte. */
  useEffect(
    () =>
      surRepondre(origine, (c) => {
        setCitation(c);
        poserFocus();
      }),
    [origine],
  );
  /* Le champ grandit avec le texte jusqu'à 40 % de la hauteur visible, puis défile. */
  useEffect(() => {
    const el = champ.current;
    if (!el) return;
    el.style.height = "auto";
    const plafond = (window.visualViewport?.height ?? window.innerHeight) * 0.4;
    el.style.height = `${Math.min(el.scrollHeight, plafond)}px`;
  }, [texte]);

  const occupe = ouvert && !!activite && activite.etat !== "question";
  const arretEnCours = arretDemande && occupe;

  const peutEnvoyer = (texte.trim().length > 0 || pieces.length > 0) && !envoi && !horsLigne;
  const actifs = (cartes ?? []).filter((c) => c.actif || c.origine === ASSISTANT);
  const modeleActuel = choix ?? lireModele(conversation?.modele);
  const postesOuverts = [...(postes ?? [])].sort((a, b) => b.dernierSignal - a.dernierSignal);
  const posteVise = postesOuverts.find((p) => p.cle === posteChoisi) ?? postesOuverts[0];
  /* La destination est celle de la conversation, indépendamment des ordinateurs ouverts (`envoi.ts`). */
  const serveurs = useServeursRelies();
  /* Une conversation directe pas encore copiée dans le compte : son id dit son serveur. */
  const hote = lireIdDirect(origine)?.hote;
  const lieu = conversation ? (conversation.lieu ?? null) : hote ? lieuDeHote(hote) : null;
  const directVps = !!lieu && origine.startsWith("dm-") && envoiSimple({ citation }, pieces.length);
  const voie = voieEnvoi({ lieu, jeton: lieu ? jetonAppareil(lieu) : null });
  const bandeau = directVps
    ? voie === "vps"
      ? `Ton message part directement à ${nomLieu(lieu, serveurs)}.`
      : "Ce téléphone n’est plus relié à ce VPS : relie-le dans Plus › Serveurs."
    : ouvert ? null : bandeauComposeur(principal);
  /* Le destinataire effectif : le choix explicite, sinon la première mention reconnue, sinon l'assistant (E2-33). */
  const effectif = destinataire ?? mentionDans(texte, cartes ?? []) ?? ASSISTANT;
  const agentAffiche = equipe ? effectif : (agentPourLibelle(origine, conversation) ?? agentId ?? ASSISTANT);
  const modeleFiche = useModeleFiche(agentAffiche, lieu, !modeleActuel?.modele);
  const modeleAffiche = modeleActuel?.modele ? modeleActuel : modeleFiche ? { modele: modeleFiche, effort: modeleActuel?.effort ?? "high" } : null;

  /* La liste « @ » (équipe) ou « / » (E2-31, E2-32). */
  const mention = equipe ? mentionEnCours(texte, curseur) : null;
  const commande = commandeEnCours(texte, curseur);
  const agentCompetences = agentId ?? (effectif || ASSISTANT);
  const competences = useLecturePoste<{ skills: SkillProposee[]; avecClaude: boolean }>("fil.competences", commande !== null && conversation ? { conversation: origine, agent: agentCompetences } : null);
  const donneesCompetences = competences.etat === "ok" ? competences.data : competences.etat === "ferme" ? (competences.gardee?.data ?? null) : null;
  const suggestions: Suggestion[] = listeFermee
    ? []
    : mention
      ? actifs
          .filter((c) => c.nom.toLowerCase().includes(mention.requete.toLowerCase()))
          .slice(0, 8)
          .map((c) => ({ cle: c.origine, nom: c.nom, detail: c.origine === ASSISTANT ? "Il répartit le travail" : c.roleCourt, visuel: <RondAgent id={c.origine} taille={28} /> }))
      : commande !== null && donneesCompetences
        ? skillsProposees([...donneesCompetences.skills, ...(donneesCompetences.avecClaude ? [COMPACTER] : [])], commande).map((s) => ({ cle: s.nom, nom: `/${s.nom}`, detail: s.description }))
        : [];
  const aideListe = listeFermee
    ? null
    : mention && suggestions.length === 0
      ? "Aucun agent à ce nom : continue d’écrire."
      : commande !== null && !mention && !donneesCompetences
        ? competences.etat === "attente"
          ? `Demande à ${sur}…`
          : `Les compétences seront visibles à l’ouverture de ${sur}. Tu peux écrire la commande.`
        : commande !== null && !mention && suggestions.length === 0
          ? "Aucune compétence à ce nom : continue d’écrire."
          : null;
  const listeOuverte = suggestions.length > 0 || !!aideListe;
  const position = Math.min(actif, Math.max(0, suggestions.length - 1));

  const joindre = (liste: FileList | File[] | null) => {
    if (!liste?.length) return;
    const { pieces: suite, alerte: refus } = ajouterPieces(pieces, [...liste]);
    setPieces(suite);
    setAlerte(refus);
  };

  const choisis = (e: ChangeEvent<HTMLInputElement>) => {
    joindre(e.target.files ? [...e.target.files] : null);
    e.target.value = "";
  };

  /* Une capture collée devient une pièce jointe, comme au bureau ; du texte se colle normalement. */
  const coller = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const images = [...e.clipboardData.files].filter((f) => f.type.startsWith("image/"));
    if (!images.length || e.clipboardData.getData("text/plain").trim()) return;
    e.preventDefault();
    joindre(images.map((f) => (/^image\.\w+$/.test(f.name) || !f.name ? new File([f], nomCapture(f.type, new Date()), { type: f.type }) : f)));
  };

  /* Un nom ou une commande à la place de ce qui est en cours de frappe : le curseur reste juste après. */
  const remplacer = (debut: number, insere: string) => {
    const apres = texte.slice(curseur);
    const avant = texte.slice(0, debut);
    const suite = `${avant}${insere}${apres}`;
    setTexte(suite);
    setActif(0);
    poserFocus(avant.length + insere.length);
  };

  const choisirSuggestion = (s: Suggestion) => {
    if (mention) return remplacer(mention.debut, `@${s.nom} `);
    remplacer(0, `${s.nom} `);
  };

  /* « @ » : le signe au curseur, et la liste s'ouvre ; le clavier reste. */
  const ouvrirMention = () => {
    const el = champ.current;
    const ici = el?.selectionStart ?? texte.length;
    const avant = texte.slice(0, ici);
    const insere = `${avant && !/\s$/.test(avant) ? " " : ""}@`;
    setListeFermee(false);
    setTexte(`${avant}${insere}${texte.slice(ici)}`);
    poserFocus(ici + insere.length);
  };

  const toucheListe = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.nativeEvent.isComposing || !listeOuverte) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      setListeFermee(true);
    } else if (suggestions.length && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
      e.preventDefault();
      setActif((position + (e.key === "ArrowDown" ? 1 : -1) + suggestions.length) % suggestions.length);
    } else if (suggestions.length && e.key === "Enter") {
      e.preventDefault();
      choisirSuggestion(suggestions[position]);
    }
  };

  const soumettre = async () => {
    if (!peutEnvoyer) return;
    const options: OptionsMessage = {};
    if (equipe) {
      const a = destinataire ?? mentionDans(texte, cartes ?? []);
      if (a && a !== ASSISTANT) options.a = a;
    }
    if (choix) {
      options.modele = choix.modele;
      options.effort = choix.effort;
    }
    if (nouveauProjet && !conversation) options.nouveau = { projetId: nouveauProjet };
    if (!lieu && postesOuverts.length >= 2 && posteVise) options.poste = posteVise.cle;
    if (citation) options.citation = citation;
    setEnvoi(true);
    setDeposees(0);
    setAlerte(null);
    try {
      await envoyer({ conversationOrigine: origine, texte: texteParDefaut(texte, pieces.length), options, pieces, surPiece: setDeposees });
      setTexte("");
      setPieces([]);
      setCitation(null);
    } catch (err) {
      /* Non accepté : le texte, la citation et les pièces restent, pour réessayer sans rien ressaisir. */
      setAlerte(messageErreur(err));
    } finally {
      setEnvoi(false);
    }
  };

  /* E2-43 : `/compact` une seule fois, par le canal du fil ; « Résumé demandé » s'affiche dans le fil, jamais « résumé » avant la réponse. */
  const resumer = () => {
    if (resumeLance) return;
    setResumeLance(true);
    void envoyer({ conversationOrigine: origine, texte: COMMANDE_COMPACTER, options: {} }).then(
      () => annoncer("Résumé demandé"),
      (err: unknown) => {
        setResumeLance(false);
        annoncer({ texte: messageErreur(err), erreur: true });
      },
    );
  };

  /* Arrêter (E2-17) : la demande part ; seul l'état reçu de l'ordinateur dit que l'agent s'est arrêté. */
  const arreter = async () => {
    const r = await arret.faire("fil.arreter", { conversation: origine });
    if (r.ok) setArretDemande(true);
    else setAlerte(r.code === "delai" ? `${majuscule(sur)} ne répond pas.` : r.message || "L’agent n’a pas pu être arrêté.");
  };

  const placeholder = agentId ? `Écris à ${nom(agentAffiche)}…` : equipe ? "Écris à l’équipe, ou @mentionne un agent…" : "Écris ton message…";
  const qui = activite ? nom(activite.roleId) : null;
  const noteOccupe = arretEnCours ? `Arrêt demandé : ${qui} s’arrête dès que ${sur} le confirme.` : occupe && texte.trim() ? `Il partira quand ${qui} aura fini.` : null;

  return (
    <div data-pied-telephone className="shrink-0 bg-fond-page px-2 pt-1 pb-[calc(8px+env(safe-area-inset-bottom))]">
      <ConseilFil conversation={conversation} origine={origine} occupe={occupe || resumeAttendu || resumeLance} onResumer={resumer} onNouveauFil={() => onNouveauFil?.()} />
      {bandeau ? (
        <p className="mb-2 flex items-start gap-2 rounded-xl bg-fond-surface-grise px-3 py-2.5 text-ui text-texte-principal">
          <Icon name="clock-01" size={18} className="mt-px shrink-0 text-icone-secondaire" />
          {bandeau}
        </p>
      ) : null}
      <div className="relative">
        {listeOuverte ? <ListeSuggestion libelle={mention ? "Agents" : "Compétences"} suggestions={suggestions} actif={position} aide={aideListe} onChoisir={choisirSuggestion} /> : null}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void soumettre();
          }}
          className="rounded-xl border border-bordure-subtile bg-fond-surface px-1.5 pt-1.5 pb-1 shadow-ombre-ambiante focus-within:border-bleu-k1-500"
        >
          {citation ? (
            <div className="mb-1 flex items-start gap-1 rounded-md bg-fond-surface-grise py-1.5 pl-3">
              <div className="min-w-0 flex-1 py-0.5">
                <p className="text-ui-xs text-texte-secondaire">Réponse à {nom(citation.roleId)}</p>
                <p className="line-clamp-2 text-ui text-texte-principal">{citation.extrait}</p>
              </div>
              <BoutonIcone variant="discret" className="size-11 shrink-0" libelle="Retirer la citation" icone={<Icon name="x-01" size={16} />} onClick={() => setCitation(null)} />
            </div>
          ) : null}
          {pieces.length ? (
            <ul aria-label="Pièces jointes" className="mb-1 flex gap-2 overflow-x-auto px-0.5 [scrollbar-width:none]">
              {pieces.map((p, i) => (
                <li key={`${p.name}-${p.size}-${p.lastModified}`} className="relative flex h-14 max-w-[220px] shrink-0 items-center gap-2 overflow-hidden rounded-md border border-bordure-subtile bg-fond-surface pl-3">
                  <Icon name={p.type.startsWith("image/") ? "image-01" : "file-01"} size={20} className="shrink-0 text-icone-secondaire" />
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-ui text-texte-principal">{p.name}</span>
                    <span className="text-ui-xs text-texte-secondaire">
                      {taillePiece(p.size)} · {envoi ? (i < deposees ? "déposée" : "envoi…") : "prêt"}
                    </span>
                  </span>
                  {envoi ? (
                    <span className="w-2 shrink-0" />
                  ) : (
                    <BoutonIcone variant="discret" className="size-11 shrink-0" libelle={`Retirer ${p.name}`} icone={<Icon name="x-01" size={16} />} onClick={() => setPieces((liste) => liste.filter((_, j) => j !== i))} />
                  )}
                  {/* Indéterminée : `fetch` ne mesure pas les octets envoyés. */}
                  {envoi && i >= deposees ? (
                    <span aria-hidden="true" className="absolute inset-x-0 bottom-0 flex h-0.5 overflow-hidden">
                      <span className="klyra-chargement-navigateur flex-1" />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {alerte ? (
            <p role="alert" className="mx-2 mb-1 flex items-start gap-1.5 text-ui text-texte-erreur">
              <Icon name="help-circle-contained" size={16} className="mt-0.5 shrink-0" />
              {alerte}
            </p>
          ) : null}
          {envoi && pieces.length ? (
            <p role="status" className="mx-2 mb-1 text-ui text-texte-secondaire">
              Envoi des pièces jointes… {deposees} sur {pieces.length}
            </p>
          ) : null}
          <textarea
            ref={champ}
            rows={1}
            value={texte}
            aria-label="Message"
            placeholder={placeholder}
            enterKeyHint="send"
            role={listeOuverte && suggestions.length ? "combobox" : undefined}
            aria-expanded={listeOuverte && suggestions.length ? true : undefined}
            aria-controls={listeOuverte && suggestions.length ? "composeur-suggestions" : undefined}
            aria-activedescendant={listeOuverte && suggestions.length ? `composeur-suggestion-${position}` : undefined}
            onChange={(e) => {
              setTexte(e.target.value);
              setCurseur(e.target.selectionStart);
              setListeFermee(false);
              setActif(0);
            }}
            onSelect={(e) => setCurseur(e.currentTarget.selectionStart)}
            onKeyDown={toucheListe}
            onPaste={coller}
            className="block min-h-11 w-full resize-none bg-transparent px-2.5 py-2.5 text-body-s leading-[1.4] text-texte-principal outline-none placeholder:text-texte-secondaire"
          />
          <div className="flex items-center gap-0.5">
            <BoutonIcone variant="discret" className="size-11 shrink-0" libelle="Joindre" aria-haspopup="dialog" icone={<Icon name="plus-01" size={22} />} onClick={() => setFeuille("joindre")} />
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto py-1 pr-1 [scrollbar-width:none]">
              {!equipe ? <span className={PUCE} aria-label={`Agent : ${nom(agentAffiche)}`}><Icon name="user-profile-01" size={16} className="text-icone-secondaire" />{nom(agentAffiche)}</span> : null}
              {equipe ? (
                <>
                  <button type="button" className={PUCE} aria-haspopup="dialog" aria-label={`Destinataire : ${nom(effectif)}`} onClick={() => setFeuille("destinataire")}>
                    <Icon name="user-profile-01" size={16} className="text-icone-secondaire" />
                    {nom(effectif)}
                    <Icon name="chevron-down" size={14} className="text-icone-secondaire" />
                  </button>
                  <button type="button" className={cn(PUCE, "min-w-11 justify-center")} aria-label="Mentionner un agent" onMouseDown={(e) => e.preventDefault()} onClick={ouvrirMention}>
                    @
                  </button>
                </>
              ) : null}
              <button type="button" className={PUCE} aria-label={`Modèle : ${libelleModele(modeleAffiche)}`} aria-haspopup="dialog" onClick={() => setFeuille("modele")}>
                {libelleModele(modeleAffiche)}
                <Icon name="chevron-down" size={14} className="text-icone-secondaire" />
              </button>
              {lieu ? (
                <span className={PUCE}>Sur {nomLieu(lieu, serveurs)}</span>
              ) : postesOuverts.length >= 2 && posteVise ? (
                <button type="button" className={PUCE} aria-haspopup="dialog" onClick={() => setFeuille("poste")}>
                  Sur {support(posteVise)}
                  <Icon name="chevron-down" size={14} className="text-icone-secondaire" />
                </button>
              ) : null}
            </div>
            {occupe ? (
              <BoutonIcone variant="blanc" className="relative size-9 shrink-0 after:absolute after:-inset-1 after:content-['']" libelle="Arrêter l’agent" disabled={arret.occupe || arretEnCours} icone={<Icon name="square" size={18} />} onClick={() => void arreter()} />
            ) : null}
            <BoutonIcone
              type="submit"
              variant={peutEnvoyer || envoi ? "sombre" : "gris"}
              className="relative ml-1 size-9 shrink-0 after:absolute after:-inset-1 after:content-['']"
              libelle={occupe ? "Mettre en attente" : "Envoyer"}
              disabled={!peutEnvoyer}
              icone={envoi ? <Icon name="loader-01" size={18} className="motion-safe:animate-spin" /> : <Icon name="arrow-up" size={20} />}
            />
          </div>
        </form>
      </div>
      {noteOccupe ? <p className="mt-1.5 px-2 text-ui-xs text-texte-secondaire">{noteOccupe}</p> : null}
      {horsLigne && texte.trim() ? <p className="mt-1.5 px-2 text-ui-xs text-texte-secondaire">L’envoi attend le réseau : ton texte reste ici.</p> : null}

      <input ref={photo} type="file" accept="image/*" multiple hidden onChange={choisis} />
      <input ref={camera} type="file" accept="image/*" capture="environment" hidden onChange={choisis} />
      <input ref={fichier} type="file" multiple hidden onChange={choisis} />

      {feuille === "joindre" ? (
        <MenuFeuille
          titre="Joindre"
          sousTitre={`${MAX_PIECES} fichiers au plus, 20 Mo chacun`}
          onFermer={() => setFeuille(null)}
          actions={[
            { libelle: "Photo", icone: "image-01", onChoisir: () => photo.current?.click() },
            { libelle: "Appareil photo", icone: "iphone-02", onChoisir: () => camera.current?.click() },
            { libelle: "Fichier", icone: "file-01", note: "Une capture collée dans le champ se joint aussi.", onChoisir: () => fichier.current?.click() },
          ]}
        />
      ) : null}
      {feuille === "destinataire" ? (
        <Feuille titre="Destinataire" sousTitre={conversation?.titre} onFermer={() => setFeuille(null)}>
          <GroupeListe>
            <div role="radiogroup" aria-label="Destinataire">
              {[...actifs]
                .sort((x, y) => Number(y.origine === ASSISTANT) - Number(x.origine === ASSISTANT))
                .map((c) => (
                  <LigneListe
                    key={c.origine}
                    retrait="avatar"
                    debut={<RondAgent id={c.origine} taille={40} />}
                    nom={c.nom}
                    ligne2={c.origine === ASSISTANT ? "Il répartit le travail" : c.roleCourt}
                    uneLigne
                    fin={<CocheChoix choisi={effectif === c.origine} />}
                    onClick={() => {
                      setFeuille(null);
                      setDestinataire(c.origine === ASSISTANT ? null : c.origine);
                      /* Après le fondu de la feuille, qui rend le focus à son déclencheur. */
                      setTimeout(() => poserFocus(), 240);
                    }}
                  />
                ))}
            </div>
          </GroupeListe>
          <p className="mt-3 px-1 text-ui-xs text-texte-secondaire">Sans choix, {nom(ASSISTANT)} répartit le travail. Une @mention dans le message choisit aussi.</p>
        </Feuille>
      ) : null}
      {feuille === "modele" ? <FeuilleModele actuel={modeleActuel} onChoisir={setChoix} onFermer={() => setFeuille(null)} /> : null}
      {feuille === "poste" ? (
        <MenuFeuille
          titre="Sur quel ordinateur ?"
          onFermer={() => setFeuille(null)}
          actions={postesOuverts.map((p) => ({ libelle: p.nom, note: p.ouvert ? "Ouvert" : "Fermé : ton message attendra son ouverture", onChoisir: () => setPosteChoisi(p.cle) }))}
        />
      ) : null}
    </div>
  );
}
