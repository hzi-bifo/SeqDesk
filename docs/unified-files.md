# Files for collections and sequencing orders

Every collection and sequencing order has one **Files** destination at
`/orders/[id]/samples-files`. Repository imports, existing server files, uploads,
and sequencer output appear against their samples here. **By sample** groups
separate read sets; **All files** lists individual files; **Activity** shows
imports and live acquisition.

Create a **New collection** to add data without facility intake. **Request
sequencing** is a separate creation action available when sequencing management
is enabled. The repository module catalogue contains downloadable data sources.

## Adding files

- **Import from a repository** appears on data collections and opens the module
  catalogue with the current collection selected. Facility orders use their
  own intake and file association. Modules retain their existing sample identity, metadata,
  validation and publication behavior.
- **Use existing files** registers FASTQ files in permitted server storage
  without copying them. The picker suggests sample names and paired mates;
  users review the mapping before confirming.
- **Upload files** transfers FASTQ files from the browser, validates them, then
  creates the sample association. The limit is 64 MiB per read set, including
  both mates. Larger files should be placed in accessible server storage.
- Sample-level **Add files** starts with that sample already selected. The
  page-level action can also create sample records and add several read sets.

File association creates a new `Read` with `isActive: false`. It preserves all
existing read sets, checksums, provenance, processing declarations, analysis
input selections and facility status. Processing defaults to unknown. A manual
processing declaration requires supporting details; source evidence remains
separate from the current classification.

## Access and facility processing

Collection owners can manage their imported/local data. Facility staff retain
their operational permissions. Facility requesters see only released active
cleaned reads and customer-visible artifacts. A common Files page does not
grant requester access to internal facility data or server-wide storage.

Ordinary users can browse their collection upload location and datasets linked
to their own Workbench. Installation administrators and authorized facility
operators can use the configured data storage base. Both supplied paths and
their resolved filesystem targets must stay within permitted roots.

Facility staff can explicitly **Use for facility processing** on a read set.
This changes selection only, preserving its provenance and classification.
Previously published delivery must be unpublished in **Facility processing**
before selecting another read set. Existing run planning, barcode assignment,
classification, QC and release controls remain available from Files.

**Connect a sequencer** appears only with an enabled, configured source and
appropriate operational access. Receiving files are not presented as completed
analysis inputs. The inventory includes the most recent 200 files per stream;
the existing live sequencer screen retains detailed run monitoring.

## Implementation

The neutral APIs are under `/api/orders/[id]/data-files`:

- `GET`: authorized sample/read-set/file inventory.
- `POST`: validate and attach a new read set to an existing or new sample.
- `GET /storage`: browse permitted directories and FASTQ files.
- `POST /upload`: bounded multipart upload and file association.
- `PUT /selection`: explicit facility selection of a validated read set.
- `GET /download`: downloads only files visible in the authorized inventory.

The existing sequencing assignment APIs remain facility operations and are not
used to attach collection files. The neutral service does not require a schema
change. It validates actual FASTQ content and mate identities/counts, rejects
duplicate links and files changing during validation, and creates the sample
and read inside one transaction. A stable request ID makes identical link and
upload retries return the existing result; retries with changed data are rejected.
Files are limited to 128 GiB of expanded
FASTQ content each during validation.

Focused tests cover UI mapping, navigation, authorization, storage confinement,
preserving existing read sets, upload failures, and facility release boundaries.
The optional `src/lib/orders/data-files.database.live.test.ts` verifies actual
PostgreSQL persistence in an explicitly named isolated local beta test database;
it creates and cleans only its own records and files and never resets the DB.
