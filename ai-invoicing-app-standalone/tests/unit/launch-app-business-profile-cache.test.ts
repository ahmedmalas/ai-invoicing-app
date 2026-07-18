import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('launch-app business profile fetch guard', () => {
  const source = readFileSync(
    join(process.cwd(), 'public/launch-app.js'),
    'utf8',
  );

  it('does not synthesise a BUSINESS_PROFILE_NOT_FOUND 404 that poisons Settings/PDF unlock', () => {
    expect(source).not.toContain('BUSINESS_PROFILE_NOT_FOUND');
    expect(source).not.toContain("status: 404, code: 'BUSINESS_PROFILE_NOT_FOUND'");
    expect(source).toContain('invalidateBusinessProfileCache');
    expect(source).toContain('Await the real response');
  });

  it('invalidates the cached GET after a successful business-profile write', () => {
    expect(source).toContain('isBusinessProfileWrite');
    expect(source).toContain('if (response.ok) invalidateBusinessProfileCache()');
  });
});
