/**
 * The landing page's decorative water (LH-UI-88 S1, added at Earl's word on 2026-11-06).
 *
 * A slow caustics shader behind the hero. Pointer movement feeds a continuous, damped flow field and the field settles when the
 * pointer leaves: there are no ripple births, buffer resets or snaps. It is decoration only: the page is complete without it, and
 * the still image in `.water-layer` shows whenever the water is stopped.
 *
 * It never starts under `prefers-reduced-motion: reduce` or Data Saver, pauses while the tab is hidden or the hero is scrolled
 * away, runs at 30 fps on touch screens, caps its drawing size, and gives way to the still image if WebGL is unavailable or lost.
 * `startWater` returns its cleanup, which the router calls when the landing page is left.
 */

type Locations = Record<"resolution" | "pointer" | "time" | "velocity" | "tail" | "energy", WebGLUniformLocation | null>;
type Connection = EventTarget & { saveData?: boolean };

const VERTEX = "attribute vec2 position;void main(){gl_Position=vec4(position,0.,1.);}";
const FRAGMENT = `
    precision highp float;
    uniform vec2 resolution;
    uniform vec2 pointer;
    uniform vec2 velocity;
    uniform vec2 tail;
    uniform float energy;
    uniform float time;
    const float TAU = 6.28318530718;
    float caustic(vec2 uv,float t){
      vec2 p=mod(uv*TAU,TAU)-250.0;
      vec2 i=p;
      float c=1.0;
      for(int n=0;n<5;n++){
        float nt=t*(1.0-3.5/float(n+1));
        i=p+vec2(cos(nt-i.x)+sin(nt+i.y),sin(nt-i.y)+cos(nt+i.x));
        vec2 denom=vec2(sin(i.x+nt),cos(i.y+nt));
        denom=sign(denom)*max(abs(denom),vec2(.0001));
        c+=1.0/length(p*.005/denom);
      }
      c=1.17-pow(c/5.0,1.4);
      return clamp(pow(abs(c),7.0),0.0,1.0);
    }
    void main(){
      vec2 uv=gl_FragCoord.xy/resolution;
      vec2 aspect=vec2(resolution.x/resolution.y,1.0);
      vec2 p=uv*aspect;
      vec2 mouse=vec2(pointer.x,1.0-pointer.y);
      vec2 delta=uv-mouse;
      float distanceToPointer=length(delta*aspect);
      float wake=exp(-distanceToPointer*3.0);
      // A continuous, damped flow field has no ripple births or buffer resets.
      vec2 drift=vec2(velocity.x,-velocity.y)*.075;
      vec2 tailPoint=vec2(tail.x,1.0-tail.y);
      vec2 trail=(mouse-tailPoint)*.045;
      p+=(drift+trail)*wake*energy;
      p+=delta*exp(-distanceToPointer*7.0)*energy*.024;
      p+=vec2(sin(p.y*3.1+time*.12),cos(p.x*2.8-time*.09))*.045;
      float c=caustic(p*.74+vec2(.14,.21),time*.21);
      float foil=smoothstep(.055,.35,c)*(1.0-smoothstep(.35,.65,c));
      float top=pow(smoothstep(.02,1.0,uv.y),1.25);
      float right=smoothstep(.15,.85,uv.x);
      float light=top*(.30+right*.65);
      vec3 deep=vec3(.169,.039,.047);
      vec3 brand=vec3(.478,.078,.098);
      vec3 gold=vec3(.785,.588,.165);
      vec3 cream=vec3(.984,.965,.933);
      vec3 base=mix(deep,brand,.66+top*.18);
      vec3 color=base+gold*pow(c,.85)*light*.50;
      color+=mix(gold,cream,.22)*foil*light*.11;
      color+=gold*wake*energy*.002;
      float broad=sin(p.x*3.0+p.y*4.0+time*.06)*.5+.5;
      color+=vec3(.045,.014,.008)*broad*top;
      float vignette=1.0-.17*pow(length(uv-vec2(.6,.64)),1.5);
      color=base+max(vec3(0.0),color-base)*vignette;
      gl_FragColor=vec4(color,1.0);
    }
  `;

