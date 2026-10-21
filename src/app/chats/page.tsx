import type { Metadata } from "next";
import { ChatsAccueil } from "@/components/chat/ChatsAccueil";

export const metadata: Metadata = { title: "Chats — KLYRA" };

/** `/chats` : le panneau des agents et des conversations s'ouvre à côté du rail (cf. AppShell). */
export default function ChatsPage() {
  return <ChatsAccueil />;
}
