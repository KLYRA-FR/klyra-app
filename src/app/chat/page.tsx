import type { Metadata } from "next";
import { Suspense } from "react";
import { ChatScreen } from "@/components/chat/ChatScreen";

export const metadata: Metadata = { title: "Chat — KLYRA" };

/** `/chat?id=…` : l’id passe en paramètre, compatible avec l’export statique. */
export default function ChatPage() {
  return (
    <Suspense>
      <ChatScreen />
    </Suspense>
  );
}
