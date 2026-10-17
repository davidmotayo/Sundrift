import { useEffect, useRef, useState } from "react";
import { Gauge, RotateCcw } from "lucide-react";
import { mountDrive, type DriveHandle, type TouchHeld } from "@/game/mountDrive";

export function DriveGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const speedRef = useRef<HTMLSpanElement>(null);
  const gearRef = useRef<HTMLSpanElement>(null);
  const startedRef = useRef(false);
  const touchRef = useRef<TouchHeld>({ gas: false, brake: false, left: false, right: false });
  const apiRef = useRef<DriveHandle | null>(null);
  const [started, setStarted] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handle = mountDrive(canvas, {
      isStarted: () => startedRef.current,
      touch: touchRef.current,
      speedEl: speedRef.current,
      gearEl: gearRef.current,
    });
    apiRef.current = handle;
    if (startedRef.current) handle.unlock();
    return () => {
      handle.dispose();
      apiRef.current = null;
    };
  }, []);

  const begin = () => {
    startedRef.current = true;
    setStarted(true);
    apiRef.current?.unlock();
  };

  const hold = (key: keyof TouchHeld) => (down: boolean) => {
    touchRef.current[key] = down;
  };

  return (
    <div className="fixed inset-0 overflow-hidden bg-ink font-sans text-sand select-none touch-none">
      <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" />
      <p className="sr-only">
        Free desert drive. W or up accelerates, S or down brakes and reverses, A or left steers left, D or
        right steers right.
      </p>

      <div className={started ? "absolute top-0 right-0 left-0 z-20 flex items-start justify-between p-4" : "hidden"}>
        <div className="flex items-center gap-3 rounded-full bg-ink/80 px-4 py-2 text-sand backdrop-blur-sm">
          <Gauge className="size-5 shrink-0" aria-hidden="true" />
          <span ref={speedRef} className="font-display text-2xl leading-none">
            0
          </span>
          <span className="text-sm tracking-wide text-sand/80">km/h</span>
          <span ref={gearRef} className="ml-1 text-sm font-semibold text-clay">
            D
          </span>
        </div>
        <button
          type="button"
          onClick={() => apiRef.current?.reset()}
          className="flex h-12 items-center gap-2 rounded-full bg-ink/80 px-4 text-sm font-medium text-sand"
        >
          <RotateCcw className="size-4" aria-hidden="true" />
          Reset
        </button>
      </div>

      <div className="touch-pad pointer-events-none absolute inset-x-0 bottom-0 z-20 items-end justify-between gap-4 px-4 pt-4 pb-6">
        <div className="pointer-events-auto flex gap-3">
          <Pedal label="Left" onHold={hold("left")} />
          <Pedal label="Right" onHold={hold("right")} />
        </div>
        <div className="pointer-events-auto flex gap-3">
          <Pedal label="Brake" onHold={hold("brake")} />
          <Pedal label="Gas" gas onHold={hold("gas")} />
        </div>
      </div>

      {started ? null : (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-ink/45 p-6">
          <div className="start-card w-full max-w-sm rounded-3xl bg-sand px-8 py-9 text-ink">
            <p className="text-sm font-medium tracking-widest text-clay uppercase">Open road</p>
            <h1 className="font-display mt-2 text-5xl leading-none text-ink">Sundrift</h1>
            <p className="mt-4 text-base leading-relaxed text-ink/80">
              A flat desert highway. Rocks, cacti, and nothing else asking for your time.
            </p>
            <button
              type="button"
              onClick={begin}
              className="mt-7 h-12 w-full rounded-full bg-clay text-base font-semibold text-ink"
            >
              Start
            </button>
            <p className="mt-4 text-sm leading-relaxed text-ink/70">
              WASD or the arrow keys. On a phone, pedals sit along the bottom.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Pedal({
  label,
  gas,
  onHold,
}: {
  label: string;
  gas?: boolean;
  onHold: (down: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={gas ? "pedal pedal-gas" : "pedal"}
      onContextMenu={(e) => e.preventDefault()}
      onPointerDown={(e) => {
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
    >
      {label}
    </button>
  );
}
