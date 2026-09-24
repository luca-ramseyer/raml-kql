import { getNodeValue } from 'jsonc-parser';
import { z } from 'zod';

import { GuidSchema } from '../../shared/auth/models';
import { parseJsonc, readTextFile, writeTextFileAtomic } from '../config/jsonc';
import { setTopLevelProperty } from '../config/jsonc-edit';

/**
 * accounts.jsonc (spec 09): which accounts the user added, their labels and order.
 * **No tokens or secrets**, only identifiers. Tokens live in the encrypted MSAL cache.
 */
export const AccountEntrySchema = z.object({
  id: z.string().min(1).max(300),
  /** `demo` entries only exist in the in-memory store used by demo mode. */
  provider: z.enum(['builtin', 'custom', 'azureCli', 'demo']),
  username: z.string().max(300).optional(),
  label: z.string().max(200).optional(),
  /** Custom provider only: the user's own app registration (not a secret). */
  clientId: GuidSchema.optional(),
});
export type AccountEntry = z.infer<typeof AccountEntrySchema>;

export interface AccountsConfigStore {
  read(): Promise<AccountEntry[]>;
  write(entries: AccountEntry[]): Promise<void>;
}

const NEW_FILE = `{
  // Accounts added in Raml KQL: labels and order only. Tokens are never stored here.
  "accounts": []
}
`;

/** accounts.jsonc in the config dir. Invalid entries are skipped, never fatal. */
export class JsoncAccountsConfig implements AccountsConfigStore {
  constructor(private readonly file: string) {}

  async read(): Promise<AccountEntry[]> {
    const text = await readTextFile(this.file);
    if (text === undefined) return [];
    const { tree, problems } = parseJsonc(text, 'accounts.jsonc');
    if (problems.length > 0 || tree === undefined) return [];
    const raw = getNodeValue(tree) as { accounts?: unknown };
    if (!Array.isArray(raw.accounts)) return [];
    return raw.accounts.flatMap((entry) => {
      const parsed = AccountEntrySchema.safeParse(entry);
      return parsed.success ? [parsed.data] : [];
    });
  }

  async write(entries: AccountEntry[]): Promise<void> {
    const text = (await readTextFile(this.file)) ?? NEW_FILE;
    const { problems } = parseJsonc(text, 'accounts.jsonc');
    const base = problems.length > 0 ? NEW_FILE : text;
    await writeTextFileAtomic(this.file, setTopLevelProperty(base, 'accounts', entries));
  }
}

/** Demo mode keeps accounts in memory so it never touches the user's real config. */
export class MemoryAccountsConfig implements AccountsConfigStore {
  private entries: AccountEntry[] = [];

  read(): Promise<AccountEntry[]> {
    return Promise.resolve([...this.entries]);
  }

  write(entries: AccountEntry[]): Promise<void> {
    this.entries = [...entries];
    return Promise.resolve();
  }
}
