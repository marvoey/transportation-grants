import { describe, expect, it } from 'vitest';
import { SIMPLER_OPPORTUNITY_PAGE, simplerOpportunityUrl } from './urls.js';

const ID = '4d8f5775-ff01-4a6f-ab4e-b125899043b3';

describe('simplerOpportunityUrl', () => {
  it('builds the public page URL from an opportunity UUID, lower-cased', () => {
    expect(simplerOpportunityUrl(ID)).toBe(`https://simpler.grants.gov/opportunity/${ID}`);
    expect(simplerOpportunityUrl(ID.toUpperCase())).toBe(`https://simpler.grants.gov/opportunity/${ID}`);
    expect(SIMPLER_OPPORTUNITY_PAGE).toBe('https://simpler.grants.gov/opportunity/');
  });

  it('returns null for anything that is not a UUID, so nothing odd ends up in a link', () => {
    for (const bad of ['', 'abc', `${ID}/../x`, `${ID}?next=https://evil.example`, 'javascript:alert(1)', `${ID} `]) {
      expect(simplerOpportunityUrl(bad)).toBeNull();
    }
  });
});
