import {describe,it,expect,vi} from "vitest";
import {bindNavigationTap} from "./mobile-tab-tap";
function button(mobile=true){
 const element=new EventTarget() as HTMLButtonElement;
 element.getBoundingClientRect=()=>({left:0,top:0,right:100,bottom:44} as DOMRect);
 const activate=vi.fn();bindNavigationTap(element,mobile,activate);
 const send=(type:string,properties:Record<string,unknown>={})=>{
  const event=new Event(type,{cancelable:true});Object.assign(event,{pointerId:1,pointerType:"touch",isPrimary:true,clientX:20,clientY:20,detail:1},properties);element.dispatchEvent(event);
 };
 return {activate,send};
}
describe("mobile navigation taps",()=>{
 it("activates a completed touch exactly once when Safari follows it with a click",()=>{const {activate,send}=button();send('pointerdown');send('pointerup');send('click');expect(activate).toHaveBeenCalledTimes(1);});
 it("accepts consecutive taps on the same target without waiting for compatibility clicks",()=>{const {activate,send}=button();for(let i=0;i<4;i++){send('pointerdown');send('pointerup');send('click');}expect(activate).toHaveBeenCalledTimes(4);});
 it("does not activate during horizontal or vertical scrolling",()=>{for(const movement of [{clientX:40},{clientY:40}]){const {activate,send}=button();send('pointerdown');send('pointermove',movement);send('pointerup');expect(activate).not.toHaveBeenCalled();}});
 it("ignores cancelled, secondary and out-of-bounds touches",()=>{const {activate,send}=button();send('pointerdown');send('pointercancel');send('pointerup');send('pointerdown',{isPrimary:false});send('pointerup');send('pointerdown');send('pointerup',{clientX:120});expect(activate).not.toHaveBeenCalled();});
 it("preserves keyboard activation even immediately after a touch",()=>{const {activate,send}=button();send('pointerdown');send('pointerup');send('click',{detail:0});expect(activate).toHaveBeenCalledTimes(2);});
 it("leaves desktop pointer and click behavior unchanged",()=>{const {activate,send}=button(false);send('pointerdown');send('pointerup');expect(activate).not.toHaveBeenCalled();send('click');expect(activate).toHaveBeenCalledTimes(1);});
});
