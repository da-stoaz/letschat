import { defineConfig } from 'vitest/config'

// Two test suites kept apart so the fast frontend unit tests don't drag in the
// heavyweight SpacetimeDB setup:
//   • `unit`     — pure frontend logic (src/**), no external services.
//   • `security` — SpacetimeDB permission-boundary integration tests. They run
//                  against a real SpacetimeDB instance (the dev container on
//                  :4300 by default) but publish the module to a DEDICATED
//                  throwaway database (`letschat_test`) so they never touch
//                  dev/prod data. Override the target with STDB_URL / STDB_TEST_DB.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          environment: 'node',
        },
      },
      {
        test: {
          name: 'security',
          include: ['tests/**/*.test.ts'],
          globalSetup: ['./tests/security/global-setup.ts'],
          // The tests share one database, so run files sequentially for determinism.
          fileParallelism: false,
          testTimeout: 30_000,
          // globalSetup builds the WASM module and publishes it — allow time for that.
          hookTimeout: 180_000,
          environment: 'node',
        },
      },
    ],
  },
})
