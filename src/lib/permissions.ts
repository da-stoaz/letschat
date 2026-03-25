import type { Role } from '../types/domain'

export const canManageChannels = (role: Role): boolean => role !== 'Member'
export const canKickOrBanMembers = (role: Role): boolean => role !== 'Member'
export const canKickOrBanModerators = (role: Role): boolean => role === 'Owner'
export const canRenameServer = (role: Role): boolean => role === 'Owner'
export const canSetRoles = (role: Role): boolean => role === 'Owner'
export const canPostInModOnlyChannel = (role: Role): boolean => role !== 'Member'
