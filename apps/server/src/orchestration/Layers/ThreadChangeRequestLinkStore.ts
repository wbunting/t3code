import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import {
  ThreadChangeRequestLinkStore,
  type ThreadChangeRequestLink,
  type ThreadChangeRequestLinkStoreShape,
} from "../Services/ThreadChangeRequestLinkStore.ts";

const make = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const get: ThreadChangeRequestLinkStoreShape["get"] = (threadId) =>
    sql<ThreadChangeRequestLink>`
      SELECT
        thread_id AS "threadId",
        provider,
        change_request_number AS "number",
        change_request_url AS "url",
        head_ref_name AS "headRefName",
        head_commit_sha AS "headCommitSha",
        linked_at AS "linkedAt",
        updated_at AS "updatedAt"
      FROM thread_change_request_links
      WHERE thread_id = ${threadId}
      LIMIT 1
    `.pipe(Effect.map((rows) => Option.fromNullishOr(rows[0])));

  const upsert: ThreadChangeRequestLinkStoreShape["upsert"] = (link) =>
    sql`
      INSERT INTO thread_change_request_links (
        thread_id,
        provider,
        change_request_number,
        change_request_url,
        head_ref_name,
        head_commit_sha,
        linked_at,
        updated_at
      )
      VALUES (
        ${link.threadId},
        ${link.provider},
        ${link.number},
        ${link.url},
        ${link.headRefName},
        ${link.headCommitSha},
        ${link.linkedAt},
        ${link.updatedAt}
      )
      ON CONFLICT (thread_id)
      DO UPDATE SET
        provider = excluded.provider,
        change_request_number = excluded.change_request_number,
        change_request_url = excluded.change_request_url,
        head_ref_name = excluded.head_ref_name,
        head_commit_sha = excluded.head_commit_sha,
        updated_at = excluded.updated_at
    `.pipe(Effect.asVoid);

  return { get, upsert } satisfies ThreadChangeRequestLinkStoreShape;
});

export const ThreadChangeRequestLinkStoreLive = Layer.effect(ThreadChangeRequestLinkStore, make);
