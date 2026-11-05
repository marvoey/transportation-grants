/**
 * One step of what the code is doing, for a progress display. Written by code in plain language; it carries labels,
 * counts and search words, never the applicant's own text. Shared by grant discovery and the project assessment.
 */
export interface ProgressEvent {
  /** Stable per step: a later event with the same id updates the earlier line. */
  id: string;
  status: 'running' | 'done' | 'failed';
  message: string;
  /** Optional second line, for example the search words that were sent. */
  detail?: string;
}

export type ProgressFn = (event: ProgressEvent) => void;

/** Wraps a listener so one that throws, or is absent, can never change the work it reports on. */
export function safeProgress(listener?: ProgressFn): ProgressFn {
  return (event) => {
    try {
      listener?.(event);
    } catch {
      /* progress is a courtesy; it must never change the result */
    }
  };
}

/**
 * One line of the developer console on the Find grants screen: how a Simpler.Grants.gov request is built and what came
 * back. Written by code from the search plan and the parsed response; it never carries the applicant's own words, the API
 * key, or the raw response body.
 */
export type ConsoleKind = 'cmd' | 'note' | 'add' | 'http' | 'json' | 'ok' | 'warn' | 'error';

export interface ConsoleLine {
  kind: ConsoleKind;
  text: string;
}

export type ConsoleFn = (line: ConsoleLine) => void;

/** Wraps a console listener so one that throws, or is absent, can never change the work it reports on. */
export function safeConsole(listener?: ConsoleFn): ConsoleFn {
  return (line) => {
    try {
      listener?.(line);
    } catch {
      /* the console is a courtesy; it must never change the result */
    }
  };
}
