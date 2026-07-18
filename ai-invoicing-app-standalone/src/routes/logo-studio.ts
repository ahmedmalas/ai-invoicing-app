import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

import { getWorkspaceContext } from '../auth/workspace-context.js';
import {
  LOGO_STYLES,
  decodeLogoReference,
  encodeLogoReference,
  generateLogoConcepts,
  logoSvgDataUrl,
  logoSvgFromReference,
  renderLogoSvg,
  type LogoConcept,
} from '../domain/logos/logo-studio.js';
import {
  brandKitToLogoReference,
  fetchActiveBrandKit,
  isLogoPlatformConfigured,
  syncActiveBrandKit,
} from '../services/logo-platform-client.js';

const generateSchema = z.object({
  businessName: z.string().trim().min(1).max(120),
  tagline: z.string().trim().max(160).optional(),
  industry: z.string().trim().min(1).max(80),
  style: z.enum(LOGO_STYLES),
  primaryColor: z
    .string()
    .regex(/^#?[0-9A-Fa-f]{6}$/)
    .optional(),
  secondaryColor: z
    .string()
    .regex(/^#?[0-9A-Fa-f]{6}$/)
    .optional(),
  iconIdeas: z.string().trim().max(200).optional(),
  count: z.number().int().min(3).max(8).optional(),
});

const selectSchema = z.object({
  concept: z.object({
    id: z.string().min(1),
    businessName: z.string().min(1),
    tagline: z.string().nullable(),
    industry: z.string().min(1),
    style: z.enum(LOGO_STYLES),
    primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
    iconIdea: z.string().min(1),
    layout: z.enum(['badge', 'lockup', 'wordmark', 'monogram', 'emblem', 'stack']),
    markShape: z.enum(['circle', 'rounded-square', 'hex', 'shield', 'pill']),
    monogram: z.string().min(1).max(4),
    seed: z.string().min(1),
  }),
  createBrandKit: z.boolean().optional(),
});

function conceptPayload(concept: LogoConcept) {
  return {
    ...concept,
    svg: renderLogoSvg(concept),
    previewUrl: logoSvgDataUrl(concept),
  };
}

function workspaceBusinessId(): string {
  return getWorkspaceContext()?.workspaceId || process.env.ORGANIZATION_ID || 'aleya-invoicing';
}

export const logoStudioRoutes: FastifyPluginAsync = async (app) => {
  app.post('/logo-studio/generate', async (request) => {
    const body = generateSchema.parse(request.body);
    const concepts = generateLogoConcepts(body).map(conceptPayload);
    return {
      concepts,
      count: concepts.length,
      message: 'Generated logo concepts for your Aleya brand.',
      platformConfigured: isLogoPlatformConfigured(),
    };
  });

  app.post('/logo-studio/select', async (request, reply) => {
    const body = selectSchema.parse(request.body);
    const concept: LogoConcept = body.concept;
    const existing = await app.db.getBusinessProfile();
    const svg = renderLogoSvg(concept);
    const businessId = workspaceBusinessId();

    let sharedKitId: string | null = null;
    let platformSyncError: string | null = null;
    try {
      const kit = await syncActiveBrandKit({
        businessId,
        businessName: concept.businessName,
        tagline: concept.tagline,
        industry: concept.industry,
        style: concept.style,
        primaryColor: concept.primaryColor,
        secondaryColor: concept.secondaryColor,
        iconIdea: concept.iconIdea,
        layout: concept.layout,
        svgMarkup: svg,
        concept: { ...concept },
        sourceApp: 'aleya-invoicing',
      });
      sharedKitId = kit?.id ?? null;
    } catch (error) {
      platformSyncError = error instanceof Error ? error.message : String(error);
    }

    const logoReference = encodeLogoReference(concept);
    const profile = await app.db.upsertBusinessProfile({
      companyName: existing?.companyName?.trim() || concept.businessName,
      legalName: existing?.legalName ?? undefined,
      abnTaxId: existing?.abnTaxId ?? undefined,
      address: existing?.address ?? undefined,
      email: existing?.email ?? undefined,
      phone: existing?.phone ?? undefined,
      logoReference,
      primaryColor: concept.primaryColor,
      secondaryColor: concept.secondaryColor,
    });
    return reply.send({
      message:
        'Logo saved as your active Brand Kit. Aleya uses it across the workspace, invoices and PDFs.',
      profile,
      concept: conceptPayload(concept),
      brandKitId: sharedKitId,
      platformConfigured: isLogoPlatformConfigured(),
      platformSyncError,
    });
  });

  app.get('/logo-studio/active', async (_request, reply) => {
    const businessId = workspaceBusinessId();
    const shared = await fetchActiveBrandKit(businessId);
    if (shared?.svg_markup) {
      const profile = await app.db.getBusinessProfile();
      return {
        profile,
        brandKit: shared,
        concept: decodeLogoReference(brandKitToLogoReference(shared)),
        source: 'shared-platform',
      };
    }

    const profile = await app.db.getBusinessProfile();
    const concept = decodeLogoReference(profile?.logoReference);
    if (!concept) {
      return reply.code(404).send({ message: 'No active logo selected' });
    }
    return {
      profile,
      concept: conceptPayload(concept),
      source: 'local-profile',
      platformConfigured: isLogoPlatformConfigured(),
    };
  });

  app.get('/logo-studio/brand-kits', async () => {
    const businessId = workspaceBusinessId();
    const active = await fetchActiveBrandKit(businessId);
    const profile = await app.db.getBusinessProfile();
    const localConcept = decodeLogoReference(profile?.logoReference);
    return {
      brandKits: active ? [active] : [],
      localActive: localConcept ? conceptPayload(localConcept) : null,
      platformConfigured: isLogoPlatformConfigured(),
      standaloneUrl: process.env.LOGO_CREATOR_PUBLIC_URL || '',
      abossLaunchUrl: process.env.LOGO_CREATOR_PUBLIC_URL
        ? `${process.env.LOGO_CREATOR_PUBLIC_URL.replace(/\/$/, '')}/?source=aboss&businessId=${encodeURIComponent(businessId)}`
        : '',
    };
  });

  app.get('/logo-studio/export.svg', async (_request, reply) => {
    const profile = await app.db.getBusinessProfile();
    const svg = logoSvgFromReference(profile?.logoReference);
    if (!svg) {
      return reply.code(404).send({ message: 'No logo configured' });
    }
    return reply
      .type('image/svg+xml; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="aleya-logo.svg"')
      .send(svg);
  });

  app.get('/business-profile/logo.svg', async (_request, reply) => {
    const profile = await app.db.getBusinessProfile();
    const svg = logoSvgFromReference(profile?.logoReference);
    if (!svg) {
      return reply.code(404).type('application/json').send({ message: 'No logo configured' });
    }
    return reply.type('image/svg+xml; charset=utf-8').header('Cache-Control', 'no-cache').send(svg);
  });

  app.get('/logo-studio/platform', async () => ({
    configured: isLogoPlatformConfigured(),
    standaloneUrl: process.env.LOGO_CREATOR_PUBLIC_URL || '',
    businessId: workspaceBusinessId(),
  }));
};
