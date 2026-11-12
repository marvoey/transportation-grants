export interface AssessArgs {
  positional: string[];
  say: string[];
  factsFile: string | null;
  /** Facts, answers to detail questions and the questions last shown, kept between runs. */
  stateFile: string | null;
  help: boolean;
}

/** Arguments of the assessment CLI: `<uuid> --say "..." [--say "..."] [--facts-file path]`. */
export function parseAssessArgs(argv: string[]): AssessArgs {
  const say: string[] = [];
  let factsFile: string | null = null;
  let stateFile: string | null = null;
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
    } else if (arg === '--state-file') {
      const value = argv[i + 1];
      if (value !== undefined && !value.startsWith('--')) stateFile = value;
      i += 1;
    } else if (!arg.startsWith('--')) {
      positional.push(arg);
    }
  }
  return { positional, say, factsFile, stateFile, help: argv.includes('--help') };
}
