import { describe, expect, it, vi } from 'vitest';

import {
  installNavigationGuards,
  isAllowedExternalUrl,
  isTrustedOrigin,
  originKey,
  type WebContentsLike,
} from './navigation';

describe('isAllowedExternalUrl', () => {
  it.each([
    'https://portal.azure.com/#blade/foo',
    'https://security.microsoft.com/v2/advanced-hunting',
    'https://github.com/raml/raml-kql/issues/new',
  ])('allows %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true);
  });

  it.each([
    'http://portal.azure.com/',
    'https://portal.azure.com.evil.example/',
    'https://evil.example/?https://portal.azure.com',
    'https://user:pass@github.com/',
    'https://github.com:8443/',
    'https://gist.github.com/',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
  ])('blocks %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false);
  });
});

describe('originKey / isTrustedOrigin', () => {
  it('works for the custom app scheme (where URL.origin is "null")', () => {
    expect(originKey('raml-kql://app/index.html')).toBe('raml-kql://app');
    expect(isTrustedOrigin('raml-kql://app/x', ['raml-kql://app'])).toBe(true);
  });

  it('distinguishes ports and hosts', () => {
    const trusted = ['http://localhost:5173'];
    expect(isTrustedOrigin('http://localhost:5173/index.html', trusted)).toBe(true);
    expect(isTrustedOrigin('http://localhost:5174/', trusted)).toBe(false);
    expect(isTrustedOrigin('http://127.0.0.1:5173/', trusted)).toBe(false);
    expect(isTrustedOrigin('', trusted)).toBe(false);
  });
});

describe('installNavigationGuards', () => {
  function install() {
    const listeners = new Map<string, (event: { preventDefault(): void }, url: string) => void>();
    let openHandler: ((details: { url: string }) => { action: 'deny' }) | undefined;
    const contents = {
      on: (event: string, listener: (event: { preventDefault(): void }, url: string) => void) => {
        listeners.set(event, listener);
      },
      setWindowOpenHandler: (handler: (details: { url: string }) => { action: 'deny' }) => {
        openHandler = handler;
      },
    } as unknown as WebContentsLike;
    const openExternal = vi.fn();
    installNavigationGuards(contents, { trustedOrigins: ['raml-kql://app'], openExternal });

    const navigate = (url: string) => {
      const event = { preventDefault: vi.fn() };
      listeners.get('will-navigate')?.(event, url);
      return event.preventDefault.mock.calls.length > 0;
    };
    return { listeners, openHandler: () => openHandler, openExternal, navigate };
  }

  it('blocks navigation to other origins', () => {
    const { navigate, openExternal } = install();
    expect(navigate('https://evil.example/')).toBe(true);
    expect(openExternal).not.toHaveBeenCalled();
  });

  it('opens allowlisted links in the OS browser instead of navigating', () => {
    const { navigate, openExternal } = install();
    expect(navigate('https://portal.azure.com/')).toBe(true);
    expect(openExternal).toHaveBeenCalledWith('https://portal.azure.com/');
  });

  it('allows same-origin navigation', () => {
    const { navigate } = install();
    expect(navigate('raml-kql://app/index.html')).toBe(false);
  });

  it('never opens new windows', () => {
    const { openHandler, openExternal } = install();
    expect(openHandler()?.({ url: 'https://evil.example/' })).toEqual({ action: 'deny' });
    expect(openHandler()?.({ url: 'https://github.com/' })).toEqual({ action: 'deny' });
    expect(openExternal).toHaveBeenCalledTimes(1);
    expect(openExternal).toHaveBeenCalledWith('https://github.com/');
  });

  it('blocks <webview> attachment', () => {
    const { listeners } = install();
    const event = { preventDefault: vi.fn() };
    listeners.get('will-attach-webview')?.(event, '');
    expect(event.preventDefault).toHaveBeenCalled();
  });
});
