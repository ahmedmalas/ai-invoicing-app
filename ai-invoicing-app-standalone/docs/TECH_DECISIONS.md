# Technical Decisions (Initial)

## Decision State
This file captures early technical direction and open decisions for the standalone rebuild.

## Confirmed Decisions

1. Standalone Repository Structure
   - The project foundation is isolated under `ai-invoicing-app-standalone`.
   - No recovery or partial patching from unavailable prior standalone commits.

2. Documentation-First Bootstrap
   - Establish core product intent and scope before implementation.
   - Keep this phase limited to foundational docs.

3. Scope Guardrails for This Phase
   - Do not scaffold full application code.
   - Do not integrate with unrelated repositories.
   - Do not perform remote operations (e.g., push).

## Open Decisions (Deferred)
- Frontend framework and rendering strategy.
- Backend architecture and persistence model.
- PDF rendering engine and template technology.
- AI provider strategy and prompt architecture.
- Authentication and multi-tenant data boundaries.
- Deployment model and CI/CD flow.

## Next Step
Translate these requirements into implementation architecture after foundation sign-off.
