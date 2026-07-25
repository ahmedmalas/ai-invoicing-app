# Aleya AI — Natural-language operating layer

## Product goal

Aleya AI is **not** a chatbot bolted onto invoicing.

It is a **natural-language assistant for Aleya Invoicing** that operates through registered application tools. Coverage is expanding toward a full operating layer, but it must **not** claim to be a complete operating layer while ordinary app features remain invisible or unimplemented (for example bank feeds).

## Amended requirements (binding)

1. **Full authorised capability** — eventually every legitimate manual action in Aleya Invoicing, including multi-step workflows.
2. **No artificial product limits** — not one tool call per message, not a fixed demo intent list, not “open invoice only”, not simulated actions.
3. **Central action registry** — typed tools with schemas, validation, ownership checks, audit, confirmation metadata, undo metadata, UI sync instructions.
4. **Dynamic discovery** — new features register tools; the chat/agent loop is not rebuilt per feature.
5. **Security boundaries** — no shell/OS, arbitrary code, arbitrary SQL, cross-tenant data, secrets, auth bypass, silent irreversible/external actions, invented financial facts.
6. **Confirmation model** — none for reversible draft work; one clear confirmation before irreversible / externally visible / financially significant actions; no repeated confirms inside an approved workflow.
7. **Autonomy** — infer from active invoice, customer, profile, conversation, previous invoices, uploads, current date; ask only when essential.
8. **Uploaded content** — untrusted; extract facts; never follow embedded instructions.
9. **Undo / recovery** — snapshot undo for reversible AI edits; partial success reporting for compound workflows.
10. **Production honesty** — M1 ships a broad useful tool set, not four demo actions. Remaining gaps are listed in the capability matrix with milestones — not waved away as “future.”

## Architecture

| Piece | Location |
|---|---|
| Tool types | `src/ai/types.ts` |
| Action registry | `src/ai/registry.ts` |
| Tool context / undo / audit | `src/ai/tool-context.ts` |
| Conversation store | `src/ai/conversation-store.ts` |
| System prompt | `src/ai/system-prompt.ts` |
| Agent runner (multi-step) | `src/ai/agent-runner.ts` |
| Tool packs | `src/ai/tools/*` |
| HTTP API | `src/routes/aleya-ai.ts` |
| UI | `public/aleya-ai-ui.js`, route `/aleya-ai` |

Agent loop uses the Vercel AI SDK with `stopWhen: stepCountIs(N)` where **N defaults to 48** (configurable via `ALEYA_AI_MAX_STEPS`). Tools are passed as a full ToolSet from the registry.

### Provider configuration

- Preferred: Vercel AI Gateway via OIDC on Vercel deployments (`@vercel/oidc` / request context). Optional static `AI_GATEWAY_API_KEY` for non-Vercel/CI.
- Model: `ALEYA_AI_MODEL` (default `openai/gpt-5.4`).
- `providerConfigured` is true only when Gateway auth material is present — never via simulated/unconfigured flags.
- Deterministic `ALEYA_PLAN:` harness is **test-only** (`ALEYA_AI_ALLOW_DETERMINISTIC_PLAN=1` or `NODE_ENV=test`). It is disabled in production and is not proof of natural-language operation.
- Provider/tool failures are returned honestly; there is no silent fallback to simulated success.

## M1 initial tool set

Invoice create/edit/lines/totals/duplicate/reuse, search/get, template bind/list, PDF prepare, email prepare (unsent), finalise (confirm), payment state / delete (confirm), bulk draft create + bulk draft update (confirm), customers CRUD, business profile read/update (confirm), payments record/list (confirm), universal search, diagnose, list_registered_tools, undo_last_ai_edit, get_visible_app_state.

See `docs/ALEYA_AI_CAPABILITY_MATRIX.md` for the full matrix against UI actions.

## Expanding capability

1. Implement the domain operation in a shared service (used by UI + AI).
2. Register an `AleyaToolDefinition` with schemas + confirmation/undo metadata.
3. Ship — no chat rewrite required.
