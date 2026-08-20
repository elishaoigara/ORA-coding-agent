"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type SpeechRecognitionEventLike = { results: { [index: number]: { [index: number]: { transcript: string } } } };
type SpeechRecognitionErrorEventLike = { error?: string };
type Recognition = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type RecognitionConstructor = new () => Recognition;

type WindowWithSpeech = Window & { SpeechRecognition?: RecognitionConstructor; webkitSpeechRecognition?: RecognitionConstructor };

export function useSpeechRecognition({ onTranscript, lang = "en-US" }: { onTranscript: (text: string) => void; lang?: string }) {
  const recognitionRef = useRef<Recognition | null>(null);
  const [isSupported, setIsSupported] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const ctor = typeof window === "undefined" ? undefined : (window as WindowWithSpeech).SpeechRecognition ?? (window as WindowWithSpeech).webkitSpeechRecognition;
    setIsSupported(Boolean(ctor));
    if (!ctor) return;
    const recognition = new ctor();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = lang;
    recognition.onresult = (event) => {
      const lastIndex = Object.keys(event.results).map(Number).sort((a, b) => b - a)[0];
      const transcript = lastIndex === undefined ? "" : event.results[lastIndex]?.[0]?.transcript ?? "";
      if (transcript.trim()) onTranscript(transcript);
    };
    recognition.onerror = (event) => {
      setError(event.error === "not-allowed" ? "Microphone permission was blocked" : "Voice input stopped");
      setIsListening(false);
    };
    recognition.onend = () => setIsListening(false);
    recognitionRef.current = recognition;
    return () => { recognition.onresult = null; recognition.onerror = null; recognition.onend = null; recognitionRef.current = null; };
  }, [lang, onTranscript]);

  const toggle = useCallback(() => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    setError(null);
    if (isListening) { recognition.stop(); setIsListening(false); return; }
    try { recognition.start(); setIsListening(true); } catch { setError("Voice input is already active"); }
  }, [isListening]);

  return { isSupported, isListening, error, toggle };
}
