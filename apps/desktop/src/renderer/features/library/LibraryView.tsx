import { useEffect, useMemo, useState } from 'react';

import type { QueryNode } from '../../../shared/queries/models';
import { Codicon } from '../../workbench/common/Codicon';
import { ContextMenu, type MenuEntry } from '../../workbench/common/ContextMenu';
import { isFilterEmpty, parsePackFilter } from '../packs/packs-store';

import {
  deleteQuery,
  folderOf,
  loadMyQueries,
  moveQuery,
  newFolder,
  newQueryFile,
  openMyQuery,
  renameQuery,
  revealQuery,
  useMyQueries,
} from './my-queries';
import { PacksSection } from './PacksSection';

import './LibraryView.css';

const NODE_MIME = 'application/x-raml-kql-query';

function depthOf(path: string): number {
  return path.split('/').length - 1;
}

/**
 * My Queries as a folder tree. Single click opens a preview tab, double click keeps it; drag
 * files onto folders to move them.
 */
function MyQueriesSection({ search }: { search: string }): React.JSX.Element {
  const { nodes, loaded } = useMyQueries();
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [menu, setMenu] = useState<
    { x: number; y: number; node: QueryNode | undefined } | undefined
  >();
  const [dropFolder, setDropFolder] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!loaded) void loadMyQueries();
  }, [loaded]);

  const visible = useMemo(() => {
    const filter = parsePackFilter(search);
    if (!isFilterEmpty(filter)) {
      // My Queries index names, descriptions and tags (not tables, MITRE or categories).
      if (filter.mitre.length + filter.tables.length + filter.categories.length > 0) return [];
      return nodes.filter((n) => {
        if (n.kind !== 'file') return false;
        const tags = (n.tags ?? []).map((t) => t.toLowerCase());
        const text = [n.name, n.path, n.description ?? '', ...tags].join(' ').toLowerCase();
        return (
          filter.tags.every((t) => tags.includes(t)) && filter.words.every((w) => text.includes(w))
        );
      });
    }
    return nodes.filter((n) => {
      // Hidden when any parent folder is collapsed.
      const parts = n.path.split('/');
      for (let i = 1; i < parts.length; i++) {
        if (collapsed.has(parts.slice(0, i).join('/'))) return false;
      }
      return true;
    });
  }, [nodes, collapsed, search]);

  const menuEntries = (node: QueryNode | undefined): MenuEntry[] => {
    const folder =
      node === undefined ? '' : node.kind === 'folder' ? node.path : folderOf(node.path);
    return [
      ...(node?.kind === 'file'
        ? ([
            { kind: 'item', label: 'Open', run: () => void openMyQuery(node.path, false) },
            { kind: 'separator' },
          ] satisfies MenuEntry[])
        : []),
      { kind: 'item', label: 'New Query…', run: () => void newQueryFile(folder) },
      { kind: 'item', label: 'New Folder…', run: () => void newFolder(folder) },
      ...(node === undefined
        ? []
        : ([
            { kind: 'separator' },
            ...(node.kind === 'file'
              ? [{ kind: 'item' as const, label: 'Rename…', run: () => void renameQuery(node) }]
              : []),
            ...(folderOf(node.path) === ''
              ? []
              : [
                  {
                    kind: 'item' as const,
                    label: 'Move to My Queries Root',
                    run: () => void moveQuery(node.path, ''),
                  },
                ]),
            { kind: 'item', label: 'Delete', run: () => void deleteQuery(node) },
          ] satisfies MenuEntry[])),
      { kind: 'separator' },
      {
        kind: 'item',
        label: 'Reveal in File Manager',
        run: () => {
          revealQuery(node?.path);
        },
      },
    ];
  };

  const dropProps = (folder: string) => ({
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(NODE_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      setDropFolder(folder);
    },
    onDragLeave: () => {
      setDropFolder(undefined);
    },
    onDrop: (event: React.DragEvent) => {
      const path = event.dataTransfer.getData(NODE_MIME);
      setDropFolder(undefined);
      if (path === '' || path === folder || folderOf(path) === folder) return;
      event.preventDefault();
      event.stopPropagation();
      void moveQuery(path, folder);
    },
  });

  return (
    <div
      className={`library-section-body${dropFolder === '' ? ' drop-target' : ''}`}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY, node: undefined });
      }}
      {...dropProps('')}
    >
      <div className="library-section">My Queries</div>
      {loaded && nodes.length === 0 ? (
        <p className="library-hint">
          Save a query with Ctrl/Cmd+S to keep it here as a .kql file in your config folder.
        </p>
      ) : null}
      <ul className="library-tree" role="tree" aria-label="My Queries">
        {visible.map((node) => {
          const isFolder = node.kind === 'folder';
          const open = isFolder && !collapsed.has(node.path);
          return (
            <li
              key={node.path}
              role="treeitem"
              aria-level={depthOf(node.path) + 1}
              aria-selected={selected === node.path}
              aria-expanded={isFolder ? open : undefined}
              tabIndex={selected === node.path ? 0 : -1}
              className={`library-row${selected === node.path ? ' selected' : ''}${dropFolder === node.path ? ' drop-target' : ''}`}
              style={{
                paddingLeft: `${String(12 + (search === '' ? depthOf(node.path) : 0) * 16)}px`,
              }}
              title={node.description ?? node.path}
              draggable
              onDragStart={(event) => {
                event.dataTransfer.setData(NODE_MIME, node.path);
              }}
              {...(isFolder ? dropProps(node.path) : {})}
              onClick={() => {
                setSelected(node.path);
                if (isFolder) {
                  const next = new Set(collapsed);
                  if (open) next.add(node.path);
                  else next.delete(node.path);
                  setCollapsed(next);
                } else {
                  void openMyQuery(node.path, true);
                }
              }}
              onDoubleClick={() => {
                if (!isFolder) void openMyQuery(node.path, false);
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !isFolder) void openMyQuery(node.path, false);
                if (event.key === 'F2' && !isFolder) void renameQuery(node);
                if (event.key === 'Delete' || (event.key === 'Backspace' && event.metaKey))
                  void deleteQuery(node);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSelected(node.path);
                setMenu({ x: event.clientX, y: event.clientY, node });
              }}
            >
              {isFolder ? (
                <Codicon name={open ? 'chevron-down' : 'chevron-right'} className="twistie" />
              ) : (
                <span className="twistie-spacer" />
              )}
              <Codicon name={isFolder ? (open ? 'folder-opened' : 'folder') : 'file-code'} />
              <span className="library-label">{node.name}</span>
              {search !== '' && folderOf(node.path) !== '' ? (
                <span className="library-description">{folderOf(node.path)}</span>
              ) : null}
            </li>
          );
        })}
      </ul>
      {menu === undefined ? null : (
        <ContextMenu
          label="My Queries"
          entries={menuEntries(menu.node)}
          x={menu.x}
          y={menu.y}
          onClose={() => {
            setMenu(undefined);
          }}
        />
      )}
    </div>
  );
}

/** The Library view (spec 08): My Queries and installed query packs, with one search box. */
export function LibraryView(): React.JSX.Element {
  const [search, setSearch] = useState('');
  return (
    <div className="library-view">
      <input
        type="search"
        className="input library-search"
        placeholder="Search (tag:, mitre:, table:, category:)"
        aria-label="Search the Library"
        title="Search names and descriptions. Filters: tag:identity mitre:T1110 table:SigninLogs category:hunting"
        value={search}
        onChange={(event) => {
          setSearch(event.target.value);
        }}
      />
      <div className="library-scroll">
        <MyQueriesSection search={search} />
        <PacksSection search={search} />
      </div>
    </div>
  );
}
