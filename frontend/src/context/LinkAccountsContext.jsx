import { createContext, useContext, useState, useCallback, useMemo } from 'react';

/**
 * LinkAccountsContext
 * ───────────────────
 * Single shared open/close state for the Link Accounts modal so any page
 * inside the dashboard shell can pop it without navigating away. The
 * <LinkAccountsSheet /> itself is rendered once at the dashboard layout
 * level; pages just call `openLinkAccounts()` from this hook.
 *
 * This replaces the previous "redirect to /connections on desktop" path —
 * the modal now works on all viewports.
 */
const LinkAccountsContext = createContext(null);

export function LinkAccountsProvider({ children }) {
  const [open, setOpen] = useState(false);

  const openLinkAccounts = useCallback(() => setOpen(true), []);
  const closeLinkAccounts = useCallback(() => setOpen(false), []);

  const value = useMemo(
    () => ({ open, openLinkAccounts, closeLinkAccounts }),
    [open, openLinkAccounts, closeLinkAccounts],
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
