import { useEffect, useState } from "react";
import { readJson, writeJson } from "./core";

type TabPreferences = { closed: string[]; archived: string[]; order: string[] };
const STORAGE_PROJECT_TABS = "aieyra.projectTabs.v1";

export function useProjectTabPreferences() {
  const [preferences, setPreferences] = useState<TabPreferences>(() => {
    const saved = readJson<TabPreferences>(STORAGE_PROJECT_TABS, { closed: [], archived: [], order: [] });
    const ids = (value: unknown) => Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === "string"))] : [];
    return { closed: ids(saved.closed), archived: ids(saved.archived), order: ids(saved.order) };
  });
  useEffect(() => { writeJson(STORAGE_PROJECT_TABS, preferences); }, [preferences]);
  return [preferences, setPreferences] as const;
}

export function isProjectTabOpen(preferences: TabPreferences, id: string) {
  return !preferences.closed.includes(id) && !preferences.archived.includes(id);
}

export function openProjectTab(preferences: TabPreferences, id: string): TabPreferences {
  return {
    closed: preferences.closed.filter((value) => value !== id),
    archived: preferences.archived.filter((value) => value !== id),
    order: isProjectTabOpen(preferences, id) && preferences.order.includes(id) ? preferences.order : [...preferences.order.filter((value) => value !== id), id]
  };
}

