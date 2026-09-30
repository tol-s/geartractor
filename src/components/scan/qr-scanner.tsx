"use client";

import * as React from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Camera, CameraOff, Check, Flashlight, Keyboard, Loader2, X, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type ScanOutcome = { ok: true; message?: string } | { ok: false; message: string };

type Phase = "starting" | "scanning" | "processing" | "success" | "error" | "denied" | "unavailable";

type Detector = { detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]> };

/**
 * Camera QR scanner. Uses the native BarcodeDetector when available and falls back to jsQR.
 * The caller resolves each scan (server lookup) and returns an outcome that drives the
 * success / error animation. Identical scans within a short window are ignored.
 */
export function QrScanner({
  onScan,
  active = true,
  className,
  hint = "Point the camera at an equipment QR code",
  continuous = true,
}: {
  onScan: (text: string) => Promise<ScanOutcome>;
  active?: boolean;
  className?: string;
  hint?: string;
  continuous?: boolean;
}) {
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const busyRef = React.useRef(false);
  const lastRef = React.useRef<{ text: string; at: number } | null>(null);
  const [phase, setPhase] = React.useState<Phase>("starting");
  const [message, setMessage] = React.useState<string | null>(null);
  const [torch, setTorch] = React.useState<boolean | null>(null);
  const [manual, setManual] = React.useState(false);
  const [code, setCode] = React.useState("");

  const handle = React.useCallback(
    async (text: string) => {
      const now = Date.now();
      if (busyRef.current) return;
      if (lastRef.current && lastRef.current.text === text && now - lastRef.current.at < 2500) return;
      lastRef.current = { text, at: now };
      busyRef.current = true;
      setPhase("processing");
      setMessage("Scanning...");
      try {
        navigator.vibrate?.(30);
      } catch {}
      let outcome: ScanOutcome;
      try {
        outcome = await onScan(text);
      } catch {
        outcome = { ok: false, message: "Something went wrong. Try again." };
      }
      if (outcome.ok) {
        setPhase("success");
        setMessage(outcome.message ?? "Scanned");
      } else {
        setPhase("error");
        setMessage(outcome.message);
        try {
          navigator.vibrate?.([60, 40, 60]);
        } catch {}
      }
      if (continuous) {
        setTimeout(() => {
          busyRef.current = false;
          setPhase(streamRef.current ? "scanning" : "unavailable");
          setMessage(null);
        }, outcome.ok ? 1100 : 2200);
      }
    },
    [onScan, continuous],
  );

  React.useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let detector: Detector | null = null;
    let jsQR: ((d: Uint8ClampedArray, w: number, h: number) => { data: string } | null) | null = null;

    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) {
        setPhase("unavailable");
        setMessage(window.isSecureContext ? "This device has no camera access." : "Camera requires a secure (HTTPS) connection.");
        setManual(true);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        const video = videoRef.current!;
        video.srcObject = stream;
        await video.play().catch(() => {});
        const track = stream.getVideoTracks()[0];
        const caps = (track.getCapabilities?.() ?? {}) as { torch?: boolean };
        if (caps.torch) setTorch(false);

        const BD = (window as unknown as { BarcodeDetector?: { new (o: { formats: string[] }): Detector; getSupportedFormats?: () => Promise<string[]> } }).BarcodeDetector;
        if (BD) {
          try {
            const formats = (await BD.getSupportedFormats?.()) ?? ["qr_code"];
            if (formats.includes("qr_code")) detector = new BD({ formats: ["qr_code"] });
          } catch {}
        }
        if (!detector) jsQR = (await import("jsqr")).default;
        setPhase("scanning");
        loop();
      } catch (err) {
        const name = (err as { name?: string })?.name;
        setPhase(name === "NotAllowedError" || name === "SecurityError" ? "denied" : "unavailable");
        setMessage(
          name === "NotAllowedError"
            ? "Camera permission was denied. Allow camera access in your browser settings, or enter the code manually."
            : "No camera could be started. Enter the code manually.",
        );
        setManual(true);
      }
    }

    async function loop() {
      if (cancelled) return;
      const video = videoRef.current;
      if (video && video.readyState >= 2 && !busyRef.current) {
        try {
          if (detector) {
            const codes = await detector.detect(video);
            if (codes[0]?.rawValue) void handle(codes[0].rawValue);
          } else if (jsQR) {
            const canvas = canvasRef.current!;
            const scale = Math.min(1, 640 / video.videoWidth);
            canvas.width = Math.floor(video.videoWidth * scale);
            canvas.height = Math.floor(video.videoHeight * scale);
            const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
            ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const res = jsQR(img.data, img.width, img.height);
            if (res?.data) void handle(res.data);
          }
        } catch {}
      }
      timer = setTimeout(loop, 160);
    }

    start();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    };
  }, [active, handle]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const next = !torch;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] });
      setTorch(next);
    } catch {}
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const v = code.trim();
    if (!v) return;
    lastRef.current = null;
    busyRef.current = false;
    void handle(v).then(() => setCode(""));
  };

  return (
    <div className={cn("relative flex flex-col overflow-hidden bg-black text-white", className)}>
      <div className="relative min-h-0 flex-1">
        <video ref={videoRef} className="absolute inset-0 size-full object-cover" playsInline muted aria-label="Camera preview" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="absolute inset-0 bg-black/35" aria-hidden />

        {/* Scan frame */}
        <div className="absolute inset-0 flex items-center justify-center p-8">
          <motion.div
            className="relative aspect-square w-full max-w-[280px]"
            animate={phase === "success" ? { scale: [1, 1.06, 1] } : phase === "error" ? { x: [0, -10, 10, -6, 6, 0] } : { scale: 1 }}
            transition={{ duration: 0.45 }}
          >
            <div className="absolute inset-0 rounded-[32px] shadow-[0_0_0_9999px_rgba(0,0,0,0.35)]" aria-hidden />
            {["left-0 top-0 border-l-4 border-t-4 rounded-tl-[32px]", "right-0 top-0 border-r-4 border-t-4 rounded-tr-[32px]", "bottom-0 left-0 border-b-4 border-l-4 rounded-bl-[32px]", "bottom-0 right-0 border-b-4 border-r-4 rounded-br-[32px]"].map((c) => (
              <span
                key={c}
                className={cn(
                  "absolute size-14 transition-colors",
                  c,
                  phase === "success" ? "border-available" : phase === "error" ? "border-missing" : "border-white",
                )}
                aria-hidden
              />
            ))}
            {phase === "scanning" && (
              <div className="absolute inset-x-5 top-5 bottom-5 overflow-hidden" aria-hidden>
                <div className="absolute inset-x-0 h-1 animate-scanline rounded-full bg-brand shadow-[0_0_18px_4px_var(--brand)]" />
              </div>
            )}
            <AnimatePresence>
              {(phase === "success" || phase === "error" || phase === "processing") && (
                <motion.div
                  key={phase}
                  initial={{ opacity: 0, scale: 0.6 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.8 }}
                  transition={{ type: "spring", stiffness: 420, damping: 22 }}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  <span
                    className={cn(
                      "flex size-20 items-center justify-center rounded-full shadow-2xl",
                      phase === "success" ? "bg-available" : phase === "error" ? "bg-missing" : "bg-white/20 backdrop-blur",
                    )}
                  >
                    {phase === "success" ? (
                      <Check className="size-10" strokeWidth={3} />
                    ) : phase === "error" ? (
                      <X className="size-10" strokeWidth={3} />
                    ) : (
                      <Loader2 className="size-9 animate-spin" />
                    )}
                  </span>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>

        {(phase === "denied" || phase === "unavailable") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-sidebar p-8 text-center">
            <span className="flex size-16 items-center justify-center rounded-2xl bg-white/10">
              {phase === "denied" ? <CameraOff className="size-8" /> : <Camera className="size-8" />}
            </span>
            <p className="max-w-xs text-[15px] font-semibold">{phase === "denied" ? "Camera access needed" : "Camera unavailable"}</p>
            <p className="max-w-xs text-[13.5px] text-white/65">{message}</p>
          </div>
        )}
        {phase === "starting" && (
          <div className="absolute inset-0 flex items-center justify-center" aria-live="polite">
            <Loader2 className="size-8 animate-spin text-white/70" aria-label="Starting camera" />
          </div>
        )}

        {torch !== null && (
          <button
            type="button"
            onClick={toggleTorch}
            className={cn("absolute right-4 top-4 flex size-11 items-center justify-center rounded-full backdrop-blur", torch ? "bg-white text-ink" : "bg-black/40 text-white")}
            aria-label={torch ? "Turn off torch" : "Turn on torch"}
            aria-pressed={torch}
          >
            <Flashlight className="size-5" />
          </button>
        )}
      </div>

      <div className="relative space-y-3 bg-sidebar px-4 pb-4 pt-4">
        <div aria-live="assertive" className="min-h-[24px] text-center text-[14px] font-medium">
          {phase === "success" && message ? (
            <span className="text-green-300">{message}</span>
          ) : phase === "error" && message ? (
            <span className="inline-flex items-center gap-1.5 text-red-300">
              <XCircle className="size-4" /> {message}
            </span>
          ) : phase === "processing" ? (
            <span className="text-white/80">Scanning...</span>
          ) : (
            <span className="text-white/60">{hint}</span>
          )}
        </div>
        {manual ? (
          <form onSubmit={submitManual} className="flex gap-2">
            <input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="Enter ID, e.g. CPT-000031"
              aria-label="Enter equipment ID"
              autoCapitalize="characters"
              className="h-12 min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-4 text-[15px] text-white placeholder:text-white/40 focus:border-brand focus:outline-none"
            />
            <button type="submit" className="h-12 rounded-xl bg-brand px-5 text-[15px] font-semibold text-white">
              Find
            </button>
          </form>
        ) : (
          <button type="button" onClick={() => setManual(true)} className="mx-auto flex h-11 items-center gap-2 rounded-xl px-4 text-[14px] font-semibold text-white/80 hover:bg-white/10">
            <Keyboard className="size-4" /> Enter code manually
          </button>
        )}
      </div>
    </div>
  );
}

/** Full-screen scanner overlay (mobile) / large modal (desktop). */
export function ScannerOverlay({
  open,
  onClose,
  title,
  onScan,
  hint,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  onScan: (text: string) => Promise<ScanOutcome>;
  hint?: string;
}) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          role="dialog"
          aria-modal="true"
          aria-label={title}
        >
          <motion.div
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="flex h-dvh w-full flex-col overflow-hidden bg-black sm:h-[640px] sm:max-w-md sm:rounded-[28px]"
          >
            <div className="flex items-center justify-between bg-sidebar px-4 pb-3 pt-[max(12px,env(safe-area-inset-top))] text-white">
              <p className="text-[16px] font-semibold">{title}</p>
              <button onClick={onClose} className="flex size-11 items-center justify-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close scanner">
                <X className="size-5" />
              </button>
            </div>
            <QrScanner onScan={onScan} className="min-h-0 flex-1 pb-safe" hint={hint} />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
