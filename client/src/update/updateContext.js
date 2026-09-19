// Context + hook live apart from the provider component so react-refresh keeps
// working (same split as `i18n/context.js`).
import { createContext, useContext } from 'react';

export const UpdateContext = createContext(null);

/**
 * `{ installed, checkManually }` for the nearest `<UpdateProvider>`.
 * `checkManually()` resolves to `{ status, manifest, installed }` and opens the
 * prompt itself when a newer build exists.
 */
export function useUpdate() {
  const ctx = useContext(UpdateContext);
  if (!ctx) {
    throw new Error('useUpdate() must be used inside <UpdateProvider>');
  }
  return ctx;
}
