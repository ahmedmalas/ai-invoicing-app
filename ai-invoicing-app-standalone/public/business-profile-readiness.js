/** Single readiness rule for Aleya-owned business profile / PDF unlock. */

export function isBusinessProfileReady(profile) {
  if (!profile || typeof profile !== 'object') return false;
  const companyName = String(profile.companyName || '').trim();
  const address = String(profile.address || '').trim();
  return Boolean(companyName && address);
}

export function businessProfileReadinessMessage(profile) {
  if (isBusinessProfileReady(profile)) {
    return 'Document identity configured. PDF preview and download use this Aleya business profile.';
  }
  const missing = [];
  if (!String(profile?.companyName || '').trim()) missing.push('business name');
  if (!String(profile?.address || '').trim()) missing.push('address');
  if (!missing.length) missing.push('business details');
  return (
    'PDF downloads are paused until you save a complete business profile (' +
    missing.join(' and ') +
    ').'
  );
}
