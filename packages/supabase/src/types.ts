// Helper para tipar los clientes Supabase con el schema generado.
// `database.ts` se regenera con:
//   pnpm dlx supabase gen types typescript --project-id $SUPABASE_PROJECT_ID > src/database.ts
// (o desde el MCP de Supabase con generate_typescript_types).

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from './database';

export type { Database, Json } from './database';

// SupabaseClient acepta <Database, SchemaName extends keyof Database, Schema>.
// Pasamos los 3 explícitos para que TS no caiga a `never` en el inferer.
export type VerdFrutSupabaseClient = SupabaseClient<Database, 'public', 'public'>;

// Helpers para tipar Insert/Update/Row de cualquier tabla del schema.
type PublicTables = Database['public']['Tables'];
export type TableRow<T extends keyof PublicTables> = PublicTables[T]['Row'];
export type TableInsert<T extends keyof PublicTables> = PublicTables[T]['Insert'];
export type TableUpdate<T extends keyof PublicTables> = PublicTables[T]['Update'];
