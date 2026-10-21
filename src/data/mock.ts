import { PROJECT_FILES } from "@/data/files";
import type { Chat, Message, Project, User } from "@/types/domain";

/**
 * Données factices de la phase front, à la forme exacte des futures données
 * du back. Créées à l’ouverture de l’app (et non au build) : les dates sont
 * relatives à cet instant, pour que « il y a 10 min » reste vrai.
 */

export interface MockWorkspace {
  currentUser: User;
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

  const projects: Project[] = [
    {
      id: "bizwhoo",
      name: "Bizwhoo",
      subtitle: "Refonte du site",
      status: "en-cours",
      pinned: true,
      roleIds: ["principal", "dev", "designer", "qa"],
      brief: "Refonte du site Bizwhoo : hero plus aérée, nouvelle page offres, formulaire de contact simplifié. Mise en ligne prévue le 24 octobre.",
      previewUrl: "localhost:3000",
      folder: "~/Documents/Clients/bizwhoo",
      files: PROJECT_FILES.siteNext(),
      updatedAt: ago(11),
    },
    {
      id: "klyra-fr",
      name: "klyra.fr",
      subtitle: "Site du studio",
      status: "en-revue",
      pinned: true,
      roleIds: ["principal", "designer", "dev"],
      brief: "Mise à jour des pages offres et du portfolio.",
      previewUrl: "localhost:3002",
      folder: "~/Documents/Base-KLYRA-main/KLYRA-site /klyra-site",
      files: PROJECT_FILES.siteNext(),
      updatedAt: ago(33),
    },
    {
      id: "diagnostic",
      name: "Diagnostic",
      subtitle: "Outil lead magnet",
      status: "en-cours",
      pinned: false,
      roleIds: ["principal", "designer", "dev"],
      brief: "Parcours de diagnostic en 5 étapes avec score final.",
      previewUrl: "localhost:3004",
      folder: "~/Documents/Base-KLYRA-main/diagnostic",
      files: PROJECT_FILES.outil(),
      updatedAt: ago(60 * 20),
    },
    {
      id: "app-interne",
      name: "App interne",
      subtitle: "Cet outil",
      status: "en-cours",
      pinned: false,
      roleIds: ["principal", "designer"],
      brief: "L’app de bureau KLYRA : chat avec des rôles, projets et fichiers.",
      previewUrl: "localhost:3100",
      folder: "~/Documents/Base-KLYRA-main/klyra-app",
      files: PROJECT_FILES.appBureau(),
      updatedAt: ago(60 * 22),
    },
  ];

  const chats: Chat[] = [
    { id: "hero-home", kind: "equipe", projectId: "bizwhoo", title: "Hero de la home", roleIds: ["principal", "dev", "designer", "qa"], updatedAt: ago(11), sessions: {}, luJusqua: new Date(now).toISOString() },
    { id: "palette", kind: "equipe", projectId: "klyra-fr", title: "Palette de la marque", roleIds: ["principal", "designer"], updatedAt: ago(33), sessions: {}, luJusqua: new Date(now).toISOString() },
    { id: "parcours-diagnostic", kind: "equipe", projectId: "diagnostic", title: "Parcours diagnostic", roleIds: ["principal", "designer"], updatedAt: ago(60 * 20), sessions: {}, luJusqua: new Date(now).toISOString() },
    { id: "planning-bizwhoo", kind: "equipe", projectId: "bizwhoo", title: "Planning Bizwhoo", roleIds: ["principal"], updatedAt: ago(60 * 22), sessions: {}, luJusqua: new Date(now).toISOString() },
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
            { id: "t1", roleId: "designer", label: "structure de la hero", status: "fait" },
            { id: "t2", roleId: "dev", label: "intégration", status: "en-cours" },
            { id: "t3", roleId: "qa", label: "contrôle avant mise en ligne", status: "a-venir" },
          ],
        },
      ],
    },
    {
      id: "m3",
      chatId: "hero-home",
      author: { kind: "role", roleId: "designer" },
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
      author: { kind: "role", roleId: "designer" },
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
      author: { kind: "role", roleId: "designer" },
      createdAt: ago(60 * 20),
      parts: [{ type: "text", text: "Oui : je la coupe en deux écrans de trois questions. Le wireframe de l’étape 2 est prêt." }],
    },

    /* ─── Planning Bizwhoo ────────────────────────────────────────── */
    {
      id: "m10",
      chatId: "planning-bizwhoo",
      author: { kind: "role", roleId: "principal" },
      createdAt: ago(60 * 22),
      parts: [{ type: "text", text: "Point planning : la hero avance, la page offres démarre lundi. Je relance Hugo demain matin." }],
    },
  ];

  return { currentUser, projects, chats, messages };
}
