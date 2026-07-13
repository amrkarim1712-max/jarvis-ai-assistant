import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/tts")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const key = process.env.LOVABLE_API_KEY;
        if (!key) return new Response("Missing LOVABLE_API_KEY", { status: 500 });
        let body: { text?: string };
        try {
          body = await request.json();
        } catch {
          return new Response("Invalid JSON", { status: 400 });
        }
        const text = (body.text ?? "").toString().trim();
        if (!text) return new Response("text required", { status: 400 });

        const res = await fetch("https://ai.gateway.lovable.dev/v1/audio/speech", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${key}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "openai/gpt-4o-mini-tts",
            input: text.slice(0, 4000),
            voice: "onyx",
            response_format: "mp3",
            instructions:
              "You are J.A.R.V.I.S., Tony Stark's refined British AI butler. Speak with a calm, precise, upper-class British male accent (RP). Composed, dry, understated, slightly wry. Measured pace, crisp consonants, never robotic. Never sound American.",
          }),
        });
        if (!res.ok) {
          const txt = await res.text();
          console.error("TTS error", res.status, txt);
          return new Response(txt || "TTS error", { status: res.status });
        }
        return new Response(res.body, {
          headers: {
            "Content-Type": "audio/mpeg",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
