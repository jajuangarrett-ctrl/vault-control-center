// Local regression using production navigation, renderers, vault event registration and CSS.
// PLAYWRIGHT_CORE_PATH and VCC_BROWSER_BIN can point to existing local tooling.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const esbuild = require("esbuild");
const { resolve } = require("node:path");
const duoSource = process.env.VCC_DUO_SOURCE;
const { chromium } = require(process.env.PLAYWRIGHT_CORE_PATH || "playwright-core");

const obsidianMock = `
export class App {}
export class WorkspaceLeaf {}
export class Component {
  unload() {}
  registerDomEvent(target,event,fn){target.addEventListener(event,fn);}
}
export class ItemView {
  constructor(leaf) {
    this.app=leaf.app;
    this.leaf=leaf;
    this.contentEl=leaf.contentEl;
    this.containerEl=leaf.contentEl;
  }
  registerDomEvent(target,event,fn) { target.addEventListener(event,fn); }
  registerEvent() {}
  addChild(component){return component;}
  removeChild() {}
  getState() {return {};}
  async setState() {}
}
export class MarkdownView extends ItemView {}
export class FileView extends ItemView {}
export class WorkspaceMobileDrawer { collapsed=true; collapse(){this.collapsed=true;} }
export class Modal {
 constructor(app){this.app=app;this.containerEl=document.createElement('div');this.containerEl.className='modal-container';
 this.modalEl=this.containerEl.createDiv({cls:'modal'});this.titleEl=this.modalEl.createEl('h2');this.contentEl=this.modalEl.createDiv();}
 open(){document.body.append(this.containerEl);this.onOpen?.();}
 close(){this.containerEl.remove();this.onClose?.();}
}
export class TFolder { constructor(path){this.path=path;this.name=path.split('/').pop();this.children=[];} isRoot(){return this.path==='/';} }
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
${duoSource ? `import { VaultVoiceModal as RealDuoVoice } from ${JSON.stringify(resolve(duoSource, "src/live/modal.ts"))};` : ""}
import VaultControlCenterPlugin from './src/plugin';
import {VaultControlCenterView} from './src/view';
import {TFile,TFolder,Platform, WorkspaceMobileDrawer} from 'obsidian';
const duoVoiceClass = ${duoSource ? "RealDuoVoice" : "undefined"};
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
const commandInvocations=[];
const enabledVoiceProviders=new Set();
const providerVersions=new Map();
const voiceLaunches=[],revealInvocations=[];
let commandFailure='', realDuoVoice, pendingReveal, delayNativeReveal=false;
let useRealDuo = false;

const entries=new Map();
const folder=path=>{
  const e=new TFolder(path);
  Object.defineProperty(e,'children',{get:()=>[...entries.values()].filter(item=>item!==e && item.path.slice(0,Math.max(0,item.path.lastIndexOf('/'))) === (e.isRoot()?'':e.path))});
  entries.set(path,e);return e;
};
const file=path=>{const e=new TFile(path);entries.set(path,e);return e;};
const inbox='08 Tasks/Inbox/Files';
const program='02 Programs/CalWORKs/CalWORKs Tasks';
const child=program+'/2026';
const taskContainer='03 Areas/Operations/Operations Tasks';
const event=taskContainer+'/Spring Workshop Tasks 2030';
const eventFiles=event+'/Files';
const subtasks=eventFiles+'/Subtasks';
const duplicate='03 Areas/Recruitment/CalWORKs Tasks';
for(const path of ['08 Tasks','08 Tasks/Inbox',inbox,'08 Tasks/Inbox/New Tasks','08 Tasks/Archive/Older Tasks','Subtasks',event,eventFiles,subtasks,taskContainer,'02 Programs','02 Programs/CalWORKs',program,child,duplicate,'Elsewhere/MyTasks','Elsewhere/Task','.obsidian/Secret Tasks']) folder(path);
const liveTasks='02 Programs/Example/Outreach/Tasks';
const otherTasks='02 Programs/Example/Outreach Tasks';
const oldTasks='Artifacts/Deprecated/Archive/Retired/Tasks';
const stagedTasks='Artifacts/Tool/Migration/2030-06-01/staging/08 Tasks';
for(const path of [liveTasks,otherTasks,oldTasks,stagedTasks,stagedTasks+'/Inbox/Files',stagedTasks+'/Copied Tasks','Copies/Example Vault/08 tasks','Copies/Example Vault/08 tasks/Other Tasks']) folder(path);
file(liveTasks+'/Active work.md');
file(otherTasks+'/Different work.md');
file(oldTasks+'/Retired work.md');
file(inbox+'/Capture.md');
file(child+'/Plan.md');
file(subtasks+'/Prepare slides.md');
file(eventFiles+'/Parent file.md');
const fixtureRoot=folder('/');
for(const path of ['00 Inbox','01 Daily Notes','03 Areas','Artifacts','Artifacts/Project 11','Artifacts/Project 2','Wiki','tmp','Empty','Credentials','Users','copilot','+','Artifacts/.private']) folder(path);
file('Root note.md');
file('api_keys.txt');
file('Artifacts/Project 2/Report.txt');
file('Artifacts/Project 2/Attachment.zip');
file('Artifacts/.private/Hidden.txt');
const handlers=new Map();
const on=(event,fn)=>{if(!handlers.has(event))handlers.set(event,[]);handlers.get(event).push(fn);return {};};
const emit=(event,...args)=>{for(const cb of handlers.get(event)||[])cb(...args);};
const leaves=[];
const nativeRoot={};
const nativeCanvas=document.querySelector('#native-note');
const noteLeaf=path=>({getRoot:()=>nativeRoot,getViewState:()=>({type:'markdown',state:{file:path}})});
const nativeNote=noteLeaf('Root note.md');
const differentNote=noteLeaf('Different fixture.md');
const workspace={
  on,onLayoutReady:fn=>fn(),rootSplit:nativeRoot,containerEl:document.querySelector('#workspace'),
  leftSplit:new WorkspaceMobileDrawer(),rightSplit:new WorkspaceMobileDrawer(),
  getLeavesOfType:type=>leaves.filter(leaf=>leaf.getViewState().type===type),
  iterateRootLeaves:visit=>leaves.filter(leaf=>leaf.getRoot()===nativeRoot).forEach(visit),
  getLastOpenFiles:()=>{throw Error('Talk to Vault must not use recent history to pick a note');},
  getActiveViewOfType:()=>null,
  getActiveFile:()=>entries.get(workspace.activeLeaf?.getViewState().state?.file),
  getLeaf:()=>{throw Error('Talk to Vault must not create a new native leaf');},
  async revealLeaf(leaf){
    revealInvocations.push(leaf.getViewState().state?.file ?? 'home');
    if(delayNativeReveal && leaf===nativeNote){
      delayNativeReveal=false;
      await new Promise(resolve=>{pendingReveal=resolve;});
      pendingReveal=undefined;
      return;
    }
    workspace.setActiveLeaf(leaf,{focus:false});
  },
  setActiveLeaf(leaf,options){
    if(options?.focus)throw Error('Talk to Vault must not force editor focus');
    workspace.activeLeaf=leaf;
    const path=leaf.getViewState().state?.file;
    document.querySelector('#host').hidden=!!path;
    nativeCanvas.hidden=!path;
    nativeCanvas.textContent=path||'';
    emit('active-leaf-change',leaf);
  },
};
const app={
  commands:{commands:{},executeCommandById(id){
    commandInvocations.push(id);
    if(id===commandFailure)throw new Error('Provider launch error');
    if(!enabledVoiceProviders.has(id))return false;
    voiceLaunches.push({id,active:workspace.activeLeaf?.getViewState().state?.file || 'home'});
    if(useRealDuo && duoVoiceClass && id==='fjg-file-focus-duo:talk-to-vault'){
      const provider={
        settings:{liveApiKey:'',liveBackendModel:'fixture'},
        resolveVoiceApiKey:()=>{throw Error('Opening Talk to Vault must not read credentials');}
      };
      realDuoVoice=new duoVoiceClass(app,provider,{folder:'',note:''},()=>{realDuoVoice=undefined;});
      realDuoVoice.openResponsive();
    }
    return true;
  }},
  plugins:{getPlugin(id){return providerVersions.has(id)?{manifest:{version:providerVersions.get(id)}}:null;}},
  workspace,
  vault:{on,getName:()=> 'Synthetic vault', getRoot:()=>fixtureRoot, getFiles:()=>[...entries.values()].filter(e=>e instanceof TFile),
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
const leaf={
  app,contentEl:document.querySelector('#host'),getRoot:()=>nativeRoot,
  getViewState:()=>({type:leaf.view.getViewType(),state:{}})
};
const view=new VaultControlCenterView(leaf,plugin);
leaf.view=view;leaves.push(leaf,nativeNote,differentNote);workspace.activeLeaf=leaf;
(async()=>{
  await plugin.onload();
  await view.onOpen();
  window.fixture={
    create(path){emit('create',folder(path));},
    voiceProviders(ids,failure='',versions={}){
      enabledVoiceProviders.clear();ids.forEach(id=>enabledVoiceProviders.add(id));
      app.commands.commands=Object.fromEntries(ids.map(id=>[id,{}]));
      providerVersions.clear();Object.entries(versions).forEach(([id,version])=>providerVersions.set(id,version));
      commandFailure=failure;commandInvocations.length=0;window.notices.length=0;
      voiceLaunches.length=0;revealInvocations.length=0;useRealDuo=false;
    },
    voiceResult(){return {calls:[...commandInvocations], notices:[...window.notices]};},
    voiceHandoff(){return {launches:[...voiceLaunches],reveals:[...revealInvocations],active:workspace.activeLeaf?.getViewState().state?.file || 'home'};},
    async visitPriorNoteThenHome(){workspace.setActiveLeaf(nativeNote,{focus:false});await plugin.openDashboard();revealInvocations.length=0;},
    returnHome(){workspace.setActiveLeaf(leaf,{focus:false});},
    visitOther(){workspace.setActiveLeaf(differentNote,{focus:false});},
    delayVoiceReveal(){delayNativeReveal=true;},
    hasPendingReveal(){return Boolean(pendingReveal);},
    finishReveal(){pendingReveal?.();},
    narrowVoiceRoot(width){document.querySelector('.workspace-split').style.maxWidth=width?width+'px':'';},
    enableRealDuo(){useRealDuo=true;},
    restoreOldTaskSelection(){return view.setState({route:'task-folders',selectedTaskFolderPath:subtasks,selectedTaskSubfolderPath:subtasks},{});},
    selectedTaskPath(){return view.getState().selectedTaskSubfolderPath;},
    setAllFilesFolder(path){return view.setState({route:'all-files',allFilesFolderPath:path},{});},
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
    for (const [width,mobile] of [[320,true],[386,true],[867,true],[1050,false]]) {
      const page = await browser.newPage({viewport:{width,height:700},hasTouch:mobile});
      await page.route("**/*",route=>route.request().url().startsWith("http://vcc-task-folders.test")
        ? route.fulfill({contentType:"text/html",body:"<!doctype html><html><body><div id='workspace'><div class='workspace-split mod-root'><div id='host' class='view-content'></div><article id='native-note' hidden></article></div></div></body></html>"})
        : route.abort());
      await page.goto(`http://vcc-task-folders.test/${mobile?"#mobile":""}`);
      page.setDefaultTimeout(5000);
      const errors=[];
      page.on("pageerror",error=>errors.push(error.message));
      await page.addStyleTag({content:readFileSync("styles.css","utf8")});
      if(duoSource)await page.addStyleTag({content:readFileSync(resolve(duoSource,"styles.css"),"utf8")});
      await page.addStyleTag({content:"html,body{margin:0;height:100%;width:100%;}#workspace,.workspace-split,#host{height:100%;width:100%;}.workspace-split{display:flex;box-sizing:border-box;}#native-note{flex:1 1 auto;min-width:0;}#host[hidden],#native-note[hidden]{display:none!important;}"});
      await page.addScriptTag({content:bundle});
      await page.waitForFunction(()=>Boolean(window.fixture));
      const activate=locator=>mobile?locator.tap():locator.click();
      const tabs=page.getByRole("tablist",{name:"Dashboard views"});
      const tasks=tabs.getByRole("tab",{name:"Tasks",exact:true});
      assert.deepEqual((await tabs.getByRole("tab").allTextContents()).slice(0,5),["Home","Areas","Programs","Tasks","HTML"]);
      const capture=page.locator(".fjg-vcc-capture-grid");
      assert.deepEqual(await capture.locator(".fjg-vcc-capture-label").allTextContents(),["Thought","Email","Agenda item","All Files"]);
      assert.equal(await capture.getByRole("button",{name:"Capture Program update"}).count(),0);
      assert.equal(await tabs.getByRole("tab",{name:"All Files"}).count(),0);
      if (process.env.VCC_FIXTURE_OUTPUT_DIR) await page.screenshot({path:`${process.env.VCC_FIXTURE_OUTPUT_DIR}/all-files-home-${width}.png`});
      const voice=page.getByRole("button",{name:"Talk to Vault",exact:true});
      const voiceBox=await voice.boundingBox();
      assert.ok(voiceBox && voiceBox.height>=44 && voiceBox.x>=0 && voiceBox.x+voiceBox.width<=width, "Voice entry stays reachable within the viewport");
      assert.equal(await voice.evaluate(button=>getComputedStyle(button).borderTopWidth),"1px");
      const duo="fjg-file-focus-duo:talk-to-vault";
      const objectives="fjg-task-manager:talk-to-dashboard";
      assert.deepEqual(await page.evaluate(()=>fixture.voiceResult()),{calls:[],notices:[]});
      await page.evaluate((ids)=>fixture.voiceProviders(ids),[duo,objectives]);
      await activate(voice);
      assert.deepEqual(await page.evaluate(()=>fixture.voiceResult()),{calls:[duo],notices:[]});
      await page.evaluate((ids)=>fixture.voiceProviders(ids),[objectives]);
      await activate(voice);
      assert.deepEqual(await page.evaluate(()=>fixture.voiceResult()),{calls:[duo,objectives],notices:[]});
      await page.evaluate(()=>fixture.voiceProviders([]));
      await activate(voice);
      const missingProvider=await page.evaluate(()=>fixture.voiceResult());
      assert.deepEqual(missingProvider.calls,[duo,objectives]);
      assert.match(missingProvider.notices[0],/enable FJG File Focus Duo or FJG Objective Manager/);
      await page.evaluate(([duo,objectives])=>fixture.voiceProviders([duo,objectives],duo),[duo,objectives]);
      await activate(voice);
      const providerFailure=await page.evaluate(()=>fixture.voiceResult());
      assert.deepEqual(providerFailure.calls,[duo]);
      assert.match(providerFailure.notices[0],/could not open/);
      assert.equal(await tabs.getByRole("tab",{name:"Home",exact:true}).getAttribute("aria-selected"),"true");
      await page.evaluate(duo=>fixture.voiceProviders([duo],'',{'fjg-file-focus-duo':'0.1.20'}),duo);
      await activate(voice);
      await page.waitForFunction(()=>fixture.voiceHandoff().launches.length===1);
      assert.deepEqual(await page.evaluate(()=>fixture.voiceHandoff()),{launches:[{id:duo,active:"home"}],reveals:[],active:"home"});
      await page.evaluate(async ({duo,objectives})=>{
        await fixture.visitPriorNoteThenHome();
        fixture.voiceProviders([duo,objectives],'',{'fjg-file-focus-duo':'0.1.20','fjg-task-manager':'0.30.18'});
      },{duo,objectives});
      await activate(voice);
      await page.waitForFunction(()=>fixture.voiceHandoff().launches.length===1);
      const wide = mobile && width >= 720;
      assert.deepEqual(await page.evaluate(()=>fixture.voiceHandoff()),{
        launches:[{id:duo,active:wide?"Root note.md":"home"}],
        reveals:wide?["Root note.md"]:[],
        active:wide?"Root note.md":"home",
      });
      await page.evaluate(()=>fixture.returnHome());
      if(wide){
        await page.evaluate(duo=>fixture.voiceProviders([duo],'',{'fjg-file-focus-duo':'0.1.19'}),duo);
        await activate(voice);
        await page.waitForFunction(()=>fixture.voiceResult().notices.length===1);
        assert.match((await page.evaluate(()=>fixture.voiceResult())).notices[0],/update FJG File Focus Duo to 0.1.20/);
        assert.deepEqual(await page.evaluate(()=>fixture.voiceHandoff()),{launches:[{id:duo,active:"home"}],reveals:[],active:"home"});
        await page.evaluate(async ({duo,objectives})=>{
          await fixture.visitPriorNoteThenHome();
          fixture.narrowVoiceRoot(670);
          fixture.voiceProviders([duo,objectives],'',{'fjg-file-focus-duo':'0.1.20','fjg-task-manager':'0.30.18'});
        },{duo,objectives});
        await activate(voice);
        await page.waitForFunction(()=>fixture.voiceHandoff().launches.length===1);
        assert.deepEqual(await page.evaluate(()=>fixture.voiceHandoff()),{launches:[{id:duo,active:"home"}],reveals:[],active:"home"});
        await page.evaluate(async ({duo,objectives})=>{
          fixture.narrowVoiceRoot(0);
          await fixture.visitPriorNoteThenHome();
          fixture.voiceProviders([duo,objectives],'',{'fjg-file-focus-duo':'0.1.19','fjg-task-manager':'v0.30.18'});
          fixture.delayVoiceReveal();
        },{duo,objectives});
        await activate(voice);
        await page.waitForFunction(()=>fixture.hasPendingReveal());
        await activate(voice);
        assert.deepEqual(await page.evaluate(()=>fixture.voiceHandoff()),{launches:[],reveals:["Root note.md"],active:"home"});
        await page.evaluate(()=>fixture.finishReveal());
        await page.waitForFunction(()=>fixture.voiceHandoff().launches.length===1);
        assert.deepEqual(await page.evaluate(()=>fixture.voiceHandoff()),{launches:[{id:objectives,active:"Root note.md"}],reveals:["Root note.md"],active:"Root note.md"});
        await page.evaluate(async duo=>{
          await fixture.visitPriorNoteThenHome();fixture.voiceProviders([duo],'',{'fjg-file-focus-duo':'0.1.20'});fixture.delayVoiceReveal();
        },duo);
        await activate(voice);
        await page.waitForFunction(()=>fixture.hasPendingReveal());
        await page.evaluate(()=>{fixture.visitOther();fixture.finishReveal();});
        await page.waitForFunction(()=>!fixture.hasPendingReveal());
        assert.deepEqual(await page.evaluate(()=>fixture.voiceHandoff()),{launches:[],reveals:["Root note.md"],active:"Different fixture.md"});
        if(duoSource){
          await page.evaluate(async duo=>{
            await fixture.visitPriorNoteThenHome();fixture.voiceProviders([duo],'',{'fjg-file-focus-duo':'0.1.20'});fixture.enableRealDuo();
          },duo);
          await activate(voice);
          const chat=page.locator(".fjgduo-vault-live-split-pane");
          await chat.waitFor();
          const lane=await chat.boundingBox(), note=await page.locator("#native-note").boundingBox();
          assert.ok(lane && note && lane.x+lane.width<=note.x+1, `Expected real provider chat left of native note: ${JSON.stringify({lane,note})}`);
          assert.equal(await page.locator("#native-note").textContent(),"Root note.md");
          assert.equal(await page.locator(".modal-container").count(),0);
          assert.deepEqual(await page.evaluate(()=>fixture.voiceHandoff()),{launches:[{id:duo,active:"Root note.md"}],reveals:["Root note.md"],active:"Root note.md"});
          await activate(chat.getByRole("button",{name:"Close conversation"}));
          assert.equal(await chat.count(),0);
        }
        await page.evaluate(()=>fixture.returnHome());
      }
      const globalSearch=page.getByRole("searchbox",{name:"Search the current dashboard tab"});
      await globalSearch.fill("old home search");
      await activate(capture.getByRole("button",{name:"All Files",exact:true}));
      const allFiles=page.locator(".fjg-vcc-all-files");
      const allHeading=allFiles.locator(".fjg-vcc-folder-heading");
      const home=allFiles.getByRole("button",{name:"Back to Home",exact:true});
      assert.equal(await allHeading.textContent(),"Vault root");
      assert.equal(await globalSearch.inputValue(),"");
      assert.equal(await globalSearch.getAttribute("placeholder"),"Filter this folder");
      const rootFolders=await allFiles.locator(".fjg-vcc-folder-chip").allTextContents();
      assert.deepEqual(rootFolders.slice(0,4),["00 Inbox","01 Daily Notes","02 Programs","03 Areas"]);
      for (const normal of ["Artifacts","Wiki","tmp","Empty"]) assert.ok(rootFolders.includes(normal));
      for (const guarded of ["+","Users","copilot","Credentials"]) assert.ok(!rootFolders.includes(guarded));
      assert.equal(await allFiles.getByRole("button",{name:"Preview Root note, in Root note.md",exact:true}).count(),1);
      assert.equal(await allFiles.getByText("api_keys",{exact:true}).count(),0);
      if (process.env.VCC_FIXTURE_OUTPUT_DIR) await page.screenshot({path:`${process.env.VCC_FIXTURE_OUTPUT_DIR}/all-files-root-${width}.png`});
      await globalSearch.fill("EMPTY");
      assert.deepEqual(await allFiles.locator(".fjg-vcc-folder-chip").allTextContents(),["Empty"]);
      await activate(allFiles.getByRole("button",{name:"Open folder Empty",exact:true}));
      assert.equal(await allHeading.textContent(),"Empty");
      assert.ok(await allFiles.getByText("This folder is empty",{exact:true}).isVisible());
      await activate(allFiles.getByRole("button",{name:"Go up one folder"}));
      assert.equal(await allHeading.textContent(),"Vault root");
      await activate(allFiles.getByRole("button",{name:"Open folder Artifacts",exact:true}));
      const children=await allFiles.locator(".fjg-vcc-folder-chip").allTextContents();
      assert.ok(children.indexOf("Project 2")<children.indexOf("Project 11"));
      assert.ok(!children.includes(".private"));
      await activate(allFiles.getByRole("button",{name:"Open folder Project 2",exact:true}));
      assert.equal(await allHeading.textContent(),"Project 2");
      const report=allFiles.getByRole("button",{name:"Preview Report, in Artifacts/Project 2/Report.txt",exact:true});
      if (mobile) assert.ok((await report.boundingBox()).height>=44);
      await activate(report);
      await page.getByText("Fixture preview of Report",{exact:true}).waitFor();
      await activate(page.getByRole("button",{name:"Close preview and return to the dashboard"}));
      await activate(allFiles.getByRole("button",{name:"Preview Attachment, in Artifacts/Project 2/Attachment.zip",exact:true}));
      await page.getByText("Native preview required",{exact:true}).waitFor();
      await page.getByRole("button",{name:"Open in tab",exact:true}).waitFor();
      await activate(page.getByRole("button",{name:"Close preview and return to the dashboard"}));
      await activate(allFiles.getByRole("button",{name:"Vault root",exact:true}));
      assert.equal(await allHeading.textContent(),"Vault root");
      await page.evaluate(()=>window.fixture.setAllFilesFolder("Artifacts/Removed/Child"));
      assert.equal(await allHeading.textContent(),"Artifacts");
      await activate(home);
      assert.equal(await globalSearch.inputValue(),"old home search");
      await activate(capture.getByRole("button",{name:"All Files",exact:true}));
      assert.equal(await allHeading.textContent(),"Vault root");
      await activate(home);
      await globalSearch.fill("");
      await activate(tasks);
      assert.equal(await tasks.getAttribute("aria-selected"),"true");
      if (width===320) assert.ok(await tabs.evaluate(el=>el.scrollWidth>el.clientWidth),"the folded route strip remains horizontally scrollable");
      assert.ok((await tasks.boundingBox()).height>=44 || !mobile);
      const row=page.locator("[data-route='task-folders'] .fjg-vcc-select-row");
      if (!(await row.count())) console.error(await page.locator("body").innerText(), errors, await page.evaluate(()=>window.notices));
      assert.equal(await row.first().locator(".fjg-vcc-row-title").textContent(),"Inbox / Files");
      assert.equal(await row.count(),7);
      assert.equal(await row.filter({hasText:"CalWORKs Tasks"}).count(),2);
      assert.equal(await row.filter({hasText:"Secret Tasks"}).count(),0);
      assert.equal(await page.locator(".fjg-vcc-folder-rail").evaluate(el=>el.scrollWidth<=el.clientWidth+1),true);
      if(mobile) assert.ok((await row.first().boundingBox()).height>=44);
      if (process.env.VCC_FIXTURE_OUTPUT_DIR) await page.screenshot({path:`${process.env.VCC_FIXTURE_OUTPUT_DIR}/tasks-folders-${width}.png`});
      const search=page.getByRole("searchbox",{name:"Search the current dashboard tab"});
      assert.equal(await row.getByText("08 Tasks",{exact:true}).count(),0);
      assert.equal(await row.getByText("New Tasks",{exact:true}).count(),0);
      assert.equal(await row.getByText("Older Tasks",{exact:true}).count(),0);
      assert.deepEqual(await row.locator(".fjg-vcc-task-folder-path").allTextContents(),["08 Tasks/Inbox/Files"]);
      assert.equal(await row.getByText("Subtasks",{exact:true}).count(),0);
      assert.equal(await row.getByText("Spring Workshop Tasks 2030",{exact:true}).count(),0);
      await search.fill("03 Areas/Operations/Operations Tasks/Spring Workshop");
      assert.equal(await row.count(),0,"nested objective paths are not listed as search hits");
      await search.fill("03 Areas/Operations/Operations Tasks");
      assert.equal(await row.count(),1,"underlying container path still matches search");
      assert.equal(await row.first().locator(".fjg-vcc-row-title").textContent(),"Operations Tasks");
      assert.equal(await row.first().locator(".fjg-vcc-task-folder-path").count(),0);
      if (mobile) {
        const frame=await row.first().boundingBox();
        assert.ok(frame && frame.height>=44 && frame.x+frame.width<=width+1);
      }
      await activate(row.first());
      assert.equal(await page.locator(".fjg-vcc-folder-heading").textContent(),"Operations Tasks");
      await activate(page.getByRole("button",{name:"Open folder Spring Workshop Tasks 2030, 2 files"}));
      await activate(page.getByRole("button",{name:"Open folder Files, 2 files"}));
      await activate(page.getByRole("button",{name:"Open folder Subtasks, 1 file"}));
      assert.equal(await page.locator(".fjg-vcc-folder-heading").textContent(),"Subtasks");
      assert.equal(await page.locator("[data-route='task-folders'] .fjg-vcc-row").filter({hasText:"Prepare slides"}).count(),1);
      assert.equal(await page.locator("[data-route='task-folders'] .fjg-vcc-row").filter({hasText:"Parent file"}).count(),0);
      await activate(page.getByRole("button",{name:mobile?"Go back from Subtasks":"Go up from Subtasks"}));
      assert.equal(await page.locator(".fjg-vcc-folder-heading").textContent(),"Files");
      await page.evaluate(()=>window.fixture.restoreOldTaskSelection());
      assert.equal(await page.locator(".fjg-vcc-folder-heading").textContent(),"Operations Tasks");
      assert.equal(await page.evaluate(()=>window.fixture.selectedTaskPath()),"03 Areas/Operations/Operations Tasks");
      await activate(page.getByRole("button",{name:"Back to Tasks Folders list"}));
      const liveTaskRow = row.getByText("Outreach · Tasks",{exact:true});
      assert.equal(await liveTaskRow.count(),1);
      assert.equal(await row.getByText("Outreach Tasks",{exact:true}).count(),1);
      assert.equal(await row.getByText("Retired · Tasks",{exact:true}).count(),0);
      await search.fill("staging");
      assert.equal(await row.count(),0);
      await search.fill("Example Vault");
      assert.equal(await row.count(),0);
      await search.fill("");
      await activate(liveTaskRow);
      assert.equal(await page.locator(".fjg-vcc-folder-heading").textContent(),"Outreach · Tasks");
      assert.equal(await page.locator("[data-route='task-folders'] .fjg-vcc-row").filter({hasText:"Active work"}).count(),1);
      assert.equal(await page.locator("[data-route='task-folders'] .fjg-vcc-row").filter({hasText:"Different work"}).count(),0);
      await activate(page.getByRole("button",{name:"Back to Tasks Folders list"}));
      await search.fill("recruitment");
      assert.equal(await row.count(),1);
      assert.equal(await row.first().locator(".fjg-vcc-row-title").textContent(),"CalWORKs Tasks");
      assert.equal(await row.first().locator(".fjg-vcc-task-folder-path").count(),0);
      await search.fill("mytasks");
      assert.equal(await row.count(),1);
      await search.fill("02 Programs/CalWORKs");
      assert.equal(await row.count(),1);
      await activate(row.first());
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
      await row.getByText("New Tasks",{exact:true}).waitFor();
      await search.fill("02 Programs/CalWORKs/CalWORKs Tasks");
      assert.equal(await row.count(),1);
      await page.evaluate(()=>window.fixture.move("02 Programs/CalWORKs","02 Programs/CalWORKs Renamed"));
      await row.first().waitFor({state:"detached"});
      await search.fill("02 Programs/CalWORKs Renamed/CalWORKs Tasks");
      assert.equal(await row.count(),1);
      await search.fill("");
      await activate(row.filter({hasText:"New Tasks"}));
      assert.equal(await page.locator(".fjg-vcc-folder-heading").textContent(),"New Tasks");
      await page.evaluate(()=>window.fixture.move("Elsewhere/New Tasks","Elsewhere/No longer a match"));
      await row.getByText("New Tasks",{exact:true}).waitFor({state:"detached"});
      assert.equal(await page.evaluate(()=>window.fixture.selectedTaskPath()),"");
      await page.evaluate(()=>window.fixture.delete("08 Tasks/Inbox/Files"));
      await row.filter({hasText:"Inbox / Files"}).waitFor({state:"detached"});
      const review=tabs.getByRole("tab",{name:"File Review",exact:true});
      await activate(review);
      await page.locator(".fjg-vcc-file-review").waitFor();
      assert.deepEqual(errors,[]);
      console.log(`PASS Tasks Folders at ${width}px ${mobile?"mobile":"desktop"}: voice launch, tab, inbox first, search, nested navigation, live create/rename/move/delete and File Review`);
      await page.close();
    }
  } finally {await browser.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
