import type { IconName } from "@/components/icons/Icon";

/**
 * Les pages du menu, dans l'ordre : les mêmes dans le menu déplié et dans le
 * rail noir. Les projets viennent juste après, en liste ou en tuiles. Les
 * serveurs n'y sont pas : le sélecteur en haut du rail mène à leur écran.
 */
export const NAVIGATION: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "Accueil", icon: "accueil-ronds" },
  { href: "/chats", label: "Chats", icon: "message-square" },
  { href: "/tickets", label: "Tickets", icon: "list" },
  { href: "/planning", label: "Planning", icon: "calendar-01" },
  { href: "/routines", label: "Automatisations", icon: "lightning-01" },
  { href: "/artefacts", label: "Artefacts", icon: "artefacts-forme" },
];
