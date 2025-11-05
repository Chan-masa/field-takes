"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";

// ====== Types ======
type SampleRate = "44.1kHz" | "48kHz" | "96kHz";
type BitDepth  = "16bit" | "24bit" | "32bit float";

const AUDIO_SETTINGS_KEY = "field_audio_settings_v1";

type TakeStatus = "OK" | "NG" | "KEEP";
type Hand = "right" | "left";
type ThemeMode = "light" | "dark";

type Suffix = "" | "a" | "b" | "c" | "d" | "e" | "f" | "g";

interface TakeRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  fileNo: string;
  sceneNo: string;
  cutNo: string;
  takeNo: string;
  status: TakeStatus;
  mics: string[]; // CH1..8
  note?: string;
}

interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  rows: TakeRow[];
}
type UIMode = "desktop" | "mobile";
const UIMODE_KEY = "field_ui_mode_v1";

// ====== Keys ======
const PROJECTS_KEY = "field_projects_v1";
const CURRENT_PROJECT_KEY = "field_current_project_v1";
const HANDEDNESS_KEY = "field_handedness_v1";
const THEME_KEY = "field_theme_v1";

// ====== Utils ======
const SUFFIXES: readonly Suffix[] = ["", "a", "b", "c", "d", "e", "f", "g"];

function uuid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
function todayPrefix(): string {
  const d = new Date();
  return `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function nextFileNo(rows: TakeRow[]): string {
  const prefix = todayPrefix();
  const todayRows = rows.filter((r) => r.fileNo?.startsWith(prefix));
  if (!todayRows.length) return `${prefix}_001`;
  const nums = todayRows
    .map((r) => parseInt((r.fileNo.split("_")[1] || "0").replace(/\D/g, ""), 10))
    .filter((n) => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}_${String(max + 1).padStart(3, "0")}`;
}
function splitNumAndSuffix(value: string): { num: number; suffix: Suffix } {
  if (value === "オンリー") return { num: -1, suffix: "" };
  const m = String(value || "").match(/^(\d+)([a-g]?)$/i);
  if (!m) return { num: parseInt(value || "0", 10) || 0, suffix: "" };
  return { num: parseInt(m[1], 10) || 0, suffix: (m[2] || "") as Suffix };
}
function combine(num: number, suffix: Suffix) {
  if (num === -1) return "オンリー";
  return `${Math.max(1, num)}${suffix}`;
}
function formatDT(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// CSV helpers (per project)
function toCSV(rows: TakeRow[]): string {
  const headers = ["createdAt","fileNo","sceneNo","cutNo","takeNo","status", ...Array.from({ length: 8 }, (_, i) => `mic${i + 1}`),"note"];
  const esc = (s: unknown) => (s ?? "").toString().replaceAll('"', '""').replaceAll("\n", " ");
  return [headers.join(",")]
    .concat(
      rows.map((r) => {
        const arr = [r.createdAt, r.fileNo, r.sceneNo, r.cutNo, r.takeNo, r.status, ...(r.mics||[]).concat(Array(8).fill("")).slice(0,8), r.note||""];
        return arr.map((v) => `"${esc(v)}"`).join(",");
      })
    )
    .join("\n");
}

function fromCSV(csv: string): TakeRow[] {
  const lines = csv.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const cols: string[] = [];
    let cur = "";
    let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) {
        if (ch === '"' && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else if (ch === '"') {
          inQ = false;
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') inQ = true;
        else if (ch === ",") {
          cols.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
    }
    cols.push(cur);
    const rec: Record<string, string> = {};
    headers.forEach((h, idx) => {
      rec[h] = cols[idx] ?? "";
    });
    const now = new Date().toISOString();
    const mics = Array.from({ length: 8 }, (_, i) => rec[`mic${i + 1}`] || "");
    return {
      id: uuid(),
      createdAt: rec.createdAt || now,
      updatedAt: now,
      fileNo: rec.fileNo || "",
      sceneNo: rec.sceneNo || "",
      cutNo: rec.cutNo || "",
      takeNo: rec.takeNo || "",
      status: (rec.status as TakeStatus) || "KEEP",
      mics,
      note: rec.note || "",
    };
  });
}

// ====== UI bits (plain HTML + Tailwind) ======
function Badge({ children, tone }: { children: React.ReactNode; tone: "ok" | "ng" | "keep" }) {
  const cls = tone === "ok" ? "bg-green-600" : tone === "ng" ? "bg-rose-600" : "bg-amber-500";
  return <span className={`px-2 py-0.5 text-xs rounded text-white ${cls}`}>{children}</span>;
}

function Stepper({
  label,
  value,
  onChange,
  variant,
  fast = 0,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  variant: "scene" | "cut" | "take";
  fast?: number;
}) {
  const { num } = splitNumAndSuffix(value);

  // ▼ cut は「オンリー (-1)」を許容、他は 1〜
  const min = variant === "cut" ? -1 : 1;
  const clamp = (v: number) => (v < min ? min : v);

  const palette =
    variant === "scene"
      ? {
          text: "text-emerald-900 dark:text-emerald-100",
          box: "bg-emerald-50 dark:bg-emerald-900/40 dark:border-emerald-700",
          btn: "bg-emerald-100 dark:bg-emerald-800 dark:text-emerald-100",
        }
      : variant === "cut"
      ? {
          text: "text-sky-900 dark:text-sky-100",
          box: "bg-sky-50 dark:bg-sky-900/40 dark:border-sky-700",
          btn: "bg-sky-100 dark:bg-sky-800 dark:text-sky-100",
        }
      : {
          text: "text-rose-900 dark:text-rose-100",
          box: "bg-rose-50 dark:bg-rose-900/40 dark:border-rose-700",
          btn: "bg-rose-100 dark:bg-rose-800 dark:text-rose-100",
        };

  const display = variant === "cut" && num === -1 ? "オンリー" : String(Math.max(1, num));

  return (
    <div className="space-y-1">
      <label className={`text-sm font-semibold ${palette.text}`}>{label}</label>
      <div className="flex gap-2 items-center justify-center">
        {fast > 0 && (
          <button
            type="button"
            className={`h-10 w-16 text-xs border rounded ${palette.btn}`}
            onClick={() => {
              if (variant === "cut") {
                // 1 → -1（オンリー）を優先。その他は通常の fast 減算
                const n = num === 1 ? -1 : clamp(num - fast);
                onChange(String(n));
              } else {
                onChange(String(clamp(num - fast)));
              }
            }}
          >
            −{fast}
          </button>
        )}

        <button
          type="button"
          className={`h-12 w-20 border rounded ${palette.btn}`}
          onClick={() => {
            if (variant === "cut") {
              // 1 → -1（オンリー）、それ以外は通常デクリメント
              const n = num === 1 ? -1 : clamp(num - 1);
              onChange(String(n));
            } else {
              onChange(String(clamp(num - 1)));
            }
          }}
        >
          −
        </button>

        <div
          className={`h-12 w-16 grid place-items-center text-xl border rounded-xl select-none ${palette.box} ${palette.text}`}
        >
          {display}
        </div>

        <button
          type="button"
          className={`h-12 w-20 border rounded ${palette.btn}`}
          onClick={() => {
            if (variant === "cut") {
              // -1（オンリー）→ 1、それ以外は通常インクリメント
              const n = num === -1 ? 1 : clamp(num + 1);
              onChange(String(n));
            } else {
              onChange(String(clamp(num + 1)));
            }
          }}
        >
          ＋
        </button>

        {fast > 0 && (
          <button
            type="button"
            className={`h-10 w-16 text-xs border rounded ${palette.btn}`}
            onClick={() => {
              if (variant === "cut") {
                // オンリーからの高速増分は 1 起点に
                const base = num === -1 ? 1 : num;
                onChange(String(clamp(base + fast)));
              } else {
                onChange(String(clamp(num + fast)));
              }
            }}
          >
            +{fast}
          </button>
        )}
      </div>
    </div>
  );
}



function SuffixRow({
  value,
  onChange,
}: {
  value: Suffix;
  onChange: (s: Suffix) => void;
}) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {SUFFIXES.map((s) => {
        const isSelected = value === s;
        const isNone = s === "";
        const base =
          isNone
            ? "bg-slate-50 border-slate-300 text-slate-700 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-100"
            : "bg-violet-50 border-violet-300 text-violet-800 dark:bg-violet-800 dark:border-violet-600 dark:text-violet-100";
        const selected =
          isSelected
            ? "ring-2 ring-violet-400 dark:ring-violet-300"
            : "";
        return (
          <button
            key={s || "none"}
            type="button"
            className={`h-8 px-2 text-xs rounded border ${base} ${selected}`}
            onClick={() => onChange(s as Suffix)}
          >
            {isNone ? "なし" : s}
          </button>
        );
      })}
    </div>
  );
}


