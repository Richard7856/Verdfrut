// Chofer = UserProfile con role 'driver' + datos operativos extras.

export interface Driver {
  id: string;
  userId: string;
  fullName: string;
  phone: string;
  zoneId: string;
  licenseNumber: string | null;
  licenseExpiresAt: string | null;
  isActive: boolean;
  createdAt: string;
}
