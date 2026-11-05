export interface ExtractArgs {
  positional: string[];
  refresh: boolean;
  includeGuidance: boolean;
  passes: number;
  help: boolean;
}

/** Parses the extraction CLI's arguments. `--passes` takes a value; everything else is a flag or the opportunity UUID. */
export function parseExtractArgs(argv: string[]): ExtractArgs {
  const passesIndex = argv.indexOf('--passes');
  const requested = passesIndex >= 0 ? Number(argv[passesIndex + 1]) : 1;
  return {
    positional: argv.filter((a, i) => !a.startsWith('--') && !(passesIndex >= 0 && i === passesIndex + 1)),
    refresh: argv.includes('--refresh'),
    includeGuidance: argv.includes('--include-guidance'),
    passes: Number.isFinite(requested) ? requested : 1,
    help: argv.includes('--help'),
  };
}
