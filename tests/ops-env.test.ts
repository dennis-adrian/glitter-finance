import assert from "node:assert/strict";
import test from "node:test";
import {
  confirmOpsTarget,
  describeOpsTarget,
  opsTargetMismatch,
  resolveOpsEnv,
  type ConfirmIo,
} from "@/scripts/ops-env";

const staging = {
  NEXT_PUBLIC_SUPABASE_URL: "https://stagingref.supabase.co",
  SUPABASE_SECRET_KEY: "sb_secret_staging",
  DATABASE_URL:
    "postgresql://postgres.stagingref:secret@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
};

const local = {
  NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321",
  SUPABASE_SECRET_KEY: "sb_secret_local",
  DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
};

test("the whole target comes from the command line when it sets it", () => {
  const { env, targetSource } = resolveOpsEnv([
    { name: "the command line", values: { ...staging, PATH: "/bin" } },
    { name: ".env.local", values: { ...local, QA_EMAIL: "qa@example.com" } },
  ]);

  assert.equal(targetSource, "the command line");
  assert.equal(env.DATABASE_URL, staging.DATABASE_URL);
  assert.equal(env.SUPABASE_SECRET_KEY, staging.SUPABASE_SECRET_KEY);
  // Other variables still come from the files.
  assert.equal(env.QA_EMAIL, "qa@example.com");
  assert.equal(env.PATH, "/bin");
});

test("a partial target on the command line is not completed from a file", () => {
  assert.throws(
    () =>
      resolveOpsEnv([
        {
          name: "the command line",
          values: {
            NEXT_PUBLIC_SUPABASE_URL: staging.NEXT_PUBLIC_SUPABASE_URL,
            SUPABASE_SECRET_KEY: staging.SUPABASE_SECRET_KEY,
          },
        },
        { name: ".env.local", values: local },
      ]),
    /come from the command line, but DATABASE_URL does not/
  );
});

test("the target comes from .env.local when the command line has none", () => {
  const { env, targetSource } = resolveOpsEnv([
    { name: "the command line", values: { DATABASE_URL: "  " } },
    { name: ".env.local", values: local },
    { name: ".env", values: staging },
  ]);

  assert.equal(targetSource, ".env.local");
  assert.equal(env.NEXT_PUBLIC_SUPABASE_URL, local.NEXT_PUBLIC_SUPABASE_URL);
  assert.equal(env.DATABASE_URL, local.DATABASE_URL);
});

test("a target split across .env.local and .env is refused", () => {
  assert.throws(
    () =>
      resolveOpsEnv([
        { name: "the command line", values: {} },
        {
          name: ".env.local",
          values: { NEXT_PUBLIC_SUPABASE_URL: local.NEXT_PUBLIC_SUPABASE_URL },
        },
        { name: ".env", values: staging },
      ]),
    /comes from \.env\.local, but SUPABASE_SECRET_KEY and DATABASE_URL do not/
  );
  assert.throws(
    () => resolveOpsEnv([{ name: "the command line", values: {} }]),
    /Missing NEXT_PUBLIC_SUPABASE_URL/
  );
});

test("the project is read from the API host and the database host or user", () => {
  const pooler = describeOpsTarget(staging);
  assert.equal(pooler.supabaseProject, "stagingref");
  assert.equal(pooler.databaseProject, "stagingref");
  assert.equal(
    pooler.database,
    "postgres.stagingref@aws-0-sa-east-1.pooler.supabase.com:6543/postgres"
  );
  assert.equal(opsTargetMismatch(pooler), null);

  const direct = describeOpsTarget({
    ...staging,
    DATABASE_URL:
      "postgresql://postgres:secret@db.stagingref.supabase.co:5432/postgres",
  });
  assert.equal(direct.databaseProject, "stagingref");
  assert.doesNotMatch(direct.database, /secret/);
});

test("a target naming two projects is a mismatch", () => {
  const otherProject = describeOpsTarget({
    ...staging,
    DATABASE_URL:
      "postgresql://postgres.prodref:secret@aws-0-sa-east-1.pooler.supabase.com:6543/postgres",
  });
  assert.match(
    opsTargetMismatch(otherProject) ?? "",
    /project stagingref but DATABASE_URL is project prodref/
  );

  const localDatabase = describeOpsTarget({
    ...staging,
    DATABASE_URL: local.DATABASE_URL,
  });
  assert.match(
    opsTargetMismatch(localDatabase) ?? "",
    /DATABASE_URL is the local stack/
  );

  assert.equal(opsTargetMismatch(describeOpsTarget(local)), null);
});

function recordingIo(overrides: Partial<ConfirmIo> = {}) {
  const lines: string[] = [];
  const questions: string[] = [];
  const io: ConfirmIo = {
    argv: ["node", "script"],
    interactive: false,
    log: (message) => lines.push(message),
    ask: async (question) => {
      questions.push(question);
      return "yes";
    },
    ...overrides,
  };
  return { io, lines, questions };
}

test("the local stack is written to without a prompt", async () => {
  const { io, lines, questions } = recordingIo();
  await confirmOpsTarget("seed the QA account", ".env.local", local, io);

  assert.match(lines.join("\n"), /Target \(from \.env\.local\):/);
  assert.match(lines.join("\n"), /http:\/\/127\.0\.0\.1:54321 \(local stack\)/);
  assert.deepEqual(questions, []);
});

test("a hosted project needs --yes or a typed confirmation", async () => {
  await assert.rejects(
    confirmOpsTarget(
      "seed the QA account",
      "the command line",
      staging,
      recordingIo().io
    ),
    /re-run with --yes/
  );

  await confirmOpsTarget(
    "seed the QA account",
    "the command line",
    staging,
    recordingIo({ argv: ["node", "script", "--yes"] }).io
  );

  const prompted = recordingIo({ interactive: true });
  await confirmOpsTarget(
    "seed the QA account",
    "the command line",
    staging,
    prompted.io
  );
  assert.equal(prompted.questions.length, 1);

  await assert.rejects(
    confirmOpsTarget(
      "seed the QA account",
      "the command line",
      staging,
      recordingIo({ interactive: true, ask: async () => "y" }).io
    ),
    /Cancelled/
  );
});

test("a mixed target is refused even with --yes", async () => {
  const { io, lines } = recordingIo({ argv: ["node", "script", "--yes"] });
  await assert.rejects(
    confirmOpsTarget(
      "seed the QA account",
      "the command line",
      { ...staging, DATABASE_URL: local.DATABASE_URL },
      io
    ),
    /Point all three variables at one project/
  );
  // The target is printed before the refusal, without secrets.
  assert.match(lines.join("\n"), /stagingref\.supabase\.co/);
  assert.doesNotMatch(lines.join("\n"), /sb_secret|:postgres@/);
});
