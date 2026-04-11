import { createContext, useContext, useState, useCallback, useMemo, useRef } from 'react';

/**
 * LinkAccountsContext
 * ───────────────────
 * Single shared open/close state for the Link Accounts modal so any page
 * inside the dashboard shell can pop it without navigating away. The
 * <LinkAccountsSheet /> itself is rendered once at the dashboard layout
 * level; pages just call `openLinkAccounts()` from this hook.
 *
 * Also exposes `notifyAccountsChanged(platform)` so the sheet can signal
 * when a platform is disconnected, and `onAccountsChanged(fn)` so pages
 * (e.g. InboxPage) can react immediately without a refresh.
 */
const LinkAccountsContext = createContext(null);

export function LinkAccountsProvider({ children }) {
  const [open, setOpen] = useState(false);
  const listenersRef = useRef([]);

  const openLinkAccounts = useCallback(() => setOpen(true), []);
  const closeLinkAccounts = useCallback(() => setOpen(false), []);

  // Register a listener; returns an unsubscribe function.
  const onAccountsChanged = useCallback((fn) => {
    listenersRef.current.push(fn);
    return () => {
      listenersRef.current = listenersRef.current.filter((l) => l !== fn);
    };
  }, []);

  // Called by LinkAccountsSheet after a successful disconnect.
  const notifyAccountsChanged = useCallback((platform) => {
    listenersRef.current.forEach((fn) => fn(platform));
  }, []);

  const value = useMemo(
    () => ({ open, openLinkAccounts, closeLinkAccounts, onAccountsChanged, notifyAccountsChanged }),
    [open, openLinkAccounts, closeLinkAccounts, onAccountsChanged, notifyAccountsChanged],
  );

  return (
    <LinkAccountsContext.Provider value={value}>
      {children}
    </LinkAccountsContext.Provider>
  );
}

export function useLinkAccounts() {
  const ctx = useContext(LinkAccountsContext);
  if (!ctx) {
    throw new Error('useLinkAccounts must be used inside a LinkAccountsProvider');
  }
  return ctx;
}
