'use client';

// Wrapper de Web Speech API (speechSynthesis) para anunciar instrucciones
// de navegación en español.
//
// Particularidades:
//   - speechSynthesis necesita haber sido ACTIVADO por una interacción del user
//     en algunos browsers (autoplay policy). Por eso tenemos un toggle inicial.
//   - voices array a veces está vacío al cargar la página y se popula async.
//     Escuchamos `voiceschanged` para refrescar.
//   - Si el chofer mutea, NO encolamos — solo skip silencioso.
//   - Si una instrucción nueva llega mientras otra se está leyendo, cancelamos
//     la anterior (el chofer no necesita instrucción vieja, solo la actual).

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_KEY = 'verdfrut.driver.tts.muted';

export function useSpeech() {
  const [muted, setMuted] = useState(false);
  const [available, setAvailable] = useState(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Hidratar mute desde localStorage al montar.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setMuted(localStorage.getItem(STORAGE_KEY) === '1');
  }, []);

  // Detectar disponibilidad + voz en español.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) {
      setAvailable(false);
      return;
    }
    setAvailable(true);

    const pickVoice = () => {
      const voices = window.speechSynthesis.getVoices();
      // Preferir voces es-MX, luego es-* genérica, luego cualquier es.
      voiceRef.current =
        voices.find((v) => v.lang === 'es-MX') ??
        voices.find((v) => v.lang.startsWith('es-')) ??
        voices.find((v) => v.lang.toLowerCase().startsWith('es')) ??
        null;
    };
    pickVoice();
    window.speechSynthesis.onvoiceschanged = pickVoice;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  const toggle = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (typeof window !== 'undefined') {
        localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      }
      // Si muteo, cortar lo que esté hablando.
      if (next && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      return next;
    });
  }, []);

  const speak = useCallback(
    (text: string) => {
      if (muted || !available) return;
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;

      // Cancela cualquier instrucción vieja en cola — la nueva es más relevante.
      window.speechSynthesis.cancel();

      const utter = new SpeechSynthesisUtterance(text);
      if (voiceRef.current) utter.voice = voiceRef.current;
      utter.lang = voiceRef.current?.lang ?? 'es-MX';
      utter.rate = 1.0;
      utter.pitch = 1.0;
      utter.volume = 1.0;
      window.speechSynthesis.speak(utter);
    },
    [muted, available],
  );

  return { speak, toggle, muted, available };
}
