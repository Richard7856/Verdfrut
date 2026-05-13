// Form "Editar customer" — Fase A2.3.

import Link from 'next/link';
import { notFound } from 'next/navigation';
import { PageHeader, Card } from '@tripdrive/ui';
import { getCustomerBySlug } from '@/lib/queries/customers';
import { CustomerForm } from '../../customer-form';
import { updateCustomerAction } from '../../actions';

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  const customer = await getCustomerBySlug(slug);
  return { title: customer ? `Editar — ${customer.name}` : 'Editar customer' };
}

export default async function EditCustomerPage({ params }: PageProps) {
  const { slug } = await params;
  const customer = await getCustomerBySlug(slug);
  if (!customer) notFound();

  const boundAction = updateCustomerAction.bind(null, customer.id);

  return (
    <>
      <PageHeader
        title={`Editar — ${customer.name}`}
        description={`slug: ${customer.slug} (no se puede cambiar)`}
        breadcrumb={
          <span>
            <Link href="/customers" className="hover:underline">
              Customers
            </Link>
            {' / '}
            <Link href={`/customers/${customer.slug}`} className="hover:underline">
              {customer.name}
            </Link>
          </span>
        }
      />

      <Card>
        <CustomerForm mode="edit" initial={customer} action={boundAction} />
      </Card>
    </>
  );
}
