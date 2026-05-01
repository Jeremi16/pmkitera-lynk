import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { cn } from "../lib/utils";

export default function Select({ value, onChange, options, className }) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  const handleSelect = (optionValue) => {
    onChange(optionValue);
    setIsOpen(false);
  };

  const currentOptionLabel = React.useMemo(() => {
    const opt = options.find((o) => (typeof o === "string" ? o === value : o.value === value));
    return opt ? (typeof opt === "string" ? opt : opt.label) : value;
  }, [value, options]);

  return (
    <div className={cn("relative w-full", className)} ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full min-w-0 flex items-center justify-between gap-2 rounded-xl border bg-white px-4 py-2.5 text-sm text-slate-700 shadow-sm transition-all duration-200 outline-none",
          isOpen
            ? "border-primary-400 ring-3 ring-primary-100"
            : "border-slate-200 hover:border-slate-300"
        )}
      >
        <span className="truncate capitalize">{currentOptionLabel}</span>
        <ChevronDown
          size={16}
          className={cn(
            "text-slate-400 transition-transform duration-200",
            isOpen && "rotate-180 text-primary-500"
          )}
        />
      </button>

      {isOpen && (
        <div className="absolute z-50 top-[calc(100%+8px)] left-0 w-full min-w-[160px] bg-white/95 backdrop-blur-xl border border-slate-100 shadow-2xl rounded-2xl animate-fade-in p-1.5 overflow-hidden">
          <div className="max-h-60 overflow-y-auto w-full">
            {options.map((option) => {
              const optValue = typeof option === "string" ? option : option.value;
              const optLabel = typeof option === "string" ? option : option.label;
              const isSelected = optValue === value;

              return (
                <button
                  key={optValue}
                  type="button"
                  onClick={() => handleSelect(optValue)}
                  className={cn(
                    "w-full flex items-center justify-between gap-2 px-3 py-2.5 text-sm rounded-xl transition-all duration-150 text-left cursor-pointer outline-none mb-1 last:mb-0",
                    isSelected
                      ? "bg-primary-50 text-primary-700 font-bold"
                      : "text-slate-600 hover:bg-slate-50 hover:text-slate-900 font-medium"
                  )}
                >
                  <span className="truncate capitalize">{optLabel}</span>
                  {isSelected && <Check size={16} className="text-primary-600 flex-shrink-0" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
