import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Volume2, VolumeX, Trash2, Loader2, Radio, ExternalLink } from "lucide-react";
import jarvisCore from "@/assets/jarvis-core-v2.png";

export const Route = createFileRoute("/")({
  component: Jarvis,
});

type Citation = { title?: string; url: string; snippet?: string };
type Msg = { role: "user" | "assistant"; content: string; citations?: Citation[] };
const STORAGE_KEY = "jarvis.conversation.v1";
const WAKE_WORDS = ["jarvis", "hey jarvis", "ok jarvis"];

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

function stripWake(text: string): string {
  let t = text.trim().toLowerCase();
  for (const w of WAKE_WORDS) {
    if (t.startsWith(w)) {
      t = t.slice(w.length);
      break;
    }
  }
  return t.replace(/^[,.\s!?:;-]+/, "").trim();
}
function containsWake(text: string): boolean {
  const t = text.toLowerCase();
  return WAKE_WORDS.some((w) => t.includes(w));
}

function Jarvis() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [voiceOn, setVoiceOn] = useState(true);
  const [radioFx, setRadioFx] = useState(true);
  const [wakeMode, setWakeMode] = useState(false);
  const [wakeHeard, setWakeHeard] = useState(false);
  const [status, setStatus] = useState("STANDBY");
  const [levels, setLevels] = useState<number[]>(() => Array(32).fill(0.15));
  const [clock, setClock] = useState<string>("");
  const [citations, setCitations] = useState<Citation[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recRef = useRef<any>(null); // command recognizer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const wakeRecRef = useRef<any>(null); // wake recognizer
  const wakeActiveRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const crackleStopRef = useRef<(() => void) | null>(null);
  const speakingRef = useRef(false);
  const listeningRef = useRef(false);
  const thinkingRef = useRef(false);

  useEffect(() => { speakingRef.current = speaking; }, [speaking]);
  useEffect(() => { listeningRef.current = listening; }, [listening]);
  useEffect(() => { thinkingRef.current = thinking; }, [thinking]);

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
    const last = [...messages].reverse().find((m) => m.role === "assistant");
    if (last?.citations?.length) setCitations(last.citations);
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

  const startCrackle = useCallback((ctx: AudioContext, dest: AudioNode) => {
    // Generate ~2s of pink-ish noise loop
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < ch.length; i++) {
      // Sparse crackle: mostly silent, occasional pops
      const r = Math.random();
      ch[i] = r > 0.995 ? (Math.random() * 2 - 1) * 0.8 : (Math.random() * 2 - 1) * 0.04;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = 1200;
    const g = ctx.createGain();
    g.gain.value = 0.06;
    src.connect(hp).connect(g).connect(dest);
    src.start();
    return () => { try { src.stop(); } catch { /* noop */ } };
  }, []);

  const speak = useCallback(
    async (text: string) => {
      if (!voiceOn) return;
      try {
        stopVisualizer();
        crackleStopRef.current?.();
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
        audio.crossOrigin = "anonymous";
        audioRef.current = audio;

        if (!audioCtxRef.current) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const Ctx = (window.AudioContext || (window as any).webkitAudioContext) as typeof AudioContext;
          audioCtxRef.current = new Ctx();
        }
        const ctx = audioCtxRef.current;
        if (ctx.state === "suspended") await ctx.resume().catch(() => {});
        const src = ctx.createMediaElementSource(audio);

        let tail: AudioNode = src;
        if (radioFx) {
          // Bandpass (comms radio): highpass 500Hz + lowpass 3400Hz
          const hp = ctx.createBiquadFilter();
          hp.type = "highpass";
          hp.frequency.value = 500;
          hp.Q.value = 0.7;
          const lp = ctx.createBiquadFilter();
          lp.type = "lowpass";
          lp.frequency.value = 3400;
          lp.Q.value = 0.7;
          // Slight peaking boost around 2kHz for intelligibility
          const pk = ctx.createBiquadFilter();
          pk.type = "peaking";
          pk.frequency.value = 2000;
          pk.Q.value = 1.2;
          pk.gain.value = 4;
          // Waveshaper for subtle saturation
          const shaper = ctx.createWaveShaper();
          const curve = new Float32Array(1024);
          for (let i = 0; i < 1024; i++) {
            const x = (i / 1024) * 2 - 1;
            curve[i] = ((3 + 8) * x) / (Math.PI + 8 * Math.abs(x)); // soft clip
          }
          shaper.curve = curve;
          shaper.oversample = "4x";
          // Compressor
          const comp = ctx.createDynamicsCompressor();
          comp.threshold.value = -22;
          comp.knee.value = 12;
          comp.ratio.value = 6;
          comp.attack.value = 0.003;
          comp.release.value = 0.15;
          // Makeup gain
          const gain = ctx.createGain();
          gain.gain.value = 1.35;

          src.connect(hp);
          hp.connect(lp);
          lp.connect(pk);
          pk.connect(shaper);
          shaper.connect(comp);
          comp.connect(gain);
          tail = gain;

          // Crackle bed
          crackleStopRef.current = startCrackle(ctx, ctx.destination);
        }

        tail.connect(ctx.destination);
        startAudioVisualizer(tail);

        audio.onplay = () => { setSpeaking(true); setStatus("SPEAKING"); };
        const cleanup = () => {
          setSpeaking(false);
          stopVisualizer();
          crackleStopRef.current?.();
          crackleStopRef.current = null;
          URL.revokeObjectURL(url);
        };
        audio.onended = () => { cleanup(); setStatus("READY"); };
        audio.onerror = () => { cleanup(); setStatus("AUDIO ERROR"); };
        await audio.play();
      } catch (e) {
        console.error("TTS failed", e);
        setSpeaking(false);
      }
    },
    [voiceOn, radioFx, startAudioVisualizer, stopVisualizer, startCrackle],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || thinkingRef.current) return;
      const next: Msg[] = [...messages, { role: "user", content: trimmed }];
      setMessages(next);
      setInput("");
      setThinking(true);
      setStatus("PROCESSING");
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: next.map(({ role, content }) => ({ role, content })) }),
        });
        if (!res.ok) throw new Error(await res.text());
        const data = (await res.json()) as { content: string; citations?: Citation[] };
        const reply = data.content || "I'm afraid I couldn't formulate a response, sir.";
        setMessages((m) => [...m, { role: "assistant", content: reply, citations: data.citations ?? [] }]);
        if (data.citations?.length) setCitations(data.citations);
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
    [messages, speak],
  );

  const startCommandListen = useCallback(() => {
    const Rec = getRecognition();
    if (!Rec) { setStatus("VOICE INPUT UNAVAILABLE"); return; }
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
      setWakeHeard(false);
      if (text) void send(text);
    };
    recRef.current = rec;
    try { rec.start(); } catch { setListening(false); }
  }, [send]);

  const toggleListen = useCallback(() => {
    if (listening) { recRef.current?.stop(); return; }
    startCommandListen();
  }, [listening, startCommandListen]);

  // Wake-word recognizer: continuous listener
  useEffect(() => {
    if (!wakeMode) {
      wakeActiveRef.current = false;
      try { wakeRecRef.current?.stop(); } catch { /* noop */ }
      wakeRecRef.current = null;
      return;
    }
    const Rec = getRecognition();
    if (!Rec) { setStatus("WAKE UNAVAILABLE"); setWakeMode(false); return; }
    wakeActiveRef.current = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rec: any = new Rec();
    rec.lang = "en-US";
    rec.continuous = true;
    rec.interimResults = true;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    rec.onresult = (ev: any) => {
      if (listeningRef.current || speakingRef.current || thinkingRef.current) return;
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const r = ev.results[i];
        const t = r[0].transcript as string;
        if (containsWake(t)) {
          setWakeHeard(true);
          const rest = stripWake(t);
          if (r.isFinal && rest.length > 2) {
            try { rec.stop(); } catch { /* noop */ }
            void send(rest);
          } else if (r.isFinal) {
            try { rec.stop(); } catch { /* noop */ }
            startCommandListen();
          }
          break;
        }
      }
    };
    rec.onerror = () => { /* keep going */ };
    rec.onend = () => {
      if (wakeActiveRef.current) {
        try { rec.start(); } catch { /* noop */ }
      }
    };
    wakeRecRef.current = rec;
    try { rec.start(); setStatus("WAKE ARMED"); } catch { /* noop */ }
    return () => {
      wakeActiveRef.current = false;
      try { rec.stop(); } catch { /* noop */ }
    };
  }, [wakeMode, send, startCommandListen]);

  const clearAll = () => {
    setMessages([]);
    setCitations([]);
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

  const onReactorClick = () => {
    if (speaking) { audioRef.current?.pause(); return; }
    if (listening) { recRef.current?.stop(); return; }
    startCommandListen();
  };

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
        lines={["MODEL · COMPOUND", "SEARCH · LIVE", radioFx ? "COMMS · RADIO FX" : "COMMS · CLEAN", "ENC · AES-256"]}
      />

      {/* Main stage */}
      <main className="relative z-10 grid flex-1 grid-cols-1 items-center gap-4 px-4 pb-2 md:grid-cols-[1fr_minmax(0,440px)_1fr] md:px-10">
        {/* Left: Citations panel */}
        <aside className="hidden max-h-[70vh] flex-col overflow-hidden rounded-md border border-jarvis/30 bg-background/40 p-3 backdrop-blur-md md:flex">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-jarvis-accent">
            <span>▸ Intel · Web Sources</span>
            <span className="text-muted-foreground">{citations.length}</span>
          </div>
          <div className="space-y-2 overflow-y-auto pr-1">
            {citations.length === 0 && (
              <p className="text-xs text-muted-foreground">No intel gathered yet, sir. Ask a question requiring live data.</p>
            )}
            {citations.map((c, i) => (
              <a
                key={i}
                href={c.url}
                target="_blank"
                rel="noreferrer"
                className="group block rounded border border-jarvis/20 bg-jarvis/5 p-2 transition-all hover:border-jarvis hover:bg-jarvis/10 hover:ring-glow"
              >
                <div className="flex items-start gap-2">
                  <span className="mt-0.5 text-[10px] font-mono text-jarvis-accent">[{i + 1}]</span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-xs font-medium text-jarvis text-glow">
                      {c.title || new URL(c.url).hostname}
                    </div>
                    <div className="truncate text-[10px] font-mono text-muted-foreground">
                      {(() => { try { return new URL(c.url).hostname; } catch { return c.url; } })()}
                    </div>
                    {c.snippet && (
                      <p className="mt-1 line-clamp-3 text-[11px] leading-snug text-foreground/80">
                        {c.snippet}
                      </p>
                    )}
                  </div>
                  <ExternalLink className="h-3 w-3 shrink-0 text-jarvis/60 group-hover:text-jarvis" />
                </div>
              </a>
            ))}
          </div>
        </aside>

        {/* Center: Reactor */}
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

            {/* Reactor image - clickable */}
            <button
              type="button"
              onClick={onReactorClick}
              aria-label="Tap to speak"
              className="absolute inset-16 h-[calc(100%-4rem)] w-[calc(100%-4rem)] cursor-pointer rounded-full transition-transform hover:scale-[1.03] focus:outline-none"
            >
              <img
                src={jarvisCore}
                alt="Arc reactor core"
                width={1024}
                height={1024}
                className={`h-full w-full object-contain animate-reactor ${active ? "animate-pulse-glow" : ""}`}
              />
            </button>

            {/* Audio bars around center */}
            <div className="pointer-events-none absolute inset-0 flex items-end justify-center gap-[3px] pb-[calc(50%-24px)]">
              {levels.map((v, i) => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-jarvis shadow-[0_0_6px_currentColor]"
                  style={{ height: `${8 + v * 60}px`, opacity: 0.5 + v * 0.5 }}
                />
              ))}
            </div>

            {/* Center label */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="translate-y-16 text-center font-mono text-[10px] uppercase tracking-[0.4em] text-jarvis/80 text-glow">
                {listening ? "◉ LISTENING" : speaking ? "◈ SPEAKING" : thinking ? "◇ PROCESSING" : wakeMode ? (wakeHeard ? "◉ WAKE HEARD" : "◇ WAKE ARMED") : "◇ TAP TO SPEAK"}
              </div>
            </div>
          </div>
        </div>

        {/* Right: Dialogue */}
        <section className="relative flex max-h-[70vh] w-full flex-col rounded-md border border-jarvis/30 bg-background/50 px-4 py-3 backdrop-blur-md">
          <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-[0.3em] text-jarvis-accent">
            <span>▸ Transcript</span>
            <button
              onClick={clearAll}
              className="inline-flex items-center gap-1 rounded border border-border/60 px-2 py-1 text-muted-foreground transition-colors hover:border-destructive hover:text-destructive"
            >
              <Trash2 className="h-3 w-3" /> Clear
            </button>
          </div>
          <div ref={scrollRef} className="min-h-[120px] flex-1 space-y-2 overflow-y-auto pr-2">
            {messages.length === 0 && (
              <p className="text-sm text-muted-foreground">
                <span className="text-jarvis text-glow">Good day, sir.</span> All systems nominal. Say <span className="text-jarvis-accent">"Jarvis"</span> to wake me, or tap the reactor.
              </p>
            )}
            {messages.map((m, i) => (
              <div key={i} className={`text-sm leading-relaxed ${m.role === "user" ? "text-jarvis-accent" : "text-foreground"}`}>
                <span className="mr-2 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
                  {m.role === "user" ? "▸ You" : "◇ Jarvis"}
                </span>
                <span className={m.role === "assistant" ? "text-glow" : ""}>{m.content}</span>
                {m.role === "assistant" && m.citations && m.citations.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {m.citations.map((c, j) => (
                      <a
                        key={j}
                        href={c.url}
                        target="_blank"
                        rel="noreferrer"
                        title={c.title || c.url}
                        className="inline-flex items-center gap-1 rounded border border-jarvis/30 bg-jarvis/5 px-1.5 py-0.5 text-[10px] font-mono text-jarvis hover:border-jarvis hover:bg-jarvis/15"
                      >
                        [{j + 1}] {(() => { try { return new URL(c.url).hostname.replace(/^www\./, ""); } catch { return "src"; } })()}
                      </a>
                    ))}
                  </div>
                )}
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
            onClick={() => setWakeMode((w) => !w)}
            className={`inline-flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-[11px] uppercase tracking-[0.2em] transition-all ${
              wakeMode
                ? "border-jarvis bg-jarvis/15 text-jarvis animate-pulse"
                : "border-border text-muted-foreground hover:border-jarvis/60 hover:text-jarvis"
            }`}
            title='Wake word: say "Jarvis"'
          >
            <span className={`h-2 w-2 rounded-full ${wakeMode ? "bg-jarvis shadow-[0_0_8px_currentColor]" : "bg-muted-foreground"}`} />
            Wake
          </button>
          <button
            type="button"
            onClick={() => setRadioFx((r) => !r)}
            className={`hidden h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-[11px] uppercase tracking-[0.2em] transition-all md:inline-flex ${
              radioFx
                ? "border-jarvis-accent/60 text-jarvis-accent"
                : "border-border text-muted-foreground hover:border-jarvis/60"
            }`}
            title="Radio comms filter"
          >
            <Radio className="h-4 w-4" /> FX
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
              placeholder='Speak to Jarvis, sir… or say "Jarvis" if wake is armed'
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
