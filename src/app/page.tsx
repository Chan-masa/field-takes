"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Pencil, Trash2, Filter, Plus, Minus } from "lucide-react";

type TakeStatus = "OK" | "NG" | "KEEP";
type Hand = "right" | "left";

interface TakeRow {
  id: string;
  createdAt: string;
  updatedAt: string;
  fileNo: string;
  sceneNo: string;
  cutNo: string;
  takeNo: string;
  status: TakeStatus;
  mics: string[];
  note?: string;
}

interface Project {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  rows: TakeRow[];
}

const PROJECTS_KEY = "field_projects_v1";
const CURRENT_PROJECT_KEY = "field_current_project_v1";

function uuid(): string { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function todayPrefix(): string { const d = new Date(); return `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; }
function nextFileNo(rows: TakeRow[]): string {
  const prefix = todayPrefix();
  const todayRows = rows.filter(r => r.fileNo && r.fileNo.startsWith(prefix));
  if (!todayRows.length) return `${prefix}_001`;
  const nums = todayRows.map(r => parseInt((r.fileNo.split("_")[1] || "0").replace(/\\D/g, ""), 10)).filter(n => !isNaN(n));
  const max = nums.length ? Math.max(...nums) : 0;
  return `${prefix}_${String(max + 1).padStart(3, "0")}`;
}
function formatDT(iso: string): string { try { return new Date(iso).toLocaleString(); } catch { return iso; } }

function toCSV(rows: TakeRow[]): string {
  const headers = ["createdAt","updatedAt","fileNo","sceneNo","cutNo","takeNo","status", ...Array.from({length:8},(_,i)=>`mic${i+1}`),"note"];
  const esc = (s:unknown)=>(s??"").toString().replaceAll('"','""').replaceAll("\\n"," ");
  return [headers.join(",")].concat(rows.map(r=>{
    const arr = [r.createdAt,r.updatedAt,r.fileNo,r.sceneNo,r.cutNo,r.takeNo,r.status, ...(r.mics||[]).concat(Array(8).fill("")).slice(0,8), r.note||""];
    return arr.map(v=>`"${esc(v)}"`).join(",");
  })).join("\\n");
}
function fromCSV(csv:string): TakeRow[] {
  const lines = csv.split(/\\r?\\n/).filter(l=>l.trim().length>0);
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.replace(/^"|"$/g, ""));
  return lines.slice(1).map(line => {
    const cols: string[] = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (inQ) { if (ch === '"' && line[i+1] === '"') { cur += '"'; i++; } else if (ch === '"') { inQ = false; } else { cur += ch; } }
      else { if (ch === '"') inQ = true; else if (ch === ",") { cols.push(cur); cur = ""; } else { cur += ch; } }
    }
    cols.push(cur);
    const rec: Record<string, string> = {}; headers.forEach((h,idx)=>{ rec[h] = cols[idx] ?? ""; });
    const now = new Date().toISOString();
    const mics = Array.from({length:8},(_,i)=> rec[`mic${i+1}`] || "");
    return { id: uuid(), createdAt: rec.createdAt || now, updatedAt: now, fileNo: rec.fileNo || "", sceneNo: rec.sceneNo || "", cutNo: rec.cutNo || "", takeNo: rec.takeNo || "", status: (rec.status as TakeStatus) || "KEEP", mics, note: rec.note || "" };
  });
}

const StatusBadge:React.FC<{s:TakeStatus}> = ({s})=>{ const tone = s==="OK" ? "bg-green-600" : s==="NG" ? "bg-red-600" : "bg-amber-500"; return <Badge className={`text-white ${tone}`}>{s}</Badge>; };

const SUFFIXES = ["", "a","b","c","d","e","f","g"] as const;
type Suffix = typeof SUFFIXES[number];
function splitNumAndSuffix(value:string):{num:number; suffix:Suffix}{ const m = String(value||"").match(/^(\\d+)([a-g]?)$/i); if(!m) return {num: parseInt(value||"0",10) || 0, suffix: ""}; return {num: parseInt(m[1],10)||0, suffix: (m[2]||"") as Suffix}; }
function combine(num:number, suffix:Suffix){ return `${Math.max(0,num)}${suffix}`; }

function Stepper({label,value,onChange,variant,fast=0}:{label:string; value:string; onChange:(v:string)=>void; variant:"scene"|"cut"|"take"; fast?:number}){
  const {num}=splitNumAndSuffix(value);
  const clamp=(v:number)=>Math.max(0,v);
  const palette=variant==="scene"?{btn:"bg-emerald-100 hover:bg-emerald-200 border-emerald-200",box:"bg-emerald-50 border-emerald-200",text:"text-emerald-900"}:variant==="cut"?{btn:"bg-sky-100 hover:bg-sky-200 border-sky-200",box:"bg-sky-50 border-sky-200",text:"text-sky-900"}:{btn:"bg-rose-100 hover:bg-rose-200 border-rose-200",box:"bg-rose-50 border-rose-200",text:"text-rose-900"};
  return (<div className="space-y-1"><Label className={`text-sm font-semibold ${palette.text}`}>{label}</Label><div className="flex gap-2 items-center">{fast>0&&<Button type="button" variant="outline" className={`h-10 px-3 border ${palette.btn}`} onClick={()=>onChange(String(clamp(num-fast)))}>−{fast}</Button>}<Button type="button" variant="outline" className={`h-12 w-12 border ${palette.btn}`} onClick={()=>onChange(String(clamp(num-1)))}><Minus/></Button><div className={`h-12 flex-1 grid place-items-center text-xl border rounded-xl select-none ${palette.box} ${palette.text}`}>{num}</div><Button type="button" variant="outline" className={`h-12 w-12 border ${palette.btn}`} onClick={()=>onChange(String(clamp(num+1)))}><Plus/></Button>{fast>0&&<Button type="button" variant="outline" className={`h-10 px-3 border ${palette.btn}`} onClick={()=>onChange(String(clamp(num+fast)))}>+{fast}</Button>}</div></div>);
}
function SuffixRow({label,value,onChange}:{label:string; value:Suffix; onChange:(s:Suffix)=>void}){
  return (<div className="flex items-center gap-2"><span className="text-xs text-slate-600">{label}</span><div className="flex gap-1">{SUFFIXES.map(s=>(<Button key={s||"none"} type="button" variant="outline" className={`h-8 px-2 text-xs ${s===""?"bg-slate-50":"bg-violet-50"} ${value===s?"ring-2 ring-violet-300":""}`} onClick={()=>onChange(s as Suffix)}>{s===""?"":s}</Button>))}</div></div>);
}
function Collapsible({ title, right, children, defaultOpen=false }:{ title:string; right?:string; children:React.ReactNode; defaultOpen?:boolean }){
  const [open,setOpen]=React.useState(defaultOpen);
  return (<div className="rounded-xl border bg-white/90"><button type="button" className="w-full flex items-center justify-between p-2 text-left" onClick={()=>setOpen(o=>!o)}><span className="font-semibold text-slate-800">{title}</span><span className="text-sm text-slate-600">{right} {open?'▾':'▸'}</span></button>{open && <div className="p-3 pt-0">{children}</div>}</div>);
}

interface ProjectMeta { id: string; name: string; createdAt: string; updatedAt: string; rowsLen: number; }
function loadProjects(): Project[] { try { const raw = localStorage.getItem(PROJECTS_KEY); if (!raw) return []; const p = JSON.parse(raw) as Project[]; return Array.isArray(p)?p:[]; } catch { return []; } }
function saveProjects(ps: Project[]) { try { localStorage.setItem(PROJECTS_KEY, JSON.stringify(ps)); } catch {} }
function getCurrentProjectId(): string | null { try { return localStorage.getItem(CURRENT_PROJECT_KEY); } catch { return null; } }
function setCurrentProjectId(id: string) { try { localStorage.setItem(CURRENT_PROJECT_KEY, id); } catch {} }

function AppInner(){
  const [projects,setProjects]=useState<Project[]>([]);
  const [currentId,setCurrentId]=useState<string|undefined>(undefined);
  const [rows,setRows]=useState<TakeRow[]>([]);
  const [hand,setHand]=useState<Hand>("right");
  const [query,setQuery]=useState<string>(""); 
  const [statusFilter,setStatusFilter]=useState<"ALL"|TakeStatus>("ALL");
  const [needsPicker,setNeedsPicker]=useState<boolean>(true);
  const csvInputRef=useRef<HTMLInputElement|null>(null);
  const jsonInputRef=useRef<HTMLInputElement|null>(null);

  const [draft,setDraft]=useState({ fileNo:"", sceneNum:0, sceneSuffix:"" as Suffix, cutNum:0, cutSuffix:"" as Suffix, takeNum:1, status:"KEEP" as TakeStatus, mics:["","","","","","","",""], note:"" });

  useEffect(()=>{
    const ps = loadProjects(); setProjects(ps);
    const savedId = getCurrentProjectId();
    if (ps.length === 0) {
      const id = uuid();
      const np: Project = { id, name: "無題プロジェクト", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rows: [] };
      const all = [np]; saveProjects(all); setProjects(all); setCurrentProjectId(id); setCurrentId(id); setNeedsPicker(true);
    } else {
      if (savedId && ps.find(p=>p.id===savedId)) { setCurrentId(savedId); setNeedsPicker(false); setRows(ps.find(p=>p.id===savedId)!.rows); }
      else { setNeedsPicker(true); }
    }
    try { const h=(localStorage.getItem("field_handedness_v1") as Hand)||"right"; setHand(h);} catch {}
  },[]);

  useEffect(()=>{
    if (!currentId) return;
    setCurrentProjectId(currentId);
    setProjects(prev => {
      const next = prev.map(p => p.id===currentId ? {...p, rows, updatedAt: new Date().toISOString()} : p);
      saveProjects(next);
      return next;
    });
  },[rows, currentId]);

  useEffect(()=>{ if(!draft.fileNo) setDraft(d=>({...d, fileNo: nextFileNo(rows)})); },[rows]);

  const filtered = useMemo(()=> {
    const q = query.toLowerCase();
    return rows.filter(r=>{
      const merged = [r.fileNo,r.sceneNo,r.cutNo,r.takeNo,r.status,...r.mics,r.note].join(" ").toLowerCase();
      return (q==="" || merged.includes(q)) && (statusFilter==="ALL" || r.status===statusFilter);
    });
  },[rows,query,statusFilter]);

  const resetCounters = () => {
  setDraft(d => ({
    ...d,
    sceneNum: 1,
    cutNum: 1,
    takeNum: 1
  }));
};


  function setSceneNum(n:number){ setDraft(d=>({...d, sceneNum:n, cutNum:1, cutSuffix:"", takeNum:1 })); }
  function setCutNum(n:number){ setDraft(d=>({...d, cutNum:n, takeNum:1 })); }

  function addRow(){
    const sceneStr = combine(draft.sceneNum, draft.sceneSuffix as Suffix);
    const cutStr   = combine(draft.cutNum,   draft.cutSuffix   as Suffix);
    const takeStr  = String(draft.takeNum);
    if(!draft.fileNo || sceneStr==="" || cutStr==="" || takeStr==="") return alert("必須:ファイルNo / S# / C# / T#");
    const row: TakeRow = { id: uuid(), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), fileNo: draft.fileNo, sceneNo: sceneStr, cutNo: cutStr, takeNo: takeStr, status: draft.status, mics: draft.mics, note: draft.note };
    setRows(p=>[...p,row]);
    setDraft(d=>({...d, fileNo: nextFileNo([...rows,row]), takeNum: d.takeNum + 1 }));
  }
  function delRow(id:string){ if(!confirm("削除しますか？")) return; setRows(p=>p.filter(r=>r.id!==id)); }
  function editRow(id:string){
    const r=rows.find(x=>x.id===id); if(!r) return;
    const sc = splitNumAndSuffix(r.sceneNo); const cu = splitNumAndSuffix(r.cutNo);
    setDraft(d=>({ ...d, fileNo:r.fileNo, sceneNum: sc.num, sceneSuffix: sc.suffix, cutNum: cu.num, cutSuffix: cu.suffix, takeNum: parseInt(r.takeNo||"1",10)||1, status: r.status, mics: r.mics||Array(8).fill(""), note: r.note||"" }));
    setRows(p=>p.filter(x=>x.id!==id));
  }

  function exportCSV(){
    const blob = new Blob(["\ufeff"+toCSV(rows)], {type:"text/csv;charset=utf-8;"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${projectName()||"project"}-takes.csv`; a.click(); URL.revokeObjectURL(url);
  }
  function importCSV(file:File){
    const r = new FileReader();
    r.onload = e => {
      const t = String(e.target?.result || "");
      const incoming = fromCSV(t);
      if(!incoming.length) return alert("有効な行なし");
      setRows(p=>[...p, ...incoming]);
    };
    r.readAsText(file);
  }

  function projectName(): string { const p = projects.find(x=>x.id===currentId); return p?.name || ""; }
  function openPicker(){ setNeedsPicker(true); }
  function createProject(initialName?:string){
    const name = (initialName ?? prompt("プロジェクト名", "新規プロジェクト")) || "新規プロジェクト";
    const id = uuid();
    const np: Project = { id, name, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), rows: [] };
    const all = [np, ...projects]; saveProjects(all); setProjects(all); setCurrentId(id); setRows([]); setNeedsPicker(false);
  }
  function openProject(id:string){ const p = projects.find(x=>x.id===id); if (!p) return; setCurrentId(id); setRows(p.rows); setNeedsPicker(false); }
  function renameProject(){
    if(!currentId) return;
    const p = projects.find(x=>x.id===currentId); if(!p) return;
    const name = prompt("新しい名前", p.name) || p.name;
    const next = projects.map(x=>x.id===currentId?{...x, name, updatedAt:new Date().toISOString()}:x);
    saveProjects(next); setProjects(next);
  }
  function duplicateProject(){
    if(!currentId) return;
    const p = projects.find(x=>x.id===currentId); if(!p) return;
    const id = uuid();
    const name = p.name + " コピー";
    const np: Project = { id, name, createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), rows: JSON.parse(JSON.stringify(p.rows)) };
    const all = [np, ...projects];
    saveProjects(all); setProjects(all); setCurrentId(id); setRows(np.rows); setNeedsPicker(false);
  }
  function deleteProject(){
    if(!currentId) return;
    const p = projects.find(x=>x.id===currentId); if(!p) return;
    if(!confirm(`「${p.name}」を削除します。元に戻せません。`)) return;
    const rest = projects.filter(x=>x.id!==currentId);
    saveProjects(rest); setProjects(rest);
    if (rest.length) { setCurrentId(rest[0].id); setRows(rest[0].rows); }
    else {
      const id = uuid();
      const np: Project = { id, name: "無題プロジェクト", createdAt:new Date().toISOString(), updatedAt:new Date().toISOString(), rows: [] };
      saveProjects([np]); setProjects([np]); setCurrentId(id); setRows([]);
    }
  }
  function exportProjectJSON(){
    const p = projects.find(x=>x.id===currentId); if(!p) return;
    const blob = new Blob([JSON.stringify(p,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href=url; a.download = `${p.name.replace(/\\s+/g,"_")}.json`; a.click(); URL.revokeObjectURL(url);
  }
  function importProjectJSON(file: File){
    const r = new FileReader();
    r.onload = e => {
      try {
        const obj = JSON.parse(String(e.target?.result||""));
        if (!obj || typeof obj !== "object") throw new Error("invalid");
        const id = uuid();
        const p: Project = { id, name: (obj.name && typeof obj.name==="string") ? obj.name : "インポート", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), rows: Array.isArray(obj.rows) ? obj.rows as TakeRow[] : [] };
        const all = [p, ...projects];
        saveProjects(all); setProjects(all); setCurrentId(id); setRows(p.rows); setNeedsPicker(false);
      } catch { alert("JSONが不正です"); }
    };
    r.readAsText(file);
  }

  useEffect(()=>{ try{ localStorage.setItem("field_handedness_v1", hand);} catch{} },[hand]);

  const sceneDisplay = combine(draft.sceneNum, draft.sceneSuffix as Suffix);
  const cutDisplay   = combine(draft.cutNum,   draft.cutSuffix   as Suffix);
  const gridCols = hand==="right" ? "md:grid-cols-[minmax(0,1fr)_420px]" : "md:grid-cols-[420px_minmax(0,1fr)]";
  const listColStart   = hand==="right" ? "md:col-start-1" : "md:col-start-2";
  const panelColStart  = hand==="right" ? "md:col-start-2" : "md:col-start-1";

  return (
    <TooltipProvider>
      <div className="p-2 md:p-4 max-w-7xl mx-auto">
        <div className="flex items-center gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xs text-slate-500">プロジェクト</span>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={()=>setNeedsPicker(true)} className="h-8 px-3">{(projects.find(x=>x.id===currentId)?.name)||"未選択"}</Button>
              <Button variant="outline" onClick={()=>createProject()} className="h-8 px-3">新規作成</Button>
              <Button variant="outline" onClick={renameProject} className="h-8 px-3">名前変更</Button>
              <Button variant="outline" onClick={duplicateProject} className="h-8 px-3">複製</Button>
              <Button variant="outline" onClick={exportProjectJSON} className="h-8 px-3">JSON出力</Button>
              <Button variant="outline" onClick={()=>jsonInputRef.current?.click()} className="h-8 px-3">JSON取込</Button>
              <input ref={jsonInputRef} type="file" accept="application/json" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)importProjectJSON(f); e.currentTarget.value="";}}/>
              <Button variant="destructive" onClick={deleteProject} className="h-8 px-3">削除</Button>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <span className="text-xs text-slate-500">利き手</span>
            <div className="rounded-lg border overflow-hidden">
              <button className={`px-3 py-1 text-sm ${hand==="left"?"bg-slate-900 text-white":"bg-white"}`} onClick={()=>setHand("left")}>左手</button>
              <button className={`px-3 py-1 text-sm ${hand==="right"?"bg-slate-900 text-white":"bg-white"}`} onClick={()=>setHand("right")}>右手</button>
            </div>
          </div>
        </div>

        <div className={`grid ${gridCols} items-start gap-3 md:gap-5`}>
          <div className={`${listColStart} md:row-start-1`}>
            <Card>
              <CardContent className="space-y-2 pt-4">
                <div className="flex gap-2 items-center">
                  <Input placeholder="キーワード検索" value={query} onChange={e=>setQuery(e.target.value)} className="bg-white/90"/>
                  <Filter className="w-4 h-4"/>
                  <Select value={statusFilter} onValueChange={(v)=>setStatusFilter(v as "ALL"|"OK"|"NG"|"KEEP")}>
                    <SelectTrigger className="w-[120px] h-9"><SelectValue placeholder="ALL"/></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">ALL</SelectItem>
                      <SelectItem value="OK">OK</SelectItem>
                      <SelectItem value="NG">NG</SelectItem>
                      <SelectItem value="KEEP">KEEP</SelectItem>
                    </SelectContent>
                  </Select>
                  <div className="ml-auto hidden md:flex gap-2">
                    <Button variant="outline" onClick={exportCSV} className="h-9 bg-indigo-50 border-indigo-200">CSV出力</Button>
                    <Button variant="outline" onClick={()=>csvInputRef.current?.click()} className="h-9 bg-teal-50 border-teal-200">CSV取込</Button>
                    <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)importCSV(f);e.currentTarget.value="";}}/>
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="min-w-full border text-sm">
                    <thead className="bg-neutral-50">
                      <tr>
                        {["作成","ファイル","S#","C#","T#","状態", ...Array.from({length:8},(_,i)=>`CH${i+1}`),"備考","操作"].map(h=>(
                          <th key={h} className="px-2 py-1 border text-left">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map(r=>(
                        <tr key={r.id} className="odd:bg-white even:bg-neutral-50">
                          <td className="px-2 py-1 border">{formatDT(r.createdAt)}</td>
                          <td className="px-2 py-1 border">{r.fileNo}</td>
                          <td className="px-2 py-1 border">{r.sceneNo}</td>
                          <td className="px-2 py-1 border">{r.cutNo}</td>
                          <td className="px-2 py-1 border">{r.takeNo}</td>
                          <td className="px-2 py-1 border"><StatusBadge s={r.status}/></td>
                          {r.mics.map((m,i)=>(<td key={i} className="px-2 py-1 border">{m}</td>))}
                          <td className="px-2 py-1 border max-w-[260px] truncate" title={r.note}>{r.note}</td>
                          <td className="px-2 py-1 border">
                            <div className="flex gap-1">
                              <Button size="icon" variant="ghost" onClick={()=>editRow(r.id)}><Pencil className="w-4 h-4"/></Button>
                              <Button size="icon" variant="ghost" onClick={()=>delRow(r.id)}><Trash2 className="w-4 h-4"/></Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {filtered.length===0 && (<tr><td colSpan={20} className="text-center py-8 text-neutral-500">一致するテイクはありません</td></tr>)}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          </div>

          <aside className={`${panelColStart} md:row-start-1 md:self-start md:sticky md:top-2 h-fit`}>
            <Card className="shadow-md">
              <CardContent className="space-y-3 pt-3">
                <div className="grid grid-cols-2 gap-2 items-end">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-slate-700 text-sm">ファイル番号*</Label>
                    <Input autoComplete="off" value={draft.fileNo} onChange={e=>setDraft({...draft,fileNo:e.target.value})} className="bg-white/90"/>
                  </div>
                  <div className="col-span-2">
                    <Stepper label="S#" value={sceneDisplay} onChange={v=>{ const {num}=splitNumAndSuffix(v); setSceneNum(num); }} variant="scene" fast={5}/>
                    <div className="mt-1"><SuffixRow label="" value={draft.sceneSuffix as Suffix} onChange={(s)=>setDraft(d=>({...d, sceneSuffix:s as Suffix}))}/></div>
                  </div>
                  <div className="col-span-2">
                    <Stepper label="C#" value={cutDisplay} onChange={v=>{ const {num}=splitNumAndSuffix(v); setCutNum(num); }} variant="cut"/>
                    <div className="mt-1"><SuffixRow label="" value={draft.cutSuffix as Suffix} onChange={(s)=>setDraft(d=>({...d, cutSuffix:s as Suffix}))}/></div>
                  </div>
                  <div className="col-span-2">
                    <Stepper label="T#" value={String(draft.takeNum)} onChange={v=>setDraft(d=>({...d, takeNum: Math.max(1, parseInt(v||"1",10)||1)}))} variant="take"/>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button className="h-10 bg-emerald-200 hover:bg-emerald-300 text-emerald-900 border border-emerald-300" onClick={()=>setDraft({...draft,status:"OK"})}>OK</Button>
                  <Button className="h-10 bg-rose-200 hover:bg-rose-300 text-rose-900 border border-rose-300" onClick={()=>setDraft({...draft,status:"NG"})}>NG</Button>
                  <Button className="h-10 bg-amber-200 hover:bg-amber-300 text-amber-900 border border-amber-300" onClick={()=>setDraft({...draft,status:"KEEP"})}>KEEP</Button>
                  <div className="flex-1" />
                 <Button
  className="h-10 px-4 bg-red-600 text-white font-bold hover:bg-red-700"
  onClick={resetCounters}
>
  リセット
</Button>

                  <Button onClick={addRow} className="h-10 px-5 rounded-2xl bg-indigo-200 hover:bg-indigo-300 text-indigo-900 border border-indigo-300">追加</Button>
                </div>

                <Collapsible title="チャンネル（CH1〜CH8）" right={`${draft.mics.filter(m=>m&&m.trim()).length}/8 設定済み`} defaultOpen={false}>
                  <div className="grid grid-cols-2 gap-2">
                    {draft.mics.map((m,i)=>(
                      <div key={i} className="space-y-1">
                        <Label className="text-xs text-slate-600">CH{i+1}</Label>
                        <Input autoComplete="off" value={m} onChange={e=>{const arr=[...draft.mics];arr[i]=e.target.value;setDraft({...draft,mics:arr});}} className="bg-white/90"/>
                      </div>
                    ))}
                  </div>
                </Collapsible>

                <Collapsible title="備考" right={(draft.note?.length||0)>0?`${draft.note!.length} 文字`:"未入力"} defaultOpen={false}>
                  <Textarea value={draft.note||""} onChange={e=>setDraft({...draft,note:e.target.value})} className="bg-white/90"/>
                </Collapsible>

                <div className="mt-2 md:hidden flex gap-2">
                  <Button variant="outline" onClick={exportCSV} className="bg-indigo-50 border-indigo-200 w-full">CSV出力</Button>
                  <Button variant="outline" onClick={()=>csvInputRef.current?.click()} className="bg-teal-50 border-teal-200 w-full">CSV取込</Button>
                  <input ref={csvInputRef} type="file" accept=".csv,text/csv" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)importCSV(f);e.currentTarget.value="";}}/>
                </div>

              </CardContent>
            </Card>
          </aside>
        </div>

        {needsPicker && (
          <div className="fixed inset-0 bg-black/40 grid place-items-center z-50">
            <div className="w-[min(92vw,560px)] rounded-2xl bg-white shadow-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold">プロジェクトを選択</h2>
                <Button variant="outline" onClick={()=>createProject()} className="h-9">新規作成</Button>
              </div>
              <div className="max-h-[50vh] overflow-auto border rounded-lg">
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="text-left px-2 py-1 border">名前</th>
                      <th className="text-left px-2 py-1 border">作成</th>
                      <th className="text-left px-2 py-1 border">更新</th>
                      <th className="text-left px-2 py-1 border">行数</th>
                      <th className="text-left px-2 py-1 border">開く</th>
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map(p=>(
                      <tr key={p.id} className="odd:bg-white even:bg-neutral-50">
                        <td className="px-2 py-1 border">{p.name}</td>
                        <td className="px-2 py-1 border">{formatDT(p.createdAt)}</td>
                        <td className="px-2 py-1 border">{formatDT(p.updatedAt)}</td>
                        <td className="px-2 py-1 border">{p.rows.length}</td>
                        <td className="px-2 py-1 border"><Button size="sm" onClick={()=>openProject(p.id)}>開く</Button></td>
                      </tr>
                    ))}
                    {projects.length===0 && <tr><td colSpan={5} className="text-center py-6 text-neutral-500">プロジェクトがありません</td></tr>}
                  </tbody>
                </table>
              </div>
              <div className="flex justify-end gap-2">
                <Button onClick={()=>createProject()} className="h-9">新規作成</Button>
                <Button variant="outline" onClick={()=>{ setNeedsPicker(false); }} className="h-9">閉じる</Button>
              </div>
            </div>
          </div>
        )}
      </div>
    </TooltipProvider>
  );
}

const NoSSR = dynamic(() => Promise.resolve(AppInner), { ssr: false });
export default NoSSR;
