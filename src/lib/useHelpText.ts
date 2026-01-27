"use client";

import { useState, useEffect } from "react";

const STORAGE_KEY = "seqdesk-help-text-visible";

export function useHelpText() {
  const [showHelpText, setShowHelpText] = useState(true);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored !== null) {
      setShowHelpText(stored === "true");
    }
    setIsLoaded(true);
  }, []);

  const toggleHelpText = () => {
    const newValue = !showHelpText;
    setShowHelpText(newValue);
    localStorage.setItem(STORAGE_KEY, String(newValue));
  };

  const hideHelpText = () => {
    setShowHelpText(false);
    localStorage.setItem(STORAGE_KEY, "false");
  };

  const showHelpTextAgain = () => {
    setShowHelpText(true);
    localStorage.setItem(STORAGE_KEY, "true");
  };

  return {
    showHelpText,
    isLoaded,
    toggleHelpText,
    hideHelpText,
    showHelpTextAgain,
  };
}
