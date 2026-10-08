import type { Chat, Message, Project, Role, User } from "@/types/domain";

/**
 * Données factices de la phase front, à la forme exacte des futures données
 * du back. Créées à l’ouverture de l’app (et non au build) : les dates sont
 * relatives à cet instant, pour que « il y a 10 min » reste vrai.
 */

export interface MockWorkspace {
  currentUser: User;
  roles: Role[];
  projects: Project[];
  chats: Chat[];
  messages: Message[];
}

const MINUTE = 60_000;

export function createMockWorkspace(now: number = Date.now()): MockWorkspace {
  const ago = (minutes: number) => new Date(now - minutes * MINUTE).toISOString();

  const currentUser: User = {
    id: "pelin",
    name: "Pelin",
    title: "Design · KLYRA",
    initial: "P",
  };

  const roles: Role[] = [
    {
      id: "principal",
      name: "Principal",
      tag: "Orchestre",
      initial: "K",
      description: "Ton seul interlocuteur si tu veux. Il comprend la demande, la découpe et passe la main aux autres rôles.",
      skills: ["Découper une demande", "Planifier", "Faire le point"],
      tools: ["Tous les projets", "Slack"],
    },
    {
      id: "dev",
      name: "Dev",
      tag: "Code",
      initial: "D",
      description: "Écrit le code, intègre les maquettes et déploie. Suit les conventions klyra-ui.",
      skills: ["Next.js", "Intégration", "Déploiement"],
      tools: ["GitHub", "Vercel", "klyra-ui"],
    },
    {
      id: "uxui",
      name: "UX/UI",
      tag: "Design",
      initial: "U",
      description: "Parcours, wireframes et maquettes. Propose plusieurs options avant de trancher.",
      skills: ["Wireframes", "Parcours", "Maquettes"],
      tools: ["Figma", "klyra-ui"],
    },
    {
      id: "da",
      name: "DA",
      tag: "Direction artistique",
      initial: "A",
      description: "Garde la cohérence de marque : typo, couleurs, images et illustrations.",
      skills: ["Identité", "Typographie", "Images"],
      tools: ["Figma", "Brand book"],
    },
  ];

  const projects: Project[] = [
    {
      id: "bizwhoo",
      name: "Bizwhoo",
      subtitle: "Refonte du site",
      status: "en-cours",
      pinned: true,
      roleIds: ["principal", "dev", "uxui", "da"],
      brief: "Refonte du site Bizwhoo : hero plus aérée, nouvelle page offres, formulaire de contact simplifié. Mise en ligne prévue le 24 octobre.",
      previewUrl: "localhost:3000",
      updatedAt: ago(11),
    },
    {
      id: "klyra-fr",
      name: "klyra.fr",
      subtitle: "Site du studio",
      status: "en-revue",
      pinned: true,
      roleIds: ["principal", "da", "dev"],
      brief: "Mise à jour des pages offres et du portfolio.",
      previewUrl: "localhost:3002",
      updatedAt: ago(33),
    },
    {
      id: "diagnostic",
      name: "Diagnostic",
      subtitle: "Outil lead magnet",
      status: "en-cours",
      pinned: false,
      roleIds: ["principal", "uxui", "dev"],
      brief: "Parcours de diagnostic en 5 étapes avec score final.",
      previewUrl: "localhost:3004",
      updatedAt: ago(60 * 20),
    },
    {
      id: "app-interne",
      name: "App interne",
      subtitle: "Cet outil",
      status: "en-cours",
      pinned: false,
      roleIds: ["principal", "uxui"],
      brief: "L’app de bureau KLYRA : chat avec des rôles, projets et fichiers.",
      previewUrl: "localhost:3100",
      updatedAt: ago(60 * 22),
    },
  ];

  const chats: Chat[] = [
    { id: "hero-home", projectId: "bizwhoo", title: "Hero de la home", roleIds: ["principal", "dev", "uxui", "da"], updatedAt: ago(11) },
    { id: "palette", projectId: "klyra-fr", title: "Palette de la marque", roleIds: ["principal", "da"], updatedAt: ago(33) },
    { id: "parcours-diagnostic", projectId: "diagnostic", title: "Parcours diagnostic", roleIds: ["principal", "uxui"], updatedAt: ago(60 * 20) },
    { id: "planning-bizwhoo", projectId: "bizwhoo", title: "Planning Bizwhoo", roleIds: ["principal"], updatedAt: ago(60 * 22) },
  ];

  const messages: Message[] = [
    /* ─── Hero de la home ─────────────────────────────────────────── */
    {
      id: "m1",
      chatId: "hero-home",
      author: { kind: "user" },
      createdAt: ago(22),
      parts: [{ type: "text", text: "On refait la hero de la home : plus aérée, titre sur deux lignes, CTA noir. Tu gères ?" }],
    },
    {
      id: "m2",
      chatId: "hero-home",
      author: { kind: "role", roleId: "principal" },
      createdAt: ago(22),
      parts: [
        { type: "text", text: "Ok, je répartis entre l’équipe et je te tiens au courant ici." },
        {
          type: "tasks",
          tasks: [
            { id: "t1", roleId: "uxui", label: "structure de la hero", status: "fait" },
            { id: "t2", roleId: "dev", label: "intégration", status: "en-cours" },
            { id: "t3", roleId: "da", label: "revue visuelle", status: "a-venir" },
          ],
        },
      ],
    },
    {
      id: "m3",
      chatId: "hero-home",
      author: { kind: "role", roleId: "uxui" },
      createdAt: ago(19),
      parts: [
        { type: "text", text: "Deux options de structure. La B garde la vidéo à droite." },
        {
          type: "options",
          options: [
            { id: "o1", label: "Option A", layout: "texte", selected: false },
            { id: "o2", label: "Option B", layout: "texte-media", selected: true },
          ],
        },
      ],
    },
    {
      id: "m4",
      chatId: "hero-home",
      author: { kind: "user" },
      createdAt: ago(17),
      parts: [{ type: "text", text: "La B. Go." }],
    },
    {
      id: "m5",
      chatId: "hero-home",
      author: { kind: "role", roleId: "dev" },
      createdAt: ago(11),
      parts: [
        {
          type: "worklog",
          durationMin: 3,
          files: [
            { path: "src/app/page.tsx", added: 42, removed: 18 },
            { path: "src/components/hero.tsx", added: 96, removed: 0 },
          ],
        },
        { type: "text", text: "C’est visible sur l’aperçu à droite. Je lance le build ?" },
        {
          type: "actions",
          actions: [
            { id: "a1", label: "Oui, lance le build", primary: true },
            { id: "a2", label: "Voir le diff", primary: false },
          ],
        },
      ],
    },

    /* ─── Palette de la marque ────────────────────────────────────── */
    {
      id: "m6",
      chatId: "palette",
      author: { kind: "user" },
      createdAt: ago(45),
      parts: [{ type: "text", text: "Tu peux me proposer des pistes de palette pour la refonte ? On reste sobre." }],
    },
    {
      id: "m7",
      chatId: "palette",
      author: { kind: "role", roleId: "da" },
      createdAt: ago(33),
      parts: [{ type: "text", text: "Trois pistes en noir et blanc, avec un seul accent possible pour les CTA. Je te les mets dans les fichiers du projet." }],
    },

    /* ─── Parcours diagnostic ─────────────────────────────────────── */
    {
      id: "m8",
      chatId: "parcours-diagnostic",
      author: { kind: "user" },
      createdAt: ago(60 * 21),
      parts: [{ type: "text", text: "L’étape 2 du diagnostic est trop longue, on peut la couper ?" }],
    },
    {
      id: "m9",
      chatId: "parcours-diagnostic",
      author: { kind: "role", roleId: "uxui" },
      createdAt: ago(60 * 20),
      parts: [{ type: "text", text: "Oui : je la coupe en deux écrans de trois questions. Le wireframe de l’étape 2 est prêt." }],
    },

    /* ─── Planning Bizwhoo ────────────────────────────────────────── */
    {
      id: "m10",
      chatId: "planning-bizwhoo",
      author: { kind: "role", roleId: "principal" },
      createdAt: ago(60 * 22),
      parts: [{ type: "text", text: "Point planning : la hero avance, la page offres démarre lundi. Je relance le Dev demain matin." }],
    },
  ];

  return { currentUser, roles, projects, chats, messages };
}
