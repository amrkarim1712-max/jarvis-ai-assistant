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

// Rotating ring text
const RING_TEXT_OUTER = "◆ STARK INDUSTRIES ◆ SECURE UPLINK ◆ CLEARANCE ALPHA ◆ SYSTEM NOMINAL ◆ ";
const RING_TEXT_INNER = "· NEURAL CORE · QUANTUM LINK · ARC REACTOR ONLINE · DIAGNOSTIC PASS · ";

function HudCorner({
  title,
  lines,
  align,
}: {
  title: string;
  lines: string[];
  align: "tl" | "tr" | "bl" | "br";
}) {
  const pos =
    align === "tl"
      ? "top-4 left-4 items-start text-left"
      : align === "tr"
        ? "top-4 right-4 items-end text-right"
        : align === "bl"
          ? "bottom-24 left-4 items-start text-left"
          : "bottom-24 right-4 items-end text-right";
  return (
    <div className={`pointer-events-none absolute z-10 hidden flex-col gap-1 text-[10px] uppercase tracking-[0.25em] text-jarvis/70 md:flex ${pos}`}>
      <div className="text-jarvis-accent text-glow">▸ {title}</div>
      {lines.map((l, i) => (
        <div key={i} className="font-mono">{l}</div>
      ))}
    </div>
  );
}

