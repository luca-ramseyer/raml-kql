import { describe, expect, it } from 'vitest';

import type { ResultColumn } from '../query/models';

import { rowLinks } from './row-links';

const col = (name: string): ResultColumn => ({ name, type: 'string' });

describe('rowLinks', () => {
  it('links incidents, alerts and Defender devices', () => {
    const columns = [col('_TenantId'), col('IncidentUrl'), col('DeviceId'), col('AlertLink')];
    const links = rowLinks(columns, [
      '00000000-0000-0000-0000-00000000c001',
      'https://portal.azure.com/#asset/Microsoft_Azure_Security_Insights/Incident/x',
      'a'.repeat(40),
      'https://security.microsoft.com/alerts/da123',
    ]);
    expect(links).toEqual([
      {
        label: 'Open Incident',
        url: 'https://portal.azure.com/#asset/Microsoft_Azure_Security_Insights/Incident/x',
      },
      { label: 'Open Alert', url: 'https://security.microsoft.com/alerts/da123' },
      {
        label: 'Open Device in Microsoft Defender',
        url: `https://security.microsoft.com/machines/${'a'.repeat(40)}?tid=00000000-0000-0000-0000-00000000c001`,
      },
    ]);
  });

  it('ignores values that are not safe portal links', () => {
    const columns = [col('IncidentUrl'), col('DeviceId'), col('AlertUrl')];
    expect(
      rowLinks(columns, [
        'http://portal.azure.com/x',
        'not-a-device',
        'https://evil.example/alert',
      ]),
    ).toEqual([]);
    expect(rowLinks(columns, [null, '', undefined])).toEqual([]);
  });
});
