// @bartleby/shared — the REST wire contract shared by the web client and
// the server. Types only; every import of this package is `import type` and
// erases at build time, so there is no runtime dependency and no build step.
export type * from './notes.js';
export type * from './comments.js';
export type * from './snapshots.js';
export type * from './mentions.js';
export type * from './users.js';
export type * from './search.js';
export type * from './errors.js';
