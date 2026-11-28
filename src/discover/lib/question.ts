// Telling a question from a name, and the address that asks it. Safe to import from client components.

const QUESTION_START =
  /^(?:who|whom|what|which|how|did|does|do|is|are|was|were|has|have|can|could|list|show|tell|find|compare|explore)\b/i;
const QUESTION_SIGNS = /->|→|\?\s*$| vs\.? | versus /i;

/** Whether search text reads as a question rather than a name: a few words, asked. */
export function looksLikeQuestion(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.split(/\s+/).length >= 3 && (QUESTION_START.test(trimmed) || QUESTION_SIGNS.test(trimmed));
}

export const askHref = (question: string) => `/discover/ask?q=${encodeURIComponent(question.trim())}`;

/** Questions to start from, one of each kind Ask answers. */
export const EXAMPLE_QUESTIONS = [
  "How is Johnny Cash connected to Rihanna?",
  "Who produced Umbrella?",
  "Who has Taylor Swift worked with the most?",
  "Who is featured on Monster by Ye?",
  "What do Adele and Ed Sheeran have in common?",
  "Who sampled Chimamanda Ngozi Adichie?",
  "Artists like Bon Iver",
  "Which bands was Dave Grohl in?",
] as const;
