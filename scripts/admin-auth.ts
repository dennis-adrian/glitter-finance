import type { SupabaseClient, User } from "@supabase/supabase-js";

const listUsersPageSize = 1000;

/** Walks every listUsers page until a case-insensitive email match or EOF. */
export async function findAuthUserByEmail(
  admin: SupabaseClient,
  email: string
): Promise<User | null> {
  const normalized = email.trim().toLowerCase();
  let page = 1;

  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: listUsersPageSize,
    });
    if (error) {
      throw new Error(`Could not list users: ${error.message}`);
    }

    const match = data.users.find(
      (user) => user.email?.toLowerCase() === normalized
    );
    if (match) {
      return match;
    }

    if (data.users.length < listUsersPageSize) {
      return null;
    }

    page += 1;
  }
}
