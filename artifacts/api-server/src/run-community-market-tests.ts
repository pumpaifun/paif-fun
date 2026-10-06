import { spawnSync } from "node:child_process";

const contractFiles = [
  "src/community-appeals-security.test.ts",
  "src/community-comments.test.ts",
  "src/community-moderation.test.ts",
  "src/pumpapi.test.ts",
  "src/pumpapi-leaderboard.test.ts",
  "src/pumpapi-leaderboard-storage.test.ts",
  "src/pump-portal.test.ts",
];

type ContractFailure = {
  file: string;
  exitStatus: number | null;
  signal: NodeJS.Signals | null;
  error?: string;
};

const failures: ContractFailure[] = [];

for (const file of contractFiles) {
  console.log(`\n=== Running ${file} ===`);

  const result = spawnSync(process.execPath, ["--import", "tsx", file], {
    stdio: "inherit",
  });

  if (result.status === 0) {
    console.log(`=== Passed ${file} (exit 0) ===`);
    continue;
  }

  failures.push({
    file,
    exitStatus: result.status,
    signal: result.signal,
    error: result.error?.message,
  });

  const outcome = result.error
    ? `could not start: ${result.error.message}`
    : result.signal
      ? `signal ${result.signal}`
      : `exit ${result.status}`;
  console.error(`=== Failed ${file} (${outcome}) ===`);
}

if (failures.length === 0) {
  console.log(`\nAll ${contractFiles.length} community and market contracts passed.`);
  process.exit(0);
}

console.error(
  `\n${failures.length} of ${contractFiles.length} community and market contracts failed:`,
);
for (const failure of failures) {
  const outcome = failure.error
    ? `could not start: ${failure.error}`
    : failure.signal
      ? `signal ${failure.signal}`
      : `exit ${failure.exitStatus}`;
  console.error(`- ${failure.file}: ${outcome}`);
}

process.exit(1);
