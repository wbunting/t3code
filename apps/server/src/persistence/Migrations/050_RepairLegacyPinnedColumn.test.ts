import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import * as NodeSqliteClient from "@t3tools/shared/nodeSqliteClient";
import { runMigrations } from "../Migrations.ts";

it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()))("050_RepairLegacyPinnedColumn", (it) => {
  it.effect("repairs databases whose fork migration occupied id 36", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 35 });
      yield* sql`
          INSERT INTO effect_sql_migrations (migration_id, name)
          VALUES (36, 'ThreadChangeRequestLinks')
        `;

      yield* runMigrations({ toMigrationInclusive: 51 });

      const columns = yield* sql<{ readonly name: string }>`
          PRAGMA table_info(projection_threads)
        `;
      assert.isTrue(columns.some((column) => column.name === "pinned_at"));
    }),
  );
});
