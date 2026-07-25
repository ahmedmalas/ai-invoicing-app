import { getAleyaRegistry, type AleyaActionRegistry } from '../registry.js';
import { registerCustomerProfileTools } from './customer-profile-tools.js';
import { registerInvoicingTools } from './invoicing-tools.js';
import { registerPaymentsMetaTools } from './payments-meta-tools.js';

/** Idempotently register the full M1 Aleya AI tool surface. */
export function ensureAleyaToolsRegistered(
  registry: AleyaActionRegistry = getAleyaRegistry(),
): AleyaActionRegistry {
  if (registry.names().length === 0) {
    registerInvoicingTools(registry);
    registerCustomerProfileTools(registry);
    registerPaymentsMetaTools(registry);
  }
  return registry;
}
