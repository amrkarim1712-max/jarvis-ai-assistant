import { createFileRoute } from "@tanstack/react-router";

type Msg = { role: "system" | "user" | "assistant"; content: string };

export const Route = createFileRoute("/api/chat")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.GROQ_API_KEY;
        if (!key) return new Response("Missing GROQ_API_KEY", { status: 500 });

        let body: { messages?: Msg[] };
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const messages = Array.isArray(body.messages) ? body.messages : [];

        const system: Msg = {
          role: "system",
          content:
            "You are J.A.R.V.I.S. — Tony Stark's AI assistant. Speak with calm British formality, dry wit, and precision. Address the user as 'sir' occasionally. Keep responses concise and spoken-friendly (no markdown, no bullet lists, no code fences) unless explicitly asked. You have live web search built in — use it whenever the user asks about current events, facts, prices, news, or anything time-sensitive.",
        };

        const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${key}`,
          },
          body: JSON.stringify({
            model: "compound-beta",
            messages: [system, ...messages],
            temperature: 0.7,
          }),
        });

        if (!res.ok) {
          const txt = await res.text();
          console.error("Groq error", res.status, txt);
          return new Response(txt || "Groq error", { status: res.status });
        }
        const data = (await res.json()) as {
          choices?: { message?: { content?: string } }[];
        };
        const content = data.choices?.[0]?.message?.content ?? "";
        return Response.json({ content });
      },
    },
  },
});
