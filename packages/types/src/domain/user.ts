// Roles del sistema. Cada proyecto Supabase de cliente maneja sus propios usuarios.
// VerdFrut superadmin vive solo en el control plane.

export type UserRole =
  | 'admin'           // Admin del cliente: ve toda la operación del cliente
  | 'dispatcher'      // Logística: crea y publica rutas
  | 'zone_manager'    // Encargado de zona: supervisa choferes de su zona
  | 'driver';         // Chofer: ejecuta rutas

export interface UserProfile {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  zoneId: string | null;
  phone: string | null;
  isActive: boolean;
  /**
   * Si TRUE, el usuario debe establecer una contraseña nueva antes de continuar.
   * Lo setea el flujo de invite y "forzar reset" del admin. Persistido en
   * user_profiles.must_reset_password.
   */
  mustResetPassword: boolean;
  createdAt: string;
}
