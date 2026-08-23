// One speech-input surface for the native app and the web app.
//
// Electron owns the higher-quality Apple recognizer. Browsers that expose
// the Web Speech API use it as a fallback, which keeps dictation and calls
// available in Chrome/Edge without sending microphone bytes through our
// server. Safari/Firefox builds without SpeechRecognition simply report the
// feature as unavailable.

export type SpeechTranscript = { partial?: boolean; text?: string; error?: string };
export type SpeechEnd = { code: number | null; reason?: string };

type TranscriptListener = (line: SpeechTranscript) => void;
type EndListener = (info: SpeechEnd) => void;

type BrowserSpeechResult = {
  isFinal: boolean;
  0?: { transcript?: string };
};

type BrowserSpeechEvent = {
  results: ArrayLike<BrowserSpeechResult>;
};

type BrowserSpeechErrorEvent = { error?: string; message?: string };

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onresult: ((event: BrowserSpeechEvent) => void) | null;
  onerror: ((event: BrowserSpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type BrowserSpeechConstructor = new () => BrowserSpeechRecognition;

function browserConstructor(): BrowserSpeechConstructor | undefined {
  // SAFETY: Web Speech is a browser vendor extension absent from lib.dom;
  // both properties are constructor-shaped when browsers expose them.
  const speechWindow = window as Window & {
    SpeechRecognition?: BrowserSpeechConstructor;
    webkitSpeechRecognition?: BrowserSpeechConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
}

function browserSpeechAvailable(): boolean {
  if (!browserConstructor()) return false;
  // Microphone access is restricted to secure contexts, with localhost
  // treated as secure by browsers. Reflect that restriction in the UI.
  return window.isSecureContext || ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}

class SpeechInput {
  private transcripts = new Set<TranscriptListener>();
  private endings = new Set<EndListener>();
  private recognition: BrowserSpeechRecognition | null = null;
  private stopIsIntentional = false;
  private pendingEnd: SpeechEnd | null = null;

  available(): boolean {
    return Boolean(window.ogb?.speechStart) || browserSpeechAvailable();
  }

  engine(): "apple-speech" | "browser-speech" | "none" {
    if (window.ogb?.speechStart) return "apple-speech";
    return browserSpeechAvailable() ? "browser-speech" : "none";
  }

  async start(options?: { endpointMs?: number }): Promise<void> {
    if (window.ogb?.speechStart) return window.ogb.speechStart(options);
    const Constructor = browserConstructor();
    if (!Constructor || !browserSpeechAvailable()) throw new Error("speech recognition is unavailable");
    if (this.recognition) return;

    const recognition = new Constructor();
    this.recognition = recognition;
    this.stopIsIntentional = false;
    this.pendingEnd = null;
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      if (this.recognition !== recognition) return;
      const parts: string[] = [];
      let final = false;
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript;
        if (transcript) parts.push(transcript.trim());
        if (index === event.results.length - 1) final = Boolean(result?.isFinal);
      }
      const text = parts.filter(Boolean).join(" ").trim();
      if (text) this.emitTranscript({ text, partial: !final });
    };
    recognition.onerror = (event) => {
      if (this.recognition !== recognition || this.stopIsIntentional) return;
      const reason = event.error || event.message || "speech-recognition-error";
      const permission = reason === "not-allowed" || reason === "service-not-allowed";
      const unsupported = reason === "language-not-supported";
      this.pendingEnd = { code: permission ? 1 : unsupported ? 2 : 0, reason };
      if (!permission && reason !== "no-speech" && reason !== "aborted") {
        this.emitTranscript({ error: reason });
      }
    };
    recognition.onend = () => {
      if (this.recognition !== recognition) return;
      const intentional = this.stopIsIntentional;
      const end = this.pendingEnd ?? { code: 0 };
      this.recognition = null;
      this.stopIsIntentional = false;
      this.pendingEnd = null;
      if (!intentional) this.emitEnd(end);
    };
    try {
      recognition.start();
    } catch (error) {
      if (this.recognition === recognition) this.recognition = null;
      throw error;
    }
  }

  async stop(): Promise<void> {
    if (window.ogb?.speechStop) return window.ogb.speechStop();
    const recognition = this.recognition;
    if (!recognition) return;
    this.stopIsIntentional = true;
    recognition.abort();
  }

  async finish(): Promise<void> {
    if (window.ogb?.speechFinish) return window.ogb.speechFinish();
    const recognition = this.recognition;
    if (!recognition) return;
    // stop(), unlike abort(), asks Web Speech to deliver its final result.
    recognition.stop();
  }

  onTranscript(listener: TranscriptListener): () => void {
    if (window.ogb?.onSpeechTranscript) return window.ogb.onSpeechTranscript(listener);
    this.transcripts.add(listener);
    return () => this.transcripts.delete(listener);
  }

  onEnd(listener: EndListener): () => void {
    if (window.ogb?.onSpeechEnd) return window.ogb.onSpeechEnd(listener);
    this.endings.add(listener);
    return () => this.endings.delete(listener);
  }

  private emitTranscript(line: SpeechTranscript) {
    for (const listener of this.transcripts) listener(line);
  }

  private emitEnd(info: SpeechEnd) {
    for (const listener of this.endings) listener(info);
  }
}

export const speechInput = new SpeechInput();
