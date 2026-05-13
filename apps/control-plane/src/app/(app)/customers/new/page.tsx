// Form "Nuevo customer" — Fase A2.3.

import Link from 'next/link';
import { PageHeader, Card } from '@tripdrive/ui';
import { CustomerForm } from '../customer-form';
import { createCustomerAction } from '../actions';

export const metadata = { title: 'Nuevo customer' };

export default function NewCustomerPage() {
  return (
    <>
      <PageHeader
        title="Nuevo customer"
        description="Crear un cliente dentro del tenant compartido. El slug será su subdomain (slug.tripdrive.xyz)."
        breadcrumb={
          <Link href="/customers" className="hover:underline">
            Customers
          </Link>
        }
      />

      <Card>
        <CustomerForm mode="create" action={createCustomerAction} />
      </Card>
    </>
  );
}
