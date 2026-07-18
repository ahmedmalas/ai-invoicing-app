export type AttachmentAction =
  | 'upload'
  | 'view'
  | 'edit'
  | 'delete'
  | 'download'
  | 'share'
  | 'restore';

export interface AttachmentAuthContext {
  isAdmin: boolean;
  canWrite: boolean;
  /** True when the actor has neither write nor admin — read-only staff. */
  isReadOnly: boolean;
}

/**
 * Map Aleya role capabilities onto attachment actions.
 * Owner/Admin ≈ isAdmin; Staff ≈ canWrite; Read-only ≈ neither.
 */
export function canPerformAttachmentAction(
  auth: AttachmentAuthContext,
  action: AttachmentAction,
): boolean {
  switch (action) {
    case 'view':
    case 'download':
      return true;
    case 'upload':
    case 'edit':
    case 'share':
      return auth.canWrite || auth.isAdmin;
    case 'delete':
    case 'restore':
      return auth.isAdmin || auth.canWrite;
    default:
      return false;
  }
}

export function assertAttachmentAction(
  auth: AttachmentAuthContext,
  action: AttachmentAction,
): void {
  if (!canPerformAttachmentAction(auth, action)) {
    throw new Error('AUTH_FORBIDDEN');
  }
}
