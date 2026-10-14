# Repository Engineering Backlog (100 Actionable Issues)

## Executive Summary
- **Review Scope:** Comprehensive repository audit spanning all smart contracts (`contracts/delivery_contract`, `contracts/escrow_contract`, `contracts/dispute_resolution_contract`, `contracts/fleet_management_contract`, `contracts/identity_reputation_contract`, `contracts/settlement_contract`, `contracts/shared_types`), TypeScript SDK client implementations and type definitions (`sdk/typescript`), deployment and initialization scripts (`scripts/`), continuous integration workflows (`.github/workflows/ci.yml`), project automation (`Makefile`, `Makefile.windows`), and architecture documentation (`docs/`).
- **Date:** October 14, 2026
- **Duplicate-Check Method:** Programmatic and manual cross-verification against all 379 open and closed GitHub issues dumped directly from `fanilabs/fanilab-smartcontract` using GitHub CLI (`gh issue list --state all --limit 1000`). Each proposed issue was verified to ensure zero title, bug-pattern, or scope overlap with existing issues and pull requests.
- **Access Status & Limitations:** Full local workspace filesystem access and GitHub CLI read access were active. In compliance with strict non-destructive constraints, no live GitHub issues were created or modified, no git commits or remote pushes were executed, and no existing codebase files were altered.
- **Labeling Policy:** Strictly adheres to existing repository labels (`bug`, `security`, `state-machine`, `validation`, `edge-case`, `observability`, `sdk`, `test`, `documentation`, `maintenance`, `parity`, `missing-functionality`, `type-mismatch`, `refactor`, `architecture`, `authorization`, `incident-response`, `feature`, `enhancement`, `performance`, and `priority: *`). No wave labels, complexity estimates, or time forecasts are included.

---

### 50. Fleet: Validate Owner and Treasury Address Separation in register_fleet
**Labels:** `validation`, `security`, `priority: medium`
**Priority:** Medium

**Description:**
register_fleet accepts owner and treasury addresses without enforcing that treasury != owner or verifying that treasury is a valid designated payout address. Deploying with owner == treasury conflates personal and operational balances.

**Impact:**
Conflation of operational fleet treasury and personal driver keys leads to accounting ambiguity in revenue splits.

**Evidence:**
- File: [contracts/fleet_management_contract/lib.rs](file:///workspaces/fanilab-smartcontract/contracts/fleet_management_contract/lib.rs)
- Symbols: `register_fleet`, `treasury`, `owner`

**Acceptance Criteria:**
- [ ] Validate treasury address constraints in register_fleet.
- [ ] Provide clear documentation on treasury contract vs account configuration.
- [ ] Add unit tests validating parameter enforcement in register_fleet.

**Dependencies & References:**
- contracts/fleet_management_contract/lib.rs fleet registration.

---

### 62. Security-Sensitive Item Retained for Private Maintainer Review

#62 — Security-sensitive item retained for private maintainer review. Details are withheld from this public backlog.
