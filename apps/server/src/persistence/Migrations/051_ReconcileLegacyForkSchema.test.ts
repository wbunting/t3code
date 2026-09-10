import { assert, it } from "@effect/vitest";
import { describe } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

describe("051_ReconcileLegacyForkSchema", () => {
  const seedLegacyLink = Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient;
    yield* sql`
      INSERT INTO projection_projects (
        project_id, title, workspace_root, scripts_json, created_at, updated_at
      ) VALUES ('project-1', 'Project', '/tmp/project', '[]', '2026-09-10', '2026-09-10')
    `;
    yield* sql`
      INSERT INTO projection_threads (
        thread_id, project_id, title, model_selection_json,
        linked_pull_request_json, created_at, updated_at
      ) VALUES (
        'thread-1', 'project-1', 'Thread', '{"instanceId":"codex","model":"gpt-5.4"}',
        '{"repository":"wbunting/t3code","number":1,"url":"https://github.com/wbunting/t3code/pull/1"}',
        '2026-09-10', '2026-09-10'
      )
    `;
  });

  it.effect("creates and backfills PR links when fork migration 50 skipped upstream schema", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 49 });
      yield* seedLegacyLink;
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES (50, 'RepairLegacyPinnedColumn')
      `;
      yield* runMigrations();
      const rows = yield* sql<{ thread_id: string; number: number }>`
        SELECT thread_id, number FROM projection_thread_pull_requests
      `;
      assert.deepStrictEqual(rows, [{ thread_id: "thread-1", number: 1 }]);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );

  it.effect("preserves an explicit unlink when upgrading an upstream database", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 49 });
      yield* seedLegacyLink;
      yield* runMigrations({ toMigrationInclusive: 50 });
      yield* sql`DELETE FROM projection_thread_pull_requests`;
      yield* runMigrations();
      const rows = yield* sql`SELECT thread_id FROM projection_thread_pull_requests`;
      assert.deepStrictEqual(rows, []);
    }).pipe(Effect.provide(NodeSqliteClient.layerMemory())),
  );
});
