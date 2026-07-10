import { z } from 'zod';
import type { FastifyPluginAsync } from 'fastify';

const profileSchema = z.object({
  companyName: z.string().min(1),
  legalName: z.string().optional(),
  abnTaxId: z.string().optional(),
  address: z.string().optional(),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  logoReference: z.string().optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
  secondaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/),
});

export const businessProfileRoutes: FastifyPluginAsync = async (app) => {
  app.post('/business-profile', async (request) => {
    const body = profileSchema.parse(request.body);
    return await app.db.upsertBusinessProfile(body);
  });

  app.get('/business-profile', async (request, reply) => {
    const profile = await app.db.getBusinessProfile();
    if (!profile) {
      return reply.code(404).send({ message: 'Business profile not configured' });
    }
    return profile;
  });

  app.post('/business-profile/logo-placeholder', async (request, reply) => {
    const body = z.object({ fileName: z.string().min(1) }).parse(request.body);
    const existing = await app.db.getBusinessProfile();
    if (!existing) {
      return reply.code(400).send({ message: 'Create business profile before setting logo placeholder' });
    }

    const updated = await app.db.upsertBusinessProfile({
      companyName: existing.companyName,
      legalName: existing.legalName ?? undefined,
      abnTaxId: existing.abnTaxId ?? undefined,
      address: existing.address ?? undefined,
      email: existing.email ?? undefined,
      phone: existing.phone ?? undefined,
      logoReference: `placeholder://${body.fileName}`,
      primaryColor: existing.primaryColor,
      secondaryColor: existing.secondaryColor,
    });

    return {
      message: 'Logo upload placeholder set',
      profile: updated,
    };
  });
};