export function startWater(canvas: HTMLCanvasElement, surface: HTMLElement): () => void {
  let disposed = false;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)");
  const coarse = matchMedia("(pointer: coarse)");
  const forced = matchMedia("(forced-colors: active)");
  const connection = (navigator as Navigator & { connection?: Connection }).connection;
  let unavailable = false;
  let gl: WebGLRenderingContext | null = null;
  let frame = 0;
  let lastDraw = 0;
  let clock = 12.5;
  let lastInput: { x: number; y: number; at: number } | null = null;
  let targetEnergy = 0;
  let energy = 0;
  let visible = true;
  let tracking = false;
  let locations: Locations | null = null;
  const pointer = { x: .5, y: .5, targetX: .5, targetY: .5, vx: 0, vy: 0, targetVX: 0, targetVY: 0, tailX: .5, tailY: .5 };
  // Both preferences are read once and then only inside their own `change` handlers. Reading `.matches` on every frame would let
  // the animation loop see a change before its event does, and the event would then never arrive (Chromium reports a change only
  // to a list whose value it has not already handed out).
  let reduced = reduce.matches;
  let touch = coarse.matches;
  // Forced colours hide the water layer, so there is nothing to draw: stop, rather than animate something nobody can see.
  let contrast = forced.matches;
  const stopped = (): boolean => disposed || reduced || contrast || Boolean(connection?.saveData) || unavailable;

  function compile(context: WebGLRenderingContext, type: number, source: string): WebGLShader {
    const shader = context.createShader(type);
    if (!shader) throw new Error("Water shader unavailable");
    context.shaderSource(shader, source);
    context.compileShader(shader);
    if (!context.getShaderParameter(shader, context.COMPILE_STATUS)) { context.deleteShader(shader); throw new Error("Water shader unavailable"); }
    return shader;
  }

  function init(): boolean {
    try {
      // A browser that can only draw WebGL in software (no GPU, a remote desktop, headless) keeps several cores busy with this shader,
      // which a decoration is not worth: refuse it and the still image stays. `failIfMajorPerformanceCaveat` asks the browser to say no;
      // the renderer name below catches the software drawers (SwiftShader, llvmpipe) that some browsers still hand out.
      const context = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false, stencil: false, powerPreference: "low-power", preserveDrawingBuffer: false, failIfMajorPerformanceCaveat: true });
      if (!context) throw new Error("WebGL unavailable");
      const debugInfo = context.getExtension("WEBGL_debug_renderer_info");
      if (debugInfo && /swiftshader|llvmpipe|softpipe|software/i.test(String(context.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL)))) { context.getExtension("WEBGL_lose_context")?.loseContext(); throw new Error("WebGL is drawn in software"); }
      gl = context;
      const vert = compile(context, context.VERTEX_SHADER, VERTEX);
      const frag = compile(context, context.FRAGMENT_SHADER, FRAGMENT);
      const program = context.createProgram();
      if (!program) throw new Error("Water program unavailable");
      context.attachShader(program, vert);
      context.attachShader(program, frag);
      context.linkProgram(program);
      context.deleteShader(vert);
      context.deleteShader(frag);
      if (!context.getProgramParameter(program, context.LINK_STATUS)) throw new Error("Water program unavailable");
      context.useProgram(program);
      const buffer = context.createBuffer();
      context.bindBuffer(context.ARRAY_BUFFER, buffer);
      context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), context.STATIC_DRAW);
      const position = context.getAttribLocation(program, "position");
      context.enableVertexAttribArray(position);
      context.vertexAttribPointer(position, 2, context.FLOAT, false, 0, 0);
      locations = {
        resolution: context.getUniformLocation(program, "resolution"), pointer: context.getUniformLocation(program, "pointer"), time: context.getUniformLocation(program, "time"),
        velocity: context.getUniformLocation(program, "velocity"), tail: context.getUniformLocation(program, "tail"), energy: context.getUniformLocation(program, "energy")
      };
      resize();
      canvas.classList.add("ready");
      return true;
    } catch { unavailable = true; canvas.classList.remove("ready"); return false; }
  }

  function resize(): void {
    if (!gl || unavailable) return;
    const rect = surface.getBoundingClientRect();
    const scale = Math.min(devicePixelRatio || 1, 1, 1400 / rect.width, 1000 / rect.height);
    const width = Math.max(1, Math.round(rect.width * scale));
    const height = Math.max(1, Math.round(rect.height * scale));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, canvas.width, canvas.height);
    draw();
  }

  function draw(): void {
    if (!gl || unavailable || !locations) return;
    gl.uniform2f(locations.resolution, canvas.width, canvas.height);
    gl.uniform2f(locations.pointer, pointer.x, pointer.y);
    gl.uniform2f(locations.velocity, pointer.vx, pointer.vy);
    gl.uniform2f(locations.tail, pointer.tailX, pointer.tailY);
    gl.uniform1f(locations.energy, energy);
    gl.uniform1f(locations.time, clock);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  function tick(timestamp: number): void {
    frame = 0;
    if (stopped() || document.hidden || !visible) return;
    const elapsed = timestamp - lastDraw;
    const interval = touch ? 1000 / 30 : 1000 / 60;
    if (elapsed >= interval - .5) {
      const dt = Math.min(elapsed / 1000, .05);
      const follow = 1 - Math.exp(-dt / .24), drift = 1 - Math.exp(-dt / .32);
      clock += dt * .22;
      pointer.x += (pointer.targetX - pointer.x) * follow;
      pointer.y += (pointer.targetY - pointer.y) * follow;
      pointer.tailX += (pointer.x - pointer.tailX) * (1 - Math.exp(-dt / .55));
      pointer.tailY += (pointer.y - pointer.tailY) * (1 - Math.exp(-dt / .55));
      pointer.vx += (pointer.targetVX - pointer.vx) * drift;
      pointer.vy += (pointer.targetVY - pointer.vy) * drift;
      energy += (targetEnergy - energy) * (1 - Math.exp(-dt / .4));
      targetEnergy *= Math.exp(-dt * 1.5);
      pointer.targetVX *= Math.exp(-dt * 4);
      pointer.targetVY *= Math.exp(-dt * 4);
      draw();
      lastDraw = timestamp;
    }
    frame = requestAnimationFrame(tick);
  }

  function move(event: PointerEvent): void {
    if (event.isPrimary === false || stopped() || !visible || document.hidden) return;
    const rect = surface.getBoundingClientRect();
    const x = (event.clientX - (rect.left || 0)) / rect.width, y = (event.clientY - rect.top) / rect.height;
    if (x < 0 || x > 1 || y < 0 || y > 1) { reset(); return; }
    const now = performance.now() / 1000;
    if (!lastInput) {
      if (energy < .005) { pointer.x = pointer.tailX = x; pointer.y = pointer.tailY = y; }
      lastInput = { x, y, at: now };
    }
    const dt = Math.max(.008, now - lastInput.at);
    const vx = Math.max(-.6, Math.min(.6, (x - lastInput.x) / dt));
    const vy = Math.max(-.6, Math.min(.6, (y - lastInput.y) / dt));
    pointer.targetX = x;
    pointer.targetY = y;
    pointer.targetVX = vx;
    pointer.targetVY = vy;
    targetEnergy = Math.min(.85, Math.hypot(vx, vy) * 1.8);
    lastInput = { x, y, at: now };
  }

  function reset(): void { lastInput = null; targetEnergy = 0; pointer.targetVX = 0; pointer.targetVY = 0; }

  function reconcile(): void {
    cancelAnimationFrame(frame);
    frame = 0;
    const shouldTrack = !stopped() && !document.hidden && visible;
    if (shouldTrack !== tracking) {
      if (shouldTrack) { window.addEventListener("pointermove", move, { passive: true }); document.documentElement.addEventListener("pointerleave", reset); }
      else { window.removeEventListener("pointermove", move); document.documentElement.removeEventListener("pointerleave", reset); }
      tracking = shouldTrack;
      if (!tracking) reset();
    }
    if (stopped()) { reset(); energy = 0; pointer.vx = 0; pointer.vy = 0; }
    // Reduced motion never creates a WebGL context, schedules frames, or tracks the pointer.
    if (stopped() || document.hidden || !visible) return;
    if (!gl && !init()) { reconcile(); return; }
    lastDraw = performance.now();
    frame = requestAnimationFrame(tick);
  }

  const onContextLost = (event: Event): void => { event.preventDefault(); unavailable = true; canvas.classList.remove("ready"); reconcile(); };
  const onContextRestored = (): void => { gl = null; locations = null; unavailable = false; reconcile(); };
  const onReduce = (): void => { reduced = reduce.matches; reconcile(); };
  const onCoarse = (): void => { touch = coarse.matches; reconcile(); };
  const onForced = (): void => { contrast = forced.matches; reconcile(); };
  reduce.addEventListener("change", onReduce);
  coarse.addEventListener("change", onCoarse);
  forced.addEventListener("change", onForced);
  connection?.addEventListener("change", reconcile);
  document.addEventListener("visibilitychange", reconcile);
  window.addEventListener("resize", resize, { passive: true });
  canvas.addEventListener("webglcontextlost", onContextLost);
  canvas.addEventListener("webglcontextrestored", onContextRestored);
  const observer = "IntersectionObserver" in window ? new IntersectionObserver((entries) => { visible = entries[0]?.isIntersecting ?? true; reconcile(); }, { rootMargin: "50px" }) : null;
  observer?.observe(surface);
  reconcile();

  return () => {
    disposed = true;
    cancelAnimationFrame(frame);
    observer?.disconnect();
    window.removeEventListener("pointermove", move);
    document.documentElement.removeEventListener("pointerleave", reset);
    window.removeEventListener("resize", resize);
    document.removeEventListener("visibilitychange", reconcile);
    reduce.removeEventListener("change", onReduce);
    coarse.removeEventListener("change", onCoarse);
    forced.removeEventListener("change", onForced);
    connection?.removeEventListener("change", reconcile);
    canvas.removeEventListener("webglcontextlost", onContextLost);
    canvas.removeEventListener("webglcontextrestored", onContextRestored);
    gl?.getExtension("WEBGL_lose_context")?.loseContext();
  };
}
