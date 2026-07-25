import { tool, type ToolSet } from 'ai';
import { z } from 'zod';

import type {
  AleyaToolContext,
  AleyaToolDefinition,
  ToolCategory,
  ToolResult,
} from './types.js';

/**
 * Central Aleya action registry.
 *
 * New application operations become available to the agent by registering here —
 * the chat/agent loop is not rebuilt per feature.
 */
export class AleyaActionRegistry {
  private readonly tools = new Map<string, AleyaToolDefinition>();

  register<T extends z.ZodTypeAny>(definition: AleyaToolDefinition<T>): void {
    if (this.tools.has(definition.name)) {
      throw new Error(`Aleya tool already registered: ${definition.name}`);
    }
    this.tools.set(definition.name, definition as AleyaToolDefinition);
  }

  get(name: string): AleyaToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(filter?: { category?: ToolCategory }): AleyaToolDefinition[] {
    const all = [...this.tools.values()];
    if (!filter?.category) return all;
    return all.filter((item) => item.category === filter.category);
  }

  names(): string[] {
    return [...this.tools.keys()].sort();
  }

  async execute(
    name: string,
    rawInput: unknown,
    ctx: AleyaToolContext,
  ): Promise<ToolResult> {
    const definition = this.tools.get(name);
    if (!definition) {
      return {
        ok: false,
        code: 'UNKNOWN_TOOL',
        message: `Tool "${name}" is not registered.`,
      };
    }

    let input: unknown;
    try {
      input = definition.inputSchema.parse(rawInput ?? {});
    } catch (error) {
      return {
        ok: false,
        code: 'INVALID_INPUT',
        message: error instanceof Error ? error.message : 'Invalid tool input',
        details: error,
      };
    }

    if (definition.confirmation === 'required') {
      const approved = [...ctx.approvedTokens].some((token) => {
        // Token format: toolName::hash or exact pending match handled by caller.
        return token === name || token.startsWith(`${name}::`);
      });
      if (!approved) {
        const pending = ctx.requestConfirmation(
          definition.name,
          input,
          `${definition.name} requires confirmation before it can run.`,
        );
        await ctx.logAudit('aleya_ai.confirmation_required', {
          toolName: definition.name,
          token: pending.token,
        });
        return {
          ok: false,
          code: 'CONFIRMATION_REQUIRED',
          message: pending.summary,
          needsConfirmation: true,
          confirmationToken: pending.token,
          confirmationSummary: pending.summary,
        };
      }
    }

    const started = Date.now();
    try {
      const result = await definition.execute(input, ctx);
      await ctx.logAudit('aleya_ai.tool_executed', {
        toolName: definition.name,
        ok: result.ok,
        durationMs: Date.now() - started,
        code: result.ok ? undefined : result.code,
      });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Tool execution failed';
      await ctx.logAudit('aleya_ai.tool_failed', {
        toolName: definition.name,
        durationMs: Date.now() - started,
        message,
      });
      return {
        ok: false,
        code: 'TOOL_EXCEPTION',
        message,
      };
    }
  }

  /** Convert registered tools into an AI SDK ToolSet for the model. */
  toAiSdkTools(ctx: AleyaToolContext): ToolSet {
    const set: ToolSet = {};
    for (const definition of this.tools.values()) {
      set[definition.name] = tool({
        description: definition.description,
        inputSchema: definition.inputSchema,
        execute: async (input) => this.execute(definition.name, input, ctx),
      });
    }
    return set;
  }

  capabilityRows(): Array<{
    tool: string;
    category: ToolCategory;
    confirmation: string;
    undo: string;
    milestone: string;
    description: string;
  }> {
    return this.list().map((item) => ({
      tool: item.name,
      category: item.category,
      confirmation: item.confirmation,
      undo: item.undo,
      milestone: item.milestone,
      description: item.description,
    }));
  }
}

let singleton: AleyaActionRegistry | null = null;

export function getAleyaRegistry(): AleyaActionRegistry {
  if (!singleton) {
    singleton = new AleyaActionRegistry();
  }
  return singleton;
}

/** Test helper — reset registry between suites. */
export function resetAleyaRegistryForTests(): void {
  singleton = new AleyaActionRegistry();
}
