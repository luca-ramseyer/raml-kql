import { AppError } from '../../shared/errors';
import type { Group, GroupsSnapshot } from '../../shared/workspaces/groups';
import type { GroupsStore } from '../config/groups-config';

/** Tenant/workspace groups (spec 03). Only the user's own groups.jsonc is ever written. */
export class GroupsService {
  private snapshotValue: GroupsSnapshot = { groups: [], problems: [] };
  private userGroups: Group[] = [];

  constructor(
    private readonly store: GroupsStore,
    private readonly onChange: (snapshot: GroupsSnapshot) => void,
  ) {}

  snapshot(): GroupsSnapshot {
    return this.snapshotValue;
  }

  async reload(): Promise<GroupsSnapshot> {
    const { groups, userGroups, problems } = await this.store.read();
    this.userGroups = userGroups;
    const next = { groups, problems };
    if (JSON.stringify(next) !== JSON.stringify(this.snapshotValue)) {
      this.snapshotValue = next;
      this.onChange(next);
    }
    return this.snapshotValue;
  }

  async save(group: Group): Promise<GroupsSnapshot> {
    const exists = this.userGroups.some((g) => g.id === group.id);
    await this.write(
      exists
        ? this.userGroups.map((g) => (g.id === group.id ? group : g))
        : [...this.userGroups, group],
    );
    return this.reload();
  }

  async delete(id: string): Promise<GroupsSnapshot> {
    if (!this.userGroups.some((g) => g.id === id)) {
      throw new AppError({
        code: 'CONFIG_INVALID',
        message:
          'This group comes from a shared file listed in "extends" and can’t be deleted here.',
        retryable: false,
        source: 'main',
      });
    }
    await this.write(this.userGroups.filter((g) => g.id !== id));
    return this.reload();
  }

  private async write(groups: Group[]): Promise<void> {
    try {
      await this.store.write(groups);
    } catch (error) {
      throw new AppError({
        code: 'CONFIG_INVALID',
        message: (error as Error).message,
        retryable: false,
        source: 'main',
      });
    }
  }
}