function Collapsible({
  title,
  right,
  children,
  defaultOpen = false,
}: {
  title: string;
  right?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border bg-white/90 dark:bg-slate-800/90">
      <button type="button" className="w-full flex items-center justify-between p-2 text-left" onClick={() => setOpen((o) => !o)}>
        <span className="font-semibold text-slate-800 dark:text-slate-100">{title}</span>
        <span className="text-sm text-slate-600 dark:text-slate-300">
          {right} {open ? "▾" : "▸"}
        </span>
      </button>
      {open && <div className="p-3 pt-0">{children}</div>}
    </div>
  );
}

// ====== Storage helpers ======
function loadProjects(): Project[] {
  try {
    const raw = localStorage.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const p = JSON.parse(raw) as Project[];
    return Array.isArray(p) ? p : [];
  } catch {
    return [];
  }
}
function saveProjects(ps: Project[]) {
  try {
    localStorage.setItem(PROJECTS_KEY, JSON.stringify(ps));
  } catch {}
}
function getCurrentProjectId(): string | null {
  try {
    return localStorage.getItem(CURRENT_PROJECT_KEY);
  } catch {
    return null;
  }
}
function setCurrentProjectId(id: string) {
  try {
    localStorage.setItem(CURRENT_PROJECT_KEY, id);
  } catch {}
}

// ====== Main ======
function compareByFileNo(a: TakeRow, b: TakeRow) {
  return a.fileNo.localeCompare(b.fileNo, "ja");
}
function AppInner() {
  // theme & hand
  const [theme, setTheme] = useState<ThemeMode>(
    (typeof window !== "undefined" && (localStorage.getItem(THEME_KEY) as ThemeMode)) || "light"
  );
  const [hand, setHand] = useState<Hand>(
    (typeof window !== "undefined" && (localStorage.getItem(HANDEDNESS_KEY) as Hand)) || "right"
  );
const [uiMode, setUiMode] = useState<UIMode>(
  (typeof window !== "undefined" && (localStorage.getItem(UIMODE_KEY) as UIMode)) || "desktop"
);
useEffect(() => {
  try { localStorage.setItem(UIMODE_KEY, uiMode); } catch {}
}, [uiMode]);

// 以降で使うフラグ
const isMobileMode = uiMode === "mobile";

  // projects
  const [projects, setProjects] = useState<Project[]>([]);
  const [currentId, setCurrentId] = useState<string | undefined>(undefined);
  const [rows, setRows] = useState<TakeRow[]>([]);
  const [needsPicker, setNeedsPicker] = useState<boolean>(true);

  // filters & inputs
  const [query, setQuery] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"ALL" | TakeStatus>("ALL");

  // csv/json
  const csvInputRef = useRef<HTMLInputElement | null>(null);
  const jsonInputRef = useRef<HTMLInputElement | null>(null);
  
  // draft
  const [draft, setDraft] = useState({
    fileNo: "",
    sceneNum: 1,
    sceneSuffix: "" as Suffix,
    cutNum: 1,
    cutSuffix: "" as Suffix,
    takeNum: 1,
    status: "KEEP" as TakeStatus,
    mics: ["", "", "", "", "", "", "", ""],
    note: "",
  });
  // オーディオ設定
  const [sampleRate, setSampleRate] = useState<SampleRate>(
    (typeof window !== "undefined" && (localStorage.getItem(AUDIO_SETTINGS_KEY+"_sr") as SampleRate)) || "48kHz"
  );
  const [bitDepth, setBitDepth] = useState<BitDepth>(
    (typeof window !== "undefined" && (localStorage.getItem(AUDIO_SETTINGS_KEY+"_bd") as BitDepth)) || "24bit"
  );

// === Undo / Redo 用スナップショット ===
type Snapshot = { rows: typeof rows; draft: typeof draft };
const past = useRef<Snapshot[]>([]);
const future = useRef<Snapshot[]>([]);
const [histTick, setHistTick] = useState(0);

const snap = (): Snapshot => ({
  rows: structuredClone(rows),
  draft: structuredClone(draft),
});
const pushHistory = () => { past.current.push(snap()); future.current.length = 0; setHistTick(t=>t+1); };
const undo = () => {
  if (!past.current.length) return;
  const prev = past.current.pop()!;
  future.current.push(snap());
  setRows(prev.rows); setDraft(prev.draft);
  setHistTick(t=>t+1);
};
const redo = () => {
  if (!future.current.length) return;
  const nxt = future.current.pop()!;
  past.current.push(snap());
  setRows(nxt.rows); setDraft(nxt.draft);
  setHistTick(t=>t+1);
};
// 自動スクロール用
const sheetRef = useRef<HTMLDivElement | null>(null);     // シート全体のスクロール容器
const endRef = useRef<HTMLDivElement | null>(null);       // 最後尾の目印
const scrollToEndNext = useRef(false);                    // 追加直後だけスクロールするフラグ

// === 保存状態表示 ===
const [saveState, setSaveState] = useState<"saving"|"saved">("saved");
useEffect(() => {
  setSaveState("saving");
  try { localStorage.setItem("field-takes-data", JSON.stringify(rows)); } catch {}
  const id = setTimeout(() => setSaveState("saved"), 300);
  return () => clearTimeout(id);
}, [rows]);


  // effects
  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {}
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(HANDEDNESS_KEY, hand);
    } catch {}
  }, [hand]);
  
