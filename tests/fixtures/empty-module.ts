// Stand-in for the `server-only` marker package under vitest. Next resolves
// `server-only` itself (and fails the build if a client module imports it);
// tests run in plain Node, where server modules are always allowed.
export {};
