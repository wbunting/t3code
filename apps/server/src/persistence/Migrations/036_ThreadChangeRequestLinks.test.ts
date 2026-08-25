import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("036_ThreadChangeRequestLinks", (it) => {
  it.effect("stores one durable pull request association per thread", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 36 });

      yield* sql`
        INSERT INTO thread_change_request_links (
          thread_id,
          provider,
          change_request_number,
          change_request_url,
          head_ref_name,
          head_commit_sha,
          linked_at,
          updated_at
        ) VALUES (
          'thread-1',
          'github',
          54,
          'https://example.test/pull/54',
          'feature/renamed',
          'abc123',
          '2026-08-25T00:00:00.000Z',
          '2026-08-25T00:00:00.000Z'
        )
      `;
      const rows = yield* sql<{
        readonly threadId: string;
        readonly number: number;
        readonly headCommitSha: string;
      }>`
        SELECT
          thread_id AS "threadId",
          change_request_number AS "number",
          head_commit_sha AS "headCommitSha"
        FROM thread_change_request_links
      `;
      assert.deepStrictEqual(rows, [{ threadId: "thread-1", number: 54, headCommitSha: "abc123" }]);
    }),
  );
});
