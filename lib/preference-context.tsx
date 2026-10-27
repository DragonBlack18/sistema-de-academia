'use client';
import { createContext, useContext } from 'react';
import type { PreferenceValues, UserPreferences } from './personalization';
type PreferenceContextValue = { resolved: PreferenceValues; preferences: UserPreferences; busy: boolean; save: (preferences: UserPreferences) => Promise<void> };
export const PreferenceContext = createContext<PreferenceContextValue | null>(null);
export function usePreferences(): PreferenceContextValue {
  const context = useContext(PreferenceContext);
  if (!context) throw new Error('Preferências precisam estar dentro do contexto autenticado.');
  return context;
}
