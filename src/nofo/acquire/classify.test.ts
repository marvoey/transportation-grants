import { describe, expect, it } from 'vitest';
import { classifyAuthority } from './authority.js';
import { describeUnsupported, detectType, expectedType, storageExtension } from './sniff.js';
import { DOCX_BYTES, HTML_BYTES, PDF_BYTES } from '../__fixtures__/helpers.js';

describe('detectType (content, not metadata)', () => {
  it('recognizes common formats from bytes', () => {
    expect(detectType(PDF_BYTES)).toBe('pdf');
    expect(detectType(Buffer.concat([Buffer.from('\n\n junk before header '), PDF_BYTES]))).toBe('pdf');
    expect(detectType(DOCX_BYTES)).toBe('zip');
    expect(detectType(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]))).toBe('ole');
    expect(detectType(HTML_BYTES)).toBe('html');
    expect(detectType(Buffer.from('  \n<html lang="en"><body>x</body></html>'))).toBe('html');
    expect(detectType(Buffer.from('﻿<!DOCTYPE HTML><p>x</p>'))).toBe('html');
    expect(detectType(Buffer.from('just some plain text'))).toBe('text');
    expect(detectType(Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe]))).toBe('unknown');
    expect(detectType(Buffer.alloc(0))).toBe('unknown');
  });
});

describe('storageExtension / expectedType / describeUnsupported', () => {
  it('derives a safe storage extension from the detected type', () => {
    expect(storageExtension('pdf', '../../evil.exe')).toBe('pdf');
    expect(storageExtension('zip', 'Template.DOCX')).toBe('docx');
    expect(storageExtension('zip', 'weird.exe')).toBe('zip');
    expect(storageExtension('ole', 'old.doc')).toBe('doc');
    expect(storageExtension('unknown', 'x.pdf')).toBe('bin');
    expect(storageExtension('html', 'page')).toBe('html');
  });
  it('flags declared-vs-detected expectations', () => {
    expect(expectedType('application/pdf', 'a.bin')).toBe('pdf');
    expect(expectedType(null, 'a.html')).toBe('html');
    expect(expectedType('application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'a')).toBe('zip');
    expect(expectedType('application/octet-stream', 'a.dat')).toBeNull();
  });
  it('describes unsupported formats honestly', () => {
    expect(describeUnsupported('zip', null, 'x.docx')).toMatch(/Word document.*not parsed/);
    expect(describeUnsupported('zip', null, 'bundle.zip')).toMatch(/never extracted/);
    expect(describeUnsupported('unknown', 'application/x-weird', 'a')).toMatch(/Unrecognized/);
  });
});

describe('classifyAuthority (deterministic triage)', () => {
  // Names and descriptions are taken from real Simpler.Grants.gov attachments.
  it.each([
    ['FY_2026_BUILD_NOFO_Final.pdf', 'FY 2026 BUILD NOFO_Final', 'controlling'],
    ['Final_WCPP_NOFO_HAD-260512-001.pdf', 'Final FY 26 WCPP NOFO', 'controlling'],
    ['FY_2027_CCFP_NOFO.pdf', 'FY 2027 Crash Causal Factors Program (CCFP) Notice of Funding Opportunity (NOFO)', 'controlling'],
    ['9.29.26_-_Final_Draft_WCPP_Application_Template.docx', 'FY 26 WCPP Application Template', 'official_guidance'],
    ['FY_2027_Budget_Narrative_Template.docx', 'Budget Narrative Template', 'official_guidance'],
    ['Updated_FY_2027_FMCSA_APPLICANT_TITLE_VI_PROGRAM_COMPLIANCE_PLAN_CHECKLIST.docx', 'FY 2027 FMCSA Applicant Title VI Program Compliance Plan Checklist', 'official_guidance'],
    ['CCFP_NOFO_Additional_Resources.pdf', 'FY 2027 Crash Causal Factors Program (CCFP) Funding Webinar & Office Hours', 'official_guidance'],
    ['ITSE_Pre-Applicant_Webinar_8.7.2026.pdf', 'ITSE Live Webinar Information', 'official_guidance'],
    // A Q&A about the NOFO is guidance even though its name contains "NOFO".
    ['NHTSA_ITSE_NOFO_Questions_and_Answers_8.20.2026.pdf', 'NHTSA ITSE NOFO Questions and Answers 8.20.2026', 'official_guidance'],
    ['NHTSA_ITSE_NOFO_Questions_and_Answers_vII._8.26.2026.pdf', 'NHTSA ITSE NOFO Questions and Answers vII. 8.26.2026', 'official_guidance'],
    ['NOFO_Amendment_1.pdf', null, 'controlling'],
    ['FMCSA_Title_VI_Program_Assurance3.docx', 'FY 2027 FMCSA Title VI Program Assurance', 'unclassified'],
    ['scan0001.pdf', null, 'unclassified'],
  ])('%s -> %s', (fileName, description, expected) => {
    const result = classifyAuthority(fileName, description);
    expect(result.authority).toBe(expected);
    expect(result.reason).toMatch(/^heuristic:/);
  });
});
