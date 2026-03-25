"use client";

import { useId } from "react";
import { UploadIcon } from "./icons";

type FilePickerProps = {
  label: string;
  accept: string;
  file: File | null;
  onChange: (file: File | null) => void;
  helper: string;
};

export function FilePicker({ label, accept, file, onChange, helper }: FilePickerProps) {
  const inputId = useId();

  return (
    <div className="wai-file-picker">
      <input
        id={inputId}
        className="wai-file-input"
        type="file"
        accept={accept}
        onChange={(event) => onChange(event.target.files?.[0] ?? null)}
      />

      <label htmlFor={inputId} className="wai-file-trigger">
        <span className="wai-file-trigger-icon"><UploadIcon /></span>
        <span>{file ? "Change file" : label}</span>
      </label>

      <div className="wai-file-copy">
        <strong>{file ? file.name : "No file selected yet"}</strong>
        <span>{file ? `${Math.max(1, Math.round(file.size / 1024))} KB` : helper}</span>
      </div>

      {file ? (
        <button className="wai-file-clear" type="button" onClick={() => onChange(null)}>
          Remove
        </button>
      ) : null}
    </div>
  );
}