useEffect(() => {
  if (!scrollToEndNext.current) return;
  scrollToEndNext.current = false;
  requestAnimationFrame(() => {
  const el = sheetRef.current;
  if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  });
}, [rows.length]);

  useEffect(() => {
    const ps = loadProjects();
    setProjects(ps);
    const savedId = getCurrentProjectId();
    if (ps.length === 0) {
      const id = uuid();
      const np: Project = { id, name: "無題プロジェクト", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rows: [] };
      const all = [np];
      saveProjects(all);
      setProjects(all);
      setCurrentProjectId(id);
      setCurrentId(id);
      setNeedsPicker(true);
    } else {
      if (savedId && ps.find((p) => p.id === savedId)) {
        setCurrentId(savedId);
        setNeedsPicker(false);
        setRows(ps.find((p) => p.id === savedId)!.rows);
      } else {
        setNeedsPicker(true);
      }
    }
  }, []);

  // persist rows into current project
  useEffect(() => {
    if (!currentId) return;
    setCurrentProjectId(currentId);
    setProjects((prev) => {
      const next = prev.map((p) => (p.id === currentId ? { ...p, rows, updatedAt: new Date().toISOString() } : p));
      saveProjects(next);
      return next;
    });
  }, [rows, currentId]);

  // fileNo auto after rows change
  useEffect(() => {
    if (!draft.fileNo) setDraft((d) => ({ ...d, fileNo: nextFileNo(rows) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows]);

  // computed
  const sceneDisplay = combine(draft.sceneNum, draft.sceneSuffix as Suffix);
  const cutDisplay = combine(draft.cutNum, draft.cutSuffix as Suffix);
  const gridCols = isMobileMode
  ? "grid-cols-1"
  : hand === "right"
    ? "md:grid-cols-[minmax(0,1fr)_420px]"
    : "md:grid-cols-[420px_minmax(0,1fr)]";

  const listColStart = hand === "right" ? "md:col-start-1" : "md:col-start-2";
  const panelColStart = hand === "right" ? "md:col-start-2" : "md:col-start-1";

  // filters
  const filtered = useMemo(() => {
    const q = query.toLowerCase();
    return rows.filter((r) => {
      const merged = [r.fileNo, r.sceneNo, r.cutNo, r.takeNo, r.status, ...(r.mics || []), r.note].join(" ").toLowerCase();
      return (q === "" || merged.includes(q)) && (statusFilter === "ALL" || r.status === statusFilter);
    });
  }, [rows, query, statusFilter]);

  // setters that auto reset
  function setSceneNum(n: number) {
    setDraft((d) => ({ ...d, sceneNum: Math.max(1,n), cutNum: 1, cutSuffix: "", takeNum: 1 }));
  }
  function setCutNum(n: number) {
    setDraft((d) => ({ ...d, cutNum: Math.max(1,n), takeNum: 1 }));
  }

  // CRUD rows
  function addRow() {
  pushHistory();
  scrollToEndNext.current = true; 
  const sceneStr = combine(draft.sceneNum, draft.sceneSuffix as Suffix);
  const cutStr = combine(draft.cutNum, draft.cutSuffix as Suffix);
  const takeStr = String(draft.takeNum);
  if (!draft.fileNo || sceneStr === "" || cutStr === "" || takeStr === "") return alert("必須: ファイルNo / S# / C# / T#");

  const row: TakeRow = {
    id: uuid(),
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fileNo: draft.fileNo,
    sceneNo: sceneStr,
    cutNo: cutStr,
    takeNo: takeStr,
    status: draft.status,
    mics: draft.mics,
    note: draft.note,
  };

  // ▼ ここで追加→即ソート
  const newRows = [...rows, row].sort(compareByFileNo);
  setRows(newRows);

  // ▼ 次の初期値（OKならカット+1、NG/KEEPはテイク+1）
  setDraft((d) => {
    const next = { ...d };
    if (d.status === "OK") {
      next.cutNum = d.cutNum === -1 ? 1 : (d.cutNum || 0) + 1; // オンリーの次は 1
      next.cutSuffix = "";
      next.takeNum = 1;
    } else {
      next.takeNum = d.takeNum + 1;
    }
    next.fileNo = nextFileNo(newRows);
    return next;
  });
}

  function delRow(id: string) {
  pushHistory();
  if (!confirm("削除しますか？")) return;
  setRows((p) => p.filter((r) => r.id !== id).sort(compareByFileNo));
}

  function editRow(id: string) {
  const r = rows.find((x) => x.id === id);
  if (!r) return;
  const sc = splitNumAndSuffix(r.sceneNo);
  const cu = splitNumAndSuffix(r.cutNo);

  setDraft((d) => ({
    ...d,
    fileNo: r.fileNo,
    sceneNum: Math.max(1, sc.num),
    sceneSuffix: sc.suffix,
    cutNum: cu.num === -1 ? -1 : Math.max(1, cu.num),
    cutSuffix: cu.suffix,
    takeNum: parseInt(r.takeNo || "1", 10) || 1,
    status: r.status,
    mics: r.mics || Array(8).fill(""),
    note: r.note || "",
  }));

  // ▼ 取り除いた後に必ずソート
  setRows((p) => p.filter((x) => x.id !== id).sort(compareByFileNo));
}

  function resetCounters() {
    pushHistory();
    setDraft((d) => ({ ...d, sceneNum: 1, cutNum: 1, takeNum: 1 }));
  }
// CSV出力（AppInner内）
const handleExportCSV = () => {
  const csv = toCSV(rows);
  const blob = new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${projectName() || "project"}-takes.csv`;
  a.click();
  URL.revokeObjectURL(url);
};


    function importCSV(file: File) {
    const r = new FileReader();
    r.onload = (e) => {
      let t = String(e.target?.result || "");

      // ▼ 追加: 先頭行が "SampleRate:" や "BitDepth:" を含む場合はスキップ
      const firstLine = t.split(/\r?\n/)[0] || "";
      if (firstLine.includes("SampleRate:") || firstLine.includes("BitDepth:")) {
        t = t.split(/\r?\n/).slice(1).join("\n");
      }

      const incoming = fromCSV(t);
      if (!incoming.length) return alert("有効な行なし");
      setRows((p) => [...p, ...incoming]);
    };
    r.readAsText(file);
  }


  // project ops
  function projectName(): string {
    const p = projects.find((x) => x.id === currentId);
    return p?.name || "";
  }
  function openPicker() {
    setNeedsPicker(true);
  }
  function createProject(initialName?: string) {
    const name = (initialName ?? prompt("プロジェクト名", "新規プロジェクト")) || "新規プロジェクト";
    const id = uuid();
    const np: Project = { id, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rows: [] };
    const all = [np, ...projects];
    saveProjects(all);
    setProjects(all);
    setCurrentId(id);
    setRows([]);
    setNeedsPicker(false);
  }
  function openProject(id: string) {
    const p = projects.find((x) => x.id === id);
    if (!p) return;
    setCurrentId(id);
    setRows(p.rows);
    setNeedsPicker(false);
  }
  function renameProject() {
    if (!currentId) return;
    const p = projects.find((x) => x.id === currentId);
    if (!p) return;
    const name = prompt("新しい名前", p.name) || p.name;
    const next = projects.map((x) => (x.id === currentId ? { ...x, name, updatedAt: new Date().toISOString() } : x));
    saveProjects(next);
    setProjects(next);
  }
  function duplicateProject() {
    if (!currentId) return;
    const p = projects.find((x) => x.id === currentId);
    if (!p) return;
    const id = uuid();
    const name = p.name + " コピー";
    const np: Project = { id, name, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rows: JSON.parse(JSON.stringify(p.rows)) };
    const all = [np, ...projects];
    saveProjects(all);
    setProjects(all);
    setCurrentId(id);
    setRows(np.rows);
    setNeedsPicker(false);
  }
  function deleteProject() {
    if (!currentId) return;
    const p = projects.find((x) => x.id === currentId);
    if (!p) return;
    if (!confirm(`「${p.name}」を削除します。元に戻せません。`)) return;
    const rest = projects.filter((x) => x.id !== currentId);
    saveProjects(rest);
    setProjects(rest);
    if (rest.length) {
      setCurrentId(rest[0].id);
      setRows(rest[0].rows);
    } else {
      const id = uuid();
      const np: Project = { id, name: "無題プロジェクト", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rows: [] };
      saveProjects([np]);
      setProjects([np]);
      setCurrentId(id);
      setRows([]);
    }
  }
  function exportProjectJSON() {
    const p = projects.find((x) => x.id === currentId);
    if (!p) return;
    const blob = new Blob([JSON.stringify(p, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.name.replace(/\s+/g, "_")}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
  function importProjectJSON(file: File) {
    const r = new FileReader();
    r.onload = (e) => {
      try {
        const obj = JSON.parse(String(e.target?.result || ""));
        if (!obj || typeof obj !== "object") throw new Error("invalid");
        const id = uuid();
        const p: Project = {
          id,
          name: obj.name && typeof obj.name === "string" ? obj.name : "インポート",
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          rows: Array.isArray(obj.rows) ? (obj.rows as TakeRow[]) : [],
        };
        const all = [p, ...projects];
        saveProjects(all);
        setProjects(all);
        setCurrentId(id);
        setRows(p.rows);
        setNeedsPicker(false);
      } catch {
        alert("JSONが不正です");
      }
    };
    r.readAsText(file);
  }

  // refs for file inputs
  const csvRef = useRef<HTMLInputElement | null>(null);
  const jsonRef = useRef<HTMLInputElement | null>(null);

  return (
    <div className="bg-white dark:bg-slate-900 dark:text-slate-100 min-h-[100dvh]">
      <div className="min-h-[100dvh] bg-white dark:bg-slate-900 p-2 md:p-4 max-w-7xl mx-auto pb-28 md:pb-0">
        {/* Top bar (1行・横スクロール可) */}
<div className="sticky top-0 z-50 bg-white dark:bg-slate-900 border-b">
  <div className="max-w-7xl mx-auto px-2 py-2 flex items-center gap-2 overflow-x-auto whitespace-nowrap">
    {/* Undo / Redo を一番左へ */}
<button className="h-8 px-2 text-xs border rounded shrink-0 disabled:opacity-40"
  onClick={undo} disabled={!past.current.length}>↶ 戻る</button>
<button className="h-8 px-2 text-xs border rounded shrink-0 disabled:opacity-40"
  onClick={redo} disabled={!future.current.length}>進む ↷</button>

<div className="mx-1 w-px h-5 bg-slate-200 dark:bg-slate-700 shrink-0" />

{/* 左側：プロジェクト操作 */}
<button className="h-8 px-2 text-xs border rounded shrink-0 bg-white dark:bg-slate-800" onClick={openPicker}>{projectName()||"未選択"}</button>
<button className="h-8 px-2 text-xs border rounded shrink-0" onClick={() => createProject()}>新規</button>
<button className="h-8 px-2 text-xs border rounded shrink-0" onClick={renameProject}>名称</button>
<button className="h-8 px-2 text-xs border rounded shrink-0" onClick={duplicateProject}>複製</button>
<button className="h-8 px-2 text-xs border rounded shrink-0" onClick={exportProjectJSON}>JSON出</button>
<button className="h-8 px-2 text-xs border rounded shrink-0" onClick={()=>jsonInputRef.current?.click()}>JSON入</button>
<button className="h-8 px-2 text-xs border rounded border-rose-300 text-rose-700 shrink-0" onClick={deleteProject}>削除</button>

    {/* 利き手・テーマ */}
    <div className="mx-1 w-px h-5 bg-slate-200 dark:bg-slate-700 shrink-0" />
    <div className="rounded-lg border overflow-hidden shrink-0">
      <button className={`px-2 py-1 text-xs ${hand==="left"?"bg-slate-900 text-white":"bg-white dark:bg-slate-800 dark:text-slate-100"}`} onClick={()=>setHand("left")}>左手</button>
      <button className={`px-2 py-1 text-xs ${hand==="right"?"bg-slate-900 text-white":"bg-white dark:bg-slate-800 dark:text-slate-100"}`} onClick={()=>setHand("right")}>右手</button>
    </div>
    <div className="rounded-lg border overflow-hidden shrink-0">
      <button className={`px-2 py-1 text-xs ${theme==="light"?"bg-slate-900 text-white":"bg-white dark:bg-slate-800 dark:text-slate-100"}`} onClick={()=>setTheme("light")}>明</button>
      <button className={`px-2 py-1 text-xs ${theme==="dark"?"bg-slate-900 text-white":"bg-white dark:bg-slate-800 dark:text-slate-100"}`} onClick={()=>setTheme("dark")}>暗</button>
    </div>

    <div className="mx-1 w-px h-5 bg-slate-200 dark:bg-slate-700 shrink-0" />
<div className="rounded-lg border overflow-hidden shrink-0">
  <button
    className={`px-2 py-1 text-xs ${uiMode==="desktop"?"bg-slate-900 text-white":"bg-white dark:bg-slate-800 dark:text-slate-100"}`}
    onClick={()=>setUiMode("desktop")}
  >
    デスクトップ
  </button>
  <button
    className={`px-2 py-1 text-xs ${uiMode==="mobile"?"bg-slate-900 text-white":"bg-white dark:bg-slate-800 dark:text-slate-100"}`}
    onClick={()=>setUiMode("mobile")}
  >
    スマホ
  </button>
</div>

{/* Audio settings */}
<div className="mx-1 w-px h-5 bg-slate-200 dark:bg-slate-700 shrink-0" />
<div className="relative shrink-0">
  <details>
    <summary className="cursor-pointer px-2 py-1 text-xs border rounded bg-white dark:bg-slate-800">
      録音設定
    </summary>
    {/* ここを absolute → fixed にして最前面へ */}
    <div className="fixed z-[100] left-2 top-[56px] p-2 border rounded shadow
                    bg-white dark:bg-slate-800">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-xs text-slate-600 dark:text-slate-300">サンプルレート</span>
        <select
          value={sampleRate}
          onChange={(e)=>{ setSampleRate(e.target.value as any); localStorage.setItem(AUDIO_SETTINGS_KEY+"_sr", e.target.value); }}
          className="h-7 text-xs rounded border bg-white dark:bg-slate-700"
        >
          <option value="44.1kHz">44.1kHz</option>
          <option value="48kHz">48kHz</option>
          <option value="96kHz">96kHz</option>
        </select>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs text-slate-600 dark:text-slate-300">ビット深度</span>
        <select
          value={bitDepth}
          onChange={(e)=>{ setBitDepth(e.target.value as any); localStorage.setItem(AUDIO_SETTINGS_KEY+"_bd", e.target.value); }}
          className="h-7 text-xs rounded border bg-white dark:bg-slate-700"
        >
          <option value="16bit">16bit</option>
          <option value="24bit">24bit</option>
          <option value="32bit float">32bit float</option>
        </select>
      </div>
    </div>
  </details>
</div>

    {/* 右端：保存状態 */}
    <div className="ml-auto shrink-0">
      <span className={`inline-flex items-center gap-1 h-6 px-2 rounded-full text-[11px] border
        ${saveState==="saving"
          ? "border-amber-300 bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-200"
          : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-200"}`}>
        {saveState==="saving" ? "保存中…" : "✓ 保存済み"}
      </span>
    </div>
  </div>
</div>


        {/* Grid */}
        <div className={`grid ${gridCols} items-start gap-3 md:gap-5`}>
          {/* List */}
          <div className={`${listColStart} md:row-start-1`}>
            <div className="rounded-xl border bg-white/90 dark:bg-slate-800/90">
              <div className={`p-3 space-y-2 ${isMobileMode ? "pb-[36vh]" : ""}`}>
                <div className="flex gap-2 items-center">
                  <input
                    placeholder="キーワード検索"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="bg-white dark:bg-slate-700 h-9 px-2 rounded border flex-1"
                  />
                  <select
                    value={statusFilter}
                    onChange={(e) => setStatusFilter(e.target.value as any)}
                    className="h-9 px-2 rounded border bg-white dark:bg-slate-700"
                  >
                    <option value="ALL">ALL</option>
                    <option value="OK">OK</option>
                    <option value="NG">NG</option>
                    <option value="KEEP">KEEP</option>
                  </select>

                  <div className="ml-auto hidden md:flex gap-2">
                    <button className="h-9 px-3 rounded border bg-indigo-50 dark:bg-indigo-900/30" onClick={handleExportCSV}>
                      CSV出力
                    </button>
                    <button className="h-9 px-3 rounded border bg-teal-50 dark:bg-emerald-900/30" onClick={() => csvInputRef.current?.click()}>
                      CSV取込
                    </button>
                    <input
                      ref={csvInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) importCSV(f);
                        e.currentTarget.value = "";
                      }}
                    />
                  </div>
                </div>

                <div ref={sheetRef} className="overflow-x-auto overflow-y-auto max-h-[60vh]">
                  <table className="min-w-full border text-sm">
                    <thead className="bg-neutral-50 dark:bg-slate-700">
                      <tr>
                        {["作成", "ファイル", "S#", "C#", "T#", "状態", ...Array.from({ length: 8 }, (_, i) => `CH${i + 1}`), "備考", "操作"].map((h) => (
                          <th key={h} className="px-2 py-1 border text-left">
                            {h}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((r) => (
                        <tr key={r.id} className="odd:bg-white even:bg-neutral-50 dark:odd:bg-slate-800 dark:even:bg-slate-700/60">
                          <td className="px-2 py-1 border">{formatDT(r.createdAt)}</td>
                          <td className="px-2 py-1 border">{r.fileNo}</td>
                          <td className="px-2 py-1 border">{r.sceneNo}</td>
                          <td className="px-2 py-1 border">{r.cutNo}</td>
                          <td className="px-2 py-1 border">{r.takeNo}</td>
                          <td className="px-2 py-1 border">
                            <Badge tone={r.status === "OK" ? "ok" : r.status === "NG" ? "ng" : "keep"}>{r.status}</Badge>
                          </td>
                          {r.mics.map((m, i) => (
                            <td key={i} className="px-2 py-1 border">
                              {m}
                            </td>
                          ))}
                          <td className="px-2 py-1 border max-w-[260px] truncate" title={r.note}>
                            {r.note}
                          </td>
                         <td className="px-2 py-1 border">
  <div className="flex gap-1 justify-end">
    <button
      onClick={() => editRow(r.id)}
      className="h-8 px-2 text-xs leading-none whitespace-nowrap border rounded bg-white dark:bg-slate-800 min-w-[56px]"
    >
      編集
    </button>
    <button
      onClick={() => delRow(r.id)}
      className="h-8 px-2 text-xs leading-none whitespace-nowrap border rounded border-rose-300 text-rose-700 min-w-[56px]"
    >
      削除
    </button>
  </div>
</td>

                        </tr>
                      ))}
                      {filtered.length === 0 && (
                        <tr>
                          <td colSpan={20} className="text-center py-8 text-neutral-500 dark:text-slate-300">
                            一致するテイクはありません
                          </td>
                        </tr>
                      )}
                      <tr><td colSpan={999}><div ref={endRef} /></td></tr>
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>

          {/* Controls */}
          <aside className={`${panelColStart} md:row-start-1 md:self-start md:sticky md:top-2 h-fit ${isMobileMode ? "hidden" : "block"}`}>
            <div className="rounded-xl border shadow-md bg-white/90 dark:bg-slate-800/90">
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 gap-2 items-end">
                  <div className="col-span-2 space-y-1">
                    <label className="text-slate-700 dark:text-slate-200 text-sm">ファイル番号*</label>
                    <input
                      autoComplete="off"
                      value={draft.fileNo}
                      onChange={(e) => setDraft({ ...draft, fileNo: e.target.value })}
                      className="bg-white dark:bg-slate-700 h-10 px-2 rounded border w-full"
                    />
                  </div>

                  {/* S# */}
                  <div className="col-span-2">
                    <Stepper
                      label="S#"
                      value={sceneDisplay}
                      onChange={(v) => {
                        const { num } = splitNumAndSuffix(v);
                        setSceneNum(num);
                      }}
                      variant="scene"
                      fast={5}
                    />
                    <div className="mt-1">
                      <SuffixRow value={draft.sceneSuffix as Suffix} onChange={(s) => setDraft((d) => ({ ...d, sceneSuffix: s as Suffix }))} />
                    </div>
                  </div>

                  {/* C# */}
                  <div className="col-span-2">
                    <Stepper
                      label="C#"
                      value={cutDisplay}
                      onChange={(v) => {
                        const { num } = splitNumAndSuffix(v);
                        setCutNum(num);
                      }}
                      variant="cut"
                    />
                    <div className="mt-1">
                      <SuffixRow value={draft.cutSuffix as Suffix} onChange={(s) => setDraft((d) => ({ ...d, cutSuffix: s as Suffix }))} />
                    </div>
                  </div>

                  {/* T# */}
                  <div className="col-span-2">
                    <Stepper
                      label="T#"
                      value={String(draft.takeNum)}
                      onChange={(v) => setDraft((d) => ({ ...d, takeNum: Math.max(1, parseInt(v || "1", 10) || 1) }))}
                      variant="take"
                    />
                  </div>
                </div>

                {/* Status + Add/Reset (desktop) */}
                <div className="hidden md:flex items-center gap-2">
                  {(["OK", "NG", "KEEP"] as const).map((s) => {
                    const selected = draft.status === s;
                    const base =
  s === "OK"
    ? "border-emerald-300 bg-emerald-100 hover:bg-emerald-200 dark:bg-emerald-800 dark:hover:bg-emerald-700 dark:text-emerald-100"
    : s === "NG"
    ? "border-rose-300 bg-rose-100 hover:bg-rose-200 dark:bg-rose-800 dark:hover:bg-rose-700 dark:text-rose-100"
    : "border-amber-300 bg-amber-100 hover:bg-amber-200 dark:bg-amber-800 dark:hover:bg-amber-700 dark:text-amber-100";

                    return (
                      <button
                        key={s}
                        aria-pressed={selected}
                        onClick={() => setDraft({ ...draft, status: s })}
                        className={`h-10 px-4 border rounded ${selected ? "ring-2 ring-offset-2 ring-indigo-400" : ""} ${base}`}
                      >
                        {s}
                      </button>
                    );
                  })}
                  <div className="flex-1" />
                  <button className="h-10 px-4 bg-red-600 text-white font-bold hover:bg-red-700 rounded" onClick={resetCounters}>
                    リセット
                  </button>
                  <button onClick={addRow} className="h-10 px-5 rounded-2xl bg-indigo-600 text-white hover:bg-indigo-700">
                    追加
                  </button>
                </div>

                <Collapsible title="チャンネル（CH1〜CH8）" right={`${draft.mics.filter((m) => m && m.trim()).length}/8 設定済み`} defaultOpen={false}>
                  <div className="grid grid-cols-2 gap-2">
                    {draft.mics.map((m, i) => (
                      <div key={i} className="space-y-1">
                        <label className="text-xs text-slate-600 dark:text-slate-300">CH{i + 1}</label>
                        <input
                          autoComplete="off"
                          value={m}
                          onChange={(e) => {
                            const arr = [...draft.mics];
                            arr[i] = e.target.value;
                            setDraft({ ...draft, mics: arr });
                          }}
                          className="bg-white dark:bg-slate-700 h-9 px-2 rounded border w-full"
                        />
                      </div>
                    ))}
                  </div>
                </Collapsible>

                <Collapsible title="備考" right={(draft.note?.length || 0) > 0 ? `${draft.note!.length} 文字` : "未入力"} defaultOpen={false}>
                  <textarea
                    value={draft.note || ""}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                    className="bg-white dark:bg-slate-700 h-24 px-2 py-1 rounded border w-full"
                  />
                </Collapsible>

                {/* CSV (mobile) */}
                <div className="mt-2 md:hidden flex gap-2">
                  <button className="bg-indigo-600 text-white rounded px-3 py-2 w-full" onClick={handleExportCSV}>
                    CSV出力
                  </button>
                  <button className="bg-emerald-600 text-white rounded px-3 py-2 w-full" onClick={() => csvInputRef.current?.click()}>
                    CSV取込
                  </button>
                  <input
                    ref={csvInputRef}
                    type="file"
                    accept=".csv,text/csv"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) importCSV(f);
                      e.currentTarget.value = "";
                    }}
                  />
                </div>
              </div>
            </div>
          </aside>
        </div>

        {/* Project picker modal */}
        {needsPicker && (
          <div className="fixed inset-0 bg-black/40 grid place-items-center z-50">
            <div className="w-[min(92vw,560px)] rounded-2xl bg-white dark:bg-slate-800 shadow-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
              </div>
              <div className="max-h-[50vh] overflow-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 dark:bg-slate-700">
                    <tr>
                      <th className="text-left px-2 py-1 border">名前</th>
                      <th className="text-left px-2 py-1 border">作成</th>
                      <th className="text-left px-2 py-1 border">更新</th>
                      <th className="text-left px-2 py-1 border">行数</th>
                      <th className="text-left px-2 py-1 border">開く</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p) => (
                      <tr key={p.id} className="odd:bg-white even:bg-neutral-50 dark:odd:bg-slate-800 dark:even:bg-slate-700/60">
                        <td className="px-2 py-1 border">{p.name}</td>
                        <td className="px-2 py-1 border">{formatDT(p.createdAt)}</td>
                        <td className="px-2 py-1 border">{formatDT(p.updatedAt)}</td>
                        <td className="px-2 py-1 border">{p.rows.length}</td>
                        <td className="px-2 py-1 border">
                          <button className="px-2 h-8 rounded border" onClick={() => openProject(p.id)}>
                            開く
                          </button>
                        </td>
                      </tr>
                    ))}
                    {projects.length === 0 && (
                      <tr>
                        <td colSpan={5} className="text-center py-6 text-neutral-500">
                          プロジェクトがありません
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <button className="h-9 px-3 rounded bg-indigo-600 text-white" onClick={() => createProject()}>
                  新規作成
                </button>
                <button className="h-9 px-3 rounded border" onClick={() => setNeedsPicker(false)}>
                  閉じる
                </button>
              </div>
            </div>
          </div>
        )}

       {/* Mobile bottom dock: all controls in ordered sections */}
<div className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 dark:bg-slate-800/95 backdrop-blur supports-[backdrop-filter]:bg-white/75">
  <details className="group">
    <summary className="list-none cursor-pointer">
      <div className="max-w-7xl mx-auto px-3 py-1 grid grid-cols-6 gap-2 text-xs">
        {/* 簡易ステータス表示行（触らない） */}
        <span className="col-span-2 text-slate-500 dark:text-slate-300 truncate">
          {projectName() || "未選択"}
        </span>
        <span className="col-span-2 text-center">{draft.fileNo || "ファイル番号"}</span>
        <span className="col-span-2 text-right text-slate-500 dark:text-slate-300">▲ 開く</span>
      </div>
    </summary>

    {/* ↓↓↓ 展開された中身 ↓↓↓ */}
    <div className="max-w-7xl mx-auto max-h-[33vh] overflow-y-auto px-3 pb-3 space-y-3">

      {/* 1) ファイル番号 */}
      <div className="space-y-1">
        <label className="text-xs text-slate-600 dark:text-slate-300">ファイル番号*</label>
        <input
          autoComplete="off"
          value={draft.fileNo}
          onChange={(e)=>setDraft({...draft, fileNo:e.target.value})}
          className="w-full h-12 px-2 rounded border bg-white dark:bg-slate-700"
        />
      </div>

      {/* 2) S# */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-emerald-900 dark:text-emerald-100">S#</label>
        <div className="flex items-center justify-center gap-2">
          <button className="h-10 px-3 text-[11px] border rounded bg-emerald-100 dark:bg-emerald-800 dark:text-emerald-100"
                  onClick={()=>setSceneNum(Math.max(1, draft.sceneNum-5))}>−5</button>
          <button className="h-12 w-16 border rounded bg-emerald-100 dark:bg-emerald-800 dark:text-emerald-100"
                  onClick={()=>setSceneNum(Math.max(1, draft.sceneNum-1))}>−</button>
          <div className="h-12 w-20 grid place-items-center text-lg border rounded-xl select-none bg-emerald-50 dark:bg-emerald-900/40 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100">
            {draft.sceneNum}
          </div>
          <button className="h-12 w-16 border rounded bg-emerald-100 dark:bg-emerald-800 dark:text-emerald-100"
                  onClick={()=>setSceneNum(draft.sceneNum+1)}>＋</button>
          <button className="h-10 px-3 text-[11px] border rounded bg-emerald-100 dark:bg-emerald-800 dark:text-emerald-100"
                  onClick={()=>setSceneNum(draft.sceneNum+5)}>+5</button>
        </div>
        {/* サフィックス */}
        <div className="flex items-center gap-1 flex-wrap justify-center">
          {SUFFIXES.map(s=>{
            const sel = draft.sceneSuffix===s;
            const base = s===""
              ? "bg-slate-50 border-slate-300 text-slate-700 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-100"
              : "bg-violet-50 border-violet-300 text-violet-800 dark:bg-violet-800 dark:border-violet-600 dark:text-violet-100";
            return (
              <button key={"s"+(s||"none")}
                className={`h-9 px-2 text-[11px] rounded border ${base} ${sel?"ring-2 ring-violet-300":""}`}
                onClick={()=>setDraft(d=>({...d, sceneSuffix:s}))}>
                {s===""?"なし":s}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3) C# */}
<div className="space-y-1">
  <label className="text-xs font-semibold text-sky-900 dark:text-sky-100">C#</label>
  <div className="flex items-center justify-center gap-2">
    <button
      className="h-12 w-16 border rounded bg-sky-100 dark:bg-sky-800 dark:text-sky-100"
      onClick={() => {
        // 1 → -1（オンリー）、それ以外は通常デクリメント（ただし 1 未満は -1 に丸め）
        const n = draft.cutNum === 1 ? -1 : draft.cutNum - 1;
        setCutNum(n);
      }}
    >
      −
    </button>
    <div className="h-12 w-20 grid place-items-center text-lg border rounded-xl select-none bg-sky-50 dark:bg-sky-900/40 dark:border-sky-700 text-sky-900 dark:text-sky-100">
      {draft.cutNum === -1 ? "オンリー" : draft.cutNum}
    </div>
    <button
      className="h-12 w-16 border rounded bg-sky-100 dark:bg-sky-800 dark:text-sky-100"
      onClick={() => {
        // -1 → 1 にジャンプ、それ以外は通常インクリメント
        const n = draft.cutNum === -1 ? 1 : draft.cutNum + 1;
        setCutNum(n);
      }}
    >
      ＋
    </button>
  </div>
  {/* サフィックスはそのまま（オンリー時は見た目だけ、値は無視） */}
  <div className="flex items-center gap-1 flex-wrap justify-center">
    {SUFFIXES.map((s) => {
      const sel = draft.cutSuffix === s;
      const base =
        s === ""
          ? "bg-slate-50 border-slate-300 text-slate-700 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-100"
          : "bg-violet-50 border-violet-300 text-violet-800 dark:bg-violet-800 dark:border-violet-600 dark:text-violet-100";
      return (
        <button
          key={"c" + (s || "none")}
          className={`h-9 px-2 text-[11px] rounded border ${base} ${sel ? "ring-2 ring-violet-300" : ""}`}
          onClick={() => setDraft((d) => ({ ...d, cutSuffix: s }))}
          disabled={draft.cutNum === -1} // オンリー時は無効化してもOK（任意）
        >
          {s === "" ? "なし" : s}
        </button>
      );
    })}
  </div>
</div>


      {/* 4) T# */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-rose-900 dark:text-rose-100">T#</label>
        <div className="flex items-center justify-center gap-2">
          <button className="h-12 w-16 border rounded bg-rose-100 dark:bg-rose-800 dark:text-rose-100"
                  onClick={()=>setDraft(d=>({...d, takeNum: Math.max(1, d.takeNum-1)}))}>−</button>
          <div className="h-12 w-20 grid place-items-center text-lg border rounded-xl select-none bg-rose-50 dark:bg-rose-900/40 dark:border-rose-700 text-rose-900 dark:text-rose-100">
            {draft.takeNum}
          </div>
          <button className="h-12 w-16 border rounded bg-rose-100 dark:bg-rose-800 dark:text-rose-100"
                  onClick={()=>setDraft(d=>({...d, takeNum: d.takeNum+1}))}>＋</button>
        </div>
      </div>

      {/* 5) ステータス */}
      <div className="grid grid-cols-3 gap-2">
        {(["OK","NG","KEEP"] as const).map((s)=>{
          const selected = draft.status===s;
          const base =
            s==="OK" ? "border-emerald-300 bg-emerald-100 dark:bg-emerald-800 dark:text-emerald-100"
          : s==="NG" ? "border-rose-300 bg-rose-100 dark:bg-rose-800 dark:text-rose-100"
          :            "border-amber-300 bg-amber-100 dark:bg-amber-800 dark:text-amber-100";
          return (
            <button key={s}
              onClick={()=>setDraft({...draft, status:s})}
              className={`h-12 text-sm border rounded ${base} ${selected?"ring-2 ring-indigo-400":""}`}>
              {s}
            </button>
          );
        })}
      </div>

      {/* 6) 追加 / リセット */}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={resetCounters} className="h-12 text-sm bg-red-600 text-white hover:bg-red-700 rounded col-span-1">リセット</button>
        <button onClick={addRow} className="h-12 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded col-span-2">追加</button>
      </div>

      {/* 7) CH1〜8 */}
      <div className="rounded-xl border bg-white/90 dark:bg-slate-800/90 p-3">
        <div className="grid grid-cols-2 gap-2">
          {draft.mics.map((m,i)=>(
            <div key={i} className="space-y-1">
              <label className="text-xs text-slate-600 dark:text-slate-300">CH{i+1}</label>
              <input
                value={m}
                onChange={(e)=>{ const a=[...draft.mics]; a[i]=e.target.value; setDraft({...draft, mics:a}); }}
                className="h-10 px-2 rounded border w-full bg-white dark:bg-slate-700"
              />
            </div>
          ))}
        </div>
      </div>

      {/* 8) 備考 */}
      <div className="rounded-xl border bg-white/90 dark:bg-slate-800/90 p-3">
        <label className="text-xs text-slate-600 dark:text-slate-300">備考</label>
        <textarea
          value={draft.note || ""}
          onChange={(e)=>setDraft({...draft, note:e.target.value})}
          className="mt-1 h-24 w-full px-2 py-1 rounded border bg-white dark:bg-slate-700"
        />
      </div>

      {/* 9) CSV */}
      <div className="flex gap-2">
        <button className="flex-1 h-10 text-xs border rounded bg-indigo-50 dark:bg-indigo-900/30" onClick={handleExportCSV}>CSV出力</button>
        <button className="flex-1 h-10 text-xs border rounded bg-emerald-50 dark:bg-emerald-900/30" onClick={()=>csvRef.current?.click()}>CSV取込</button>
        <input
          ref={csvRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e)=>{ const f=e.target.files?.[0]; if(f) importCSV(f); e.currentTarget.value=""; }}
        />
      </div>

    </div>
    {/* ↑↑↑ 展開された中身ここまで ↑↑↑ */}
  </details>
</div>
{/* Mobile bottom dock: all controls in ordered sections */}
<div className="md:hidden fixed inset-x-0 bottom-0 z-40 border-t bg-white/95 dark:bg-slate-800/95 backdrop-blur supports-[backdrop-filter]:bg-white/75">
  <details className="group">
    <summary className="list-none cursor-pointer">
      <div className="max-w-7xl mx-auto px-3 py-1 grid grid-cols-6 gap-2 text-xs">
        {/* 簡易ステータス表示行（触らない） */}
        <span className="col-span-2 text-slate-500 dark:text-slate-300 truncate">
          {projectName() || "未選択"}
        </span>
        <span className="col-span-2 text-center">{draft.fileNo || "ファイル番号"}</span>
        <span className="col-span-2 text-right text-slate-500 dark:text-slate-300">▲ 開く</span>
      </div>
    </summary>

    {/* ↓↓↓ 展開された中身 ↓↓↓ */}
    <div className="max-w-7xl mx-auto max-h-[33vh] overflow-y-auto px-3 pb-3 space-y-3">

      {/* 1) ファイル番号 */}
      <div className="space-y-1">
        <label className="text-xs text-slate-600 dark:text-slate-300">ファイル番号*</label>
        <input
          autoComplete="off"
          value={draft.fileNo}
          onChange={(e)=>setDraft({...draft, fileNo:e.target.value})}
          className="w-full h-12 px-2 rounded border bg-white dark:bg-slate-700"
        />
      </div>

      {/* 2) S# */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-emerald-900 dark:text-emerald-100">S#</label>
        <div className="flex items-center justify-center gap-2">
          <button className="h-10 px-3 text-[11px] border rounded bg-emerald-100 dark:bg-emerald-800 dark:text-emerald-100"
                  onClick={()=>setSceneNum(Math.max(1, draft.sceneNum-5))}>−5</button>
          <button className="h-12 w-16 border rounded bg-emerald-100 dark:bg-emerald-800 dark:text-emerald-100"
                  onClick={()=>setSceneNum(Math.max(1, draft.sceneNum-1))}>−</button>
          <div className="h-12 w-20 grid place-items-center text-lg border rounded-xl select-none bg-emerald-50 dark:bg-emerald-900/40 dark:border-emerald-700 text-emerald-900 dark:text-emerald-100">
            {draft.sceneNum}
          </div>
          <button className="h-12 w-16 border rounded bg-emerald-100 dark:bg-emerald-800 dark:text-emerald-100"
                  onClick={()=>setSceneNum(draft.sceneNum+1)}>＋</button>
          <button className="h-10 px-3 text-[11px] border rounded bg-emerald-100 dark:bg-emerald-800 dark:text-emerald-100"
                  onClick={()=>setSceneNum(draft.sceneNum+5)}>+5</button>
        </div>
        {/* サフィックス */}
        <div className="flex items-center gap-1 flex-wrap justify-center">
          {SUFFIXES.map(s=>{
            const sel = draft.sceneSuffix===s;
            const base = s===""
              ? "bg-slate-50 border-slate-300 text-slate-700 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-100"
              : "bg-violet-50 border-violet-300 text-violet-800 dark:bg-violet-800 dark:border-violet-600 dark:text-violet-100";
            return (
              <button key={"s"+(s||"none")}
                className={`h-9 px-2 text-[11px] rounded border ${base} ${sel?"ring-2 ring-violet-300":""}`}
                onClick={()=>setDraft(d=>({...d, sceneSuffix:s}))}>
                {s===""?"なし":s}
              </button>
            );
          })}
        </div>
      </div>

      {/* 3) C# */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-sky-900 dark:text-sky-100">C#</label>
        <div className="flex items-center justify-center gap-2">
          <button className="h-12 w-16 border rounded bg-sky-100 dark:bg-sky-800 dark:text-sky-100"
                  onClick={()=>setCutNum(Math.max(1, draft.cutNum-1))}>−</button>
          <div className="h-12 w-20 grid place-items-center text-lg border rounded-xl select-none bg-sky-50 dark:bg-sky-900/40 dark:border-sky-700 text-sky-900 dark:text-sky-100">
            {draft.cutNum}
          </div>
          <button className="h-12 w-16 border rounded bg-sky-100 dark:bg-sky-800 dark:text-sky-100"
                  onClick={()=>setCutNum(draft.cutNum+1)}>＋</button>
        </div>
        {/* サフィックス */}
        <div className="flex items-center gap-1 flex-wrap justify-center">
          {SUFFIXES.map(s=>{
            const sel = draft.cutSuffix===s;
            const base = s===""
              ? "bg-slate-50 border-slate-300 text-slate-700 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-100"
              : "bg-violet-50 border-violet-300 text-violet-800 dark:bg-violet-800 dark:border-violet-600 dark:text-violet-100";
            return (
              <button key={"c"+(s||"none")}
                className={`h-9 px-2 text-[11px] rounded border ${base} ${sel?"ring-2 ring-violet-300":""}`}
                onClick={()=>setDraft(d=>({...d, cutSuffix:s}))}>
                {s===""?"なし":s}
              </button>
            );
          })}
        </div>
      </div>

      {/* 4) T# */}
      <div className="space-y-1">
        <label className="text-xs font-semibold text-rose-900 dark:text-rose-100">T#</label>
        <div className="flex items-center justify-center gap-2">
          <button className="h-12 w-16 border rounded bg-rose-100 dark:bg-rose-800 dark:text-rose-100"
                  onClick={()=>setDraft(d=>({...d, takeNum: Math.max(1, d.takeNum-1)}))}>−</button>
          <div className="h-12 w-20 grid place-items-center text-lg border rounded-xl select-none bg-rose-50 dark:bg-rose-900/40 dark:border-rose-700 text-rose-900 dark:text-rose-100">
            {draft.takeNum}
          </div>
          <button className="h-12 w-16 border rounded bg-rose-100 dark:bg-rose-800 dark:text-rose-100"
                  onClick={()=>setDraft(d=>({...d, takeNum: d.takeNum+1}))}>＋</button>
        </div>
      </div>

      {/* 5) ステータス */}
      <div className="grid grid-cols-3 gap-2">
        {(["OK","NG","KEEP"] as const).map((s)=>{
          const selected = draft.status===s;
          const base =
            s==="OK" ? "border-emerald-300 bg-emerald-100 dark:bg-emerald-800 dark:text-emerald-100"
          : s==="NG" ? "border-rose-300 bg-rose-100 dark:bg-rose-800 dark:text-rose-100"
          :            "border-amber-300 bg-amber-100 dark:bg-amber-800 dark:text-amber-100";
          return (
            <button key={s}
              onClick={()=>setDraft({...draft, status:s})}
              className={`h-12 text-sm border rounded ${base} ${selected?"ring-2 ring-indigo-400":""}`}>
              {s}
            </button>
          );
        })}
      </div>

      {/* 6) 追加 / リセット */}
      <div className="grid grid-cols-3 gap-2">
        <button onClick={resetCounters} className="h-12 text-sm bg-red-600 text-white hover:bg-red-700 rounded col-span-1">リセット</button>
        <button onClick={addRow} className="h-12 text-sm bg-indigo-600 text-white hover:bg-indigo-700 rounded col-span-2">追加</button>
      </div>

      {/* 7) CH1〜8 */}
      <div className="rounded-xl border bg-white/90 dark:bg-slate-800/90 p-3">
        <div className="grid grid-cols-2 gap-2">
          {draft.mics.map((m,i)=>(
            <div key={i} className="space-y-1">
              <label className="text-xs text-slate-600 dark:text-slate-300">CH{i+1}</label>
              <input
                value={m}
                onChange={(e)=>{ const a=[...draft.mics]; a[i]=e.target.value; setDraft({...draft, mics:a}); }}
                className="h-10 px-2 rounded border w-full bg-white dark:bg-slate-700"
              />
            </div>
          ))}
        </div>
      </div>

      {/* 8) 備考 */}
      <div className="rounded-xl border bg-white/90 dark:bg-slate-800/90 p-3">
        <label className="text-xs text-slate-600 dark:text-slate-300">備考</label>
        <textarea
          value={draft.note || ""}
          onChange={(e)=>setDraft({...draft, note:e.target.value})}
          className="mt-1 h-24 w-full px-2 py-1 rounded border bg-white dark:bg-slate-700"
        />
      </div>

      {/* 9) CSV */}
      <div className="flex gap-2">
        <button className="flex-1 h-10 text-xs border rounded bg-indigo-50 dark:bg-indigo-900/30" onClick={handleExportCSV}>CSV出力</button>
        <button className="flex-1 h-10 text-xs border rounded bg-emerald-50 dark:bg-emerald-900/30" onClick={()=>csvRef.current?.click()}>CSV取込</button>
        <input
          ref={csvRef}
          type="file"
          accept=".csv,text/csv"
          className="hidden"
          onChange={(e)=>{ const f=e.target.files?.[0]; if(f) importCSV(f); e.currentTarget.value=""; }}
        />
      </div>

    </div>
    {/* ↑↑↑ 展開された中身ここまで ↑↑↑ */}
  </details>
</div>



      </div>

      {/* Hidden file inputs (fallback) */}
      <input
        ref={csvInputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importCSV(f);
          e.currentTarget.value = "";
        }}
      />
      <input
        ref={jsonInputRef}
        type="file"
        accept="application/json"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) importProjectJSON(f);
          e.currentTarget.value = "";
        }}
      />
    </div>
  );
}

const NoSSR = dynamic(() => Promise.resolve(AppInner), { ssr: false });
export default NoSSR;