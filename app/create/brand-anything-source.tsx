"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { ModelStage } from "@/app/model-stage";
import {
  BRAND_MODEL_ACCEPT,
  brandModelFormatList,
  getBrandModelFormat,
  getBrandModelMimeType,
  isSupportedBrandModelFileName,
  MAX_BRAND_MODEL_BYTES,
  readableFileSize,
  type BrandModelFormat,
  type UploadedBrandModel,
} from "@/lib/brand-model";

import styles from "./create.module.css";

type AnythingSource = "model" | "photo";

type UploadTicket = {
  bucket?: string;
  path?: string;
  token?: string;
  signedUrl?: string;
  contentType?: string;
  format?: BrandModelFormat;
  uploadClaim?: string;
  error?: string;
};

type BrandAnythingSourceProps = {
  assetName: string;
  onAssetNameChange: (value: string) => void;
  source: AnythingSource;
  onSourceChange: (value: AnythingSource) => void;
  model: UploadedBrandModel | null;
  onModelChange: (value: UploadedBrandModel | null) => void;
  getUploadHeaders: () => Record<string, string>;
};

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    const copied = document.execCommand("copy");
    textarea.remove();
    if (!copied) throw new Error("Copy was blocked.");
  }
}

function buildAgentPrompt(assetName: string, referenceName: string) {
  const subject = assetName.trim() || "the object";
  return `Use the img2threejs skill to reconstruct ${subject} from ./${referenceName} as a real-time browser model.

Follow the skill's mandatory local-state, assessment, strict-quality, locked-pass, multi-angle and visual review gates. Preserve the visible silhouette, proportions, material regions and identity-defining details. Mark hidden sides as inferred instead of inventing confidence.

Keep the procedural Three.js factory and its evidence artifacts. After the final quality gate, also export one self-contained binary glTF named brand-anything.glb for Brand Anything:
- one .glb file with embedded textures and no external dependencies
- Y-up, centred at the origin, facing +Z
- under 25 MB and suitable for a WebGL viewer
- no cameras, environment maps, scripts or remote assets
- preserve any safe idle animation

Do not stop at a screenshot. Verify the exported GLB in a browser, then tell me where brand-anything.glb was written.`;
}

