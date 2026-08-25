import type { SourceControlProviderKind } from "@t3tools/contracts";
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import type * as Option from "effect/Option";
import type { SqlError } from "effect/unstable/sql/SqlError";

export interface ThreadChangeRequestLink {
  readonly threadId: string;
  readonly provider: SourceControlProviderKind;
  readonly number: number;
  readonly url: string;
  readonly headRefName: string;
  readonly headCommitSha: string | null;
  readonly linkedAt: string;
  readonly updatedAt: string;
}

export interface ThreadChangeRequestLinkStoreShape {
  readonly get: (
    threadId: string,
  ) => Effect.Effect<Option.Option<ThreadChangeRequestLink>, SqlError>;
  readonly upsert: (link: ThreadChangeRequestLink) => Effect.Effect<void, SqlError>;
}

export class ThreadChangeRequestLinkStore extends Context.Service<
  ThreadChangeRequestLinkStore,
  ThreadChangeRequestLinkStoreShape
>()("t3/orchestration/Services/ThreadChangeRequestLinkStore") {}
