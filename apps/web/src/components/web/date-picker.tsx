"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { normalizeDateValue } from "./api";
import { CalendarIcon } from "./icons";

type DatePickerProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  max?: string;
};

const weekdayLabels = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

function formatMonthLabel(value: Date) {
  return new Intl.DateTimeFormat("en", { month: "long", year: "numeric", timeZone: "UTC" }).format(value);
}

function formatTriggerLabel(value: string, placeholder: string) {
  const normalized = normalizeDateValue(value);
  if (!normalized) return placeholder;

  const [year, month, day] = normalized.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function parseIsoDate(value: string) {
  const normalized = normalizeDateValue(value);
  if (!normalized) return null;
  const [year, month, day] = normalized.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function buildCalendarDays(monthDate: Date) {
  const startOfMonth = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1));
  const startWeekday = startOfMonth.getUTCDay();
  const gridStart = new Date(Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth(), 1 - startWeekday));

  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(gridStart);
    date.setUTCDate(gridStart.getUTCDate() + index);
    return date;
  });
}

export function DatePicker({
  value,
  onChange,
  placeholder = "Select date",
  max,
}: DatePickerProps) {
  const initialDate = useMemo(() => parseIsoDate(value) ?? parseIsoDate(max ?? "") ?? new Date(), [value, max]);
  const [open, setOpen] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(
    new Date(Date.UTC(initialDate.getUTCFullYear(), initialDate.getUTCMonth(), 1)),
  );
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleEscape);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  useEffect(() => {
    const selectedDate = parseIsoDate(value);
    if (!selectedDate) return;
    setVisibleMonth(new Date(Date.UTC(selectedDate.getUTCFullYear(), selectedDate.getUTCMonth(), 1)));
  }, [value]);

  const selectedValue = normalizeDateValue(value);
  const maxValue = normalizeDateValue(max ?? "");
  const days = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);

  return (
    <div className={open ? "wai-date-picker is-open" : "wai-date-picker"} ref={rootRef}>
      <button
        type="button"
        className={selectedValue ? "wai-date-picker-trigger has-value" : "wai-date-picker-trigger"}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="wai-date-picker-icon"><CalendarIcon /></span>
        <span>{formatTriggerLabel(selectedValue, placeholder)}</span>
      </button>

      {open ? (
        <div className="wai-date-picker-popover" role="dialog" aria-label="Choose date">
          <div className="wai-date-picker-header">
            <button
              type="button"
              className="wai-date-picker-nav"
              onClick={() => setVisibleMonth((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)))}
              aria-label="Previous month"
            >
              ‹
            </button>
            <strong>{formatMonthLabel(visibleMonth)}</strong>
            <button
              type="button"
              className="wai-date-picker-nav"
              onClick={() => setVisibleMonth((current) => new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1)))}
              aria-label="Next month"
            >
              ›
            </button>
          </div>

          <div className="wai-date-picker-weekdays">
            {weekdayLabels.map((label) => (
              <span key={label}>{label}</span>
            ))}
          </div>

          <div className="wai-date-picker-grid">
            {days.map((day) => {
              const dayValue = toIsoDate(day);
              const outsideMonth = day.getUTCMonth() !== visibleMonth.getUTCMonth();
              const disabled = Boolean(maxValue && dayValue > maxValue);
              const isSelected = selectedValue === dayValue;

              return (
                <button
                  key={dayValue}
                  type="button"
                  className={[
                    "wai-date-picker-day",
                    outsideMonth ? "is-muted" : "",
                    isSelected ? "is-selected" : "",
                  ].filter(Boolean).join(" ")}
                  disabled={disabled}
                  onClick={() => {
                    onChange(dayValue);
                    setOpen(false);
                  }}
                >
                  {day.getUTCDate()}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
