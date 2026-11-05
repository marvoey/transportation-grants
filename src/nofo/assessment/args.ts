export interface AssessArgs {
  positional: string[];
  say: string[];
  factsFile: string | null;
  help: boolean;
}

/** Arguments of the assessment CLI: `<uuid> --say "..." [--say "..."] [--facts-file path]`. */
export function parseAssessArgs(argv: string[]): AssessArgs {
  const say: string[] = [];
  let factsFile: string | null = null;
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--say') {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith('--')) say.push(value);
      i += 1;
    } else if (arg === '--facts-file') {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith('--')) factsFile = value;
      i += 1;
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }
  return { positional, say, factsFile, help: argv.includes('--help') };
}
