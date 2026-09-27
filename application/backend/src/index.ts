/**
 * Public entry point.
 *
 * Nothing is exported that a consumer should depend on beyond `createApp`; the
 * rest of the modules are internal wiring, and exporting them would make every
 * refactor a breaking change.
 */
export { createApp } from './app.js';
export { env } from './config/app-env.js';
