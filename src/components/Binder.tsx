import { useState } from "react";
import type { ProjectStore } from "../project/store";
import type { BinderNode } from "../project/model";
import { useStore } from "../lib/useStore";
import { ArchiveIcon, ChevronDown, ChevronRight, FileIcon, FolderIcon, FolderPlus, Plus, Trash, Warning } from "./icons";
import { MATTER_PRESETS, NOTES_TEMPLATE } from "../formats/templates";
import { NotesEditor } from "../editor/EditorPane";

type DropPos = "before" | "after" | "inside";

export function Binder({ store }: { store: ProjectStore }) {
  useStore(store);
  const [dragId, setDragId] = useState<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; pos: DropPos } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [presetsFor, setPresetsFor] = useState<"front" | "back" | null>(null);

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
    return (
      <div key={node.id} role="treeitem" aria-expanded={isFolder ? !node.collapsed : undefined} aria-selected={selected}>
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
          <span className="row-icon">{conflictOf ? <Warning /> : isFolder ? <FolderIcon /> : <FileIcon />}</span>
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
              {isFolder && (
                <button className="row-action" title="New document in this folder" onClick={(e) => { e.stopPropagation(); void store.addDoc(node.id); }}>
                  <Plus />
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
        {isFolder && !node.collapsed && <div role="group">{node.children?.map((c) => row(c, depth + 1))}</div>}
      </div>
    );
  };

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
            {presetsFor === role && (
              <div className="menu preset-menu" onMouseLeave={() => setPresetsFor(null)}>
                {MATTER_PRESETS.filter((pr) => pr.where === role && (!pr.forTemplates || pr.forTemplates.includes(store.template.id as never))).map((pr) => (
                  <button
                    key={pr.title}
                    className="menu-item"
                    data-testid={`preset-${pr.title}`}
                    onClick={() => {
                      setPresetsFor(null);
                      void store.addDoc(root.id, undefined, role, pr);
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
                    void store.addDoc(root.id, undefined, role, { title: "Untitled page", content: "" });
                  }}
                >
                  Blank page
                </button>
              </div>
            )}
            {!root.collapsed && (
              <div role="group">{root.children?.length ? root.children.map((c) => row(c, 0)) : <div className="binder-empty">{empty}</div>}</div>
            )}
          </section>
        );
      })}
    </nav>
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
