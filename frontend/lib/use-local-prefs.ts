"use client";

import { useState, useCallback, useRef } from "react";

const STORAGE_KEY = "dekant-pm-prefs";

export interface AppPrefs {
  chartSmooth: boolean;
  chartYUnit: "pct" | "price";
  chartDynamicScale: boolean;
}

const DEFAULTS: AppPrefs = {
  chartSmooth: true,
  chartYUnit: "pct",
  chartDynamicScale: true,
};

function loadPrefs(): AppPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...JSON.parse(raw) };
  } catch {
    return DEFAULTS;
  }
}

function savePrefs(prefs: AppPrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    // localStorage unavailable (SSR, private browsing quota, etc.)
  }
}

export function useLocalPrefs() {
  const [prefs, setPrefsState] = useState<AppPrefs>(loadPrefs);
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const setPref = useCallback(<K extends keyof AppPrefs>(key: K, value: AppPrefs[K]) => {
    const next = { ...prefsRef.current, [key]: value };
    prefsRef.current = next;
    setPrefsState(next);
    savePrefs(next);
  }, []);

  return { prefs, setPref } as const;
}
