import { useEffect, useRef, useState, type RefObject } from "react";
import type { ProjectStore } from "../project/store";
import { inMatterFolder, roleOf, type BinderNode, type Role } from "../project/model";
import { useStore } from "../lib/useStore";
import { pickFile } from "../lib/backend";
import { planImport } from "../project/importers";
import { Popover } from "./Popover";
import {
  ArchiveIcon,
  BINDER_ICONS,
  BulbIcon,
  ChapterIcon,
  ChevronDown,
  Close,
  ChevronRight,
  FileIcon,
  FolderIcon,
  FolderPlus,
  ImportIcon,
  MasksIcon,
  PageIcon,
  PersonIcon,
  Plus,
  QuillIcon,
  SceneIcon,
  Trash,
  Warning,
} from "./icons";
import { COPYRIGHT_CLAUSES, copyrightPage, MATTER_PRESETS, NOTES_TEMPLATE } from "../formats/templates";
import { NotesEditor } from "../editor/EditorPane";

type DropPos = "before" | "after" | "inside";

/** Each kind of binder item has its own icon: scenes, chapters, poems, pages, characters, research notes, plays. */
function NodeIcon({ store, node }: { store: ProjectStore; node: BinderNode }) {
  const chosen = node.icon ? BINDER_ICONS[node.icon] : undefined;
  if (chosen) return <chosen.Icon />;
  return <DefaultIcon store={store} node={node} />;
}

function DefaultIcon({ store, node }: { store: ProjectStore; node: BinderNode }) {
  if (node.kind === "folder") return node.play ? <MasksIcon /> : <FolderIcon />;
  const role = roleOf(store.data, node.id);
  if (role === "characters") return <PersonIcon />;
  if (role === "research") return <BulbIcon />;
  if (role === "front" || role === "back" || inMatterFolder(store.data, node.id)) return <PageIcon />;
  const t = store.template;
  if (t.mode === "script") return <SceneIcon />;
  if (t.id === "book") return <ChapterIcon />;
  if (t.mode === "poem") return <QuillIcon />;
  return <PageIcon />;
}

/** Ask for a script file and put its scenes into a folder (one play of a collection). */
async function importIntoFolder(store: ProjectStore, node: BinderNode) {
  const path = await pickFile(`Import a script into “${node.title}”`, ["fdx", "fountain", "spmd", "docx", "pdf", "rtf", "txt", "md"], store.root.replace(/\/[^/]*$/, ""));
  if (!path) return;
  try {
    const plan = await planImport(path);
    const scenes = plan.manuscript.filter((n) => n.kind === "folder" || (n.blocks ?? []).length);
    if (!scenes.length) {
      store.toast("No script was found in that file.", "warn");
      return;
    }
    const n = await store.importInto(node.id, scenes, plan.title);
    store.toast(`Imported ${n} scene${n === 1 ? "" : "s"} from “${path.split("/").pop()}” into “${store.node(node.id)?.title ?? node.title}”.`);
  } catch (e) {
    store.toast(`Could not import: ${(e as Error).message}`, "error");
  }
}

