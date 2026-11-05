import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';
import { GrantServerError } from '../../types/index.js';
import { SimplerApiError, SimplerGrantsClient } from './client.js';
import { SimplerOpportunitySource } from './source.js';
import { asFetch, fakeFetch, jsonResponse } from '../__fixtures__/helpers.js';

const fixture = (name: string): { data: Record<string, unknown> } =>
  JSON.parse(readFileSync(new URL(`../__fixtures__/api/${name}`, import.meta.url), 'utf-8'));

function sourceReturning(body: unknown) {
  const fetchImpl = fakeFetch(() => jsonResponse(body));
  const client = new SimplerGrantsClient({ apiKey: 'k', baseUrl: 'https://api.example.test', fetchImpl: asFetch(fetchImpl), maxRetries: 0 });
  return { source: new SimplerOpportunitySource(client, () => new Date('2026-11-05T00:00:00Z')), fetchImpl };
}

describe('SimplerOpportunitySource', () => {
  // Trimmed real records. They prove the schema accepts what the API actually returns.
  it.each([
    ['detail-build.json', 1],
    ['detail-wcpp.json', 2],
  ])('parses the real-shaped record %s', async (file, attachmentCount) => {
    const body = fixture(file);
    const id = String(body.data.opportunity_id);
    const { source, fetchImpl } = sourceReturning(body);

    const detail = await source.getOpportunityWithAttachments(id);

    expect(detail.opportunity.opportunityId).toBe(id);
    expect(detail.opportunity.opportunityNumber).toBe(body.data.opportunity_number);
    expect(detail.opportunity.opportunityNumber).not.toBe(detail.opportunity.opportunityId); // number != UUID
    expect(detail.attachments).toHaveLength(attachmentCount);
    expect(detail.attachments[0].downloadPath).toMatch(/^https:\/\//);
    expect(detail.opportunity.responseSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(fetchImpl.calls[0].url).toBe(`https://api.example.test/v1/opportunities/${id}`);
  });

  it('maps metadata faithfully, including a null fiscal year', async () => {
    const body = fixture('detail-build.json');
    const { source } = sourceReturning(body);
    const { opportunity } = await source.getOpportunityWithAttachments(String(body.data.opportunity_id));
    expect(opportunity.status).toBe('archived');
    expect(opportunity.summary.awardCeiling).toBe(25_000_000);
    expect(opportunity.summary.fiscalYear).toBeNull();
    expect(opportunity.legacyOpportunityId).toBe(360921);
    expect(opportunity.agency.topLevelName).toBe('Department of Transportation');
  });

  it('treats an empty attachment list as zero attachments (not an error)', async () => {
    const body = fixture('detail-build.json');
    (body.data as { attachments: unknown[] }).attachments = [];
    const { source } = sourceReturning(body);
    const detail = await source.getOpportunityWithAttachments(String(body.data.opportunity_id));
    expect(detail.attachments).toEqual([]);
  });

  it('tolerates unknown extra fields', async () => {
    const body = fixture('detail-build.json');
    (body.data as Record<string, unknown>).brand_new_field = { anything: true };
    const { source } = sourceReturning(body);
    await expect(source.getOpportunityWithAttachments(String(body.data.opportunity_id))).resolves.toBeDefined();
  });

  it('accepts an attachment that has no download_path (recorded later as a per-document failure)', async () => {
    const body = fixture('detail-build.json');
    delete (body.data.attachments as Array<Record<string, unknown>>)[0].download_path;
    const { source } = sourceReturning(body);
    const detail = await source.getOpportunityWithAttachments(String(body.data.opportunity_id));
    expect(detail.attachments[0].downloadPath).toBeNull();
  });

  it('rejects a response whose attachments field is not an array', async () => {
    const body = fixture('detail-build.json');
    (body.data as Record<string, unknown>).attachments = 'oops';
    const { source } = sourceReturning(body);
    const error = await source.getOpportunityWithAttachments(String(body.data.opportunity_id)).catch((e) => e);
    expect(error).toBeInstanceOf(SimplerApiError);
    expect(error.kind).toBe('malformed_response');
    expect(error.message).toContain('attachments');
  });

  it('rejects a response missing opportunity_id', async () => {
    const body = fixture('detail-build.json');
    const id = String(body.data.opportunity_id);
    delete body.data.opportunity_id;
    const { source } = sourceReturning(body);
    const error = await source.getOpportunityWithAttachments(id).catch((e) => e);
    expect(error.kind).toBe('malformed_response');
  });

  it('rejects an envelope with no data', async () => {
    const { source } = sourceReturning({ message: 'Success' });
    const error = await source.getOpportunityWithAttachments('11111111-1111-4111-8111-111111111111').catch((e) => e);
    expect(error.kind).toBe('malformed_response');
  });

  it('rejects a response for a different opportunity than requested', async () => {
    const body = fixture('detail-build.json');
    const { source } = sourceReturning(body);
    const error = await source.getOpportunityWithAttachments('99999999-9999-4999-8999-999999999999').catch((e) => e);
    expect(error.kind).toBe('malformed_response');
  });

  it('validates the UUID before making any request', async () => {
    const { source, fetchImpl } = sourceReturning({});
    await expect(source.getOpportunityWithAttachments('../../etc/passwd')).rejects.toBeInstanceOf(GrantServerError);
    expect(fetchImpl.calls).toHaveLength(0);
  });
});