export function BrandAnythingSource({
  assetName,
  onAssetNameChange,
  source,
  onSourceChange,
  model,
  onModelChange,
  getUploadHeaders,
}: BrandAnythingSourceProps) {
  const [localModelUrl, setLocalModelUrl] = useState<string | null>(null);
  const [localModelFormat, setLocalModelFormat] = useState<BrandModelFormat | null>(
    model ? getBrandModelFormat(model.fileName) : null,
  );
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [referenceName, setReferenceName] = useState("reference.jpg");
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "ready" | "error">(model ? "ready" : "idle");
  const [uploadError, setUploadError] = useState("");
  const [copied, setCopied] = useState<"" | "codex" | "claude" | "prompt">("");
  const modelUrlRef = useRef<string | null>(null);
  const referenceUrlRef = useRef<string | null>(null);

  useEffect(() => () => {
    if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current);
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
  }, []);

  const agentPrompt = useMemo(
    () => buildAgentPrompt(assetName, referenceName),
    [assetName, referenceName],
  );
  const visibleUploadState = model && uploadState === "idle" ? "ready" : uploadState;

  const markCopied = async (kind: "codex" | "claude" | "prompt", text: string) => {
    try {
      await copyText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => current === kind ? "" : current), 1800);
    } catch {
      setUploadError("Your browser blocked copying. Select the command and copy it manually.");
    }
  };

  const uploadModel = async (file: File) => {
    setUploadError("");
    const format = getBrandModelFormat(file.name);
    if (!format || !isSupportedBrandModelFileName(file.name)) {
      setUploadState("error");
      setUploadError(`Choose a supported ${brandModelFormatList()} model. Multi-file packages are not supported.`);
      return;
    }
    if (file.size <= 0 || file.size > MAX_BRAND_MODEL_BYTES) {
      setUploadState("error");
      setUploadError("Your 3D model needs to be smaller than 25 MB.");
      return;
    }

    if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    modelUrlRef.current = nextUrl;
    setLocalModelUrl(nextUrl);
    setLocalModelFormat(format);
    setUploadState("uploading");
    onModelChange(null);
    const expectedMime = getBrandModelMimeType(format)!;
    const uploadFile = file.type === expectedMime
      ? file
      : new File([file], file.name, { type: expectedMime, lastModified: file.lastModified });

    try {
      const ticketResponse = await fetch("/api/models/upload-ticket", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...getUploadHeaders() },
        body: JSON.stringify({ fileName: file.name, size: file.size }),
      });
      const ticket = await ticketResponse.json() as UploadTicket;
      if (!ticketResponse.ok || !ticket.bucket || !ticket.path || !ticket.token || !ticket.signedUrl || !ticket.uploadClaim) {
        throw new Error(ticket.error || "The upload could not be prepared.");
      }

      const uploadBody = new FormData();
      uploadBody.append("cacheControl", "3600");
      uploadBody.append("", uploadFile);
      const response = await fetch(ticket.signedUrl, {
        method: "PUT",
        headers: { "x-upsert": "false" },
        body: uploadBody,
      });
      if (!response.ok) throw new Error("The storage service rejected this upload.");

      onModelChange({
        storagePath: ticket.path,
        uploadClaim: ticket.uploadClaim,
        fileName: file.name,
        size: file.size,
        format: ticket.format || format,
      });
      setUploadState("ready");
    } catch (error) {
      setUploadState("error");
      setUploadError(error instanceof Error ? error.message : "The model upload failed. Please try again.");
    }
  };

  const chooseReference = (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/") || file.size > 10 * 1024 * 1024) {
      setUploadError("Reference photos must be an image smaller than 10 MB.");
      return;
    }
    if (referenceUrlRef.current) URL.revokeObjectURL(referenceUrlRef.current);
    const nextUrl = URL.createObjectURL(file);
    referenceUrlRef.current = nextUrl;
    setReferenceUrl(nextUrl);
    setReferenceName(file.name);
    setUploadError("");
  };

  return (
    <section className={styles.anythingBuilder} aria-labelledby="anything-builder-title">
      <div className={styles.anythingHeader}>
        <p>BrandMyAnything</p>
        <h2 id="anything-builder-title">Bring the object. We&apos;ll bring the auction.</h2>
        <span>Cars, boats, aircraft, instruments, robots — if an agent can model it, brands can bid on it.</span>
      </div>

      <label className={styles.inputLabel}>
        What is it?
        <input
          type="text"
          minLength={2}
          maxLength={80}
          value={assetName}
          onChange={(event) => onAssetNameChange(event.target.value)}
          placeholder="My 1972 Porsche 911"
          required
        />
        <small>This becomes the object name throughout the public auction.</small>
      </label>

      <div className={styles.sourceSwitch} role="group" aria-label="How to add your 3D object">
        <button
          type="button"
          className={source === "model" ? styles.activeSource : ""}
          aria-pressed={source === "model"}
          onClick={() => onSourceChange("model")}
        >
          <span>01</span><strong>I have a 3D model</strong><small>Upload a supported single-file model</small>
        </button>
        <button
          type="button"
          className={source === "photo" ? styles.activeSource : ""}
          aria-pressed={source === "photo"}
          onClick={() => onSourceChange("photo")}
        >
          <span>02</span><strong>I only have a photo</strong><small>Build it with your coding agent</small>
        </button>
      </div>

      {source === "model" ? (
        <div className={styles.modelRoute}>
          {localModelUrl && localModelFormat && (
            <ModelStage
              sourceUrl={localModelUrl}
              format={localModelFormat}
              label={`Preview of ${assetName || "your uploaded object"}`}
              className={styles.createModelStage}
            />
          )}
          <label className={`${styles.modelDrop} ${visibleUploadState === "ready" ? styles.modelDropReady : ""}`}>
            <input
              type="file"
              accept={BRAND_MODEL_ACCEPT}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void uploadModel(file);
              }}
            />
            <span className={styles.modelDropIcon} aria-hidden="true">↥</span>
            <strong>
              {visibleUploadState === "uploading" ? "Uploading your model…"
                : model ? model.fileName
                  : "Drop in one 3D model"}
            </strong>
            <small>
              {model ? `${readableFileSize(model.size)} · private until your auction is published`
                : `${brandModelFormatList()} · single file · 25 MB maximum`}
            </small>
            {visibleUploadState === "ready" && <b aria-label="Upload complete">Ready</b>}
          </label>
          {model && !localModelUrl && (
            <p className={styles.restoredModel}>✓ {model.fileName} is already uploaded and ready to publish.</p>
          )}
        </div>
      ) : (
        <div className={styles.photoRoute}>
          <div className={styles.photoIntro}>
            <span>Local-first workflow</span>
            <h3>Generation runs on your machine, inside your agent.</h3>
            <p>High-fidelity 3D generation is expensive. Brand Anything never charges your card or sends this photo to a hidden model API. Codex or Claude Code builds and quality-checks the model locally with the open-source img2threejs skill.</p>
          </div>

          <label className={styles.referenceDrop}>
            <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => chooseReference(event.target.files?.[0])} />
            {referenceUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={referenceUrl} alt={`Reference for ${assetName || "your object"}`} />
            ) : (
              <span aria-hidden="true">＋</span>
            )}
            <strong>{referenceUrl ? referenceName : "Choose the clearest reference photo"}</strong>
            <small>The photo stays in this browser. More angles improve hidden geometry.</small>
          </label>

          <ol className={styles.agentSteps}>
            <li>
              <span>1</span>
              <div><strong>Install the skill</strong><p>Pick the folder used by your coding agent.</p></div>
              <div className={styles.installCommands}>
                <button type="button" onClick={() => void markCopied("codex", "git clone https://github.com/img2threejs/img2threejs.git ~/.codex/skills/img2threejs")}>
                  <b>Codex</b><code>~/.codex/skills/img2threejs</code><em>{copied === "codex" ? "Copied" : "Copy install"}</em>
                </button>
                <button type="button" onClick={() => void markCopied("claude", "git clone https://github.com/img2threejs/img2threejs.git ~/.claude/skills/img2threejs")}>
                  <b>Claude Code</b><code>~/.claude/skills/img2threejs</code><em>{copied === "claude" ? "Copied" : "Copy install"}</em>
                </button>
              </div>
            </li>
            <li>
              <span>2</span>
              <div><strong>Hand the job to your agent</strong><p>Put the photo in the agent&apos;s workspace, then paste this quality-gated brief.</p></div>
              <div className={styles.promptBox}>
                <pre>{agentPrompt}</pre>
                <button type="button" onClick={() => void markCopied("prompt", agentPrompt)}>{copied === "prompt" ? "Prompt copied" : "Copy agent prompt"}</button>
              </div>
            </li>
            <li>
              <span>3</span>
              <div><strong>Bring back brand-anything.glb</strong><p>Once the agent has browser-verified it, upload that file here and continue the normal auction flow.</p></div>
              <button type="button" className={styles.returnToModel} onClick={() => onSourceChange("model")}>I have my GLB →</button>
            </li>
          </ol>
        </div>
      )}

      {uploadError && <p className={styles.validation} role="alert">{uploadError}</p>}
    </section>
  );
}

export type { AnythingSource };
