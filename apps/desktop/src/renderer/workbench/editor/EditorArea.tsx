import { Fragment, useEffect, useRef, useState } from 'react';

import {
  loadedQueryEditor,
  loadQueryEditor,
  type QueryEditorComponent,
} from '../../features/editor/editor-preload';
import { PackUpdateEditor } from '../../features/packs/PackUpdateEditor';
import { useRuns } from '../../features/query/run-store';
import { SettingsEditor } from '../../features/settings/SettingsEditor';
import { WelcomePage } from '../../features/welcome/WelcomePage';
import { WorkspacesEditor } from '../../features/workspaces/WorkspacesEditor';
import { executeCommand } from '../../platform/commands';
import {
  activateEditor,
  closeEditor,
  closeOtherEditors,
  focusGroup,
  moveEditor,
  resizeGroups,
  updateEditor,
  useEditors,
  type EditorGroup,
  type EditorInput,
} from '../../platform/editors';
import { useKeybindingLabel } from '../../platform/keybindings/keybinding-service';
import { Codicon } from '../common/Codicon';
import { ContextMenu, type MenuEntry } from '../common/ContextMenu';
import { KeybindingLabel } from '../common/KeybindingLabel';
import { Sash } from '../common/Sash';

import './EditorArea.css';

/**
 * The query editor is a separate chunk (Monaco and the Kusto language service are large),
 * usually preloaded at idle time. Loaded without Suspense on purpose: React throttles
 * revealing a suspended boundary by up to 300 ms, which made every first tab feel slow.
 */
function QueryEditorHost({ editorId }: { editorId: string }): React.JSX.Element {
  const [Editor, setEditor] = useState<QueryEditorComponent | undefined>(() => loadedQueryEditor());
  useEffect(() => {
    if (Editor !== undefined) return undefined;
    let current = true;
    void loadQueryEditor().then((component) => {
      if (current) setEditor(() => component);
    });
    return () => {
      current = false;
    };
  }, [Editor]);
  return Editor === undefined ? (
    <div className="query-editor-message">Loading editor…</div>
  ) : (
    <Editor editorId={editorId} />
  );
}

const TAB_MIME = 'application/x-raml-kql-editor';