export function Binder({ store }: { store: ProjectStore }) {
  useStore(store);
  /** The items being dragged: the whole selection when the dragged row is part of it. */
  const [dragIds, setDragIds] = useState<string[] | null>(null);
  /** Rows picked with ⌘/Ctrl-click or Shift-click. The open document is always one of them. */
  const [picked, setPicked] = useState<Set<string>>(() => new Set(store.selectedId ? [store.selectedId] : []));
  /** Where a Shift-click range starts. */
  const [rangeFrom, setRangeFrom] = useState<string | null>(store.selectedId);
  /** The icon picker: the rows it changes and the icon it hangs from. */
  const [iconFor, setIconFor] = useState<{ ids: string[]; anchor: RefObject<HTMLElement | null>; current?: string } | null>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  // The icon picker closes on a click elsewhere or Escape.
  useEffect(() => {
    if (!iconFor) return;
    const down = (e: MouseEvent) => {
      const t = e.target as Node;
      if (pickerRef.current?.contains(t) || iconFor.anchor.current?.contains(t)) return;
      setIconFor(null);
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && setIconFor(null);
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [iconFor]);
  // Opening a document some other way (a new scene, search…) starts a fresh selection.
  useEffect(() => {
    const id = store.selectedId;
    setPicked((p) => (id && p.has(id) ? p : new Set(id ? [id] : [])));
  }, [store.selectedId]);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** The section ("front"/"back") or play front matter folder (its id) whose page menu is open. */
  const [presetsFor, setPresetsFor] = useState<string | null>(null);
  const [copyrightFor, setCopyrightFor] = useState<{ parentId: string; role: Role } | null>(null);
  const script = store.template.mode === "script";

  /** Rows as they are shown (collapsed folders hide their children), for Shift-click ranges. */
  const visibleOrder = () => {
    const out: string[] = [];
    const rec = (nodes: BinderNode[]) => {
      for (const n of nodes) {
        out.push(n.id);
        if (n.kind === "folder" && !n.collapsed) rec(n.children ?? []);
      }
    };
    for (const r of store.data.binder) if (!r.collapsed) rec(r.children ?? []);
    return out;
  };
  /** The rows an action on `id` applies to: the whole selection if `id` is in it, else just `id`. */
  const targetsOf = (id: string) => (picked.has(id) && picked.size > 1 ? visibleOrder().filter((x) => picked.has(x)) : [id]);
  const onRowClick = (e: React.MouseEvent, node: BinderNode) => {
    if (e.metaKey || e.ctrlKey) {
      const next = new Set(picked);
      if (next.has(node.id) && next.size > 1) {
        next.delete(node.id);
        // The open document stays picked; if it was the one removed, open another picked row.
        if (store.selectedId === node.id) void store.select([...next][next.size - 1]);
      } else next.add(node.id);
      setPicked(next);
      setRangeFrom(node.id);
      return;
    }
    if (e.shiftKey && rangeFrom) {
      const order = visibleOrder();
      const a = order.indexOf(rangeFrom);
      const b = order.indexOf(node.id);
      if (a >= 0 && b >= 0) {
        setPicked(new Set(order.slice(Math.min(a, b), Math.max(a, b) + 1)));
        return;
      }
    }
    setPicked(new Set([node.id]));
    setRangeFrom(node.id);
    void store.select(node.id);
  };

  /** The menu of ready-made front/back matter pages, for a section or a play's front matter folder. */
  const presetMenu = (key: string, where: "front" | "back", parentId: string, role: Role) =>
    presetsFor === key && (
      <div className="menu preset-menu" onMouseLeave={() => setPresetsFor(null)}>
        {MATTER_PRESETS.filter((pr) => pr.where === where && (!pr.forTemplates || pr.forTemplates.includes(store.template.id as never))).map((pr) => (
          <button
            key={pr.title}
            className="menu-item"
            data-testid={`preset-${pr.title}`}
            onClick={() => {
              setPresetsFor(null);
              if (pr.title === "Copyright") setCopyrightFor({ parentId, role });
              else void store.addDoc(parentId, undefined, role, pr);
            }}
          >
            {pr.title}
          </button>
        ))}
        <div className="menu-sep" />
        <button
          className="menu-item"
          onClick={() => {
            setPresetsFor(null);
            void store.addDoc(parentId, undefined, role, { title: "Untitled page", content: "" });
          }}
        >
          Blank page
        </button>
      </div>
    );

  const onDragOver = (e: React.DragEvent, node: BinderNode) => {
    if (!dragIds) return;
    // Rows sit inside their section; the innermost target decides.
    e.stopPropagation();
    // Never onto a dragged row or into one of the dragged folders.
    if (dragIds.includes(node.id) || dragIds.some((d) => store.node(d)?.kind === "folder" && isInside(d, node.id))) {
      if (drop) setDrop(null);
      return;
    }
    e.preventDefault();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const y = (e.clientY - rect.top) / rect.height;
    let pos: DropPos;
    if (node.role) pos = "inside";
    else if (node.kind === "folder") pos = y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
    else pos = y < 0.5 ? "before" : "after";
    if (drop?.id !== node.id || drop.pos !== pos) setDrop({ id: node.id, pos });
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragIds && drop) void store.moveMany(dragIds, drop.id, drop.pos);
    setDragIds(null);
    setDrop(null);
  };

  /** Is `id` somewhere inside the folder `folderId`? */
  const isInside = (folderId: string, id: string) => {
    let hit = false;
    const rec = (nodes: BinderNode[]) => {
      for (const n of nodes) {
        if (n.id === id) hit = true;
        if (!hit && n.children) rec(n.children);
      }
    };
    rec(store.node(folderId)?.children ?? []);
    return hit;
  };

  const row = (node: BinderNode, depth: number): React.ReactNode => {
    const selected = store.selectedId === node.id || picked.has(node.id);
    const missing = store.missing.has(node.id);
    const conflictOf = store.conflictCopies.get(node.id);
    const isFolder = node.kind === "folder";
    const dropCls = drop?.id === node.id ? ` drop-${drop.pos}` : "";
    const role = roleOf(store.data, node.id);
    const matterFolder = isFolder && !!node.matter;
    const canImport = isFolder && script && role === "manuscript" && !inMatterFolder(store.data, node.id);
    return (
      <div key={node.id} className="binder-item" role="treeitem" aria-expanded={isFolder ? !node.collapsed : undefined} aria-selected={selected}>
        <div
          className={`binder-row${selected ? " selected" : ""}${missing ? " missing" : ""}${dropCls}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={editing !== node.id}
          onDragStart={(e) => {
            const ids = targetsOf(node.id);
            if (ids.length === 1 && !picked.has(node.id)) {
              setPicked(new Set([node.id]));
              void store.select(node.id);
            }
            setDragIds(ids);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", ids.length > 1 ? `${ids.length} items` : node.title);
          }}
          onDragEnd={() => {
            setDragIds(null);
            setDrop(null);
          }}
          onDragOver={(e) => onDragOver(e, node)}
          onDrop={onDrop}
          onClick={(e) => onRowClick(e, node)}
          onDoubleClick={() => setEditing(node.id)}
          title={missing ? "This file is missing on disk." : conflictOf ? `A sync service made this conflict copy of “${conflictOf}”. Compare the two, keep what you need and delete the other.` : undefined}
          data-testid={`binder-${node.title}`}
        >
          {isFolder ? (
            <button
              className="twisty"
              onClick={(e) => {
                e.stopPropagation();
                store.toggleCollapsed(node.id);
              }}
              aria-label={node.collapsed ? "Expand" : "Collapse"}
            >
              {node.collapsed ? <ChevronRight width={13} height={13} /> : <ChevronDown width={13} height={13} />}
            </button>
          ) : (
            <span className="twisty" />
          )}
          {conflictOf ? (
            <span className="row-icon">
              <Warning />
            </span>
          ) : (
            <button
              className="row-icon pickable"
              title="Change icon"
              aria-label={`Change the icon of “${node.title}”`}
              data-testid={`icon-${node.title}`}
              onClick={(e) => {
                e.stopPropagation();
                const el = e.currentTarget;
                const ids = targetsOf(node.id);
                setIconFor((cur) => (cur && cur.anchor.current === el ? null : { ids, anchor: { current: el }, current: node.icon }));
              }}
              onDoubleClick={(e) => e.stopPropagation()}
            >
              <NodeIcon store={store} node={node} />
            </button>
          )}
          {editing === node.id ? (
            <input
              className="rename"
              autoFocus
              defaultValue={node.title}
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setEditing(null);
              }}
              onBlur={(e) => {
                void store.rename(node.id, e.target.value);
                setEditing(null);
              }}
            />
          ) : (
            <span className="row-title">{node.title}</span>
          )}
          {missing ? (
            <button className="row-action visible" onClick={(e) => { e.stopPropagation(); void store.forget(node.id); }} title="Remove from binder">
              Remove
            </button>
          ) : (
            <span className="row-actions">
              {canImport && (
                <button
                  className="row-action"
                  title={node.play ? "Import a script into this play (Final Draft, Fountain…)" : "Import a script into this folder (Final Draft, Fountain…)"}
                  aria-label="Import a script into this folder"
                  data-testid={`import-into-${node.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void importIntoFolder(store, node);
                  }}
                >
                  <ImportIcon />
                </button>
              )}
              {isFolder && (
                <button
                  className="row-action"
                  title={matterFolder ? "Add a page" : node.play ? "New act in this play" : "New document in this folder"}
                  data-testid={`add-in-${node.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (matterFolder) setPresetsFor(presetsFor === node.id ? null : node.id);
                    else if (node.play) void store.addFolder(node.id);
                    else void store.addDoc(node.id);
                  }}
                >
                  {node.play ? <FolderPlus /> : <Plus />}
                </button>
              )}
              {store.data.binder.some((r) => r.role === "archive") && roleOf(store.data, node.id) !== "archive" && (
                <button
                  className="row-action"
                  title="Move to archive"
                  aria-label="Move to archive"
                  data-testid={`archive-${node.title}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    const ids = targetsOf(node.id);
                    void (async () => {
                      for (const id of ids) await store.archive(id);
                      store.toast(ids.length > 1 ? `Moved ${ids.length} items to the Archive.` : `Moved “${node.title}” to the Archive.`);
                    })();
                  }}
                >
                  <ArchiveIcon />
                </button>
              )}
              <button
                className="row-action"
                title="Move to trash"
                onClick={(e) => {
                  e.stopPropagation();
                  const ids = targetsOf(node.id);
                  const what = ids.length > 1 ? `these ${ids.length} items` : `“${node.title}”`;
                  if (!window.confirm(`Move ${what} to the project's .trash folder?`)) return;
                  // Items inside a folder that is also going are trashed with it.
                  const top = ids.filter((id) => !ids.some((o) => o !== id && isInside(o, id)));
                  void (async () => {
                    for (const id of top) await store.remove(id);
                  })();
                }}
              >
                <Trash />
              </button>
            </span>
          )}
        </div>
        {matterFolder && presetMenu(node.id, "front", node.id, role ?? "manuscript")}
        {isFolder && !node.collapsed && <div role="group">{node.children?.map((c) => row(c, depth + 1))}</div>}
      </div>
    );
  };

  if (store.single) {
    const doc = store.data.binder.find((r) => r.role === "manuscript")?.children?.[0];
    return (
      <nav className="binder" aria-label="Document">
        <div className="binder-head">
          <span className="section-toggle">Document</span>
        </div>
        {doc && (
          <div className="binder-row selected" style={{ paddingLeft: 8 }}>
            <span className="twisty" />
            <span className="row-icon">
              <FileIcon />
            </span>
            <span className="row-title">{doc.file}</span>
          </div>
        )}
        <p className="binder-empty single-hint">
          A single file, saved as you type. To get scenes, notes and a binder, use File › New project, or import it.
        </p>
      </nav>
    );
  }

  return (
    <nav className="binder" role="tree" aria-label="Binder">
      {store.data.binder.map((root) => {
        const role = root.role!;
        const docNoun = role === "manuscript" || role === "archive" ? store.template.docNoun : role === "characters" ? "character" : role === "research" ? "note" : "page";
        const folderNoun = role === "manuscript" ? store.template.folderNoun : "folder";
        const matter = role === "front" || role === "back";
        const add = () => {
          if (matter) return setPresetsFor(presetsFor === role ? null : role);
          const at = store.insertionPoint(role);
          void store.addDoc(at.parentId, at.afterId, role);
        };
        const empty =
          role === "front" ? "Title page extras: dedication, cast list…" : role === "back" ? "Acknowledgements, notes…" : role === "archive" ? "Drag old drafts here" : "Nothing here yet";
        return (
          <section key={root.id} className={`binder-section role-${role}`} onDragOver={(e) => onDragOver(e, root)} onDrop={onDrop}>
            <div className={`binder-head${drop?.id === root.id ? " drop-inside" : ""}`}>
              <button className="section-toggle" onClick={() => store.toggleCollapsed(root.id)} data-testid={`section-${role}`}>
                {role === "archive" && <ArchiveIcon width={12} height={12} />} {root.title}
              </button>
              <span className="head-actions">
                {role === "manuscript" && script && (
                  <button className="row-action" title="New play: a whole play with its own title page and front matter, for a collection or trilogy" onClick={() => void store.addPlay()} data-testid="add-play">
                    <MasksIcon />
                  </button>
                )}
                {!matter && (
                  <button className="row-action" title={`New ${folderNoun.toLowerCase()}`} onClick={() => void store.addFolder(root.id, role)} data-testid={`add-folder-${role}`}>
                    <FolderPlus />
                  </button>
                )}
                <button className="row-action" title={matter ? "Add a page" : `New ${docNoun.toLowerCase()}`} onClick={add} data-testid={`add-doc-${role}`}>
                  <Plus />
                </button>
              </span>
            </div>
            {matter && presetMenu(role, role as "front" | "back", root.id, role)}
            {!root.collapsed && (
              <div role="group">{root.children?.length ? root.children.map((c) => row(c, 0)) : <div className="binder-empty">{empty}</div>}</div>
            )}
            {!root.collapsed && !!root.children?.length && (
              // Drop here to put items at the end of the section, out of any folder.
              <div
                className={`binder-end${drop?.id === root.id ? " drop-here" : ""}`}
                onDragOver={(e) => {
                  if (!dragIds) return;
                  e.preventDefault();
                  e.stopPropagation();
                  if (drop?.id !== root.id || drop.pos !== "inside") setDrop({ id: root.id, pos: "inside" });
                }}
                onDrop={onDrop}
                data-testid={`end-${role}`}
              />
            )}
          </section>
        );
      })}
      {iconFor && (
        <Popover anchor={iconFor.anchor} panelRef={pickerRef} className="icon-picker" data-testid="icon-picker">
          <div className="icon-picker-head">{iconFor.ids.length > 1 ? `Icon for ${iconFor.ids.length} items` : "Icon"}</div>
          <div className="icon-grid">
            {Object.entries(BINDER_ICONS).map(([key, { label, Icon }]) => (
              <button
                key={key}
                className={`icon-choice${iconFor.current === key ? " on" : ""}`}
                title={label}
                aria-label={label}
                data-testid={`icon-choice-${key}`}
                onClick={() => {
                  store.setIcon(iconFor.ids, key);
                  setIconFor(null);
                }}
              >
                <Icon />
              </button>
            ))}
          </div>
          <div className="menu-sep" />
          <button
            className="menu-item"
            data-testid="icon-choice-default"
            onClick={() => {
              store.setIcon(iconFor.ids, undefined);
              setIconFor(null);
            }}
          >
            Default icon
          </button>
        </Popover>
      )}
      {copyrightFor && (
        <CopyrightDialog
          author={store.data.author}
          onCancel={() => setCopyrightFor(null)}
          onCreate={(content) => {
            const { parentId, role } = copyrightFor;
            setCopyrightFor(null);
            void store.addDoc(parentId, undefined, role, { title: "Copyright", content });
          }}
        />
      )}
    </nav>
  );
}

