import { describe, expect, it, vi } from 'vitest';

import { MemoryGroupsStore } from '../config/groups-config';

import { GroupsService } from './groups-service';

describe('GroupsService', () => {
  it('saves, replaces and deletes user groups', async () => {
    const onChange = vi.fn();
    const service = new GroupsService(new MemoryGroupsStore(), onChange);
    await service.reload();
    await service.save({ id: 'a', name: 'A', type: 'static', workspaces: [] });
    await service.save({ id: 'a', name: 'A2', type: 'static', workspaces: ['x'] });
    expect(service.snapshot().groups).toEqual([
      { id: 'a', name: 'A2', type: 'static', workspaces: ['x'] },
    ]);
    await service.delete('a');
    expect(service.snapshot().groups).toEqual([]);
    expect(onChange).toHaveBeenCalled();
  });

  it('refuses to delete a group it does not own', async () => {
    const service = new GroupsService(new MemoryGroupsStore(), vi.fn());
    await service.reload();
    await expect(service.delete('nope')).rejects.toMatchObject({ code: 'CONFIG_INVALID' });
  });
});
