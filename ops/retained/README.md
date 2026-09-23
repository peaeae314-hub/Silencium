# ops/retained — OFF by default

This directory is for **explicit ops-only** capture (e.g. a recorder browser
saving what a human already can see). It is **not** part of the normal
Silencium relay path.

- `server/app.js` does **not** write here.
- Do not enable automatic plaintext retention in production.
- Any use must be a conscious opt-in outside the shipped server.
