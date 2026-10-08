import type { Metadata } from "next";
import { ComingSoon } from "@/components/shell/ComingSoon";

export const metadata: Metadata = { title: "Tous les chats — KLYRA" };

export default function ChatsPage() {
  return <ComingSoon title="Tous les chats" description="La liste complète des chats arrive bientôt. En attendant, ouvre un chat récent dans la barre latérale." />;
}
