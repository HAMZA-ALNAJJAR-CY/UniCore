# UUID migration recovery (developer-assisted, same browser origin)

The v2 upgrade is all-or-nothing. An IDENTITY_COLLISION leaves the original v1 database and attachment Blobs intact. The timetable page displays a blocking explanation; other placeholder routes remain available. Never use Clear site data, delete the database, or change the database name to work around this error.

Practical maintenance procedure:

1. Close other UniCore tabs, stop edits, and retain the affected browser profile/origin. A different port or hostname is a different IndexedDB database and will not repair the affected one.
2. A developer should open the pre-migration app at commit `7ec30c3` on that same origin (use a separate checkout, keeping the current work intact). That build declares version 1 and can inspect the unchanged v1 stores without attempting v2. Browser developer tools can also inspect Application → IndexedDB → UniCore without deleting anything.
3. Identify every pair of IDs differing only by case and every course whose term/code becomes ambiguous after case folding. Inspect all seven stores, including tombstones, notes and both file relationship stores. Distinguish genuine duplicates from separate academic records with the user; never select the newer timestamp automatically.
4. After explicit user approval of a written repair mapping, use the v1 Dexie connection in a single read-write transaction over all seven stores. Keep both records: rekey the distinct record to a new UUID and rewrite only its explicitly identified dependent references. Preserve Blobs and every other field. If course-code ownership is also ambiguous, the user must provide corrected codes/term ownership. If a reference cannot be assigned unambiguously, stop; do not guess or merge it. An atomic key rename must remove the old key and add the chosen new key inside that transaction, never clear a table. Have a developer review the exact script against the actual records before executing it.
5. Recheck all references, record/file counts and Blob content using v1. Close the v1 connection and reopen the current build on the original origin. Its unchanged v2 preflight will either accept the now-unambiguous identities or fail safely again. Do not retry a repair blindly.

This is a documented maintenance path, not an automatic repair feature, backup/restore implementation, or authorization to run a repair. No repair is executed by opening the timetable page. Current tests verify that failed upgrades remain reopenable as version 1 and preserve records.
