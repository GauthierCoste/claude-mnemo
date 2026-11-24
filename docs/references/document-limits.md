# Document size limits

Mnemo runs locally, so documents are limited by what each step can process without loading a whole file into memory, not by an upload quota.

## Upload (drop zone of the interface)

- Up to **10 GiB** per file (`TAILLE_MAX_DOCUMENT` in `packages/contrat`, the single constant read by the service and the interface).
- Before sending, the interface checks the upload without a body (`/api/depot/verifier`): refused path (400), file already there (409), too large (413), not enough free disk space (507). The refusal always reaches the interface intact.
- The browser then sends the file as a stream (`XMLHttpRequest` with the file itself as body) and shows the upload progress for files of 1 MiB or more, with a "Annuler l'envoi" button.
- The service writes the body as it arrives into a temporary file in `.mnemo/depots/`, then links it under its final name; where a hard link is impossible (exFAT, SMB, another volume), it creates the final name exclusively and copies the file into it. It never keeps the whole body in memory and never replaces an existing file (409). Temporaries left by a crash are removed when the service starts. One case is not covered: on a volume without hard links, if the service is killed while it copies, the final file stays truncated under its real name. These volumes offer no rename that refuses to overwrite, so the copy cannot go to a hidden name first; delete the truncated file and upload it again.
- A file announced as larger than the limit, or than the free disk space, is refused before anything is read (413, 507). A file that exceeds the limit while it is being sent is refused as soon as the limit is crossed (413); a full disk gives 507 with a clear message. In all these cases, when the upload is cancelled or interrupted, and when nothing arrives for 2 minutes, nothing is left on disk. Only the upload route may take up to an hour; other requests keep a 5-minute limit for their body.
- Token, `Origin`, path checks (relative to the Mnemo folder, outside `_mnemo/` and `.mnemo/`, no hidden segment, no symbolic link) are unchanged.

## Referencing and indexing (`mnemo source`, `extraire_source`, search)

A referenced document may be up to 10 GiB. It is hashed as a stream, then extracted in an isolated worker thread (1 GiB heap, a time limit of 2 minutes plus 2 minutes per GiB) that reads the file in 4 MiB chunks on demand. Email attachments are extracted afterwards, one by one, in another worker: an attachment that is too heavy or corrupted fails on its own (it is listed with the attachments that are not indexed, and reported as a warning) and a new worker carries on with the next ones.

Search never waits for an extraction. It serves the index as it is; the service and the MCP server re-extract changed documents in the background, and `mnemo index` does it from the command line (`mnemo cherche` says how many changed documents still serve their old text). While a document is being extracted, its reservation is renewed, so no other process extracts it at the same time.

Each format has its own limit:

| Format | Limit | Why |
|---|---|---|
| Markdown, plain text (`.md`, `.markdown`, `.txt`) | 10 GiB | Decoded as a stream; reading stops once the text limit below is reached. |
| PDF (`.pdf`) | 256 MiB | pdf.js loads the whole file in memory. |
| Word (`.docx`) | 100 MiB (200 MiB once decompressed) | mammoth loads and decompresses the whole archive. |
| Email (`.eml`) | 256 MiB | The message is parsed in memory. |
| Mailbox (`.mbox`) | 10 GiB, 256 MiB per message | Read message by message; a larger message is skipped with a warning. |
| Email attachment | 256 MiB, then the limit of its own format | Decoded only when it is extracted, one attachment at a time. |

Indexed text is capped at **32 Mi characters per document** (`TEXTE_MAX_DOCUMENT`), the text kept to rebuild the threads of a mailbox at 64 Mi characters, and the text of all the attachments of a file at 64 Mi characters (`TEXTE_MAX_PIECES`). Beyond that the rest is not indexed: `extraire_source` reports it ("extraction incomplète"), and `mnemo index` lists the document under "documents indexés en partie".

A document over its format limit gets a clear refusal that gives its size and the limit; it stays in the folder, without passages. A document too heavy for the worker gives "document trop lourd à extraire"; the service keeps running.
