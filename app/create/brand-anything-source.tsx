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

const INSTALL_SKILL_PROMPT = `Install the img2threejs skill from https://github.com/img2threejs/img2threejs.

Read its SKILL.md, follow its setup instructions, and confirm when the skill is ready to use.`;

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

function buildAgentPrompt(assetName: string) {
  const subject = assetName.trim() || "the object";
  return `Use the img2threejs skill to reconstruct ${subject} from the reference image or images attached to this message as a real-time browser model.

Treat multiple images as different views of the same object. Follow the skill's mandatory local-state, assessment, strict-quality, locked-pass, multi-angle and visual review gates. Preserve the visible silhouette, proportions, material regions and identity-defining details. Mark hidden sides as inferred instead of inventing confidence.

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
  const [uploadState, setUploadState] = useState<"idle" | "uploading" | "ready" | "error">(model ? "ready" : "idle");
  const [uploadError, setUploadError] = useState("");
  const [copied, setCopied] = useState<"" | "install" | "prompt">("");
  const modelUrlRef = useRef<string | null>(null);
  const guideDialogRef = useRef<HTMLDialogElement>(null);
  const modelInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => () => {
    if (modelUrlRef.current) URL.revokeObjectURL(modelUrlRef.current);
  }, []);

  useEffect(() => {
    if (source !== "photo") return;
    onSourceChange("model");
    guideDialogRef.current?.showModal();
  }, [onSourceChange, source]);

  const agentPrompt = useMemo(() => buildAgentPrompt(assetName), [assetName]);
  const visibleUploadState = model && uploadState === "idle" ? "ready" : uploadState;

  const markCopied = async (kind: "install" | "prompt", text: string) => {
    try {
      await copyText(text);
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => current === kind ? "" : current), 1800);
    } catch {
      setUploadError("Your browser blocked copying. Select the prompt and copy it manually.");
    }
  };

  const openPhotoGuide = () => {
    setUploadError("");
    guideDialogRef.current?.showModal();
  };

  const returnToModelUpload = () => {
    guideDialogRef.current?.close();
    window.setTimeout(() => modelInputRef.current?.focus(), 0);
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

      const uploadBody = await uploadFile.arrayBuffer();
      const response = await fetch(ticket.signedUrl, {
        method: "PUT",
        headers: {
          "cache-control": "max-age=3600",
          "content-type": ticket.contentType || expectedMime,
          "x-upsert": "false",
        },
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
          className={styles.activeSource}
          onClick={() => modelInputRef.current?.focus()}
        >
          <span>01</span><strong>Upload a 3D model</strong><small>GLB, GLTF, OBJ or STL · single file</small>
        </button>
        <button
          type="button"
          onClick={openPhotoGuide}
        >
          <span>02</span><strong>I only have photos</strong><small>Create the model privately with Codex <i aria-hidden="true">↗</i></small>
        </button>
      </div>

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
            ref={modelInputRef}
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

      <dialog
        ref={guideDialogRef}
        className={styles.photoGuide}
        aria-labelledby="photo-guide-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) guideDialogRef.current?.close();
        }}
      >
        <div className={styles.photoGuidePanel}>
          <header className={styles.photoGuideHeader}>
            <div>
              <p>Photo → private 3D model</p>
              <h3 id="photo-guide-title">Let Codex build the model.</h3>
              <span>No shell commands. No photo upload to Brand Anything.</span>
            </div>
            <button type="button" aria-label="Close photo guide" onClick={() => guideDialogRef.current?.close()}>×</button>
          </header>

          <ol className={styles.agentSteps}>
            <li>
              <span>1</span>
              <div className={styles.agentStepCopy}>
                <strong>Get Codex</strong>
                <p>Download Codex, then open a new task for your object.</p>
              </div>
              <a className={styles.codexLink} href="https://chatgpt.com/codex/" target="_blank" rel="noreferrer">Download Codex <span aria-hidden="true">↗</span></a>
            </li>
            <li>
              <span>2</span>
              <div className={styles.agentStepCopy}>
                <strong>Ask Codex to install img2threejs</strong>
                <p>Copy this message into Codex. It will handle the installation for you.</p>
              </div>
              <div className={styles.promptBox}>
                <pre>{INSTALL_SKILL_PROMPT}</pre>
                <button type="button" onClick={() => void markCopied("install", INSTALL_SKILL_PROMPT)}>{copied === "install" ? "Installation prompt copied" : "Copy installation prompt"}</button>
              </div>
            </li>
            <li>
              <span>3</span>
              <div className={styles.agentStepCopy}>
                <strong>Attach your photos and send the brief</strong>
                <p>Attach one clear photo or several angles directly to your Codex task, then send this prompt.</p>
              </div>
              <div className={`${styles.promptBox} ${styles.modelPromptBox}`}>
                <pre>{agentPrompt}</pre>
                <button type="button" onClick={() => void markCopied("prompt", agentPrompt)}>{copied === "prompt" ? "Model prompt copied" : "Copy model prompt"}</button>
              </div>
              <p className={styles.photoPrivacy}><span aria-hidden="true">●</span> Your photos go only to the agent you choose. They are never selected or uploaded on this site.</p>
            </li>
          </ol>

          <footer className={styles.photoGuideFooter}>
            <p>When Codex exports <strong>brand-anything.glb</strong>, come back and upload it here.</p>
            <button type="button" onClick={returnToModelUpload}>Upload my finished model</button>
          </footer>
        </div>
      </dialog>

      {uploadError && <p className={styles.validation} role="alert">{uploadError}</p>}
    </section>
  );
}

export type { AnythingSource };
