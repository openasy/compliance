# compliance

[![CI](https://github.com/openasy/compliance/actions/workflows/ci.yml/badge.svg)](https://github.com/openasy/compliance/actions/workflows/ci.yml)
[![Node.js 26 LTS](https://img.shields.io/badge/node-26%20LTS-339933?logo=nodedotjs&logoColor=white)](./.nvmrc)
[![License: AGPL-3.0](https://img.shields.io/badge/license-AGPL--3.0-blue)](./LICENSE)

The [OpenAsy](https://github.com/openasy) Compliance product: **ISO 27001, SOC 2, GDPR and PCI DSS controls, with
evidence read from the products that do the work** (ADR 0058). It reads what each product of the install serves at
`/metrics`, judges checks on those numbers, and shows which controls pass, which fail and which need evidence. What
software cannot prove, such as training records, is added by hand with the date it counts until.

```
backups /metrics ─────────┐
vulnerabilities /metrics ─┼──read every 15 min──▶  compliance  ──▶  checks  ──▶  controls of each framework
deception /metrics ───────┘                            ▲                          └── a report for the auditor
                                      evidence by hand ┘
```

## Checks

A check is a number one product serves and what it must be, such as
`openasy_backups_job_state{state="untested"} = 0` for "every backup job has a restore test". There are 41, from
Backups, Vulnerabilities, SAST, Secrets, Audit, DAST, Supply chain, Infrastructure, Posture, Malware, Certificates,
Logs, SIEM, Uptime, Deception, Threat intel, Incidents and Risk. Each read keeps the day's tally, so a check also shows
whether it held over the last 90 days.

- A check **passes** or **fails** on the number read.
- **No data**: the product does not serve the number, as an older version may not.
- **Not read**: the product could not be read the last time. The last value stays, and the error says why.
- **Not installed**: the product is not in the install, and the check is left out of every control.

## Controls

Each framework's controls name the checks that prove them: 18 of ISO/IEC 27001:2022 Annex A, 12 of SOC 2, 5 GDPR
articles and 13 PCI DSS 4.0 requirements. Their titles are short names, not the standards' text.

- A control is **passing** when every check of an installed product passes, and the evidence it asks for by hand is
  there and has not ended.
- **Failing** when one of its checks fails.
- **Needs evidence** when a check has no data or was not read, when no installed product proves it and nobody added
  evidence, or when the evidence it asks for is missing or has ended.
- **Does not apply** when someone says so, with a reason, as in a statement of applicability.

Each control has an owner. A framework can be taken out of scope under Frameworks. The report of a framework, in
Markdown or CSV, lists every control with its state, its checks with the values read, and its evidence: hand it to
the auditor.

Compliance collects evidence; it does not certify anything. The auditor does.

## Run

```bash
openssl rand -hex 32 > openasy-kek
export OPENASY_PRODUCTS=backups=https://backups.example.com,vulnerabilities=https://vulns.example.com
docker compose up -d
docker compose logs compliance | grep 'no owner yet'
```

Open the link from the log once to create the owner account; there is no default password (ADR 0013). The UI and API
are on http://localhost:8080, the API reference at http://localhost:8080/api/docs/.

Compliance reads `<address>/metrics` of each product in `OPENASY_PRODUCTS`, the same value every product has. A
product that serves `/metrics` on a port of its own (ADR 0026) is named in `COMPLIANCE_SOURCES` with that address.
Products behind a certificate of your own CA need it trusted: mount it and set `NODE_EXTRA_CA_CERTS`.

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `8080` | HTTP port |
| `COMPLIANCE_PUBLIC_URL` | `http://localhost:8080` | The address people open, with `https://` behind your TLS proxy |
| `OPENASY_PRODUCTS` | | The install's products: the product switcher, and where compliance reads them |
| `COMPLIANCE_SOURCES` | | `product=address` of a product's `/metrics` where it is not under its address |
| `COMPLIANCE_COLLECT_MINUTES` | `15` | How often the products are read |
| `COMPLIANCE_SECRETS_KEY_FILE` | `/run/secrets/openasy-kek` | 32-byte key-encryption key |
| `COMPLIANCE_DB` | `/data/compliance.db` | SQLite file (WAL), on the `/data` volume |
| `COMPLIANCE_METRICS_PORT` | | Serve `/metrics` on this port only (ADR 0026) |
| `COMPLIANCE_HEADLESS` | `false` | `true` serves only the API |
| `COMPLIANCE_PASSWORD_SIGN_IN`, `OPENASY_OIDC_*` | | Sign-in, as in every OpenAsy product ([@openasy/auth](https://github.com/openasy/auth)) |

`/metrics` has `openasy_compliance_controls{state}` and `openasy_compliance_sources_failing`. Days of check history
are kept for 400 days; evidence by hand stays until someone deletes it.

The container runs as non-root with a read-only root filesystem, no capabilities and `no-new-privileges`.

## Roles

Viewers, auditors among them, see everything; editors also set owners, say a control does not apply, add evidence
and read the products now; admins also choose the frameworks in scope, and manage members and API tokens (ADR 0003).

## Not yet

Identity serves no numbers yet, so access controls such as MFA coverage ask for evidence by hand. Files are linked,
not uploaded. Audits with their own scope and dates, and policies, are planned.

## Develop

```bash
npm install
npm test        # the metrics reader, every check and control, reports, and every API response against openapi.json
npm run dev     # the UI, with the API on :8080
```

## Licence

AGPL-3.0 (ADR 0008).
