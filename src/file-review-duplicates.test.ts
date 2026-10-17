import { describe, expect, it, vi } from "vitest";
import type { App, TFile } from "obsidian";
import { comparableNote, archiveMatchingInboxNote, DUPLICATE_ARCHIVE } from "./file-review-duplicates";
const note = (location: string, body = "Body") => `---\ntitle: Note\nlocation: ${location}\ntags: []\n---\n${body}\n`;
function fixture() {
  const source = {path: "AI Team/Formatted_Notes/Note.md", extension:"md"} as TFile;
  const target = {path: "Filed/Note.md", extension:"md"} as TFile;
  const files = new Map<string, any>([[source.path,source],[target.path,target]]);
  const contents = new Map([[source,note("Inbox")],[target,note("Filed")]]);
  const renameFile = vi.fn(async (file: TFile, path: string) => {files.delete(file.path);file.path=path;files.set(path,file);});
  const app = {vault:{read: vi.fn(async (f: TFile) => contents.get(f)),getAbstractFileByPath:(p:string)=>files.get(p),getFolderByPath:(p:string)=>files.get(p)?.children ? files.get(p):null,createFolder:vi.fn(async(p:string)=>{files.set(p,{path:p,children:[]});})},fileManager:{renameFile}} as unknown as App;
  return {source,target,files,contents,renameFile,app};
}
describe("matching inbox copy archival",()=>{
 it("ignores only location, preserving body, tags and other properties",()=>{
  expect(comparableNote(note("Inbox"))).toBe(comparableNote(note("Filed")));
  expect(comparableNote(note("Inbox","Changed"))).not.toBe(comparableNote(note("Filed")));
  expect(comparableNote(note("Inbox").replace("tags: []","tags: [important]"))).not.toBe(comparableNote(note("Filed")));
  expect(comparableNote("location: body text\n")).toBe("location: body text\n");
 });
 it("archives only the inbox copy, choosing a free archive name",async()=>{
  const f=fixture();const path=f.source.path;
  f.files.set(`${DUPLICATE_ARCHIVE}/${path}`,{});
  await expect(archiveMatchingInboxNote(f.app,f.source,f.target,path)).resolves.toMatch(/Matching inbox copy archived/);
  expect(f.source.path).toBe(`${DUPLICATE_ARCHIVE}/AI Team/Formatted_Notes/Note (2).md`);
  expect(f.target.path).toBe("Filed/Note.md");expect(f.contents.get(f.target)).toBe(note("Filed"));
 });
 it("refuses different content without creating an archive",async()=>{
  const f=fixture();f.contents.set(f.target,note("Filed","Different"));
  await expect(archiveMatchingInboxNote(f.app,f.source,f.target,f.source.path)).rejects.toThrow(/content differs/);
  expect(f.renameFile).not.toHaveBeenCalled();expect(f.app.vault.createFolder).not.toHaveBeenCalled();
 });
 it("rejects a destination changed during comparison",async()=>{
  const f=fixture();let reads=0;
  vi.mocked(f.app.vault.read).mockImplementation(async(file)=>{if(++reads===4)return note("Filed","Changed");return f.contents.get(file)!;});
  await expect(archiveMatchingInboxNote(f.app,f.source,f.target,f.source.path)).rejects.toThrow(/changed during comparison/);
  expect(f.renameFile).not.toHaveBeenCalled();
 });
});
