"use client";

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

const questions = [
  {
    q: "Is DBDeck really free?",
    a: "Yes. DBDeck is MIT licensed, has no paid tier, no account and no feature locked behind a subscription.",
  },
  {
    q: "Which editors does it run in?",
    a: "VS Code 1.85 or newer, Cursor, VSCodium, Windsurf and other editors that install extensions from the Visual Studio Marketplace or Open VSX.",
  },
  {
    q: "Where are my passwords stored?",
    a: "In your operating system keychain through VS Code SecretStorage. Turn off Remember password on a connection to keep its secrets in memory for the current session only.",
  },
  {
    q: "Does DBDeck send anything to a server?",
    a: "No. The extension connects only to the databases you configure. There is no telemetry, analytics or cloud sync.",
  },
  {
    q: "What does the AI query feature send?",
    a: "Only your written request and the table and column names, types and keys you select. Rows, passwords and connection strings are never sent. You choose the provider: ChatGPT sign-in, your own API key or a local Ollama model.",
  },
  {
    q: "Can I use it against production safely?",
    a: "Mark the connection read-only to block writes. Table edits are staged and saved in a single transaction, and destructive actions ask for confirmation.",
  },
];

export function Faq() {
  return (
    <Accordion className="mt-10 divide-y divide-border border-y border-border">
      {questions.map(({ q, a }) => (
        <AccordionItem key={q} value={q} className="not-last:border-b-0">
          <AccordionTrigger className="py-5 text-base hover:no-underline">{q}</AccordionTrigger>
          <AccordionContent className="pb-5 text-[15px] leading-[1.75] text-muted-foreground">{a}</AccordionContent>
        </AccordionItem>
      ))}
    </Accordion>
  );
}
