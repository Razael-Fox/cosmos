'use client';

import React, { createContext, useContext, useState } from 'react';
import { dictionary, type Dictionary, type Language } from './dictionary';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: Dictionary;
}

const STORAGE_KEY = 'cosmos_language';

function getInitialLanguage(): Language {
  if (typeof window === 'undefined') return 'id';
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'id' || saved === 'en') return saved;
  } catch {
    // ignore
  }
  return 'id';
}

const LanguageContext = createContext<LanguageContextType>({
  language: 'id',
  setLanguage: () => {},
  t: dictionary.id,
});

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

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