function Tab({
  editor,
  active,
  groupId,
  index,
}: {
  editor: EditorInput;
  active: boolean;
  groupId: string;
  index: number;
}): React.JSX.Element {
  // A running query tab shows a spinner, like VS Code's `$(loading~spin)` (spec 05).
  const running = useRuns((s) => s.byTab[editor.id]?.state === 'running');
  const [menu, setMenu] = useState<{ x: number; y: number } | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState(false);
  const className = [
    'tab',
    active ? 'active' : '',
    editor.preview === true ? 'preview' : '',
    editor.dirty === true ? 'dirty' : '',
    editor.pinned === true ? 'pinned' : '',
    dropTarget ? 'drop-target' : '',
  ]
    .filter((c) => c !== '')
    .join(' ');
  const entries: MenuEntry[] = [
    {
      kind: 'item',
      label: 'Close',
      run: () => {
        closeEditor(editor.id);
      },
    },
    {
      kind: 'item',
      label: 'Close Others',
      run: () => {
        closeOtherEditors(editor.id);
      },
    },
    { kind: 'separator' },
    ...(editor.preview === true
      ? [
          {
            kind: 'item' as const,
            label: 'Keep Open',
            run: () => {
              updateEditor(editor.id, { preview: false });
            },
          },
        ]
      : []),
    editor.pinned === true
      ? {
          kind: 'item',
          label: 'Unpin',
          run: () => {
            updateEditor(editor.id, { pinned: false });
          },
        }
      : {
          kind: 'item',
          label: 'Pin',
          run: () => {
            updateEditor(editor.id, { pinned: true, preview: false });
          },
        },
    { kind: 'separator' },
    {
      kind: 'item',
      label: 'Split Right',
      run: () => {
        activateEditor(editor.id);
        void executeCommand('workbench.action.splitEditor');
      },
    },
  ];
  return (
    <div
      role="tab"
      aria-selected={active}
      tabIndex={active ? 0 : -1}
      className={className}
      title={
        editor.description === undefined ? editor.title : `${editor.title} — ${editor.description}`
      }
      draggable
      onDragStart={(event) => {
        event.dataTransfer.setData(TAB_MIME, editor.id);
        event.dataTransfer.effectAllowed = 'move';
      }}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes(TAB_MIME)) return;
        event.preventDefault();
        event.stopPropagation();
        setDropTarget(true);
      }}
      onDragLeave={() => {
        setDropTarget(false);
      }}
      onDrop={(event) => {
        const id = event.dataTransfer.getData(TAB_MIME);
        setDropTarget(false);
        if (id === '' || id === editor.id) return;
        event.preventDefault();
        event.stopPropagation();
        moveEditor(id, groupId, index);
      }}
      onClick={() => {
        activateEditor(editor.id);
      }}
      onDoubleClick={() => {
        // Double click keeps a preview tab open (VS Code).
        if (editor.preview === true) updateEditor(editor.id, { preview: false });
      }}
      onAuxClick={(event) => {
        // Middle click closes, like VS Code.
        if (event.button === 1) closeEditor(editor.id);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        setMenu({ x: event.clientX, y: event.clientY });
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') activateEditor(editor.id);
      }}
    >
      <Codicon
        name={running ? 'loading' : editor.icon}
        className={running ? 'tab-icon codicon-modifier-spin' : 'tab-icon'}
      />
      <span className="tab-label">{editor.title}</span>
      {editor.description === undefined ? null : (
        <span className="tab-description">{editor.description}</span>
      )}
      <button
        type="button"
        className="tab-close"
        title={editor.pinned === true ? 'Unpin' : 'Close'}
        aria-label={editor.pinned === true ? `Unpin ${editor.title}` : `Close ${editor.title}`}
        onClick={(event) => {
          event.stopPropagation();
          if (editor.pinned === true) updateEditor(editor.id, { pinned: false });
          else closeEditor(editor.id);
        }}
      >
        <Codicon name={editor.pinned === true ? 'pinned' : 'close'} className="tab-close-icon" />
        {editor.dirty === true && editor.pinned !== true ? (
          <Codicon name="circle-filled" className="tab-dirty-icon" />
        ) : null}
      </button>
      {menu === undefined ? null : (
        <ContextMenu
          label="Tab"
          entries={entries}
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

function WatermarkEntry({ label, command }: { label: string; command: string }): React.JSX.Element {
  const keybinding = useKeybindingLabel(command);
  return (
    <dl className="watermark-entry">
      <dt>{label}</dt>
      <dd>{keybinding === undefined ? null : <KeybindingLabel label={keybinding} />}</dd>
    </dl>
  );
}

/** Shown when no editor is open, like VS Code's empty editor watermark. */
function Watermark(): React.JSX.Element {
  return (
    <div className="editor-watermark">
      <div className="watermark-box">
        <WatermarkEntry label="Show All Commands" command="workbench.action.showCommands" />
        <WatermarkEntry label="New Query" command="query.new" />
        <WatermarkEntry label="Go to Query" command="workbench.action.quickOpen" />
        <WatermarkEntry label="Toggle Panel" command="workbench.action.togglePanel" />
        <WatermarkEntry label="Open Settings" command="workbench.action.openSettings" />
        <button
          type="button"
          className="watermark-link"
          onClick={() => void executeCommand('workbench.action.showWelcomePage')}
        >
          Open Welcome Page
        </button>
      </div>
    </div>
  );
}

function GroupView({
  group,
  active,
  index,
  total,
}: {
  group: EditorGroup;
  active: boolean;
  index: number;
  total: number;
}): React.JSX.Element {
  const editor = group.editors.find((e) => e.id === group.activeId);
  const [dropTarget, setDropTarget] = useState(false);
  const acceptDrop = {
    onDragOver: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes(TAB_MIME)) return;
      event.preventDefault();
      setDropTarget(true);
    },
    onDragLeave: () => {
      setDropTarget(false);
    },
    onDrop: (event: React.DragEvent) => {
      const id = event.dataTransfer.getData(TAB_MIME);
      setDropTarget(false);
      if (id === '') return;
      event.preventDefault();
      moveEditor(id, group.id);
    },
  };
  return (
    <div
      className={`editor-group${active ? ' active' : ''}${dropTarget ? ' drop-target' : ''}`}
      role="group"
      aria-label={total > 1 ? `Editor Group ${String(index + 1)}` : 'Editor Group'}
      style={{ flexGrow: group.size }}
      onMouseDownCapture={() => {
        if (!active) focusGroup(group.id);
      }}
      onFocusCapture={() => {
        if (!active) focusGroup(group.id);
      }}
    >
      {group.editors.length === 0 ? (
        <div className="editor-group-empty" {...acceptDrop}>
          <Watermark />
        </div>
      ) : (
        <>
          <div className="tabs-container" role="tablist" aria-label="Open editors" {...acceptDrop}>
            {group.editors.map((e, i) => (
              <Tab
                key={e.id}
                editor={e}
                active={e.id === group.activeId}
                groupId={group.id}
                index={i}
              />
            ))}
          </div>
          <div
            className="editor-content"
            role="tabpanel"
            aria-label={editor?.title}
            {...acceptDrop}
          >
            {editor?.kind === 'welcome' ? <WelcomePage /> : null}
            {editor?.kind === 'settings' ? <SettingsEditor /> : null}
            {editor?.kind === 'workspaces' ? <WorkspacesEditor /> : null}
            {editor?.kind === 'packUpdate' ? (
              <PackUpdateEditor
                key={editor.id}
                editorId={editor.id}
                sourceId={editor.id.slice('pack-update:'.length)}
              />
            ) : null}
            {editor?.kind === 'query' ? (
              <QueryEditorHost key={editor.id} editorId={editor.id} />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

export function EditorArea(): React.JSX.Element {
  const { groups, activeGroupId } = useEditors();
  const container = useRef<HTMLElement>(null);
  const startSizes = useRef<number[]>([]);

  return (
    <section className="part editor" aria-label="Editor" ref={container}>
      {groups.map((group, index) => (
        <Fragment key={group.id}>
          {index === 0 ? null : (
            <Sash
              orientation="vertical"
              label="Resize editor groups"
              onDragStart={() => {
                startSizes.current = groups.map((g) => g.size);
              }}
              onDrag={(delta) => {
                const width = container.current?.getBoundingClientRect().width ?? 1;
                const total = startSizes.current.reduce((a, b) => a + b, 0);
                const shift = (delta / width) * total;
                const sizes = [...startSizes.current];
                const left = (sizes[index - 1] ?? 1) + shift;
                const right = (sizes[index] ?? 1) - shift;
                if (left < total * 0.1 || right < total * 0.1) return;
                sizes[index - 1] = left;
                sizes[index] = right;
                resizeGroups(sizes);
              }}
              onReset={() => {
                resizeGroups(groups.map(() => 1));
              }}
            />
          )}
          <GroupView
            group={group}
            active={group.id === activeGroupId}
            index={index}
            total={groups.length}
          />
        </Fragment>
      ))}
    </section>
  );
}
