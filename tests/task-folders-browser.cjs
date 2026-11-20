// Local regression using production navigation, renderers, vault event registration and CSS.
// PLAYWRIGHT_CORE_PATH and VCC_BROWSER_BIN can point to existing local tooling.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const esbuild = require("esbuild");
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");

const obsidianMock = `
export class App {}
export class WorkspaceLeaf {}
export class Component {}
export class ItemView {
  constructor(leaf) {
    this.app=leaf.app;
    this.leaf=leaf;
    this.contentEl=leaf.contentEl;
    this.containerEl=leaf.contentEl;
  }
  registerDomEvent(target,event,fn) { target.addEventListener(event,fn); }
  registerEvent() {}
  getState() {return {};}
  async setState() {}
}
export class MarkdownView extends ItemView {}
export class TFolder { constructor(path){this.path=path;this.name=path.split('/').pop();this.children=[];} }
export class TFile {
  constructor(path) {
    this.path=path;this.name=path.split('/').pop();this.basename=this.name.replace(/\\..+$/, '');
    this.extension=this.name.split('.').pop();
    this.stat={size:120,mtime:1000,ctime:900};
  }
}
export class Vault {}
export class FuzzySuggestModal {}
export class Notice { constructor(text) { window.notices.push(text); } }
export class PluginSettingTab {}
export class SecretComponent {}
export class Setting {}
export class Plugin {
  constructor(app) {this.app=app;}
  async loadData() { return {}; }
  async saveData() {}
  registerView() {}
  addRibbonIcon() {}
  addCommand() {}
  addSettingTab() {}
  registerEvent() {}
}
export const Platform={isMobile:location.hash==='#mobile',isDesktopApp:false};
export const MarkdownRenderer={render:async(app,text,el)=>{el.textContent=text;}};
export const setIcon=(el,name)=>{el.dataset.icon=name;};
export const normalizePath=(path)=>path;
export const parseLinktext=(path)=>({path,subpath:''});
export const requestUrl=async()=>{throw new Error('Network disabled in fixture');};
`;

const harness = `
import VaultControlCenterPlugin from './src/plugin';
import {VaultControlCenterView} from './src/view';
import {TFile,TFolder,Platform} from 'obsidian';
const create=(parent,tag,{cls,text,attr}={})=>{
  const el=document.createElement(tag);
  if (cls) el.className=cls;
  if (text) el.textContent=text;
  for(const [k,v] of Object.entries(attr||{})) el.setAttribute(k,v);
  parent.append(el);
  return el;
};
Object.assign(HTMLElement.prototype,{
  createEl(tag,opts){return create(this,tag,opts);},
  createDiv(opts){return create(this,'div',opts);},
  createSpan(opts){return create(this,'span',opts);},
  addClass(...classes){this.classList.add(...classes);},
  removeClass(...classes){this.classList.remove(...classes);},
  empty(){this.replaceChildren();},
  setText(text){this.textContent=text;},
  isShown(){return !this.hidden;},
});
document.body.classList.toggle('is-mobile',Platform.isMobile);
window.notices=[];
const entries=new Map();
const folder=path=>{const e=new TFolder(path);entries.set(path,e);return e;};
const file=path=>{const e=new TFile(path);entries.set(path,e);return e;};
const inbox='08 Tasks/Inbox/Files';
const program='02 Programs/CalWORKs/CalWORKs Tasks';
const child=program+'/2026';
const duplicate='03 Areas/Recruitment/CalWORKs Tasks';
for(const path of ['08 Tasks','08 Tasks/Inbox',inbox,'02 Programs','02 Programs/CalWORKs',program,child,duplicate,'Elsewhere/MyTasks','Elsewhere/Task','.obsidian/Secret Tasks']) folder(path);
file(inbox+'/Capture.md');
file(child+'/Plan.md');
const handlers=new Map();
const on=(event,fn)=>{if(!handlers.has(event))handlers.set(event,[]);handlers.get(event).push(fn);return {};};
const emit=(event,...args)=>{for(const cb of handlers.get(event)||[])cb(...args);};
const leaves=[];
const app={
  workspace:{on, onLayoutReady:fn=>fn(), getLeavesOfType:()=>leaves,
    getLastOpenFiles:()=>[], getActiveViewOfType:()=>null,},
  vault:{on, getFiles:()=>[...entries.values()].filter(e=>e instanceof TFile),
    getAllLoadedFiles:()=>[...entries.values()], configDir:'.obsidian',
    getMarkdownFiles:()=>[...entries.values()].filter(e=>e instanceof TFile && e.extension==="md"),
    getAbstractFileByPath:path=>entries.get(path),
    getFileByPath:path=>entries.get(path) instanceof TFile ? entries.get(path) : null,
    getFolderByPath:path=>entries.get(path) instanceof TFolder ? entries.get(path) : null,
    cachedRead:async e=>'Fixture preview of '+e.basename,
    adapter:{exists:async path=>entries.has(path),read:async()=>'',stat:async()=>null},
  },
};
const plugin=new VaultControlCenterPlugin(app);
const leaf={app,contentEl:document.querySelector('#host')};
const view=new VaultControlCenterView(leaf,plugin);
leaf.view=view;leaves.push(leaf);
(async()=>{
  await plugin.onload();
  await view.onOpen();
  window.fixture={
    create(path){emit('create',folder(path));},
    move(oldPath,newPath){
      const root=entries.get(oldPath);
      for(const [p,e] of [...entries]) if(p===oldPath||p.startsWith(oldPath+'/')){
        entries.delete(p);e.path=newPath+p.slice(oldPath.length);
        if(p===oldPath)e.name=newPath.split('/').pop();
        entries.set(e.path,e);
      }
      emit('rename',root,oldPath);
    },
    delete(path){const e=entries.get(path);entries.delete(path);emit('delete',e);},
  };
})().catch(error=>{console.error(error);setTimeout(()=>{throw error;},0);});
`;

