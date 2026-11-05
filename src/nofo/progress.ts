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
