import { describe, expect, it } from 'vitest';

import { detectEntity } from './entities';

describe('detectEntity', () => {
  it.each([
    ['IPAddress', '203.0.113.7', 'ip'],
    ['RemoteIP', '2001:db8::1', 'ip'],
    ['SHA256', 'a'.repeat(64), 'sha256'],
    ['InitiatingProcessSHA1', 'b'.repeat(40), 'sha1'],
    ['MD5', 'c'.repeat(32), 'md5'],
    ['UserPrincipalName', 'alice@contoso.com', 'upn'],
    ['DeviceName', 'contoso-ws-01', 'hostname'],
    ['RemoteUrl', 'https://fabrikam.example/login', 'url'],
    ['TenantId', '00000000-0000-0000-0000-000000000001', 'tenantId'],
    ['SomethingElse', '198.51.100.20', 'ip'],
  ])('%s = %s is %s', (column, value, type) => {
    expect(detectEntity(column, value)).toBe(type);
  });

  it.each([
    ['IPAddress', '999.1.1.1'],
    ['IPAddress', 'not an ip'],
    ['SHA256', 'xyz'],
    ['Message', 'hello world'],
    ['IPAddress', 42],
    ['IPAddress', ''],
  ])('%s = %s is nothing', (column, value) => {
    expect(detectEntity(column, value)).toBeUndefined();
  });
});
