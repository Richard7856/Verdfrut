// CRUD de usuarios (admin, dispatcher, zone_manager, driver).

import { Badge, DataTable, PageHeader, type Column, type BadgeTone } from '@verdfrut/ui';
import type { UserProfile, UserRole } from '@verdfrut/types';
import { requireRole } from '@/lib/auth';
import { listUsers } from '@/lib/queries/users';
import { listZones } from '@/lib/queries/zones';
import { InviteUserButton } from './invite-user-button';
import { ToggleUserActiveCell } from './toggle-user-active-cell';
import { ForceResetButton } from './force-reset-button';
import { TemplateDownloadButton } from '@/components/template-download-button';

export const metadata = { title: 'Usuarios' };

const ROLE_LABELS: Record<UserRole, string> = {
  admin: 'Administrador',
  dispatcher: 'Logística',
  zone_manager: 'Encargado de zona',
  driver: 'Chofer',
};

const ROLE_TONES: Record<UserRole, BadgeTone> = {
  admin: 'danger',
  dispatcher: 'primary',
  zone_manager: 'info',
  driver: 'neutral',
};

export default async function UsersPage() {
  await requireRole('admin');

  const [users, zones] = await Promise.all([listUsers(), listZones()]);
  const zonesById = new Map(zones.map((z) => [z.id, z]));

  const columns: Column<UserProfile>[] = [
    { key: 'name', header: 'Nombre', cell: (u) => u.fullName },
    {
      key: 'email',
      header: 'Email',
      cell: (u) => <span className="text-[var(--color-text-muted)]">{u.email}</span>,
    },
    {
      key: 'role',
      header: 'Rol',
      cell: (u) => <Badge tone={ROLE_TONES[u.role]}>{ROLE_LABELS[u.role]}</Badge>,
    },
    {
      key: 'zone',
      header: 'Zona',
      cell: (u) =>
        u.zoneId
          ? zonesById.get(u.zoneId)?.code ?? '—'
          : <span className="text-[var(--color-text-subtle)]">—</span>,
    },
    {
      key: 'status',
      header: 'Estado',
      cell: (u) => (
        <Badge tone={u.isActive ? 'success' : 'neutral'}>
          {u.isActive ? 'Activo' : 'Inactivo'}
        </Badge>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (u) => (
        <div className="flex items-center justify-end gap-3">
          <ForceResetButton user={u} />
          <ToggleUserActiveCell user={u} />
        </div>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Usuarios"
        description={`${users.length} usuario(s). Las invitaciones llegan por email.`}
        action={
          <div className="flex gap-2">
            <TemplateDownloadButton entity="users" />
            <InviteUserButton zones={zones} />
          </div>
        }
      />
      <DataTable
        columns={columns}
        rows={users}
        rowKey={(u) => u.id}
        emptyTitle="Sin usuarios"
        emptyDescription="Invita al primer usuario para empezar a operar."
        emptyAction={<InviteUserButton zones={zones} />}
      />
    </>
  );
}
