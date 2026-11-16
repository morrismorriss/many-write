import { useState } from "react";
import type { ProjectStore } from "../project/store";
import { inMatterFolder, roleOf, type BinderNode, type Role } from "../project/model";
import { useStore } from "../lib/useStore";
import { pickFile } from "../lib/backend";
import { planImport } from "../project/importers";
import {
  ArchiveIcon,
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
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  /** The section ("front"/"back") or play front matter folder (its id) whose page menu is open. */
  const [presetsFor, setPresetsFor] = useState<string | null>(null);
  const [copyrightFor, setCopyrightFor] = useState<{ parentId: string; role: Role } | null>(null);
  const script = store.template.mode === "script";

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
    if (!dragId) return;
    // Rows sit inside their section; the innermost target decides.
    e.stopPropagation();
    if (dragId === node.id) return;
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
    if (dragId && drop) void store.move(dragId, drop.id, drop.pos);
    setDragId(null);
    setDrop(null);
  };

  const row = (node: BinderNode, depth: number): React.ReactNode => {
    const selected = store.selectedId === node.id;
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
            setDragId(node.id);
            e.dataTransfer.effectAllowed = "move";
            e.dataTransfer.setData("text/plain", node.title);
          }}
          onDragEnd={() => {
            setDragId(null);
            setDrop(null);
          }}
          onDragOver={(e) => onDragOver(e, node)}
          onDrop={onDrop}
          onClick={() => void store.select(node.id)}
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
          <span className="row-icon">{conflictOf ? <Warning /> : <NodeIcon store={store} node={node} />}</span>
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
                    void store.archive(node.id).then(() => store.toast(`Moved “${node.title}” to the Archive.`));
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
                  if (window.confirm(`Move “${node.title}” to the project's .trash folder?`)) void store.remove(node.id);
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
          </section>
        );
      })}
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
