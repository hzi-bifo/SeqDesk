"use client";

import { useSyncExternalStore } from "react";

const STORAGE_KEY = "seqdesk-help-text-visible";
const CHANGE_EVENT = "seqdesk-help-text-change";

function subscribe(onStoreChange: () => void) {
  window.addEventListener("storage", onStoreChange);
  window.addEventListener(CHANGE_EVENT, onStoreChange);
  return () => {
    window.removeEventListener("storage", onStoreChange);
    window.removeEventListener(CHANGE_EVENT, onStoreChange);
  };
}

function getSnapshot() {
  return localStorage.getItem(STORAGE_KEY) !== "false";
}

function getServerSnapshot() {
  return true;
}

function subscribeToHydration() {
  return () => {};
}

function writePreference(value: boolean) {
  localStorage.setItem(STORAGE_KEY, String(value));
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function useHelpText() {
  const showHelpText = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const isLoaded = useSyncExternalStore(subscribeToHydration, () => true, () => false);

  const toggleHelpText = () => {
    writePreference(!showHelpText);
  };

  const hideHelpText = () => {
    writePreference(false);
  };

  const showHelpTextAgain = () => {
    writePreference(true);
  };

  return {
    showHelpText,
    isLoaded,
    toggleHelpText,
    hideHelpText,
    showHelpTextAgain,
  };
}
