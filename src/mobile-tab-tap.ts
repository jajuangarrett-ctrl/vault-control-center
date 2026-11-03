/** Complete mobile taps without relying on a delayed compatibility click.
 * Keep scrolling, cancelled touches, mouse input and keyboard activation native.
 */
export function bindNavigationTap(button: HTMLButtonElement, mobile: boolean, activate: () => void): void {
  let touch: {id:number; x:number; y:number} | null = null;
  let ignoreClickUntil = 0;
  if (mobile) {
    button.addEventListener("pointerdown", event => {
      touch = event.pointerType === "touch" && event.isPrimary !== false
        ? {id:event.pointerId, x:event.clientX, y:event.clientY} : null;
    });
    button.addEventListener("pointermove", event => {
      if (touch && event.pointerId === touch.id && Math.hypot(event.clientX-touch.x,event.clientY-touch.y)>8) touch=null;
    });
    button.addEventListener("pointercancel", () => {touch=null;});
    button.addEventListener("pointerup", event => {
      const start=touch;touch=null;
      if (!start || start.id!==event.pointerId || Math.hypot(event.clientX-start.x,event.clientY-start.y)>8) return;
      const bounds=button.getBoundingClientRect();
      if(event.clientX<bounds.left || event.clientX>bounds.right || event.clientY<bounds.top || event.clientY>bounds.bottom)return;
      event.preventDefault();
      ignoreClickUntil=performance.now()+750;
      activate();
    });
  }
  button.addEventListener("click", event => {
    if (mobile && event.detail!==0 && performance.now()<ignoreClickUntil) {event.preventDefault();return;}
    activate();
  });
}
