import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import repairLegacyPinnedColumn from "./050_RepairLegacyPinnedColumn.ts";
import createThreadPullRequests from "./050_ProjectionThreadPullRequests.ts";

/** Repairs databases where earlier fork migrations occupied upstream ids 36 or 50. */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* repairLegacyPinnedColumn;

  const tables = yield* sql`
    SELECT name FROM sqlite_master
    WHERE type = 'table' AND name = 'projection_thread_pull_requests'
  `;
  if (tables.length === 0) {
    yield* createThreadPullRequests;
  }
});
