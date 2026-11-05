/** Les réactions proposées sous une réponse d'agent (mêmes qu'au bureau, `src/lib/repondre.ts`). */
export const REACTIONS = ["👍", "👎", "❤️", "😂", "🎉", "😮"] as const;

export const reactionValide = (emoji: string): boolean => (REACTIONS as readonly string[]).includes(emoji);
