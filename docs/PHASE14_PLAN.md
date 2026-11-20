# Phase 14 delivery plan

1. Replace overlapping publishers with read-only PR validation and a single versioned delivery workflow. Keep functional and security checks blocking.
2. Build and inventory platform bundles and runtime container archives. Validate backend package inputs separately. Record hashes, SBOMs and build attestations.
3. Validate with a real `-preview.N` tag and retain the rehearsal artifacts in Actions.
4. Require protected environments, successful checks and production keys for public candidates. Require a verified candidate from the same source before a stable release.
5. Validate hosted outcomes and document versioning, verification and rollback on the development branch.
