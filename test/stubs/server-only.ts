/**
 * Stand-in for the `server-only` package in unit tests. The real package throws when it is
 * imported outside the React Server Components build, which is what it is for; tests import
 * server modules directly.
 */
export {};
