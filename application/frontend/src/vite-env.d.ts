/// <reference types="vite/client" />

/*
 * Vite's ambient types. Needed because `noUncheckedSideEffectImports` is on,
 * which is the right default: it makes TypeScript complain about importing a
 * non-code file with no type declaration, rather than silently accepting an
 * import that would fail at build time.
 */
