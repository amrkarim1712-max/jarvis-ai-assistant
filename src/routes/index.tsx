import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Volume2, VolumeX, Trash2, Loader2 } from "lucide-react";
import jarvisCore from "@/assets/jarvis-core.png";

export const Route = createFileRoute("/")({
  component: Jarvis,
});

type Msg = { role: "user" | "assistant"; content: string };

const STORAGE_KEY = "jarvis.conversation.v1";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpeechRecognitionCtor = new () => any;

function getRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function Jarvis() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [status, setStatus] = useState("SYSTEMS ONLINE");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch {
      // ignore
    }
    inputRef.current?.focus();
  }, []);

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // ignore
    }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const speak = useCallback(
    (text: string) => {
      if (!voiceOn || typeof window === "undefined" || !("speechSynthesis" in window)) return;
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find((v) => /Daniel|Google UK English Male|Microsoft.*George|Microsoft.*Ryan/i.test(v.name)) ??
        voices.find((v) => v.lang?.toLowerCase().startsWith("en-gb")) ??
        voices.find((v) => v.lang?.toLowerCase().startsWith("en"));
      if (preferred) u.voice = preferred;
      u.rate = 1.02;
      u.pitch = 0.95;
      u.onstart = () => setSpeaking(true);
      u.onend = () => setSpeaking(false);
      u.onerror = () => setSpeaking(false);
      window.speechSynthesis.speak(u);
    },
    [voiceOn],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thinking) return;
      const next: Msg[] = [...messages, { role: "user", content: trimmed }];
      setMessages(next);
      setInput("");
      setThinking(true);
      setStatus("PROCESSING QUERY");
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: next }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { content: string };
        const reply = data.content || "I'm afraid I couldn't formulate a response, sir.";
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
        setStatus("READY");
        speak(reply);
      } catch (e) {
        console.error(e);
        setMessages((m) => [
          ...m,
          { role: "assistant", content: "Apologies, sir. My connection to the network appears to be compromised." },
        ]);
        setStatus("ERROR");
      } finally {
        setThinking(false);
        inputRef.current?.focus();
      }
    },
    [messages, thinking, speak],
  );

  const toggleListen = useCallback(() => {
    const Rec = getRecognition();
    if (!Rec) {
      setStatus("VOICE INPUT UNAVAILABLE");
      return;
    }
    if (listening) {
      recRef.current?.stop();
      return;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new Rec();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onstart = () => {
      setListening(true);
      setStatus("LISTENING");
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (ev: any) => {
      let interim = "";
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interim += r[0].transcript;
      }
      setInput((finalText + interim).trim());
    };
    rec.onerror = () => {
      setListening(false);
      setStatus("READY");
    };
    rec.onend = () => {
      setListening(false);
      setStatus("READY");
      const text = finalText.trim();
      if (text) void send(text);
    };
    recRef.current = rec;
    try {
      // Cancel any speaking so mic can be heard
      window.speechSynthesis?.cancel();
      rec.start();
    } catch {
      setListening(false);
    }
  }, [listening, send]);

  const clearAll = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    window.speechSynthesis?.cancel();
    setStatus("MEMORY WIPED");
  };

  const toggleVoice = () => {
    setVoiceOn((v) => {
      if (v) window.speechSynthesis?.cancel();
      return !v;
    });
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content;
  const active = listening || thinking || speaking;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden">
      {/* Background grid */}
      <div className="jarvis-grid pointer-events-none absolute inset-0 opacity-40" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_40%,var(--background)_90%)]" />

      {/* Top HUD bar */}
      <header className="relative z-10 flex items-center justify-between border-b border-border/40 px-6 py-3 text-xs uppercase tracking-[0.3em] text-jarvis">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2 w-2 rounded-full bg-jarvis animate-hud shadow-[0_0_10px_currentColor]" />
          <span className="text-glow">J.A.R.V.I.S. v1.0</span>
        </div>
        <div className="hidden text-jarvis-accent text-glow md:block">
          {new Date().toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
        </div>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground">STATUS:</span>
          <span className="text-jarvis-accent text-glow">{status}</span>
        </div>
      </header>

      {/* Main stage */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-6 px-4 pb-4 md:flex-row md:gap-10 md:px-10">
        {/* Reactor */}
        <div className="relative flex shrink-0 items-center justify-center">
          <div className="relative h-[300px] w-[300px] md:h-[420px] md:w-[420px]">
            {/* Outer rotating ring */}
            <div className="absolute inset-0 rounded-full border border-jarvis/30 animate-spin-slow">
              <div className="absolute left-1/2 top-0 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-jarvis shadow-[0_0_12px_currentColor]" />
              <div className="absolute right-0 top-1/2 h-2 w-2 translate-x-1/2 -translate-y-1/2 rounded-full bg-jarvis-accent shadow-[0_0_12px_currentColor]" />
            </div>
            <div className="absolute inset-4 rounded-full border border-dashed border-jarvis/20 animate-spin-reverse" />
            <div className="absolute inset-10 rounded-full border border-jarvis/40 animate-spin-slow" />

            {/* Reactor image */}
            <img
              src={jarvisCore}
              alt="Arc reactor"
              width={420}
              height={420}
              className={`absolute inset-0 h-full w-full object-contain animate-reactor ${active ? "animate-pulse-glow" : ""}`}
            />

            {/* Center label */}
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center font-mono text-[10px] uppercase tracking-[0.4em] text-jarvis/70">
                <div>{listening ? "◉ LISTENING" : speaking ? "◈ SPEAKING" : thinking ? "◇ THINKING" : "◇ IDLE"}</div>
              </div>
            </div>
          </div>
        </div>

        {/* Right panel — conversation */}
        <section className="relative flex h-full min-h-0 w-full max-w-2xl flex-1 flex-col rounded-lg border border-jarvis/30 bg-background/60 p-4 backdrop-blur-sm ring-glow">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-jarvis-accent">
            <span>▸ Dialogue Log</span>
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
              title="Wipe memory"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          </div>

          <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-2">
            {messages.length === 0 && (
              <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
                <p className="text-glow text-lg text-jarvis">Good day, sir.</p>
                <p className="max-w-sm text-sm text-muted-foreground">
                  All systems are operational. Press the microphone, or type a query below. I have live access to the web.
                </p>
                <div className="mt-4 grid gap-2 text-xs text-muted-foreground">
                  <span>▸ "What's the latest on AI regulation?"</span>
                  <span>▸ "Weather in Tokyo right now."</span>
                  <span>▸ "Summarise today's headlines."</span>
                </div>
              </div>
            )}
            {messages.map((m, i) => (
              <div
                key={i}
                className={`text-sm leading-relaxed ${
                  m.role === "user" ? "text-jarvis-accent" : "text-foreground"
                }`}
              >
                <span className="mr-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                  {m.role === "user" ? "▸ You" : "◇ Jarvis"}
                </span>
                <span className={m.role === "assistant" ? "text-glow" : ""}>{m.content}</span>
              </div>
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-sm text-jarvis">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="animate-pulse">Processing…</span>
              </div>
            )}
          </div>

          {/* Live subtitle for last spoken reply */}
          {speaking && lastAssistant && (
            <div className="mt-2 border-t border-jarvis/20 pt-2 text-xs italic text-jarvis-accent text-glow">
              🔊 {lastAssistant.slice(0, 140)}{lastAssistant.length > 140 ? "…" : ""}
            </div>
          )}
        </section>
      </main>

      {/* Bottom control dock */}
      <footer className="relative z-10 border-t border-border/40 bg-background/40 px-4 py-3 backdrop-blur-md md:px-10">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void send(input);
          }}
          className="mx-auto flex max-w-4xl items-center gap-2"
        >
          <button
            type="button"
            onClick={toggleListen}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all ${
              listening
                ? "border-destructive bg-destructive/20 text-destructive animate-pulse"
                : "border-jarvis/50 text-jarvis hover:bg-jarvis/10 hover:ring-glow"
            }`}
            title={listening ? "Stop listening" : "Speak"}
          >
            {listening ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <button
            type="button"
            onClick={toggleVoice}
            className={`inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full border transition-all ${
              voiceOn
                ? "border-jarvis-accent/50 text-jarvis-accent hover:bg-jarvis-accent/10"
                : "border-border text-muted-foreground"
            }`}
            title={voiceOn ? "Mute Jarvis" : "Unmute Jarvis"}
          >
            {voiceOn ? <Volume2 className="h-5 w-5" /> : <VolumeX className="h-5 w-5" />}
          </button>
          <div className="relative flex-1">
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Speak to Jarvis, sir…"
              className="h-11 w-full rounded-full border border-jarvis/40 bg-input/60 px-5 pr-14 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-jarvis focus:outline-none focus:ring-glow"
              disabled={thinking}
            />
            <button
              type="submit"
              disabled={thinking || !input.trim()}
              className="absolute right-1.5 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-jarvis text-primary-foreground transition-all hover:bg-jarvis-glow disabled:opacity-40"
            >
              {thinking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </button>
          </div>
        </form>
      </footer>

      {/* Scanline effect */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-jarvis/5 to-transparent animate-scan" />
    </div>
  );
}
