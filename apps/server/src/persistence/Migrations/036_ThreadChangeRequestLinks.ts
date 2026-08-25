import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  yield* sql`
    CREATE TABLE IF NOT EXISTS thread_change_request_links (
      thread_id TEXT PRIMARY KEY,
      provider TEXT NOT NULL,
      change_request_number INTEGER NOT NULL,
      change_request_url TEXT NOT NULL,
      head_ref_name TEXT NOT NULL,
      head_commit_sha TEXT,
      linked_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    )
  `;
  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_thread_change_request_links_url
    ON thread_change_request_links(change_request_url)
  `;
});
