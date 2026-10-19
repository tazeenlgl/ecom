# Documentation index

All documents describe the repository as it is. Features are labelled **implemented**, **partial**, **planned** or **blocked**. Verified facts are kept apart from assumptions.

## Recommended reading order

1. [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md): what the platform is for and who uses it.
2. [ARCHITECTURE.md](ARCHITECTURE.md): modules, data ownership, request flow and diagrams.
3. [TENANCY.md](TENANCY.md): how stores are resolved and isolated. Read this before writing any query.
4. [DATABASE.md](DATABASE.md) and [ER_DIAGRAM.md](ER_DIAGRAM.md): schema, constraints and relationships.
5. [API.md](API.md): conventions and the endpoint index. The full contract is in [openapi.json](openapi.json).
6. [ORDERS_AND_FULFILLMENT.md](ORDERS_AND_FULFILLMENT.md) and [PAYMENTS.md](PAYMENTS.md): state machines and money flows.
7. [POS_INTEGRATION.md](POS_INTEGRATION.md): what is and is not known about the POS.
8. [SECURITY.md](SECURITY.md): threat model and controls.
9. [DEVELOPMENT.md](DEVELOPMENT.md), [TESTING.md](TESTING.md) and [MIGRATIONS.md](MIGRATIONS.md): day-to-day work.
10. [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) and [KNOWN_ISSUES.md](KNOWN_ISSUES.md): what is next and what is open.

## All documents

| Document | Purpose |
| --- | --- |
| [PROJECT_OVERVIEW.md](PROJECT_OVERVIEW.md) | Vision, scope, users, capabilities |
| [REQUIREMENTS.md](REQUIREMENTS.md) | Functional and non-functional requirements with status |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, module boundaries, request lifecycle, diagrams |
| [DATABASE.md](DATABASE.md) | Schema overview, constraints, tenant isolation in the database |
| [ER_DIAGRAM.md](ER_DIAGRAM.md) | Mermaid entity relationship diagram |
| [API.md](API.md) | API conventions, errors, pagination, endpoint index with permissions |
| [openapi.json](openapi.json) | Generated OpenAPI 3.1 document (`npm run openapi -w @ecom/api`) |
| [SECURITY.md](SECURITY.md) | Threat model, authentication, authorization, secrets, webhooks, privacy |
| [TENANCY.md](TENANCY.md) | Domain resolution, store context, cross-tenant protections |
| [POS_INTEGRATION.md](POS_INTEGRATION.md) | POS ownership, port, sync, retries, unknowns |
| [PAYMENTS.md](PAYMENTS.md) | Provider interface, payment states, webhooks, refunds, reconciliation |
| [ORDERS_AND_FULFILLMENT.md](ORDERS_AND_FULFILLMENT.md) | Order, payment, fulfillment, POS sync, return and refund state machines; promotions |
| [DEVELOPMENT.md](DEVELOPMENT.md) | Local setup and workflows |
| [TESTING.md](TESTING.md) | Test strategy, commands, limitations |
| [DEPLOYMENT.md](DEPLOYMENT.md) | Intended deployment (nothing is deployed) |
| [MIGRATIONS.md](MIGRATIONS.md) | Migration policy, order, rollback limits |
| [OPERATIONS.md](OPERATIONS.md) | Logging, jobs, backups, incidents |
| [DECISIONS.md](DECISIONS.md) | Architecture decision records |
| [IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) | Phases, acceptance criteria, outstanding work |
| [KNOWN_ISSUES.md](KNOWN_ISSUES.md) | Limitations, risks, open decisions |
| [ENVIRONMENT_VARIABLES.md](ENVIRONMENT_VARIABLES.md) | Configuration reference |
| [phase-0-discovery.md](phase-0-discovery.md) | Historical: Phase 0 discovery report (2026-10-19) |

Root files: [README.md](../README.md), [CLAUDE.md](../CLAUDE.md), [CHANGELOG.md](../CHANGELOG.md), [.env.example](../.env.example).