/** Choose the clauses for a copyright page. */
function CopyrightDialog({ author, onCreate, onCancel }: { author: string; onCreate: (content: string) => void; onCancel: () => void }) {
  const [on, setOn] = useState(() => new Set(COPYRIGHT_CLAUSES.filter((c) => c.defaultOn).map((c) => c.id)));
  const year = new Date().getFullYear();
  const name = author.trim() || "the author";
  const toggle = (id: string) =>
    setOn((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal small copyright-dialog" role="dialog" aria-label="Copyright page">
        <div className="modal-head">
          <h2>Copyright page</h2>
          <button className="icon-btn" onClick={onCancel} aria-label="Close">
            <Close />
          </button>
        </div>
        <p className="muted small-text">
          Starts with “Copyright © {year} by {name}”. Tick the clauses that apply. These are common wording, not legal advice:{" "}
          <strong>you decide what to keep, change or add</strong>, and you can edit the page afterwards.
        </p>
        <div className="clause-list">
          {COPYRIGHT_CLAUSES.map((c) => (
            <label key={c.id} className="check clause">
              <input type="checkbox" checked={on.has(c.id)} onChange={() => toggle(c.id)} data-testid={`clause-${c.id}`} />
              <span>
                <span className="clause-title">{c.title}</span>
                <span className="clause-text">{c.text.replace(/\{author\}/g, name)}</span>
              </span>
            </label>
          ))}
        </div>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => onCreate(copyrightPage(author, year, [...on]))} data-testid="copyright-create">
            Add page
          </button>
        </div>
      </div>
    </div>
  );
}

export function NotesPanel({ store, spellcheck }: { store: ProjectStore; spellcheck: boolean }) {
  useStore(store);
  const id = store.selectedId;
  const node = id ? store.node(id) : null;
  if (!node) return <div className="notes empty">Select an item to see its notes.</div>;
  const notes = store.notes.get(node.id);
  return (
    <div className="notes">
      <div className="notes-head">
        <span>Notes</span>
        <span className="notes-for">{node.title}</span>
      </div>
      <NotesEditor
        key={node.id}
        store={store}
        nodeId={node.id}
        markdown={notes?.text ?? ""}
        template={NOTES_TEMPLATE}
        spellcheck={spellcheck}
        onChange={(md) => store.updateNotes(node.id, md)}
      />
    </div>
  );
}
