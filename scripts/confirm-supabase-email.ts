import { createClient, type SupabaseClient, type User } from "@supabase/supabase-js";

const PAGE_SIZE = 1_000;

function usage() {
  console.log("Usage: bun run auth:confirm-email <email>");
  console.log("Confirms one existing Supabase Auth user without sending an email.");
}

function normalizeEmail(value: string | undefined) {
  const email = value?.trim().toLowerCase() ?? "";
  if (!/^\S+@\S+\.\S+$/.test(email)) {
    throw new Error("Provide one valid email address.");
  }
  return email;
}

async function findUserByEmail(
  supabase: SupabaseClient,
  email: string,
): Promise<User | null> {
  for (let page = 1; ; page += 1) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;

    const user = data.users.find((candidate) => candidate.email?.trim().toLowerCase() === email);
    if (user) return user;
    if (data.users.length < PAGE_SIZE) return null;
  }
}

async function main() {
  const args = process.argv.slice(2).filter((argument) => argument !== "--");
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }
  if (args.length !== 1) {
    usage();
    throw new Error("Expected exactly one email address.");
  }

  const email = normalizeEmail(args[0]);
  const supabaseUrl = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !secretKey) {
    throw new Error(
      "Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY) in your local environment.",
    );
  }

  const projectUrl = new URL(supabaseUrl);
  console.log(`Supabase project: ${projectUrl.host}`);
  console.log(`Looking up: ${email}`);

  const supabase = createClient(supabaseUrl, secretKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  const user = await findUserByEmail(supabase, email);
  if (!user) {
    throw new Error(`No Supabase Auth user exists for ${email}. Register it in Preview first.`);
  }

  if (user.email_confirmed_at) {
    console.log(`Already confirmed: ${email} (${user.id})`);
    return;
  }

  const { data, error } = await supabase.auth.admin.updateUserById(user.id, {
    email_confirm: true,
  });
  if (error) throw error;
  if (!data.user.email_confirmed_at) {
    throw new Error(`Supabase updated ${email}, but did not return a confirmed timestamp.`);
  }

  console.log(`Confirmed: ${email} (${data.user.id})`);
  console.log("Return to Preview and sign in with the password used during registration.");
}

await main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Could not confirm Supabase email: ${message}`);
  process.exitCode = 1;
});
