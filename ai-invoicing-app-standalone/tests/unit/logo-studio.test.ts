import { describe, expect, it } from 'vitest';

import {
  decodeLogoReference,
  encodeLogoReference,
  generateLogoConcepts,
  logoSvgFromReference,
  monogramFromName,
  renderLogoSvg,
} from '../../src/domain/logos/logo-studio.js';

describe('logo studio', () => {
  it('generates multiple distinct logo concepts from a brand brief', () => {
    const concepts = generateLogoConcepts({
      businessName: 'Quantum Hire',
      tagline: 'Scaffold with certainty',
      industry: 'Scaffold hire',
      style: 'premium',
      primaryColor: '#173f35',
      secondaryColor: '#c4f36b',
      iconIdeas: 'building, star',
      count: 6,
    });
    expect(concepts).toHaveLength(6);
    expect(new Set(concepts.map((item) => item.id)).size).toBe(6);
    expect(concepts[0]?.monogram).toBe('QH');
    expect(renderLogoSvg(concepts[0]!)).toContain('<svg');
    expect(renderLogoSvg(concepts[0]!)).toContain('Quantum Hire');
  });

  it('persists selected logos through the Aleya logo reference encoding', () => {
    const [concept] = generateLogoConcepts({
      businessName: 'Aleya Hire Co',
      industry: 'Hire',
      style: 'modern',
    });
    expect(concept).toBeTruthy();
    const reference = encodeLogoReference(concept!);
    expect(reference.startsWith('aleya-logo:v1:')).toBe(true);
    expect(decodeLogoReference(reference)?.businessName).toBe('Aleya Hire Co');
    expect(logoSvgFromReference(reference)).toContain('<svg');
    expect(monogramFromName('Single')).toBe('SI');
  });
});
