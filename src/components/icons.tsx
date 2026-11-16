// Small stroke icons (24px grid), drawn for Many Write.
import type { SVGProps } from "react";

const base = (d: React.ReactNode) => (p: SVGProps<SVGSVGElement>) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...p}>
    {d}
  </svg>
);

export const ChevronLeft = base(<path d="M15 18l-6-6 6-6" />);
export const ChevronRight = base(<path d="M9 18l6-6-6-6" />);
export const ChevronDown = base(<path d="M6 9l6 6 6-6" />);
export const Plus = base(<path d="M12 5v14M5 12h14" />);
export const FolderIcon = base(<path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" />);
export const FolderPlus = base(<><path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M12 11v5M9.5 13.5h5" /></>);
export const FileIcon = base(<><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5" /></>);
export const Trash = base(<><path d="M4 7h16M10 11v6M14 11v6" /><path d="M6 7l1 12a2 2 0 002 2h6a2 2 0 002-2l1-12M9 7V4h6v3" /></>);
export const More = base(<><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>);
export const Palette = base(<><path d="M12 3a9 9 0 100 18c1.1 0 2-.9 2-2 0-.5-.2-1-.5-1.3-.3-.4-.5-.8-.5-1.3 0-1.1.9-2 2-2h2.4A4.6 4.6 0 0022 9.8C22 6 17.5 3 12 3z" /><circle cx="7.5" cy="11" r="1" /><circle cx="10.5" cy="7" r="1" /><circle cx="15.5" cy="7.5" r="1" /></>);
export const Download = base(<><path d="M12 4v11M7 10l5 5 5-5" /><path d="M5 20h14" /></>);
export const Settings = base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z" /></>);
export const Close = base(<path d="M6 6l12 12M18 6L6 18" />);
export const Check = base(<path d="M5 12.5l4.5 4.5L19 7.5" />);
export const Warning = base(<><path d="M10.3 3.9L1.8 18a2 2 0 001.7 3h17a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z" /><path d="M12 9v4M12 17h.01" /></>);
export const Crosshair = base(<><circle cx="12" cy="12" r="7" /><path d="M12 2v4M12 18v4M2 12h4M18 12h4" /></>);
export const Book = base(<><path d="M4 19.5A2.5 2.5 0 016.5 17H20V3H6.5A2.5 2.5 0 004 5.5z" /><path d="M4 19.5A2.5 2.5 0 006.5 22H20v-5" /></>);
export const NoteIcon = base(<><path d="M5 4h14v12l-4 4H5z" /><path d="M15 20v-4h4M9 9h6M9 13h4" /></>);
export const Timer = base(<><circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" /></>);
export const TargetIcon = base(<><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><circle cx="12" cy="12" r="0.8" fill="currentColor" /></>);
export const BarChart = base(<path d="M5 20V11M12 20V5M19 20v-7M3 20h18" />);
export const Search = base(<><circle cx="11" cy="11" r="6.5" /><path d="M20 20l-4.2-4.2" /></>);
export const Lock = base(<><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>);
export const ArrowUp = base(<path d="M12 19V5M6 11l6-6 6 6" />);
export const ArrowDown = base(<path d="M12 5v14M6 13l6 6 6-6" />);
// Binder icons: each kind of item has its own shape.
/** A script page: a scene in a play or screenplay. */
export const SceneIcon = base(<><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M8.5 12h7M10 16h4" /></>);
/** An open book page with text: a chapter. */
export const ChapterIcon = base(<><path d="M3 5.5C5.5 4.5 8.5 4.5 12 6.5c3.5-2 6.5-2 9-1V19c-2.5-1-5.5-1-9 1-3.5-2-6.5-2-9-1z" /><path d="M12 6.5V20M6 9h3M6 12.5h3M15 9h3M15 12.5h3" /></>);
/** A sheet with ruled lines: sections, pages and front/back matter. */
export const PageIcon = base(<><path d="M14 3H7a2 2 0 00-2 2v14a2 2 0 002 2h10a2 2 0 002-2V8z" /><path d="M14 3v5h5M9 13h6M9 17h4" /></>);
/** A quill: a poem. */
export const QuillIcon = base(<><path d="M20 4c-6 0-11 4.5-12.5 11.5L6.5 20" /><path d="M20 4c0 6-3.5 10.5-11 11.5M12.5 10.5L9 14" /></>);
/** A person: a character page. */
export const PersonIcon = base(<><circle cx="12" cy="8" r="3.6" /><path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" /></>);
/** A light bulb: a research note. */
export const BulbIcon = base(<><path d="M9 18h6M10 21h4" /><path d="M12 3a6 6 0 00-3.6 10.8c.6.5 1.1 1.3 1.1 2.2h5c0-.9.5-1.7 1.1-2.2A6 6 0 0012 3z" /></>);
/** A theatre mask: a whole play inside a collection. */
export const MasksIcon = base(<><path d="M5 4.5c4.5-1.3 9.5-1.3 14 0V11a7 7 0 01-14 0z" /><path d="M8.5 9.5h2M13.5 9.5h2M9 13.5c1.8 1.6 4.2 1.6 6 0" /></>);
/** A stack of pages: an act, part or sequence. */
export const StackIcon = base(<><path d="M12 3l9 4.5-9 4.5-9-4.5z" /><path d="M3 12l9 4.5 9-4.5M3 16.5L12 21l9-4.5" /></>);
/** A heart: donations. */
export const HeartIcon = base(<path d="M12 20s-7.5-4.6-9-9.4C2 7.3 4.2 4.5 7.3 4.5c2 0 3.6 1.1 4.7 2.8 1.1-1.7 2.7-2.8 4.7-2.8 3.1 0 5.3 2.8 4.3 6.1C19.5 15.4 12 20 12 20z" />);
/** Two overlapping windows: open in a new window. */
export const WindowsIcon = base(<><rect x="8" y="8" width="13" height="12" rx="2" /><path d="M16 8V6a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2h3" /></>);
export const ImportIcon = base(<><path d="M12 3v11M7 9l5 5 5-5" /><path d="M5 15v4a2 2 0 002 2h10a2 2 0 002-2v-4" /></>);
export const ArchiveIcon = base(<><rect x="3" y="4" width="18" height="4" rx="1" /><path d="M5 8v11a1 1 0 001 1h12a1 1 0 001-1V8M10 12h4" /></>);

/** The pomodoro timer's tomato: an outline like the other icons, with a stem, two leaves and a divot at the bottom. */
export const Tomato = base(
  <>
    <path d="M12 8.2C7.2 6.8 3.3 9.6 3.3 14c0 4 3.3 6.8 7 6.7.8 0 1.1-.9 1.7-.9s.9.9 1.7.9c3.7.1 7-2.7 7-6.7 0-4.4-3.9-7.2-8.7-5.8z" />
    <path d="M12 8.2V3.4" />
    <path d="M12 5.9c-1.1-1.5-3-1.9-4.6-1.1M12 5.9c1.1-1.5 3-1.9 4.6-1.1" />
  </>,
);

// Extra shapes offered in the binder's icon picker.
export const StarIcon = base(<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" />);
export const FlagIcon = base(<><path d="M5 21V4" /><path d="M5 4h11l-2 4 2 4H5" /></>);
export const MusicIcon = base(<><path d="M9 18V5l11-2v13" /><circle cx="6.5" cy="18" r="2.5" /><circle cx="17.5" cy="16" r="2.5" /></>);
export const PinIcon = base(<><path d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0113 0c0 5-6.5 11-6.5 11z" /><circle cx="12" cy="10" r="2.3" /></>);
export const MoonIcon = base(<path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z" />);
export const SunIcon = base(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const FlameIcon = base(<path d="M12 21c-3.9 0-6.5-2.6-6.5-6.2 0-3.6 3-5.6 3.6-9.3 2.4 1.4 3.4 3.5 3.4 5.6 1-.6 1.7-1.8 1.9-3.1 2.3 1.8 3.6 4.2 3.6 6.8 0 3.6-2.6 6.2-6 6.2z" />);
export const LeafIcon = base(<><path d="M5 19c0-8 5-14 15-14 0 10-6 15-14 15" /><path d="M5 19l8-8" /></>);
export const BoltIcon = base(<path d="M13 2L4.5 13.5H11L10 22l8.5-11.5H12z" />);
export const MapIcon = base(<><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></>);
export const CameraIcon = base(<><path d="M4 8h3l2-3h6l2 3h3a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1V9a1 1 0 011-1z" /><circle cx="12" cy="13" r="3.5" /></>);
export const ChatIcon = base(<path d="M4 5h16v11H9l-5 4z" />);
export const KeyIcon = base(<><circle cx="8" cy="15" r="4" /><path d="M11 12l9-9M16 7l3 3M14 9l2 2" /></>);
export const CrownIcon = base(<path d="M3 8l4.5 4L12 5l4.5 7L21 8l-2 11H5z" />);
export const HomeIcon = base(<><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10M10 20v-5h4v5" /></>);
export const GlobeIcon = base(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>);
export const SwordIcon = base(<><path d="M20 4l-9.5 9.5M20 4h-4M20 4v4" /><path d="M7 14l3 3M5 19l3.5-3.5M8.5 12.5l3 3" /></>);
export const EyeIcon = base(<><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const ClockIcon = base(<><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);
export const QuestionIcon = base(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 114 2c-.9.6-1.5 1.2-1.5 2.3M12 17h.01" /></>);

type IconComponent = ReturnType<typeof base>;

/** Icons a binder item can wear. The keys are stored in project.json, so never rename one. */
export const BINDER_ICONS: Record<string, { label: string; Icon: IconComponent }> = {
  folder: { label: "Folder", Icon: FolderIcon },
  stack: { label: "Stack", Icon: StackIcon },
  scene: { label: "Scene", Icon: SceneIcon },
  page: { label: "Page", Icon: PageIcon },
  chapter: { label: "Chapter", Icon: ChapterIcon },
  book: { label: "Book", Icon: Book },
  quill: { label: "Quill", Icon: QuillIcon },
  note: { label: "Note", Icon: NoteIcon },
  masks: { label: "Masks", Icon: MasksIcon },
  person: { label: "Person", Icon: PersonIcon },
  bulb: { label: "Idea", Icon: BulbIcon },
  heart: { label: "Heart", Icon: HeartIcon },
  star: { label: "Star", Icon: StarIcon },
  flag: { label: "Flag", Icon: FlagIcon },
  music: { label: "Music", Icon: MusicIcon },
  pin: { label: "Place", Icon: PinIcon },
  map: { label: "Map", Icon: MapIcon },
  home: { label: "Home", Icon: HomeIcon },
  globe: { label: "World", Icon: GlobeIcon },
  sun: { label: "Day", Icon: SunIcon },
  moon: { label: "Night", Icon: MoonIcon },
  clock: { label: "Time", Icon: ClockIcon },
  flame: { label: "Flame", Icon: FlameIcon },
  bolt: { label: "Bolt", Icon: BoltIcon },
  leaf: { label: "Leaf", Icon: LeafIcon },
  chat: { label: "Dialogue", Icon: ChatIcon },
  camera: { label: "Camera", Icon: CameraIcon },
  eye: { label: "Eye", Icon: EyeIcon },
  key: { label: "Key", Icon: KeyIcon },
  crown: { label: "Crown", Icon: CrownIcon },
  sword: { label: "Sword", Icon: SwordIcon },
  question: { label: "Question", Icon: QuestionIcon },
  target: { label: "Target", Icon: TargetIcon },
  lock: { label: "Lock", Icon: Lock },
  warning: { label: "Warning", Icon: Warning },
  archive: { label: "Box", Icon: ArchiveIcon },
};
