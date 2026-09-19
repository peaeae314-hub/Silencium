import React from 'react';

/**
 * Render a translated string that may embed `<code>…</code>` spans (used for the
 * relay-URL examples in `settings.hint` / `settings.firstLaunch`). The markup is
 * author-controlled dictionary content, never user input — no HTML injection.
 */
export function renderWithCode(text) {
  if (typeof text !== 'string') return text;
  const OPEN = '<code>';
  const CLOSE = '</code>';
  return text
    .split(/(<code>[\s\S]*?<\/code>)/g)
    .map((part, index) =>
      part.startsWith(OPEN) && part.endsWith(CLOSE) ? (
        <code key={index}>{part.slice(OPEN.length, -CLOSE.length)}</code>
      ) : (
        part
      )
    );
}