const build = async () => (await esbuild.build({
  stdin:{ contents:harness, resolveDir:process.cwd(), loader:"ts" },
  platform:"browser", bundle:true, write:false,
  external:["electron","node:*","path","fs","child_process","os"],
  plugins:[{name:"obsidian-fixture",setup(build){
    build.onResolve({filter:/^obsidian$/},()=>({path:"obsidian",namespace:"mock"}));
    build.onLoad({filter:/.*/,namespace:"mock"},()=>({contents:obsidianMock,loader:"js"}));
  }}],
})).outputFiles[0].text;

async function main() {
  const bundle = await build();
  const browser = await chromium.launch({ executablePath: process.env.VCC_BROWSER_BIN,
    args:["--disable-background-networking","--disable-component-update","--disable-sync","--host-resolver-rules=MAP * ~NOTFOUND"] });
  try {
    for (const [width,mobile] of [[320,true],[867,true],[1050,false]]) {
      const page = await browser.newPage({viewport:{width,height:700},hasTouch:mobile});
      await page.route("**/*",route=>route.request().url().startsWith("http://vcc-task-folders.test")
        ? route.fulfill({contentType:"text/html",body:"<!doctype html><html><body><div id='host' class='view-content'></div></body></html>"})
        : route.abort());
      await page.goto(`http://vcc-task-folders.test/${mobile?"#mobile":""}`);
      page.setDefaultTimeout(5000);
      const errors=[];
      page.on("pageerror",error=>errors.push(error.message));
      await page.addStyleTag({content:readFileSync("styles.css","utf8")});
      await page.addStyleTag({content:"html,body{margin:0;height:100%;width:100%;}#host{height:100%;width:100%;}"});
      await page.addScriptTag({content:bundle});
      await page.waitForFunction(()=>Boolean(window.fixture));
      const activate=locator=>mobile?locator.tap():locator.click();
      const tabs=page.getByRole("tablist",{name:"Dashboard views"});
      const tasks=tabs.getByRole("tab",{name:"Tasks",exact:true});
      assert.deepEqual((await tabs.getByRole("tab").allTextContents()).slice(0,5),["Home","Areas","Programs","Tasks","HTML"]);
      await activate(tasks);
      assert.equal(await tasks.getAttribute("aria-selected"),"true");
      if (width===320) assert.ok(await tabs.evaluate(el=>el.scrollWidth>el.clientWidth),"the folded route strip remains horizontally scrollable");
      assert.ok((await tasks.boundingBox()).height>=44 || !mobile);
      const row=page.locator("[data-route='task-folders'] .fjg-vcc-select-row");
      if (!(await row.count())) console.error(await page.locator("body").innerText(), errors, await page.evaluate(()=>window.notices));
      assert.equal(await row.first().locator(".fjg-vcc-row-title").textContent(),"Inbox / Files");
      assert.equal(await row.count(),5);
      assert.equal(await row.filter({hasText:"CalWORKs Tasks"}).count(),2);
      assert.equal(await row.filter({hasText:"Secret Tasks"}).count(),0);
      assert.equal(await page.locator(".fjg-vcc-folder-rail").evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      if(mobile) assert.ok((await row.first().boundingBox()).height>=44);
      if (process.env.VCC_FIXTURE_OUTPUT_DIR) await page.screenshot({path:`${process.env.VCC_FIXTURE_OUTPUT_DIR}/tasks-folders-${width}.png`});
      const search=page.getByRole("searchbox",{name:"Search the current dashboard tab"});
      await search.fill("recruitment");
      assert.equal(await row.count(),1);
      assert.match(await row.first().textContent(),/03 Areas\/Recruitment/);
      await search.fill("mytasks");
      assert.equal(await row.count(),1);
      await search.fill("CalWORKs");
      await activate(row.filter({hasText:"02 Programs/CalWORKs/CalWORKs Tasks"}));
      assert.equal(await search.inputValue(),"");
      assert.equal(await page.locator(".fjg-vcc-folder-heading").textContent(),"CalWORKs Tasks");
      await activate(page.getByRole("button",{name:"Open folder 2026, 1 file"}));
      assert.equal(await page.locator(".fjg-vcc-folder-heading").textContent(),"2026");
      const plan=page.locator("[data-route='task-folders'] .fjg-vcc-row").filter({hasText:"Plan"});
      assert.equal(await plan.count(),1);
      const up=page.getByRole("button",{name:mobile?"Go back from 2026":"Go up from 2026"});
      await activate(up);
      await activate(page.getByRole("button",{name:"Back to Tasks Folders list"}));
      assert.equal(await row.first().locator(".fjg-vcc-row-title").textContent(),"Inbox / Files");
      await page.evaluate(()=>window.fixture.create("Elsewhere/New Tasks"));
      await row.filter({hasText:"Elsewhere/New Tasks"}).waitFor();
      await page.evaluate(()=>window.fixture.move("02 Programs/CalWORKs","02 Programs/CalWORKs Renamed"));
      await row.filter({hasText:"02 Programs/CalWORKs Renamed/CalWORKs Tasks"}).waitFor();
      assert.equal(await row.filter({hasText:"02 Programs/CalWORKs/CalWORKs Tasks"}).count(),0);
      await page.evaluate(()=>window.fixture.move("Elsewhere/New Tasks","Elsewhere/No longer a match"));
      await row.filter({hasText:"Elsewhere/New Tasks"}).waitFor({state:"detached"});
      await page.evaluate(()=>window.fixture.delete("08 Tasks/Inbox/Files"));
      await row.filter({hasText:"Inbox / Files"}).waitFor({state:"detached"});
      const review=tabs.getByRole("tab",{name:"File Review",exact:true});
      await activate(review);
      await page.locator(".fjg-vcc-file-review").waitFor();
      assert.deepEqual(errors,[]);
      console.log(`PASS Tasks Folders at ${width}px ${mobile?"mobile":"desktop"}: tab, inbox first, search, nested navigation, live create/rename/move/delete and File Review`);
      await page.close();
    }
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