function Jarvis() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [status, setStatus] = useState("STANDBY");
  const [levels, setLevels] = useState<number[]>(() => Array(32).fill(0.15));
  const [clock, setClock] = useState<string>("");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);

  // Clock
  useEffect(() => {
    const tick = () => setClock(new Date().toLocaleTimeString("en-GB", { hour12: false }));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, []);

  // Load persisted
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setMessages(JSON.parse(raw));
    } catch { /* ignore */ }
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(messages)); } catch { /* ignore */ }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Ambient reactor pulse animation for levels when idle
  useEffect(() => {
    if (speaking || listening) return;
    const id = setInterval(() => {
      setLevels((prev) => prev.map((_, i) => 0.15 + Math.abs(Math.sin(Date.now() / 500 + i / 3)) * 0.15));
    }, 80);
    return () => clearInterval(id);
  }, [speaking, listening]);

  const stopVisualizer = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    analyserRef.current = null;
  }, []);

  const startAudioVisualizer = useCallback((source: AudioNode) => {
    const ctx = audioCtxRef.current!;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 128;
    source.connect(analyser);
    analyserRef.current = analyser;
    const data = new Uint8Array(analyser.frequencyBinCount);
    const loop = () => {
      analyser.getByteFrequencyData(data);
      const bars = 32;
      const step = Math.floor(data.length / bars);
      const next: number[] = [];
      for (let i = 0; i < bars; i++) {
        const v = data[i * step] / 255;
        next.push(0.12 + v * 0.88);
      }
      setLevels(next);
      rafRef.current = requestAnimationFrame(loop);
    };
    loop();
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!voiceOn) return;
      try {
        stopVisualizer();
        audioRef.current?.pause();
        const res = await fetch("/api/tts", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) throw new Error(await res.text());
        const blob = await res.blob();
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audioRef.current = audio;

        // Web Audio for visualization
        if (!audioCtxRef.current) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
          audioCtxRef.current = new Ctx();
        }
        if (audioCtxRef.current.state === "suspended") await audioCtxRef.current.resume().catch(() => {});
        const src = audioCtxRef.current.createMediaElementSource(audio);
        src.connect(audioCtxRef.current.destination);
        startAudioVisualizer(src);

        audio.onplay = () => { setSpeaking(true); setStatus("SPEAKING"); };
        audio.onended = () => {
          setSpeaking(false);
          setStatus("READY");
          stopVisualizer();
          URL.revokeObjectURL(url);
        };
        audio.onerror = () => {
          setSpeaking(false);
          setStatus("AUDIO ERROR");
          stopVisualizer();
        };
        await audio.play();
      } catch (e) {
        console.error("TTS failed", e);
        setSpeaking(false);
      }
    },
    [voiceOn, startAudioVisualizer, stopVisualizer],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thinking) return;
      const next: Msg[] = [...messages, { role: "user", content: trimmed }];
      setMessages(next);
      setInput("");
      setThinking(true);
      setStatus("PROCESSING");
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
        void speak(reply);
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
    audioRef.current?.pause();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new Rec();
    rec.lang = "en-US";
    rec.interimResults = true;
    rec.continuous = false;
    let finalText = "";
    rec.onstart = () => { setListening(true); setStatus("LISTENING"); };
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
    rec.onerror = () => { setListening(false); setStatus("READY"); };
    rec.onend = () => {
      setListening(false);
      setStatus("READY");
      const text = finalText.trim();
      if (text) void send(text);
    };
    recRef.current = rec;
    try { rec.start(); } catch { setListening(false); }
  }, [listening, send]);

  const clearAll = () => {
    setMessages([]);
    localStorage.removeItem(STORAGE_KEY);
    audioRef.current?.pause();
    setStatus("MEMORY WIPED");
  };

  const toggleVoice = () => {
    setVoiceOn((v) => {
      if (v) audioRef.current?.pause();
      return !v;
    });
  };

  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant")?.content;
  const active = listening || thinking || speaking;

  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden">
      {/* BG */}
      <div className="jarvis-grid pointer-events-none absolute inset-0 opacity-30" />
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_center,transparent_30%,var(--background)_85%)]" />

      {/* Top bar */}
      <header className="relative z-10 flex items-center justify-between border-b border-jarvis/20 px-6 py-2 text-[10px] uppercase tracking-[0.35em] text-jarvis">
        <div className="flex items-center gap-3">
          <span className="inline-block h-2 w-2 rounded-full bg-jarvis animate-hud shadow-[0_0_10px_currentColor]" />
          <span className="text-glow">J.A.R.V.I.S.</span>
          <span className="text-muted-foreground">/ MK-VII</span>
        </div>
        <div className="hidden md:block text-jarvis-accent text-glow font-mono">{clock}</div>
        <div className="flex items-center gap-4">
          <span className="text-muted-foreground">STATUS</span>
          <span className="text-jarvis-accent text-glow">◆ {status}</span>
        </div>
      </header>

      {/* Corner HUD */}
      <HudCorner
        align="tl"
        title="System"
        lines={["CPU · 12%", "MEM · 4.2 / 16 GB", "NET · SECURE", "AI CORE · ONLINE"]}
      />
      <HudCorner
        align="tr"
        title="Sensors"
        lines={["AMBIENT · 21.4°C", "PRESSURE · 1013 hPa", "GEO · LOCK", "SIGNAL · 98%"]}
      />
      <HudCorner
        align="bl"
        title="Diagnostics"
        lines={["ARC · 3.2 GJ", "COOLANT · 100%", "LATENCY · 42ms", "UPTIME · 12:44:07"]}
      />
      <HudCorner
        align="br"
        title="Uplink"
        lines={["MODEL · COMPOUND", "SEARCH · LIVE", "TTS · ONLINE", "ENC · AES-256"]}
      />

      {/* Main stage */}
      <main className="relative z-10 flex flex-1 flex-col items-center justify-center gap-4 px-4 pb-2 md:px-10">
        {/* Reactor */}
        <div className="relative flex shrink-0 items-center justify-center">
          <div className="relative h-[300px] w-[300px] md:h-[440px] md:w-[440px]">
            {/* Rotating text ring - outer */}
            <svg className="absolute inset-0 h-full w-full animate-spin-slow" viewBox="0 0 400 400">
              <defs>
                <path id="circleOuter" d="M 200,200 m -190,0 a 190,190 0 1,1 380,0 a 190,190 0 1,1 -380,0" />
              </defs>
              <text fill="currentColor" className="fill-jarvis text-[10px] tracking-[0.4em]" style={{ letterSpacing: "0.4em" }}>
                <textPath href="#circleOuter">{RING_TEXT_OUTER.repeat(3)}</textPath>
              </text>
            </svg>
            {/* Rotating text ring - inner reverse */}
            <svg className="absolute inset-6 h-[calc(100%-3rem)] w-[calc(100%-3rem)] animate-spin-reverse" viewBox="0 0 400 400">
              <defs>
                <path id="circleInner" d="M 200,200 m -170,0 a 170,170 0 1,1 340,0 a 170,170 0 1,1 -340,0" />
              </defs>
              <text fill="currentColor" className="fill-jarvis-accent text-[9px]">
                <textPath href="#circleInner">{RING_TEXT_INNER.repeat(3)}</textPath>
              </text>
            </svg>

            {/* Tick marks ring */}
            <div className="absolute inset-12 rounded-full border border-jarvis/30">
              {Array.from({ length: 60 }).map((_, i) => (
                <span
                  key={i}
                  className="absolute left-1/2 top-1/2 h-2 w-[1px] origin-bottom bg-jarvis/40"
                  style={{
                    transform: `translate(-50%, -100%) rotate(${i * 6}deg) translateY(-${140}px)`,
                    height: i % 5 === 0 ? "8px" : "3px",
                    opacity: i % 5 === 0 ? 0.9 : 0.4,
                  }}
                />
              ))}
            </div>

            {/* Reactor image */}
            <img
              src={jarvisCore}
              alt=""
              width={440}
              height={440}
              className={`absolute inset-16 h-[calc(100%-4rem)] w-[calc(100%-4rem)] object-contain animate-reactor ${active ? "animate-pulse-glow" : ""}`}
            />

            {/* Audio bars around center */}
            <div className="absolute inset-0 flex items-end justify-center gap-[3px] pb-[calc(50%-24px)]">
              {levels.map((v, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-jarvis shadow-[0_0_6px_currentColor]"
                  style={{ height: `${8 + v * 60}px`, opacity: 0.5 + v * 0.5 }}
                />
              ))}
            </div>

            {/* Center label */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="translate-y-16 text-center font-mono text-[10px] uppercase tracking-[0.4em] text-jarvis/80 text-glow">
                {listening ? "◉ LISTENING" : speaking ? "◈ SPEAKING" : thinking ? "◇ PROCESSING" : "◇ STANDBY"}
              </div>
            </div>
          </div>
        </div>

        {/* Dialogue */}
        <section className="relative flex w-full max-w-3xl flex-col rounded-md border border-jarvis/30 bg-background/50 px-4 py-3 backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-jarvis-accent">
            <span>▸ Transcript</span>
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          </div>
          <div ref={scrollRef} className="max-h-[22vh] min-h-[80px] space-y-2 overflow-y-auto pr-2">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                <span className="text-jarvis text-glow">Good day, sir.</span> All systems nominal. Speak, or type a query — I have live web access.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`text-sm leading-relaxed ${m.role === "user" ? "text-jarvis-accent" : "text-foreground"}`}>
                <span className="mr-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                  {m.role === "user" ? "▸ You" : "◇ Jarvis"}
                </span>
                <span className={m.role === "assistant" ? "text-glow" : ""}>{m.content}</span>
              </div>
            ))}
            {thinking && (
              <div className="flex items-center gap-2 text-sm text-jarvis">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="animate-pulse">Consulting the network…</span>
              </div>
            )}
          </div>
          {speaking && lastAssistant && (
            <div className="mt-2 border-t border-jarvis/20 pt-2 text-xs italic text-jarvis-accent text-glow line-clamp-2">
              🔊 {lastAssistant}
            </div>
          )}
        </section>
      </main>

      {/* Footer input */}
      <footer className="relative z-10 border-t border-jarvis/20 bg-background/40 px-4 py-3 backdrop-blur-md md:px-10">
        <form
          onSubmit={(e) => { e.preventDefault(); void send(input); }}
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
            title={listening ? "Stop" : "Speak"}
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
    </div>
  );
}
