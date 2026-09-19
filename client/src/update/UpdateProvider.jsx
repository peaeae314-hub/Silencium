import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { UpdateContext } from './updateContext';
import UpdatePromptDialog from './UpdatePromptDialog';
import {
  checkForPrompt,
  checkStatus,
  getInstalledVersion,
  ignoreVersion,
  shouldAutoCheck,
  snoozeVersion,
} from './updateService';

/**
 * Hosts the in-app update check: one silent check per cold start once
 * [autoCheck] flips true (the app booted, i.e. locale + relay URL are ready),
 * plus an on-demand check exposed to Settings via `useUpdate()`.
 *
 * The prompt itself is rendered here, above the router, so it also covers the
 * first-launch Settings screen on a device that has no relay configured yet.
 */
export default function UpdateProvider({ children, autoCheck = false }) {
  const [installed, setInstalled] = useState(null);
  const [prompt, setPrompt] = useState(null);
  const autoCheckDone = useRef(false);
  const promptOpen = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const version = await getInstalledVersion();
      if (!cancelled) setInstalled(version);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!autoCheck || autoCheckDone.current) return;
    autoCheckDone.current = true;
    // Web (browser) builds skip the silent check: the served bundle is already
    // the latest one. Settings still offers a manual check.
    if (!shouldAutoCheck()) return;

    let cancelled = false;
    (async () => {
      const result = await checkForPrompt({ forceManual: false });
      if (cancelled || result.status !== checkStatus.updateAvailable) return;
      promptOpen.current = true;
      setPrompt(result);
    })();
    return () => {
      cancelled = true;
    };
  }, [autoCheck]);

  const closePrompt = useCallback(() => {
    promptOpen.current = false;
    setPrompt(null);
  }, []);

  /** "Later" — snooze so the next cold starts stay quiet for a while. */
  const handleLater = useCallback(async () => {
    if (prompt?.manifest) await snoozeVersion(prompt.manifest.versionCode);
    closePrompt();
  }, [prompt, closePrompt]);

  /** "Skip this version" — persist the skip for this remote versionCode. */
  const handleSkip = useCallback(async () => {
    if (prompt?.manifest) await ignoreVersion(prompt.manifest.versionCode);
    closePrompt();
  }, [prompt, closePrompt]);

  /** Settings → Check for updates. Ignores skip/snooze (forceManual). */
  const checkManually = useCallback(async () => {
    const result = await checkForPrompt({ forceManual: true });
    if (result.status === checkStatus.updateAvailable && !promptOpen.current) {
      promptOpen.current = true;
      setPrompt(result);
    }
    return result;
  }, []);

  const value = useMemo(
    () => ({ installed, checkManually, checkStatus }),
    [installed, checkManually]
  );

  return (
    <UpdateContext.Provider value={value}>
      {children}
      {prompt && (
        <UpdatePromptDialog
          manifest={prompt.manifest}
          installed={prompt.installed || installed}
          onLater={handleLater}
          onSkip={handleSkip}
          onDismiss={closePrompt}
        />
      )}
    </UpdateContext.Provider>
  );
}
