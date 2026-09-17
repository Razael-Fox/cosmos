'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { dictionary, type Dictionary, type Language } from './dictionary';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Dictionary;
}

const STORAGE_KEY = 'cosmos_language';

const LanguageContext = createContext<LanguageContextType>({
  language: 'id',
  setLanguage: () => {},
  t: dictionary.id,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  // Initialize with the default language to keep server/client render output
  // identical, then hydrate the saved preference on mount to avoid
  // React hydration mismatches when localStorage holds 'en'.
  const [language, setLanguageState] = useState<Language>('id');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'id' || saved === 'en') {
        // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydration-safe sync of persisted preference after mount
        setLanguageState(saved);
      }
    } catch {
      // ignore
    }
  }, []);

  useEffect(() => {
    try {
      document.documentElement.lang = language;
    } catch {
      // ignore
    }
  }, [language]);

  const setLanguage = (lang: Language) => {
    setLanguageState(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // ignore
    }
  };

  const value: LanguageContextType = {
    language,
    setLanguage,
    t: dictionary[language],
  };

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
}

export function useTranslation() {
  return useContext(LanguageContext);
}
