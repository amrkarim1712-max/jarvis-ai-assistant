import { createFileRoute } from "@tanstack/react-router";

type Msg = { role: "system" | "user" | "assistant"; content: string };

export type Citation = { title?: string; url: string; snippet?: string };

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
            model: "compound-beta-mini",
            messages: [system, ...messages],
            temperature: 0.6,
            max_tokens: 400,
          }),
        });

        if (!res.ok) {
          const txt = await res.text();
          console.error("Groq error", res.status, txt);
          return new Response(txt || "Groq error", { status: res.status });
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const data = (await res.json()) as any;
        const msg = data.choices?.[0]?.message ?? {};
        const content: string = msg.content ?? "";

        // Extract citations from compound-beta executed_tools
        const citations: Citation[] = [];
        const seen = new Set<string>();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tools: any[] = msg.executed_tools ?? data.choices?.[0]?.executed_tools ?? [];
        for (const t of tools) {
          const out = t?.output ?? t?.search_results ?? t?.results;
          const list = Array.isArray(out)
            ? out
            : Array.isArray(out?.results)
              ? out.results
              : Array.isArray(out?.web)
                ? out.web
                : [];
          for (const r of list) {
            const url = r?.url ?? r?.link;
            if (!url || seen.has(url)) continue;
            seen.add(url);
            citations.push({
              url,
              title: r?.title ?? r?.name,
              snippet: (r?.snippet ?? r?.content ?? r?.description ?? "")
                .toString()
                .slice(0, 220),
            });
            if (citations.length >= 6) break;
          }
          if (citations.length >= 6) break;
        }

        return Response.json({ content, citations });
      },
    },
  },
});
