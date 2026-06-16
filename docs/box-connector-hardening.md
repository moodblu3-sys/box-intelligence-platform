# Box Connector Hardening

## Purpose

This note captures the hardening work needed to move the Box Connector beyond
the MVP while keeping the current scope focused on stable interview demos.

The current hardening target is:

- clear Box API error classification
- retry/backoff for transient Box API failures
- file-level failure isolation
- actionable validation errors
- focused unit coverage

## Implemented In This Hardening Pass

- Classify Box API errors for credentials and folder validation:
  - `400` / `401`: invalid credential or subject configuration
  - `403`: insufficient permissions
  - `404`: configured folder was not found
  - `429`: Box rate limit
  - `5xx`: transient Box service failure
- Retry transient API failures:
  - `429`
  - `500`
  - `502`
  - `503`
  - `504`
- Explicit request timeouts:
  - auth requests
  - metadata requests
  - file downloads
- Isolate per-file failures:
  - download failures skip only the failed file
  - extraction failures skip only the failed file
  - logs include `box_file_id`, file name, and folder path
- Unit tests for:
  - `429` retry
  - `5xx` retry
  - `403` non-retry
  - validation mapping for `403` and `404`
  - download failure skip
  - recursive traversal
  - metadata generation

## Not Implemented Yet

The following are intentionally out of scope for the interview-demo hardening
pass:

- checkpointing
- pruning
- deletion detection
- Box Events API
- permission sync
- group sync
- comments
- file versions
- Box export

## Deletion Detection Design Direction

The connector currently discovers files by traversing configured root folders.
If a file is deleted from Box, the connector can stop seeing it, but a robust
deletion story needs explicit coordination with Onyx pruning.

Recommended direction:

1. Keep folder traversal as the authoritative snapshot for MVP-compatible syncs.
2. During a full traversal, record every discovered Box document ID:
   - `box:file:{file_id}`
3. Compare the discovered set against documents currently associated with the
   connector/credential pair.
4. Mark documents missing from the latest snapshot as candidates for pruning.
5. Let the existing Onyx pruning path delete or hide stale documents.

For larger Box tenants, this should not be implemented as an unbounded in-memory
set. Use batching or connector checkpoint state to avoid holding very large
snapshots in memory.

## Checkpoint Design Direction

The current connector is a simple `LoadConnector` / `PollConnector`. For larger
folders, checkpointing should be introduced before adding enterprise-scale
features.

Recommended checkpoint shape:

```json
{
  "pending_folders": [
    {
      "folder_id": "123",
      "parent_id": "0",
      "path_parts": ["Root", "Contracts"]
    }
  ],
  "current_folder": {
    "folder_id": "123",
    "offset": 200,
    "path_parts": ["Root", "Contracts"]
  }
}
```

Recommended behavior:

1. Store pending folders and the current pagination offset.
2. Yield documents in bounded batches.
3. Persist progress after each batch.
4. Resume from the last folder/offset after worker restart.
5. Keep `modified_at` filtering as an optimization, not the only correctness
   mechanism.

Offset-based pagination is acceptable for a first checkpoint implementation,
but Box marker-based pagination should be considered if the API endpoint and SDK
support it for the chosen traversal path.

## Pruning Design Direction

Pruning should be implemented after checkpointing, not before. Without
checkpointing, a partially completed traversal could look like many files were
deleted.

Recommended direction:

1. Only prune after a successful full traversal.
2. Track a sync run identifier for documents seen in the latest complete run.
3. Do not prune if the sync ends with connector-level failure.
4. Keep file-level failures separate:
   - failed files should not be marked deleted
   - they should remain available from the previous successful index
5. Surface pruning counts in indexing attempt metadata/logs.

This avoids deleting valid search results when Box rate limits, temporary API
failures, or extraction failures occur during a demo or production sync.

## Permission Sync Direction

Permission sync is not part of this pass. The current MVP uses connector-level
PUBLIC/PRIVATE access control. A future enterprise connector should map Box
collaborators and groups to Onyx document permissions.

Recommended future steps:

1. Add Box user/group identity resolution.
2. Read file/folder collaborations.
3. Inherit permissions through folder hierarchy.
4. Expand Box groups into Onyx external groups.
5. Add tests for inherited access, direct collaborators, and removed access.

## Demo Operations Notes

For interview demos:

- Use a small, dedicated root folder.
- Prefer PDF/DOCX/TXT files with known text content.
- Keep Box folder IDs stable.
- Avoid testing with very large folders until checkpointing is added.
- If indexing hits Box rate limits, retry after the connector cools down.
