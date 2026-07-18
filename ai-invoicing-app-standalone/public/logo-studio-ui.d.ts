export const LOGO_STYLE_OPTIONS: string[];
export function logoSrcFromProfile(profile: { logoReference?: string | null; companyName?: string | null } | null | undefined): string;
export function brandMarkHtml(
  profile: { logoReference?: string | null; companyName?: string | null } | null | undefined,
  options?: { sizeClass?: string },
): string;
export function buildLogoCreatorPageHtml(input?: {
  profile?: Record<string, unknown>;
  concepts?: Array<Record<string, unknown>>;
  selectedId?: string;
  notice?: string;
  standaloneUrl?: string;
  abossLaunchUrl?: string;
}): string;
