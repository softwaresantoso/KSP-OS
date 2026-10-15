import type { ActorRole, Role } from './types.ts';

export type Permission =
  | 'member.manage'
  | 'savings.record'
  | 'loan.verify'
  | 'loan.approve'
  | 'loan.disburse'
  | 'loan.record_payment'
  | 'cash.manage'
  | 'report.view'
  | 'settings.manage';

export const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  ketua: ['loan.approve', 'report.view', 'settings.manage'],
  sekretaris: ['member.manage', 'report.view'],
  bendahara: [
    'savings.record',
    'loan.verify',
    'loan.approve',
    'loan.disburse',
    'loan.record_payment',
    'cash.manage',
    'report.view',
    'settings.manage',
  ],
  admin: ['member.manage', 'savings.record', 'loan.verify', 'loan.record_payment', 'cash.manage', 'report.view'],
};

export function can(role: ActorRole | null | undefined, permission: Permission): boolean {
  if (!role || role === 'anggota') return false;
  return ROLE_PERMISSIONS[role].includes(permission);
}
